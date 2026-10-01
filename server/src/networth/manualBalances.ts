import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { manualBalances, recurringExpenses, transactions, type ManualBalance } from "../db/schema.js";

/**
 * Det som ägs eller är skyldigt och som ingen import känner till.
 *
 * Two things live here today: the student loan and the car. They have nothing
 * in common except that no bank tells the tool about them, and that both are a
 * single number someone has to keep true.
 *
 * The number is an *anchor*, not a running total: what was the case on
 * `valueDate`. Where a monthly charge pays the thing down, the row points at
 * that expense and today's figure is the anchor minus every charge booked
 * since. A month drawn twice, or skipped, is then right without anyone
 * noticing — and correcting it by hand is nothing more exotic than a newer
 * anchor.
 *
 * Amounts are positive on both sides of the sheet. `kind` says which side.
 */

export interface ManualBalanceInput {
  key: string;
  kind: "asset" | "debt";
  name: string;
  amountOre: number;
  valueDate: string;
  liquid?: boolean;
  recurringExpenseId?: number | null;
  source?: string | null;
  note?: string | null;
}

export class ManualBalanceError extends Error {}

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function check(input: Pick<ManualBalanceInput, "amountOre" | "valueDate" | "name">): void {
  if (!Number.isInteger(input.amountOre) || input.amountOre < 0) {
    throw new ManualBalanceError("Beloppet ska vara ett antal öre, 0 eller mer. Skulder skrivs positivt.");
  }
  if (!DATE.test(input.valueDate)) throw new ManualBalanceError("Värdedatumet ska vara ÅÅÅÅ-MM-DD.");
  if (!input.name.trim()) throw new ManualBalanceError("Posten behöver ett namn.");
}

/** Every kept row, newest anchor per key. */
export function listManualBalances(db: Db): ManualBalance[] {
  return db.select().from(manualBalances).where(isNull(manualBalances.deletedAt)).orderBy(manualBalances.id).all();
}

/**
 * The newest anchor with this key. Nothing stops two rows sharing one — a
 * restore, an import — and the newer of them is the one that is true.
 */
export function manualBalanceByKey(db: Db, key: string): ManualBalance | undefined {
  return listManualBalances(db).findLast((r) => r.key === key);
}

export function createManualBalance(db: Db, input: ManualBalanceInput): ManualBalance {
  check(input);
  return db
    .insert(manualBalances)
    .values({
      key: input.key.trim(),
      kind: input.kind,
      name: input.name.trim(),
      amountOre: input.amountOre,
      valueDate: input.valueDate,
      liquid: input.liquid ?? false,
      recurringExpenseId: input.recurringExpenseId ?? null,
      source: clean(input.source),
      note: clean(input.note),
    })
    .returning()
    .get();
}

/**
 * A correction. The amount and the day it was true move together, because an
 * amount without its day is worth nothing: everything after the day is derived
 * from the charges, and an anchor left on an old date would subtract them
 * twice.
 */
export function updateManualBalance(db: Db, id: number, patch: Partial<ManualBalanceInput>): ManualBalance {
  const row = db.select().from(manualBalances).where(eq(manualBalances.id, id)).get();
  if (!row || row.deletedAt) throw new ManualBalanceError("Posten finns inte.");
  const next = { ...row, ...patch };
  check(next);
  return db
    .update(manualBalances)
    .set({
      name: next.name.trim(),
      amountOre: next.amountOre,
      valueDate: next.valueDate,
      liquid: next.liquid,
      recurringExpenseId: next.recurringExpenseId ?? null,
      source: clean(next.source),
      note: clean(next.note),
      updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    })
    .where(eq(manualBalances.id, id))
    .returning()
    .get();
}

export function deleteManualBalance(db: Db, id: number): boolean {
  const r = db
    .update(manualBalances)
    .set({ deletedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
    .where(and(eq(manualBalances.id, id), isNull(manualBalances.deletedAt)))
    .returning()
    .all();
  return r.length > 0;
}

export interface CurrentBalance {
  row: ManualBalance;
  /** The anchor less what has been paid off since it, never below zero. */
  amountOre: number;
  /** What has been paid since the anchor, and over how many charges. */
  paidOre: number;
  charges: number;
  /** The day of the newest charge counted, when there is one. */
  lastChargeDate: string | null;
}

/**
 * What the row is worth today.
 *
 * A debt is never carried below zero: the last charge is usually smaller than
 * the instalment, and a loan that has been paid off is paid off, not negative.
 */
export function currentBalance(db: Db, row: ManualBalance, on: string): CurrentBalance {
  if (row.recurringExpenseId === null) {
    return { row, amountOre: row.amountOre, paidOre: 0, charges: 0, lastChargeDate: null };
  }
  const paid = db
    .select({ amount: transactions.amount, date: transactions.bookingDate })
    .from(transactions)
    .where(
      and(
        eq(transactions.recurringExpenseId, row.recurringExpenseId),
        gt(transactions.bookingDate, row.valueDate),
        sql`${transactions.bookingDate} <= ${on}`,
        sql`${transactions.amount} < 0`,
        isNull(transactions.deletedAt),
      ),
    )
    .all();
  const paidOre = paid.reduce((sum, t) => sum - t.amount, 0);
  return {
    row,
    amountOre: Math.max(0, row.amountOre - paidOre),
    paidOre,
    charges: paid.length,
    lastChargeDate: paid.map((t) => t.date).sort().at(-1) ?? null,
  };
}

/** Every kept row with what it is worth today. */
export function currentBalances(db: Db, on: string): CurrentBalance[] {
  return listManualBalances(db).map((row) => currentBalance(db, row, on));
}

// ---------- Example figures ----------

/** An example student loan, as it stood the day it was written down. */
const CSN_ORE = 20_000_000;
const CSN_DATE = "2026-09-20";
/** An example car value. */
const CAR_ORE = 8_000_000;

/**
 * Puts two example figures (a student loan and a car) in place, once. Not
 * seeded into a new database: the demo data and the tests use them, and the
 * household enters its own under Hålls för hand.
 *
 * Rows that have been deleted count as present: a figure someone removed on
 * purpose must not reappear the next time the server starts.
 */
export function seedManualBalances(db: Db): number {
  const taken = new Set(db.select({ key: manualBalances.key }).from(manualBalances).all().map((r) => r.key));
  // The loan is paid down by its own monthly charge, so it points at it and
  // needs no second bookkeeping of what has been paid.
  const csnExpense = db.select({ id: recurringExpenses.id }).from(recurringExpenses).where(eq(recurringExpenses.name, "CSN")).get();
  const seeds: ManualBalanceInput[] = [
    { key: "csn", kind: "debt", name: "CSN", amountOre: CSN_ORE, valueDate: CSN_DATE, recurringExpenseId: csnExpense?.id ?? null, note: "Räknas ned när CSN-dragningen syns bland transaktionerna." },
    { key: "car", kind: "asset", name: "Bilen", amountOre: CAR_ORE, valueDate: CSN_DATE, source: "exempel" },
  ];
  let added = 0;
  for (const seed of seeds) {
    if (taken.has(seed.key)) continue;
    createManualBalance(db, seed);
    added++;
  }
  return added;
}
