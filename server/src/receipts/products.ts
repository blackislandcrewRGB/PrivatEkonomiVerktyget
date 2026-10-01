import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { productAliases, productGroups, products, receiptLines, receipts, type Product, type ProductGroup } from "../db/schema.js";
import { ReceiptError, receiptNameKey } from "./parse.js";
import { PRODUCT_GROUPS, groupForName } from "./productRules.js";

/**
 * Groceries as things rather than as printed lines.
 *
 * A receipt row is what one shop called something once. Lidl cuts the name at
 * eighteen characters, Willys shouts it with the size baked in, and the same
 * oat drink is 'Havredryck Barista' in one shop and 'HAVREDRYCK NATURELL' in
 * another. So every printed name is an alias, and the product is what they
 * mean. Two names become one product when the user says so, and the answer
 * keeps: next month's receipt with either name lands on the same product.
 *
 * Nothing here touches money. A product is a way of reading rows that are
 * already stored — the receipt still holds the amounts, and the transaction
 * still holds the truth.
 */

export interface ProductWithStats extends Product {
  groupName: string | null;
  groupColor: string | null;
  /** The printed names that mean this product, the oldest first. */
  aliases: string[];
  /** Receipt rows that are this product, and what they came to. */
  times: number;
  totalOre: number;
  lastPurchase: string | null;
}

/** Willys prints in capitals; a product isn't shouted. Only fully upper-case names are folded. */
function displayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (/\p{Ll}/u.test(trimmed)) return trimmed;
  const lower = trimmed.toLocaleLowerCase("sv");
  return lower.replace(/\p{L}/u, (c) => c.toLocaleUpperCase("sv"));
}

/** The shelves that are missing, added. Never changes one that exists: it may have been renamed. */
export function seedProductGroups(db: Db): number {
  let added = 0;
  PRODUCT_GROUPS.forEach((g, i) => {
    if (db.select({ id: productGroups.id }).from(productGroups).where(eq(productGroups.name, g.name)).get()) return;
    db.insert(productGroups).values({ name: g.name, color: g.color, position: i }).run();
    added++;
  });
  return added;
}

export function listGroups(db: Db): ProductGroup[] {
  return db.select().from(productGroups).orderBy(asc(productGroups.position), asc(productGroups.name)).all();
}

/**
 * The product a printed name means, made on the spot when the name is new.
 * The rules give the new one a shelf to start on; from then on it is the
 * product's own, and renaming or moving it never asks the rules again.
 */
export function resolveProduct(db: Db, name: string): number {
  const nameKey = receiptNameKey(name);
  if (!nameKey) throw new ReceiptError("Varan behöver ett namn.");
  const existing = db.select({ productId: productAliases.productId }).from(productAliases).where(eq(productAliases.nameKey, nameKey)).get();
  if (existing) return existing.productId;

  const guess = groupForName(nameKey);
  const groupId = guess
    ? (db.select({ id: productGroups.id }).from(productGroups).where(eq(productGroups.name, guess)).get()?.id ?? null)
    : null;
  const product = db.insert(products).values({ name: displayName(name), groupId }).returning({ id: products.id }).get();
  db.insert(productAliases).values({ nameKey, productId: product.id }).run();
  return product.id;
}

/**
 * Every item row that has no product yet gets one. Run after the migrations,
 * so receipts stored before this existed are in the list too, and so a
 * restored backup or an imported export heals itself.
 */
export function syncProducts(db: Db): number {
  const rows = db
    .selectDistinct({ name: receiptLines.name, nameKey: receiptLines.nameKey })
    .from(receiptLines)
    .leftJoin(productAliases, eq(productAliases.nameKey, receiptLines.nameKey))
    .where(and(eq(receiptLines.kind, "item"), isNull(productAliases.id)))
    .orderBy(asc(receiptLines.nameKey))
    .all();
  for (const r of rows) resolveProduct(db, r.name);
  return rows.length;
}

interface Stat {
  productId: number;
  times: number;
  totalOre: number;
  lastPurchase: string | null;
}

/** Which receipts count: the ones that are still there, and inside the period asked for. */
export interface Period {
  from?: string;
  to?: string;
}

/** Rows per product in one query: how many, for how much, most recently when. */
function stats(db: Db, period: Period): Map<number, Stat> {
  const where = [isNull(receipts.deletedAt), eq(receiptLines.kind, "item")];
  if (period.from) where.push(sql`${receipts.purchaseDate} >= ${period.from}`);
  if (period.to) where.push(sql`${receipts.purchaseDate} <= ${period.to}`);
  const rows = db
    .select({
      productId: productAliases.productId,
      times: sql<number>`count(*)`,
      totalOre: sql<number>`coalesce(sum(${receiptLines.totalOre}), 0)`,
      lastPurchase: sql<string | null>`max(${receipts.purchaseDate})`,
    })
    .from(productAliases)
    .innerJoin(receiptLines, eq(receiptLines.nameKey, productAliases.nameKey))
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(and(...where))
    .groupBy(productAliases.productId)
    .all();
  return new Map(rows.map((r) => [r.productId, r]));
}

/**
 * Every product, with its names and what it has cost in the period. Products
 * with no shelf come first: they are the ones waiting for an answer.
 */
export function listProducts(db: Db, period: Period = {}): ProductWithStats[] {
  const counted = stats(db, period);
  const names = new Map<number, string[]>();
  for (const a of db.select().from(productAliases).orderBy(asc(productAliases.id)).all()) {
    names.set(a.productId, [...(names.get(a.productId) ?? []), a.nameKey]);
  }
  return db
    .select({ product: products, groupName: productGroups.name, groupColor: productGroups.color })
    .from(products)
    .leftJoin(productGroups, eq(productGroups.id, products.groupId))
    .orderBy(sql`${products.groupId} is not null`, asc(products.name))
    .all()
    .map(({ product, groupName, groupColor }) => ({
      ...product,
      groupName,
      groupColor,
      aliases: names.get(product.id) ?? [],
      times: counted.get(product.id)?.times ?? 0,
      totalOre: counted.get(product.id)?.totalOre ?? 0,
      lastPurchase: counted.get(product.id)?.lastPurchase ?? null,
    }));
}

export function getProduct(db: Db, id: number, period: Period = {}): ProductWithStats | undefined {
  return listProducts(db, period).find((p) => p.id === id);
}

const touch = { updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` };

export function renameProduct(db: Db, id: number, name: string): Product {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new ReceiptError("Varan behöver ett namn.");
  const row = db.update(products).set({ name: clean, ...touch }).where(eq(products.id, id)).returning().get();
  if (!row) throw new ReceiptError("Varan finns inte.");
  return row;
}

export function setProductGroup(db: Db, id: number, groupId: number | null): Product {
  if (groupId !== null && !db.select({ id: productGroups.id }).from(productGroups).where(eq(productGroups.id, groupId)).get()) {
    throw new ReceiptError("Varugruppen finns inte.");
  }
  const row = db.update(products).set({ groupId, ...touch }).where(eq(products.id, id)).returning().get();
  if (!row) throw new ReceiptError("Varan finns inte.");
  return row;
}

/**
 * Two names for the same thing. The aliases move to the product that is kept
 * and the others go, so both the rows already stored and the ones pasted next
 * month read as one grocery.
 */
export function mergeProducts(db: Db, keepId: number, mergeIds: number[]): Product {
  const keep = db.select().from(products).where(eq(products.id, keepId)).get();
  if (!keep) throw new ReceiptError("Varan finns inte.");
  const ids = [...new Set(mergeIds)].filter((id) => id !== keepId);
  if (ids.length === 0) throw new ReceiptError("Välj minst en vara att slå ihop.");
  const found = db.select({ id: products.id }).from(products).where(inArray(products.id, ids)).all();
  if (found.length !== ids.length) throw new ReceiptError("En av varorna finns inte.");

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    tx.update(productAliases).set({ productId: keepId }).where(inArray(productAliases.productId, ids)).run();
    tx.delete(products).where(inArray(products.id, ids)).run();
    return tx.update(products).set(touch).where(eq(products.id, keepId)).returning().get();
  }) as Product;
}

/**
 * The way back out of a merge that was wrong: one printed name leaves its
 * product and becomes its own again. The last name of a product can't leave —
 * that would be a product nothing means.
 */
export function detachAlias(db: Db, nameKey: string): Product {
  const alias = db.select().from(productAliases).where(eq(productAliases.nameKey, nameKey)).get();
  if (!alias) throw new ReceiptError("Namnet finns inte.");
  const siblings = db
    .select({ id: productAliases.id })
    .from(productAliases)
    .where(and(eq(productAliases.productId, alias.productId), ne(productAliases.id, alias.id)))
    .all();
  if (siblings.length === 0) throw new ReceiptError("Varan har bara det här namnet.");

  const row = db.select({ name: receiptLines.name }).from(receiptLines).where(eq(receiptLines.nameKey, nameKey)).get();
  const old = db.select().from(products).where(eq(products.id, alias.productId)).get();
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const product = tx
      .insert(products)
      .values({ name: displayName(row?.name ?? nameKey), groupId: old?.groupId ?? null })
      .returning()
      .get();
    tx.update(productAliases).set({ productId: product.id }).where(eq(productAliases.id, alias.id)).run();
    return product;
  }) as Product;
}

export function createGroup(db: Db, name: string, color: string | null): ProductGroup {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new ReceiptError("Varugruppen behöver ett namn.");
  if (db.select({ id: productGroups.id }).from(productGroups).where(eq(productGroups.name, clean)).get()) {
    throw new ReceiptError("Det finns redan en varugrupp med det namnet.");
  }
  const last = db.select({ p: productGroups.position }).from(productGroups).orderBy(desc(productGroups.position)).get();
  return db.insert(productGroups).values({ name: clean, color, position: (last?.p ?? 0) + 1 }).returning().get();
}

export function updateGroup(db: Db, id: number, patch: { name?: string; color?: string | null }): ProductGroup {
  const set: Partial<ProductGroup> = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim().replace(/\s+/g, " ");
    if (!clean) throw new ReceiptError("Varugruppen behöver ett namn.");
    const taken = db.select({ id: productGroups.id }).from(productGroups).where(eq(productGroups.name, clean)).get();
    if (taken && taken.id !== id) throw new ReceiptError("Det finns redan en varugrupp med det namnet.");
    set.name = clean;
  }
  if (patch.color !== undefined) set.color = patch.color;
  const row = Object.keys(set).length
    ? db.update(productGroups).set(set).where(eq(productGroups.id, id)).returning().get()
    : db.select().from(productGroups).where(eq(productGroups.id, id)).get();
  if (!row) throw new ReceiptError("Varugruppen finns inte.");
  return row;
}

/**
 * The rules, run again over the products that have no shelf. Only on request:
 * taking a grocery off a shelf is an answer too, and a pass at startup would
 * quietly undo it. What it is for is the names that came in before a rule
 * knew them.
 */
export function placeUnplaced(db: Db): number {
  const shelves = new Map(listGroups(db).map((g) => [g.name, g.id]));
  let placed = 0;
  for (const p of db.select().from(products).where(isNull(products.groupId)).all()) {
    const groupId = shelves.get(groupForName(p.name) ?? "");
    if (groupId === undefined) continue;
    db.update(products).set({ groupId, ...touch }).where(eq(products.id, p.id)).run();
    placed++;
  }
  return placed;
}

/** The group goes; its products stay and are simply unplaced again. */
export function deleteGroup(db: Db, id: number): boolean {
  return db.delete(productGroups).where(eq(productGroups.id, id)).returning({ id: productGroups.id }).all().length > 0;
}
