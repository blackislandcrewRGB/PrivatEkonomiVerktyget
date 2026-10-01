import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, merchantCategoryMap, merchantRules, transactions, type Category, type CategoryKey, type MerchantRule } from "../db/schema.js";
import { getCategoryKeyMap } from "../db/seed.js";
import { findMatchingRule } from "./matchRules.js";
import { merchantText, normalizePhone } from "./counterparty.js";
import { merchantCategoryKey } from "../import/norwegianKey.js";
import { getPartnerNumbers } from "../settings.js";

export interface CategorizeContext {
  rules: MerchantRule[];
  categoryById: Map<number, Category>;
  categoryIdByKey: Map<CategoryKey, number>;
  merchantMap: Map<string, { categoryId: number | null }>;
  partnerNumbers: Set<string>;
}

export function loadCategorizeContext(db: Db): CategorizeContext {
  return {
    rules: db.select().from(merchantRules).all(),
    categoryById: new Map(db.select().from(categories).all().map((c) => [c.id, c])),
    categoryIdByKey: getCategoryKeyMap(db),
    merchantMap: new Map(db.select().from(merchantCategoryMap).all().map((m) => [m.key, m])),
    partnerNumbers: new Set(getPartnerNumbers(db)),
  };
}

export interface CategorizeInput {
  accountId: number | null;
  descriptionClean: string;
  counterparty: string;
  amount: number;
  merchantCategory?: string | null;
  /** Shared flag when no rule says otherwise. */
  defaultShared: boolean;
  /** Set by a parser that knows what the row is (card bill payments). */
  forced?: { categoryKey: CategoryKey; isTransfer: true; shared: false };
}

export interface Categorization {
  rule?: MerchantRule;
  categoryId: number | null;
  source: "rule" | "merchant_category" | "none";
  isTransfer: boolean;
  shared: boolean;
  counterAccountId: number | null;
}

/**
 * Precedence: what the parser knows for sure (card bill payments) > money in
 * from the partner's number > merchant rules (direction-aware) > the bank's
 * merchant category > none.
 */
export function categorize(ctx: CategorizeContext, row: CategorizeInput): Categorization {
  if (row.forced) {
    return {
      categoryId: ctx.categoryIdByKey.get(row.forced.categoryKey) ?? null,
      source: "rule",
      isTransfer: true,
      shared: false,
      counterAccountId: null,
    };
  }
  if (row.amount > 0 && ctx.partnerNumbers.size > 0 && ctx.partnerNumbers.has(normalizePhone(row.counterparty) ?? "")) {
    return {
      categoryId: ctx.categoryIdByKey.get("from_partner") ?? null,
      source: "rule",
      isTransfer: false,
      shared: false,
      counterAccountId: null,
    };
  }
  const rule = findMatchingRule(ctx.rules, merchantText(row.descriptionClean), row.amount);
  if (rule) {
    const category = ctx.categoryById.get(rule.categoryId);
    const isTransfer = rule.isTransfer || !!category?.isTransfer;
    return {
      rule,
      categoryId: category?.id ?? null,
      source: "rule",
      isTransfer,
      // Transfers are never shared expenses.
      shared: isTransfer ? false : (rule.sharedDefault ?? row.defaultShared),
      counterAccountId: rule.counterAccountId && rule.counterAccountId !== row.accountId ? rule.counterAccountId : null,
    };
  }
  const mapped = row.merchantCategory ? ctx.merchantMap.get(merchantCategoryKey(row.merchantCategory))?.categoryId : null;
  const category = mapped ? ctx.categoryById.get(mapped) : undefined;
  const isTransfer = !!category?.isTransfer;
  return {
    categoryId: category?.id ?? null,
    source: category ? "merchant_category" : "none",
    isTransfer,
    shared: isTransfer ? false : row.defaultShared,
    counterAccountId: null,
  };
}

/**
 * Runs categorisation again on rows that still have no category (rules added
 * since they were imported). Rows edited by hand, transfers and deleted rows
 * are never touched. Returns how many rows got a category.
 */
export function recategorizeUncategorized(db: Db): number {
  const ctx = loadCategorizeContext(db);
  const rows = db
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
  let changed = 0;
  for (const t of rows) {
    const c = categorize(ctx, {
      accountId: t.accountId,
      descriptionClean: t.descriptionClean,
      counterparty: t.counterparty ?? t.descriptionClean,
      amount: t.amount,
      merchantCategory: t.merchantCategory,
      defaultShared: t.shared,
    });
    if (c.categoryId === null) continue;
    db.update(transactions)
      .set({
        categoryId: c.categoryId,
        categorySource: c.source,
        isTransfer: c.isTransfer,
        // Private rows are never shared, whatever the rule says.
        shared: t.private ? false : c.shared,
        ...(t.counterAccountId === null && c.counterAccountId !== null ? { counterAccountId: c.counterAccountId } : {}),
      })
      .where(eq(transactions.id, t.id))
      .run();
    if (c.rule) db.update(merchantRules).set({ hits: sql`${merchantRules.hits} + 1` }).where(eq(merchantRules.id, c.rule.id)).run();
    changed++;
  }
  return changed;
}
