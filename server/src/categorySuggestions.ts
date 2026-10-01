import { inArray, isNull } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { transactions } from "./db/schema.js";
import { findMatchingRule } from "./categorize/matchRules.js";
import { merchantKey, merchantText, normalizePhone } from "./categorize/counterparty.js";
import { loadCategorizeContext } from "./categorize/categorize.js";
import { merchantCategoryKey } from "./import/norwegianKey.js";

export type SuggestionReason = "rule" | "merchant_category" | "history" | "similar" | "popular";

export interface CategorySuggestion {
  categoryId: number;
  reason: SuggestionReason;
  /** 'Regel: LIDL', 'Norwegian: GROCERY STORES', '12 gånger tidigare'. */
  detail: string;
  /** How many of the asked rows the suggestion comes from. */
  rows: number;
}

const MAX = 6;
const ORDER: Record<SuggestionReason, number> = { rule: 0, merchant_category: 1, history: 2, similar: 3, popular: 4 };
/** Words that say nothing about the merchant ('SWISH', 'K*', company forms). */
const NOISE = new Set(["SWISH", "SKICKAD", "MOTTAGEN", "BETALNING", "INBETALNING", "AB", "INC", "LTD", "THE", "COM", "SE"]);

/** The first word that tells merchants apart: 'ICA' in 'ICA KVANTUM EXEMPEL', 'AMAZON' in 'AMAZON.SE* ZP52'. */
export function merchantWord(key: string): string | null {
  const word = key
    .split(/[^A-ZÅÄÖ0-9]+/)
    .find((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w));
  return word ?? null;
}

/**
 * Categories to offer first in the picker for one or more rows: what a rule
 * says, what Bank Norwegian's merchant category maps to, then what the same
 * merchant (same direction) got before, most used first. For several rows
 * the reasons are pooled: rules and merchant categories first, then history,
 * each by how many rows back them. 'Okänt' is never suggested.
 *
 * With `fill` (Att granska's quick picks): categories of merchants sharing the
 * first telling word come next ('Liknande'), then the categories used most in
 * the same direction, until there are `fill` of them.
 */
export function categorySuggestions(db: Db, ids: number[], opts: { fill?: number } = {}): CategorySuggestion[] {
  if (ids.length === 0) return [];
  const rows = db.select().from(transactions).where(inArray(transactions.id, ids.slice(0, 5000))).all();
  if (rows.length === 0) return [];
  const ctx = loadCategorizeContext(db);
  const unknownId = ctx.categoryIdByKey.get("unknown");
  const found = new Map<number, CategorySuggestion & { weight: number }>();
  const add = (categoryId: number | null | undefined, reason: SuggestionReason, detail: string, weight = 1) => {
    if (!categoryId || categoryId === unknownId || !ctx.categoryById.has(categoryId)) return;
    const prev = found.get(categoryId);
    if (!prev) return found.set(categoryId, { categoryId, reason, detail, rows: 1, weight });
    if (ORDER[reason] < ORDER[prev.reason]) Object.assign(prev, { reason, detail });
    prev.rows++;
    prev.weight += weight;
  };

  for (const t of rows) {
    if (t.amount > 0 && ctx.partnerNumbers.has(normalizePhone(t.counterparty ?? "") ?? "")) {
      add(ctx.categoryIdByKey.get("from_partner"), "rule", "Swish från partnern");
    }
    const rule = findMatchingRule(ctx.rules, merchantText(t.descriptionClean), t.amount);
    if (rule) add(rule.categoryId, "rule", `Regel: ${rule.pattern}`);
    if (t.merchantCategory) {
      const mapped = ctx.merchantMap.get(merchantCategoryKey(t.merchantCategory))?.categoryId;
      add(mapped, "merchant_category", `Norwegian: ${t.merchantCategory}`);
    }
  }

  // What the same merchants got before, in the same direction; with `fill`, also
  // merchants sharing the first telling word ('ICA NARA' for 'ICA KVANTUM'),
  // then the categories used most in that direction.
  const keys = new Map(rows.map((t) => [`${merchantKey(t)}|${Math.sign(t.amount)}`, true]));
  const words = new Map(rows.map((t) => [`${merchantWord(merchantKey(t))}|${Math.sign(t.amount)}`, merchantKey(t)]));
  const signs = new Set(rows.map((t) => Math.sign(t.amount)));
  const asked = new Set(rows.map((t) => t.id));
  const history = new Map<number, number>();
  const similar = new Map<number, { n: number; example: string }>();
  const popular = new Map<number, number>();
  for (const t of db.select().from(transactions).where(isNull(transactions.deletedAt)).all()) {
    if (asked.has(t.id) || t.categoryId === null || t.categoryId === unknownId || t.isTransfer) continue;
    const key = merchantKey(t);
    const sign = Math.sign(t.amount);
    if (keys.has(`${key}|${sign}`)) {
      history.set(t.categoryId, (history.get(t.categoryId) ?? 0) + 1);
      continue;
    }
    if (!opts.fill) continue;
    const word = merchantWord(key);
    if (word && words.has(`${word}|${sign}`)) {
      const s = similar.get(t.categoryId) ?? { n: 0, example: key };
      s.n++;
      similar.set(t.categoryId, s);
    }
    if (signs.has(sign)) popular.set(t.categoryId, (popular.get(t.categoryId) ?? 0) + 1);
  }
  for (const [categoryId, n] of [...history].sort((a, b) => b[1] - a[1])) {
    if (found.has(categoryId)) continue;
    found.set(categoryId, { categoryId, reason: "history", detail: `${n} ${n === 1 ? "gång" : "gånger"} tidigare`, rows: 0, weight: n });
  }
  for (const [categoryId, s] of [...similar].sort((a, b) => b[1].n - a[1].n)) {
    if (found.has(categoryId)) continue;
    found.set(categoryId, { categoryId, reason: "similar", detail: `Liknande: ${s.example}`, rows: 0, weight: s.n });
  }
  const max = Math.max(MAX, opts.fill ?? 0);
  const out = [...found.values()]
    .sort((a, b) => ORDER[a.reason] - ORDER[b.reason] || b.rows - a.rows || b.weight - a.weight)
    .slice(0, max);
  if (opts.fill && out.length < opts.fill) {
    for (const [categoryId, n] of [...popular].sort((a, b) => b[1] - a[1])) {
      if (out.length >= opts.fill) break;
      if (out.some((o) => o.categoryId === categoryId) || !ctx.categoryById.has(categoryId)) continue;
      if (ctx.categoryById.get(categoryId)!.isSettlement) continue;
      out.push({ categoryId, reason: "popular", detail: "Ofta använd", rows: 0, weight: n });
    }
  }
  return out.map(({ categoryId, reason, detail, rows }) => ({ categoryId, reason, detail, rows }));
}
