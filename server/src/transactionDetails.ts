import { and, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { imports, merchantRules, transactions } from "./db/schema.js";
import { merchantKey, merchantText } from "./categorize/counterparty.js";
import { ruleMatches, findMatchingRule } from "./categorize/matchRules.js";
import { suggestRule } from "./categorize/ruleService.js";
import { ruleIcon } from "./icons/icons.js";
import { addDays } from "./overview/dates.js";

/**
 * What the detail panel shows beyond the list row: the bank's raw text and
 * technical fields, the import it came from, the same merchant over the last
 * 12 months, the rules that match it (the winning one flagged) and the rule
 * that would remember its current category.
 */
export function transactionDetails(db: Db, id: number, today: string) {
  const t = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!t) return null;
  const imp = t.importId ? db.select().from(imports).where(eq(imports.id, t.importId)).get() : undefined;

  const key = merchantKey(t);
  const since = addDays(today, -365);
  const same = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), gte(transactions.bookingDate, since), eq(transactions.isTransfer, false)))
    .all()
    .filter((r) => merchantKey(r) === key && Math.sign(r.amount) === Math.sign(t.amount) && r.returnGroupId === null);
  const total = same.reduce((s, r) => s + r.amount, 0);

  const text = merchantText(t.descriptionClean);
  const rules = db.select().from(merchantRules).all();
  const matching = rules.filter((r) => {
    const dir = r.direction ?? "any";
    return (dir === "any" || (dir === "in" ? t.amount > 0 : t.amount < 0)) && ruleMatches(r, text);
  });
  const best = findMatchingRule(rules, text, t.amount);

  return {
    id: t.id,
    descriptionRaw: t.descriptionRaw,
    postedDate: t.postedDate,
    merchantCategory: t.merchantCategory,
    cardMasked: t.cardMasked,
    foreignAmount: t.foreignAmount,
    foreignCurrency: t.foreignCurrency,
    exchangeRate: t.exchangeRate,
    counterRef: t.counterRef,
    fingerprint: t.fingerprint,
    occurrenceIndex: t.occurrenceIndex,
    createdAt: t.createdAt,
    import: imp ? { id: imp.id, filename: imp.filename, importedAt: imp.importedAt } : null,
    merchant: {
      label: t.counterparty ?? text,
      /** Search text that finds the merchant's rows in the list. */
      query: (t.counterparty ?? text).trim(),
      since,
      count: same.length,
      total,
      average: same.length ? Math.round(total / same.length) : 0,
    },
    rules: matching.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      matchType: r.matchType,
      direction: r.direction,
      categoryId: r.categoryId,
      hits: r.hits,
      best: r.id === best?.id,
      iconPath: r.iconPath,
      icon: ruleIcon(r),
    })),
    // Nothing to suggest when the rule that wins already gives the row its category.
    ruleSuggestion: best && best.categoryId === t.categoryId ? null : suggestRule(db, t),
  };
}
