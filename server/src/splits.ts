import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { categories, transactions, transactionSplits } from "./db/schema.js";

/**
 * One purchase split across several categories: an Amazon order that is partly
 * clothes, partly electronics, or a fuel stop where the hot dog isn't fuel.
 *
 * The parts live in their own table and always sum to the row's amount with
 * its sign, so no total moves when a row is split: only which categories the
 * money lands in. The transaction keeps its own `category_id` (the largest
 * part), so the row still reads as something sensible wherever only the column
 * is known.
 *
 * Splitting is always the user's own doing ('manual'), never a rule's.
 */

/** More parts than this on one purchase is a receipt, not a category. */
export const MAX_SPLIT_PARTS = 10;

export class SplitError extends Error {}

export interface SplitPart {
  categoryId: number;
  amount: number;
}

const SELECT = { categoryId: transactionSplits.categoryId, amount: transactionSplits.amount };

/** The parts of one transaction, in the order they were entered. Empty when it isn't split. */
export function splitsFor(db: Db, transactionId: number): SplitPart[] {
  return db
    .select(SELECT)
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId))
    .orderBy(asc(transactionSplits.sort), asc(transactionSplits.id))
    .all();
}

/**
 * The parts of every split transaction, by transaction id. Split rows are few,
 * so a list or a whole period loads them in one query and looks each row up.
 */
export function loadSplits(db: Db, ids?: number[]): Map<number, SplitPart[]> {
  const rows = db
    .select({ transactionId: transactionSplits.transactionId, ...SELECT })
    .from(transactionSplits)
    // Only worth narrowing for a handful of rows; SQLite has a variable limit.
    .where(ids && ids.length <= 200 ? inArray(transactionSplits.transactionId, ids) : undefined)
    .orderBy(asc(transactionSplits.transactionId), asc(transactionSplits.sort), asc(transactionSplits.id))
    .all();
  const out = new Map<number, SplitPart[]>();
  for (const r of rows) {
    const list = out.get(r.transactionId);
    if (list) list.push({ categoryId: r.categoryId, amount: r.amount });
    else out.set(r.transactionId, [{ categoryId: r.categoryId, amount: r.amount }]);
  }
  return out;
}

/**
 * A row as categories see it: its parts when it is split, otherwise the row
 * itself as one part. Everything that sums per category goes through this, so
 * a split row is counted once in each of its categories and never twice.
 */
export function partsOf<T extends { id: number; amount: number; categoryId: number | null }>(
  row: T,
  splits: Map<number, SplitPart[]>,
): { categoryId: number | null; amount: number }[] {
  return splits.get(row.id) ?? [{ categoryId: row.categoryId, amount: row.amount }];
}

const kr = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Replaces the parts of a transaction. The parts must have the row's sign and
 * add up to its amount exactly, so the user sees the remainder rather than
 * a rounding hole. Returns the parts as they were stored.
 */
export function setSplits(db: Db, transactionId: number, parts: SplitPart[]): SplitPart[] {
  const tx = db.select().from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!tx) throw new SplitError("Raden finns inte.");
  if (tx.deletedAt) throw new SplitError("Raden är borttagen.");
  if (tx.isTransfer) throw new SplitError("En överföring går inte att dela upp.");
  if (parts.length < 2) throw new SplitError("En uppdelning behöver minst två delar.");
  if (parts.length > MAX_SPLIT_PARTS) throw new SplitError(`Högst ${MAX_SPLIT_PARTS} delar går på ett köp.`);

  for (const p of parts) {
    if (!Number.isInteger(p.categoryId) || p.categoryId <= 0) throw new SplitError("Varje del behöver en kategori.");
    if (!Number.isInteger(p.amount) || p.amount === 0) throw new SplitError("Varje del behöver ett belopp.");
    if (Math.sign(p.amount) !== Math.sign(tx.amount)) throw new SplitError("Delarna ska ha samma tecken som raden.");
  }
  const ids = parts.map((p) => p.categoryId);
  if (new Set(ids).size !== ids.length) throw new SplitError("Varje kategori får bara finnas en gång. Slå ihop delarna i stället.");
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  if (sum !== tx.amount) throw new SplitError(`Delarna blir ${kr(sum)} kr, raden är ${kr(tx.amount)} kr. Det som saknas är ${kr(tx.amount - sum)} kr.`);

  const cats = db.select().from(categories).where(inArray(categories.id, ids)).all();
  for (const id of ids) {
    const cat = cats.find((c) => c.id === id);
    if (!cat) throw new SplitError("En vald kategori finns inte.");
    if (cat.isTransfer || cat.isSettlement) throw new SplitError(`${cat.name} är en överföring eller avstämning och kan inte vara en del av ett köp.`);
  }

  // The row's own category follows the largest part, so lists and rules that
  // only know the column still say something true about the purchase.
  const largest = parts.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
  db.transaction((txn) => {
    txn.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId)).run();
    txn
      .insert(transactionSplits)
      .values(parts.map((p, i) => ({ transactionId, categoryId: p.categoryId, amount: p.amount, sort: i })))
      .run();
    txn
      .update(transactions)
      .set({ categoryId: largest.categoryId, categorySource: "manual", isTransfer: false, manuallyEditedAt: new Date().toISOString() })
      .where(eq(transactions.id, transactionId))
      .run();
  });
  return splitsFor(db, transactionId);
}

/** Undoes a split: the whole amount goes back to the row's own category. */
export function clearSplits(db: Db, transactionId: number): boolean {
  const gone = db.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId)).returning({ id: transactionSplits.id }).all();
  if (gone.length) db.update(transactions).set({ manuallyEditedAt: new Date().toISOString() }).where(eq(transactions.id, transactionId)).run();
  return gone.length > 0;
}

/**
 * Drops the splits of rows whose category is set from somewhere else (a
 * category change on the row, a rule, a bulk edit): the new category then
 * applies to the whole amount. Returns how many rows lost their parts.
 */
export function clearSplitsFor(db: Db, ids: number[]): number {
  if (ids.length === 0) return 0;
  const gone = new Set<number>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of db
      .delete(transactionSplits)
      .where(inArray(transactionSplits.transactionId, ids.slice(i, i + 500)))
      .returning({ transactionId: transactionSplits.transactionId })
      .all())
      gone.add(r.transactionId);
  }
  return gone.size;
}
