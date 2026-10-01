import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { labelRules, transactions, type LabelRule, type MerchantRule } from "../db/schema.js";
import { restoreRows, snapshotRows, type RowSnapshot } from "../undo.js";
import { findMatchingRule, isValidRegex } from "./matchRules.js";
import { merchantText } from "./counterparty.js";

// Name rules: 'ANTHROPIC* CLAUDE SUB' → 'CLAUDE Abonnemang' on new imports.
// Matched like category rules, on the merchant text, most specific first.

export class LabelRuleError extends Error {}

export interface LabelRuleSpec {
  pattern: string;
  matchType: MerchantRule["matchType"];
}

export const loadLabelRules = (db: Db) => db.select().from(labelRules).all();

/** The name a new row gets from the rules, or null. */
export function labelFor(rules: readonly LabelRule[], descriptionClean: string): string | null {
  return findMatchingRule(rules, merchantText(descriptionClean))?.label ?? null;
}

/** Imported rows without a name of their own (manual rows' text is their name). */
function unnamed(db: Db) {
  return db
    .select({ id: transactions.id, descriptionClean: transactions.descriptionClean })
    .from(transactions)
    .where(and(isNull(transactions.label), isNull(transactions.deletedAt), ne(transactions.source, "manual")))
    .all();
}

function matching(db: Db, spec: LabelRuleSpec) {
  if (spec.matchType === "regex" && !isValidRegex(spec.pattern)) return [];
  const rule = { id: 0, pattern: spec.pattern, matchType: spec.matchType };
  return unnamed(db).filter((t) => findMatchingRule([rule], merchantText(t.descriptionClean)));
}

/**
 * A pattern for these rows: the start their merchant texts share
 * ('ANTHROPIC* CLAUDE SUB' twice → itself), else the first row's text.
 */
export function suggestLabelPattern(db: Db, ids: number[]): LabelRuleSpec | null {
  if (!ids.length) return null;
  const texts = db
    .select({ d: transactions.descriptionClean })
    .from(transactions)
    .where(inArray(transactions.id, ids.slice(0, 500)))
    .all()
    .map((r) => merchantText(r.d).trim());
  if (!texts.length) return null;
  let prefix = texts[0];
  for (const t of texts.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < t.length && prefix[i].toLocaleLowerCase("sv") === t[i].toLocaleLowerCase("sv")) i++;
    prefix = prefix.slice(0, i);
  }
  // Don't end halfway through a word or on punctuation ('ANTHROPIC* CL' → 'ANTHROPIC').
  const whole = texts.every((t) => t.length === prefix.length || !/[\p{L}\p{N}]/u.test(t[prefix.length]) || !/[\p{L}\p{N}]/u.test(prefix.at(-1) ?? ""));
  if (!whole) prefix = prefix.replace(/[\p{L}\p{N}]+$/u, "");
  prefix = prefix.replace(/[^\p{L}\p{N}]+$/u, "");
  return { pattern: prefix.length >= 3 ? prefix : texts[0], matchType: "contains" };
}

export interface LabelRuleSuggestion extends LabelRuleSpec {
  label: string;
  /** Other rows without a name it would rename now. */
  matches: number;
  examples: string[];
  /** A rule with the same pattern that gives another name (it would be replaced). */
  existingRuleId: number | null;
}

/**
 * After a row is renamed by hand: a name rule for its text, so new imports
 * get the same name. None for manual rows, without a name, or when a rule
 * already gives the row this name.
 */
export function suggestLabelRule(db: Db, t: { id: number; label: string | null; descriptionClean: string; source: string }): LabelRuleSuggestion | null {
  if (!t.label || t.source === "manual") return null;
  const rules = loadLabelRules(db);
  if (findMatchingRule(rules, merchantText(t.descriptionClean))?.label === t.label) return null;
  const spec = suggestLabelPattern(db, [t.id]);
  if (!spec) return null;
  const existing = rules.find((r) => r.matchType === spec.matchType && r.pattern === spec.pattern);
  return { ...spec, label: t.label, ...previewLabelRule(db, spec, [t.id]), existingRuleId: existing?.id ?? null };
}

/** How many other rows without a name the rule would rename now, with a few of their texts. */
export function previewLabelRule(db: Db, spec: LabelRuleSpec, excludeIds: number[] = []) {
  const skip = new Set(excludeIds);
  const rows = matching(db, spec).filter((t) => !skip.has(t.id));
  return { matches: rows.length, examples: [...new Set(rows.map((r) => r.descriptionClean))].slice(0, 5) };
}

/**
 * Saves the rule (a new label for the same pattern replaces the old one) and
 * names the given rows and every imported row without a name it matches.
 * Returns what undoLabelRule needs.
 */
export function saveLabelRule(
  db: Db,
  input: LabelRuleSpec & { label: string; ids?: number[] },
): { rule: LabelRule; previousLabel: string | null; renamed: number; applied: number; before: RowSnapshot[] } {
  const pattern = input.pattern.trim();
  const label = input.label.trim();
  if (!pattern) throw new LabelRuleError("Mönstret är tomt.");
  if (!label) throw new LabelRuleError("Namnet är tomt.");
  if (!["contains", "exact", "regex"].includes(input.matchType)) throw new LabelRuleError("Okänd matchning.");
  if (input.matchType === "regex" && !isValidRegex(pattern)) throw new LabelRuleError("Ogiltigt reguljärt uttryck.");

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const previous = tx
      .select()
      .from(labelRules)
      .where(and(eq(labelRules.matchType, input.matchType), eq(labelRules.pattern, pattern)))
      .get();
    const rule = tx
      .insert(labelRules)
      .values({ pattern, matchType: input.matchType, label })
      .onConflictDoUpdate({ target: [labelRules.matchType, labelRules.pattern], set: { label } })
      .returning()
      .get();

    // The chosen rows, renamed by hand (a manual row's text is its name too).
    const chosen = input.ids?.length
      ? tx
          .select({ id: transactions.id, label: transactions.label, source: transactions.source })
          .from(transactions)
          .where(and(inArray(transactions.id, input.ids.slice(0, 10_000)), isNull(transactions.deletedAt)))
          .all()
          .filter((r) => r.label !== label)
      : [];
    const chosenIds = new Set(chosen.map((r) => r.id));
    const others = matching(tx, { pattern, matchType: input.matchType })
      .map((t) => t.id)
      .filter((id) => !chosenIds.has(id));
    const before = snapshotRows(tx, [...chosenIds, ...others]);

    const now = new Date().toISOString();
    for (const r of chosen) {
      tx.update(transactions)
        .set({ label, manuallyEditedAt: now, ...(r.source === "manual" ? { descriptionRaw: label, descriptionClean: label } : {}) })
        .where(eq(transactions.id, r.id))
        .run();
    }
    for (let i = 0; i < others.length; i += 500) {
      tx.update(transactions).set({ label }).where(inArray(transactions.id, others.slice(i, i + 500))).run();
    }
    return { rule, previousLabel: previous?.label ?? null, renamed: chosen.length, applied: others.length, before };
  });
}

/** Undoes saveLabelRule: the rows get their old names, and the rule goes (it was new) or gets its old name back. */
export function undoLabelRule(db: Db, ruleId: number, previousLabel: string | null, before: unknown): number {
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const restored = restoreRows(tx, before);
    if (previousLabel === null) tx.delete(labelRules).where(eq(labelRules.id, ruleId)).run();
    else tx.update(labelRules).set({ label: previousLabel }).where(eq(labelRules.id, ruleId)).run();
    return restored;
  });
}

/** The rules, oldest first, with how many rows (not deleted) carry the name and match the pattern. */
export function labelRuleList(db: Db) {
  const rules = db.select().from(labelRules).orderBy(asc(labelRules.id)).all();
  const named = db
    .select({ label: transactions.label, descriptionClean: transactions.descriptionClean })
    .from(transactions)
    .where(isNull(transactions.deletedAt))
    .all()
    .filter((t) => t.label !== null);
  return rules.map((r) => ({
    ...r,
    rows: named.filter((t) => t.label === r.label && findMatchingRule([r], merchantText(t.descriptionClean))).length,
  }));
}
