import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { productAliases, productGroups, products, receiptLines, receipts } from "../db/schema.js";
import { loadRows } from "../analysis/analysis.js";
import { receiptsByTransaction } from "./receipts.js";
import type { Period } from "./products.js";

/**
 * What the receipts add up to, for the Matvaror tab.
 *
 * The first thing this has to say is how little it knows. Receipts cover a
 * part of the groceries, and a sum built on that part reads as the whole
 * unless the coverage is written next to it. So every answer here comes with
 * how many of the period's grocery purchases it was built from.
 *
 * Receipts are never halved: a purchase is split between two people, a
 * shopping bag isn't. The money side is therefore counted whole too
 * ('household'), so the two numbers can stand next to each other.
 */

export interface GrocerySummary {
  coverage: { purchases: number; withReceipt: number; spentOre: number; receiptOre: number };
  /** Per shelf over the period. `id` null is the groceries nobody has placed. */
  groups: { id: number | null; name: string; color: string | null; totalOre: number; times: number }[];
  /** Per month, per shelf: the stacked bars. Keys are group ids, or 'none'. `receipts`: how many receipts the month has. */
  months: { month: string; totalOre: number; receipts: number; groups: Record<string, number> }[];
  /**
   * The rows that aren't groceries: discounts are negative, the money saved.
   * `bags`: how many, when every bag row says so (a quantity, or a price per
   * bag to divide by); null when one doesn't.
   */
  extras: { discountOre: number; depositOre: number; bagOre: number; bags: number | null };
  stores: { store: string; receipts: number; totalOre: number }[];
}

/** One purchase of one grocery, for the price history of a single product. */
export interface ProductPurchase {
  receiptId: number;
  date: string;
  store: string;
  name: string;
  quantityMilli: number | null;
  unit: string | null;
  unitPriceOre: number | null;
  totalOre: number;
}

export interface ProductHistory {
  rows: ProductPurchase[];
  /** Days between purchases on average, when it has been bought more than once. */
  everyDays: number | null;
  /** What it comes to in a month over the period. */
  perMonthOre: number | null;
  /** The shop with the lowest price per purchase, when more than one has sold it. */
  cheapestStore: string | null;
}

const monthOf = (date: string) => date.slice(0, 7);

function months(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); ) {
    out.push(m);
    const [y, mm] = m.split("-").map(Number);
    const next = new Date(Date.UTC(y, mm, 1));
    m = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return out;
}

const within = (period: Period) => {
  const where = [isNull(receipts.deletedAt)];
  if (period.from) where.push(sql`${receipts.purchaseDate} >= ${period.from}`);
  if (period.to) where.push(sql`${receipts.purchaseDate} <= ${period.to}`);
  return where;
};

/**
 * How much of the period's grocery money has a receipt behind it.
 *
 * Only receipts on grocery purchases count here, so the two sums answer the
 * same question. A receipt from Rusta is a real receipt and is in the shelves
 * and the months below — it just isn't part of what the groceries cost.
 */
function coverage(db: Db, from: string, to: string) {
  // The household's whole amounts: a receipt is never half a receipt.
  const grocery = loadRows(db, from, to, "household").filter((r) => r.parts.some((p) => p.isFood === "groceries") && r.amount < 0);
  const ids = grocery.map((r) => r.id);
  const withReceipt = receiptsByTransaction(db, ids);
  const receiptIds = new Set([...withReceipt.values()].map((r) => r.id));
  const receiptOre = db
    .select({ id: receipts.id, totalOre: receipts.totalOre })
    .from(receipts)
    .where(isNull(receipts.deletedAt))
    .all()
    .filter((r) => receiptIds.has(r.id))
    .reduce((s, r) => s + r.totalOre, 0);
  return {
    purchases: grocery.length,
    withReceipt: grocery.filter((r) => withReceipt.has(r.id)).length,
    spentOre: grocery.reduce((s, r) => s + Math.round(-r.amount), 0),
    receiptOre,
  };
}

export function grocerySummary(db: Db, from: string, to: string): GrocerySummary {
  const period: Period = { from, to };
  const shelves = db.select().from(productGroups).orderBy(asc(productGroups.position), asc(productGroups.name)).all();

  const rows = db
    .select({
      kind: receiptLines.kind,
      totalOre: receiptLines.totalOre,
      purchaseDate: receipts.purchaseDate,
      store: receipts.store,
      receiptId: receipts.id,
      groupId: products.groupId,
      quantityMilli: receiptLines.quantityMilli,
      unitPriceOre: receiptLines.unitPriceOre,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .leftJoin(productAliases, eq(productAliases.nameKey, receiptLines.nameKey))
    .leftJoin(products, eq(products.id, productAliases.productId))
    .where(and(...within(period)))
    .all();

  const byGroup = new Map<string, { totalOre: number; times: number }>();
  const byMonth = new Map<string, Map<string, number>>();
  const byStore = new Map<string, { receipts: Set<number>; totalOre: number }>();
  const receiptsByMonth = new Map<string, Set<number>>();
  const extras = { discountOre: 0, depositOre: 0, bagOre: 0 };
  let bags: number | null = 0;

  for (const r of rows) {
    const store = byStore.get(r.store) ?? { receipts: new Set<number>(), totalOre: 0 };
    store.receipts.add(r.receiptId);
    store.totalOre += r.totalOre;
    byStore.set(r.store, store);
    const inMonth = receiptsByMonth.get(monthOf(r.purchaseDate)) ?? new Set<number>();
    inMonth.add(r.receiptId);
    receiptsByMonth.set(monthOf(r.purchaseDate), inMonth);

    if (r.kind === "discount") extras.discountOre += r.totalOre;
    else if (r.kind === "deposit") extras.depositOre += r.totalOre;
    else if (r.kind === "bag") {
      extras.bagOre += r.totalOre;
      const count = r.quantityMilli ? r.quantityMilli / 1000 : r.unitPriceOre ? r.totalOre / r.unitPriceOre : null;
      bags = bags === null || count === null ? null : bags + count;
    }
    if (r.kind !== "item") continue;

    const key = r.groupId === null || r.groupId === undefined ? "none" : String(r.groupId);
    const g = byGroup.get(key) ?? { totalOre: 0, times: 0 };
    g.totalOre += r.totalOre;
    g.times++;
    byGroup.set(key, g);

    const month = byMonth.get(monthOf(r.purchaseDate)) ?? new Map<string, number>();
    month.set(key, (month.get(key) ?? 0) + r.totalOre);
    byMonth.set(monthOf(r.purchaseDate), month);
  }

  const groups: GrocerySummary["groups"] = shelves
    .map((s) => ({ id: s.id as number | null, name: s.name, color: s.color, ...(byGroup.get(String(s.id)) ?? { totalOre: 0, times: 0 }) }))
    .filter((g) => g.times > 0)
    .sort((a, b) => b.totalOre - a.totalOre);
  const unplaced = byGroup.get("none");
  if (unplaced) groups.push({ id: null, name: "Utan hylla", color: null, ...unplaced });

  return {
    coverage: coverage(db, from, to),
    groups,
    months: months(from, to).map((month) => {
      const m = byMonth.get(month);
      return {
        month,
        totalOre: m ? [...m.values()].reduce((s, v) => s + v, 0) : 0,
        receipts: receiptsByMonth.get(month)?.size ?? 0,
        groups: m ? Object.fromEntries(m) : {},
      };
    }),
    extras: { ...extras, bags: bags === null || extras.bagOre === 0 ? null : Math.round(bags) },
    stores: [...byStore]
      .map(([store, s]) => ({ store, receipts: s.receipts.size, totalOre: s.totalOre }))
      .sort((a, b) => b.totalOre - a.totalOre),
  };
}

/** Every time one grocery was bought in the period, oldest first. */
export function productHistory(db: Db, productId: number, from: string, to: string): ProductHistory {
  const rows = db
    .select({
      receiptId: receipts.id,
      date: receipts.purchaseDate,
      store: receipts.store,
      name: receiptLines.name,
      quantityMilli: receiptLines.quantityMilli,
      unit: receiptLines.unit,
      unitPriceOre: receiptLines.unitPriceOre,
      totalOre: receiptLines.totalOre,
    })
    .from(productAliases)
    .innerJoin(receiptLines, eq(receiptLines.nameKey, productAliases.nameKey))
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(and(eq(productAliases.productId, productId), eq(receiptLines.kind, "item"), ...within({ from, to })))
    .orderBy(asc(receipts.purchaseDate), asc(receipts.id))
    .all();

  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const total = rows.reduce((s, r) => s + r.totalOre, 0);

  // Cheapest shop by what a purchase there cost on average; only worth saying
  // when more than one shop has sold it.
  const perStore = new Map<string, { n: number; ore: number }>();
  for (const r of rows) {
    const s = perStore.get(r.store) ?? { n: 0, ore: 0 };
    perStore.set(r.store, { n: s.n + 1, ore: s.ore + r.totalOre });
  }
  const cheapest = [...perStore].sort((a, b) => a[1].ore / a[1].n - b[1].ore / b[1].n)[0];

  return {
    rows,
    everyDays: rows.length > 1 ? Math.max(1, Math.round(days(rows[0].date, rows[rows.length - 1].date) / (rows.length - 1))) : null,
    perMonthOre: rows.length > 0 ? Math.round(total / Math.max(1, months(from, to).length)) : null,
    cheapestStore: perStore.size > 1 ? cheapest[0] : null,
  };
}
