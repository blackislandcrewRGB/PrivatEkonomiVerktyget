import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, contacts, merchantRules, transactions, type MerchantRule } from "../db/schema.js";
import { findMatchingRule, isValidRegex } from "./matchRules.js";
import { merchantText } from "./counterparty.js";
import { recategorizeUncategorized } from "./categorize.js";
import { restoreRows, snapshotRows, type RowSnapshot } from "../undo.js";

export interface RuleSpec {
  pattern: string;
  matchType: MerchantRule["matchType"];
  direction: MerchantRule["direction"];
  categoryId: number;
}

export interface RuleSuggestion extends RuleSpec {
  /** What to call the merchant in the UI (contact name or the pattern). */
  label: string;
  /** Other uncategorised rows the rule would categorise right away. */
  matches: number;
  /** A rule with this pattern and direction already exists (it would be updated). */
  existingRuleId: number | null;
}

type Tx = typeof transactions.$inferSelect;

const isSwish = (t: Pick<Tx, "descriptionClean">) => /^Swish\b/i.test(t.descriptionClean);

/**
 * After the user sets a category on a row: the rule that would remember it.
 * Pattern = the merchant (for Swish the phone number), 'contains'; for Swish
 * also the direction, since the same number can be money in or out.
 */
export function suggestRule(db: Db, t: Tx): RuleSuggestion | null {
  if (t.categoryId === null) return null;
  // 'Vet ej' is a one-off answer, never something to remember.
  if (db.select().from(categories).where(eq(categories.id, t.categoryId)).get()?.systemKey === "unknown") return null;
  const pattern = (t.counterparty ?? merchantText(t.descriptionClean)).trim();
  if (!pattern) return null;
  const direction: MerchantRule["direction"] = isSwish(t) ? (t.amount > 0 ? "in" : "out") : "any";
  const spec: RuleSpec = { pattern, matchType: "contains", direction, categoryId: t.categoryId };

  const existing = db
    .select()
    .from(merchantRules)
    .where(and(eq(merchantRules.matchType, "contains"), eq(merchantRules.pattern, pattern), eq(merchantRules.direction, direction)))
    .get();
  if (existing && existing.categoryId === t.categoryId) return null; // already remembered

  const contact = t.counterparty ? db.select().from(contacts).where(eq(contacts.counterparty, t.counterparty)).get() : undefined;
  return { ...spec, label: contact?.name ?? pattern, matches: previewRule(db, spec, t.id), existingRuleId: existing?.id ?? null };
}

/** Rows without category (not edited by hand, not transfers) the rule would match. */
export function previewRule(db: Db, spec: Omit<RuleSpec, "categoryId">, excludeId?: number): number {
  if (spec.matchType === "regex" && !isValidRegex(spec.pattern)) return 0;
  const rule = { id: 0, pattern: spec.pattern, matchType: spec.matchType, direction: spec.direction };
  return uncategorized(db).filter((t) => t.id !== excludeId && findMatchingRule([rule], merchantText(t.descriptionClean), t.amount)).length;
}

function uncategorized(db: Db) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.categoryId),
        eq(transactions.categorySource, "none"),
        isNull(transactions.manuallyEditedAt),
        isNull(transactions.deletedAt),
        eq(transactions.isTransfer, false),
      ),
    )
    .all();
}

export class RuleError extends Error {}

/**
 * Creates the rule (or updates the category of an existing rule with the same
 * pattern and direction) and applies it at once to uncategorised rows.
 * Returns the rule, how many rows got a category, and what undoing it needs:
 * the rule's category before (null = the rule is new) and the rows as they were.
 */
export function saveRule(
  db: Db,
  spec: RuleSpec,
): { rule: MerchantRule; applied: number; previousCategoryId: number | null; before: RowSnapshot[] } {
  const pattern = spec.pattern.trim();
  if (!pattern) throw new RuleError("Mönstret är tomt.");
  if (spec.matchType === "regex" && !isValidRegex(pattern)) throw new RuleError("Ogiltigt reguljärt uttryck.");
  const category = db.select().from(categories).where(eq(categories.id, spec.categoryId)).get();
  if (!category) throw new RuleError("Kategorin finns inte.");
  if (category.systemKey === "unknown") throw new RuleError("Okänt är ingen kategori att skapa regel för.");

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const previous = tx
      .select()
      .from(merchantRules)
      .where(and(eq(merchantRules.matchType, spec.matchType), eq(merchantRules.pattern, pattern), eq(merchantRules.direction, spec.direction)))
      .get();
    const candidates = snapshotRows(tx, uncategorized(tx).map((t) => t.id));
    const rule = tx
      .insert(merchantRules)
      .values({ pattern, matchType: spec.matchType, direction: spec.direction, categoryId: spec.categoryId, isTransfer: category.isTransfer, createdFrom: "manual" })
      .onConflictDoUpdate({
        target: [merchantRules.matchType, merchantRules.pattern, merchantRules.direction],
        set: { categoryId: spec.categoryId, isTransfer: category.isTransfer },
      })
      .returning()
      .get();
    const applied = recategorizeUncategorized(tx);
    const still = new Set(uncategorized(tx).map((t) => t.id));
    return {
      rule,
      applied,
      previousCategoryId: previous?.categoryId ?? null,
      before: candidates.filter((c) => !still.has(c.id)),
    };
  });
}

/**
 * Undoes saveRule: the rows it categorised go back as they were, and the rule
 * is removed (it was new) or gets its old category back.
 */
export function undoRule(db: Db, ruleId: number, previousCategoryId: number | null, before: unknown): number {
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const restored = restoreRows(tx, before);
    if (previousCategoryId === null) tx.delete(merchantRules).where(eq(merchantRules.id, ruleId)).run();
    else {
      const category = tx.select().from(categories).where(eq(categories.id, previousCategoryId)).get();
      if (category) tx.update(merchantRules).set({ categoryId: category.id, isTransfer: category.isTransfer }).where(eq(merchantRules.id, ruleId)).run();
    }
    return restored;
  });
}

/**
 * Rows of the last 12 months (from `since`) each rule would decide: the rule
 * that wins for the row's text and direction, whatever category the row has now.
 */
export function ruleMatchCounts(db: Db, since: string): Map<number, number> {
  const rules = db.select().from(merchantRules).all();
  const rows = db
    .select({ descriptionClean: transactions.descriptionClean, amount: transactions.amount })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), gte(transactions.bookingDate, since)))
    .all();
  const out = new Map<number, number>();
  for (const r of rows) {
    const rule = findMatchingRule(rules, merchantText(r.descriptionClean), r.amount);
    if (rule) out.set(rule.id, (out.get(rule.id) ?? 0) + 1);
  }
  return out;
}

/**
 * The rows a rule would match (all rows, not only uncategorised), newest
 * first, for 'Testa mönster': how many, how many are uncategorised, and up to
 * `limit` of them.
 */
export function ruleExamples(db: Db, spec: Omit<RuleSpec, "categoryId">, limit = 50) {
  if (!spec.pattern.trim() || (spec.matchType === "regex" && !isValidRegex(spec.pattern))) return { total: 0, uncategorized: 0, rows: [] };
  const rule = { id: 0, pattern: spec.pattern.trim(), matchType: spec.matchType, direction: spec.direction };
  const rows = db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      descriptionClean: transactions.descriptionClean,
      amount: transactions.amount,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      isTransfer: transactions.isTransfer,
      private: transactions.private,
    })
    .from(transactions)
    .where(isNull(transactions.deletedAt))
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .all()
    .filter((t) => findMatchingRule([rule], merchantText(t.descriptionClean), t.amount));
  return { total: rows.length, uncategorized: rows.filter((r) => r.categoryId === null && !r.isTransfer).length, rows: rows.slice(0, limit) };
}

/**
 * Changes a rule's pattern, type, direction or category. Rows it already
 * categorised keep their category; uncategorised rows it now matches get it.
 */
export function updateRule(db: Db, id: number, patch: Partial<RuleSpec>): { rule: MerchantRule; applied: number } {
  const current = db.select().from(merchantRules).where(eq(merchantRules.id, id)).get();
  if (!current) throw new RuleError("Regeln finns inte.");
  const next = {
    pattern: (patch.pattern ?? current.pattern).trim(),
    matchType: patch.matchType ?? current.matchType,
    direction: patch.direction ?? current.direction,
    categoryId: patch.categoryId ?? current.categoryId,
  };
  if (!next.pattern) throw new RuleError("Mönstret är tomt.");
  if (next.matchType === "regex" && !isValidRegex(next.pattern)) throw new RuleError("Ogiltigt reguljärt uttryck.");
  const category = db.select().from(categories).where(eq(categories.id, next.categoryId)).get();
  if (!category) throw new RuleError("Kategorin finns inte.");
  if (category.systemKey === "unknown") throw new RuleError("Okänt är ingen kategori att skapa regel för.");
  const clash = db
    .select()
    .from(merchantRules)
    .where(and(eq(merchantRules.matchType, next.matchType), eq(merchantRules.pattern, next.pattern), eq(merchantRules.direction, next.direction)))
    .get();
  if (clash && clash.id !== id) throw new RuleError("Det finns redan en regel med samma mönster, typ och riktning.");
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const rule = tx
      .update(merchantRules)
      .set({ ...next, isTransfer: category.isTransfer })
      .where(eq(merchantRules.id, id))
      .returning()
      .get();
    return { rule, applied: recategorizeUncategorized(tx) };
  });
}
