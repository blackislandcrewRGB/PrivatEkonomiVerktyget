import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { accounts, categories, contacts, merchantCategoryMap, merchantRules, type CategoryKey } from "./schema.js";
import {
  SEED_CATEGORIES,
  SEED_CATEGORY_KEYS,
  SEED_CONTACTS,
  SEED_MERCHANT_CATEGORIES,
  SEED_RULES,
  SEED_SETTLEMENT_CATEGORIES,
  type SeedContact,
  type SeedRule,
} from "./seedData.js";
import { getPartnerNumbers, setPartnerNumbers } from "../settings.js";
import { assignBrandSlugs } from "../icons/icons.js";
import { seedProductGroups } from "../receipts/products.js";
import { applyDefaultMapping } from "../referenceBudget/mapping.js";
import { merchantCategoryKey } from "../import/norwegianKey.js";

export interface SeedResult {
  categoriesAdded: number;
  rulesAdded: number;
  merchantCategoriesAdded: number;
}

/**
 * Inserts seed categories and rules that are missing. Accounts are the
 * household's own and made in the app (or by `exampleHousehold` for the demo
 * and the tests), never seeded here.
 * Idempotent: existing rows (including ones the user edited) are never changed.
 */
export function seed(db: Db): SeedResult {
  return db.transaction((tx) => {
    const result: SeedResult = { categoriesAdded: 0, rulesAdded: 0, merchantCategoriesAdded: 0 };

    const ensureCategory = (name: string, parentId: number | null, color: string, isTransfer: boolean) => {
      const existing = tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.name, name), parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId)))
        .get();
      if (existing) return existing.id;
      result.categoriesAdded++;
      return tx.insert(categories).values({ name, parentId, color, isTransfer }).returning({ id: categories.id }).get().id;
    };

    for (const top of SEED_CATEGORIES) {
      const isTransfer = top.isTransfer ?? false;
      const parentId = ensureCategory(top.name, null, top.color, isTransfer);
      for (const child of top.children ?? []) ensureCategory(child, parentId, top.color, isTransfer);
    }

    markSettlementCategories(tx as unknown as Db);
    assignCategoryKeys(tx as unknown as Db);

    for (const rule of SEED_RULES) result.rulesAdded += insertSeedRule(tx as unknown as Db, rule);
    result.merchantCategoriesAdded = seedMerchantCategoryMap(tx as unknown as Db);
    seedProductGroups(tx as unknown as Db);
    applyDefaultMapping(tx as unknown as Db);
    assignBrandSlugs(tx as unknown as Db);

    return result;
  });
}

/** Inserts a seed rule unless one with the same pattern exists. Returns 1 if added. */
export function insertSeedRule(db: Db, rule: SeedRule): number {
  const categoryId = getCategoryPathMap(db).get(rule.category);
  if (categoryId === undefined) throw new Error(`Seed rule references unknown category "${rule.category}"`);
  // A missing counter account (renamed or deleted by the user) just leaves it unset.
  const counterAccountId = rule.counterAccount
    ? (db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, rule.counterAccount)).get()?.id ?? null)
    : null;
  return db
    .insert(merchantRules)
    .values({
      pattern: rule.pattern,
      matchType: rule.matchType,
      categoryId,
      isTransfer: rule.isTransfer ?? false,
      sharedDefault: rule.sharedDefault ?? null,
      counterAccountId,
      direction: rule.direction ?? "any",
      createdFrom: "seed",
    })
    .onConflictDoNothing()
    .returning({ id: merchantRules.id })
    .all().length;
}

/**
 * Adds seed merchant-category mappings. An existing key is only filled in if it
 * has no category yet (logged as unknown by an import); a user's mapping is kept.
 */
export function seedMerchantCategoryMap(db: Db): number {
  const paths = getCategoryPathMap(db);
  let added = 0;
  for (const [label, path] of Object.entries(SEED_MERCHANT_CATEGORIES)) {
    const categoryId = paths.get(path);
    if (categoryId === undefined) throw new Error(`Seed merchant category references unknown category "${path}"`);
    const key = merchantCategoryKey(label);
    const existing = db.select().from(merchantCategoryMap).where(eq(merchantCategoryMap.key, key)).get();
    if (!existing) {
      db.insert(merchantCategoryMap).values({ key, label, categoryId }).run();
      added++;
    } else if (existing.categoryId === null) {
      db.update(merchantCategoryMap).set({ categoryId }).where(eq(merchantCategoryMap.id, existing.id)).run();
      added++;
    }
  }
  return added;
}

export function markSettlementCategories(db: Db): void {
  const paths = getCategoryPathMap(db);
  for (const path of SEED_SETTLEMENT_CATEGORIES) {
    const id = paths.get(path);
    if (id !== undefined) db.update(categories).set({ isSettlement: true }).where(eq(categories.id, id)).run();
  }
}

/** Adds missing contacts, and the partner's number to settings if none is set. */
export function seedContacts(db: Db, list: SeedContact[] = SEED_CONTACTS): void {
  for (const c of list) {
    db.insert(contacts).values({ counterparty: c.counterparty, name: c.name, note: c.note ?? null }).onConflictDoNothing().run();
  }
  if (getPartnerNumbers(db).length === 0) {
    const partner = list.filter((c) => c.partner).map((c) => c.counterparty);
    if (partner.length) setPartnerNumbers(db, partner);
  }
}

/** Gives the seed categories the code relies on their key, unless the key is already taken. */
export function assignCategoryKeys(db: Db): void {
  const paths = getCategoryPathMap(db);
  const taken = new Set(
    db.select({ key: categories.systemKey }).from(categories).all().map((c) => c.key).filter(Boolean),
  );
  for (const [path, key] of Object.entries(SEED_CATEGORY_KEYS)) {
    const id = paths.get(path);
    if (id === undefined || taken.has(key)) continue;
    db.update(categories).set({ systemKey: key }).where(eq(categories.id, id)).run();
  }
}

export function getCategoryKeyMap(db: Db): Map<CategoryKey, number> {
  const rows = db.select({ id: categories.id, key: categories.systemKey }).from(categories).all();
  return new Map(rows.filter((r) => r.key).map((r) => [r.key as CategoryKey, r.id]));
}

/** Category id for a key ('unknown', 'salary', …), or undefined if missing. */
export function categoryIdByKey(db: Db, key: CategoryKey): number | undefined {
  return db.select({ id: categories.id }).from(categories).where(eq(categories.systemKey, key)).get()?.id;
}

/** Map of "Parent" and "Parent/Child" paths to category ids. */
export function getCategoryPathMap(db: Db): Map<string, number> {
  const rows = db
    .select({ id: categories.id, name: categories.name, parentName: sql<string | null>`p.name` })
    .from(categories)
    .leftJoin(sql`categories p`, sql`p.id = ${categories.parentId}`)
    .all();
  return new Map(rows.map((r) => [r.parentName ? `${r.parentName}/${r.name}` : r.name, r.id]));
}

export function isDatabaseEmpty(db: Db): boolean {
  return (db.select({ n: sql<number>`count(*)` }).from(categories).get()?.n ?? 0) === 0;
}
