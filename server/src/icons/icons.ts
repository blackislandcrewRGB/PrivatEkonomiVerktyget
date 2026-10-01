import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { merchantRules, transactions } from "../db/schema.js";
import { findMatchingRule } from "../categorize/matchRules.js";
import { merchantText } from "../categorize/counterparty.js";
import { brandFor } from "./brands.js";

/**
 * A merchant's icon as the web draws it: an uploaded image, or a brand from
 * the bundled simple-icons set. Absent means the monogram. Resolved on the
 * server once per list (not per row in the browser), with the same rule
 * matching as the categories.
 */
export interface IconRef {
  brand?: string;
  image?: string;
}

/** Uploaded icons are served at /api/icons/<hash>.<ext>. */
export const iconUrl = (path: string) => `/api/icons/${path}`;

/** A rule's own icon: its image, its brand, or the built-in brand its text names. */
export function ruleIcon(rule: { pattern: string; matchType: string; brandSlug: string | null; iconPath: string | null }): IconRef | undefined {
  if (rule.iconPath) return { image: iconUrl(rule.iconPath) };
  const brand = rule.brandSlug ?? (rule.matchType === "regex" ? null : brandFor(rule.pattern));
  return brand ? { brand } : undefined;
}

type IconRule = { id: number; pattern: string; matchType: "exact" | "contains" | "regex"; direction: "any" | "in" | "out"; brandSlug: string | null; iconPath: string | null };

/**
 * Resolves texts to icons for one response. Priority: the matching rule's
 * own image, its brand, then the built-in brand for the text. `.rule()` gives
 * the rule itself (where an upload for 'all purchases there' goes).
 */
export function iconResolver(db: Db) {
  const rules: IconRule[] = db
    .select({ id: merchantRules.id, pattern: merchantRules.pattern, matchType: merchantRules.matchType, direction: merchantRules.direction, brandSlug: merchantRules.brandSlug, iconPath: merchantRules.iconPath })
    .from(merchantRules)
    .all();
  const memo = new Map<string, IconRef | undefined>();
  const rule = (text: string | null | undefined, amount?: number): IconRule | undefined => (text ? findMatchingRule(rules, merchantText(text), amount) : undefined);
  const resolve = (text: string | null | undefined, amount?: number): IconRef | undefined => {
    if (!text) return undefined;
    const key = `${amount === undefined ? "" : amount > 0 ? "+" : "-"}${text}`;
    if (memo.has(key)) return memo.get(key);
    const t = merchantText(text);
    const r = rule(text, amount);
    const brand = r?.brandSlug ?? brandFor(t);
    const icon = r?.iconPath ? { image: iconUrl(r.iconPath) } : brand ? { brand } : undefined;
    memo.set(key, icon);
    return icon;
  };
  return Object.assign(resolve, { rule });
}

/**
 * Seeds brand_slug on the rules: a rule gets a brand when every row it is
 * the best match for (or, without rows, its own text) has that same built-in
 * brand. A rule over mixed brands ('ANTHROPIC' catches Claude's subscription
 * too) is left alone, the rows get their brand one by one. Rules that already
 * have a brand are not touched. Returns how many were set.
 */
export function assignBrandSlugs(db: Db): number {
  const rules = db.select().from(merchantRules).all();
  const rows = db.select({ text: transactions.descriptionClean, amount: transactions.amount }).from(transactions).where(isNull(transactions.deletedAt)).all();
  const brands = new Map<number, Set<string | null>>();
  for (const r of rows) {
    const t = merchantText(r.text);
    const rule = findMatchingRule(rules, t, r.amount);
    if (!rule) continue;
    const set = brands.get(rule.id) ?? new Set();
    set.add(brandFor(t));
    brands.set(rule.id, set);
  }
  let n = 0;
  for (const rule of rules) {
    if (rule.brandSlug) continue;
    const found = brands.get(rule.id) ?? new Set([rule.matchType === "regex" ? null : brandFor(rule.pattern)]);
    const [only] = found;
    if (found.size !== 1 || !only) continue;
    db.update(merchantRules).set({ brandSlug: only }).where(eq(merchantRules.id, rule.id)).run();
    n++;
  }
  return n;
}
