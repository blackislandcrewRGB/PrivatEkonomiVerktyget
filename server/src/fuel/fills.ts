import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { fuelFills, transactions, type FuelFill } from "../db/schema.js";
import { FuelError } from "./fuel.js";

/**
 * Tankningen som den står på kvittot.
 *
 * The bank says what a fill-up cost. The receipt says how many litres that
 * bought, at what price, and what was taken off — and those four numbers
 * check each other, so a typo in one of them is caught at the door instead of
 * quietly moving a consumption figure.
 *
 * **The price actually paid is not stored.** It is the total over the litres,
 * worked out when needed. A stored fifth number could disagree with the four
 * it came from, and then nobody would know which to believe.
 */

export interface FillInput {
  /** The receipt's own day, which can be the day before the bank's. */
  date: string;
  /** Hundredths of a litre: 60,44 l = 6044. */
  litresE2: number;
  /** Öre per litre as displayed at the pump, before any discount. */
  listPriceOre: number;
  /** The discount on the whole fill-up, in öre. */
  discountOre?: number;
  /** What was actually charged, in öre. */
  amountOre: number;
  transactionId?: number | null;
  station?: string | null;
  note?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rounding on the receipt itself: the two ends may differ by an öre, never more. */
export const RECEIPT_TOLERANCE_ORE = 2;

/** Öre per litre actually paid: the total over the litres. */
export const paidPerLitre = (fill: Pick<FuelFill, "amountOre" | "litresE2">) => Math.round((fill.amountOre * 100) / fill.litresE2);

/** The discount as öre per litre, which is how a fuel discount is usually given. */
export const discountPerLitre = (fill: Pick<FuelFill, "discountOre" | "litresE2">) => Math.round((fill.discountOre * 100) / fill.litresE2);

/** Litres as a number, for arithmetic that isn't money. */
export const litresOf = (fill: Pick<FuelFill, "litresE2">) => fill.litresE2 / 100;

function check(db: Db, input: FillInput): void {
  if (!DATE.test(input.date)) throw new FuelError("Datum ska vara ÅÅÅÅ-MM-DD.");
  if (!Number.isInteger(input.litresE2) || input.litresE2 <= 0) throw new FuelError("Antalet liter ska vara hundradelar av en liter, mer än noll.");
  if (!Number.isInteger(input.listPriceOre) || input.listPriceOre < 100 || input.listPriceOre > 10_000) throw new FuelError("Literpriset ska vara mellan 1 och 100 kr.");
  if (!Number.isInteger(input.amountOre) || input.amountOre <= 0) throw new FuelError("Beloppet ska vara ett antal öre, mer än noll.");
  const discount = input.discountOre ?? 0;
  if (!Number.isInteger(discount) || discount < 0) throw new FuelError("Rabatten ska vara ett antal öre, 0 eller mer.");

  // The receipt's own arithmetic: price × litres − discount = total. Getting
  // this wrong is how a mistyped litre count turns into a consumption figure
  // nobody can explain.
  const gross = Math.round((input.listPriceOre * input.litresE2) / 100);
  const off = Math.abs(gross - discount - input.amountOre);
  if (off > RECEIPT_TOLERANCE_ORE) {
    throw new FuelError(
      `Kvittot går inte ihop: ${(input.listPriceOre / 100).toFixed(2)} kr/l × ${(input.litresE2 / 100).toFixed(2)} l − ${(discount / 100).toFixed(2)} kr rabatt blir ${((gross - discount) / 100).toFixed(2)} kr, inte ${(input.amountOre / 100).toFixed(2)} kr.`,
    );
  }

  // And against the bank, which is the authority on what left the account.
  if (input.transactionId != null) {
    const tx = db.select({ amount: transactions.amount }).from(transactions).where(eq(transactions.id, input.transactionId)).get();
    if (!tx) throw new FuelError(`Transaktion ${input.transactionId} finns inte.`);
    if (Math.abs(Math.abs(tx.amount) - input.amountOre) > RECEIPT_TOLERANCE_ORE) {
      throw new FuelError(`Kvittots ${(input.amountOre / 100).toFixed(2)} kr stämmer inte med transaktionens ${(Math.abs(tx.amount) / 100).toFixed(2)} kr.`);
    }
  }
}

/**
 * Stores a receipt. One per transaction: entering the same one again updates
 * it rather than making a second fill-up out of one tank of diesel.
 */
export function saveFill(db: Db, input: FillInput): FuelFill {
  check(db, input);
  const values = {
    date: input.date,
    litresE2: input.litresE2,
    listPriceOre: input.listPriceOre,
    discountOre: input.discountOre ?? 0,
    amountOre: input.amountOre,
    transactionId: input.transactionId ?? null,
    station: input.station?.trim() || null,
    note: input.note?.trim() || null,
  };
  const existing = values.transactionId == null ? undefined : db.select().from(fuelFills).where(eq(fuelFills.transactionId, values.transactionId)).get();
  if (existing) {
    return db.update(fuelFills).set({ ...values, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` }).where(eq(fuelFills.id, existing.id)).returning().get();
  }
  return db.insert(fuelFills).values(values).returning().get();
}

export function deleteFill(db: Db, id: number): void {
  db.delete(fuelFills).where(eq(fuelFills.id, id)).run();
}

export function listFills(db: Db, range: { from?: string; to?: string } = {}): FuelFill[] {
  const where = [];
  if (range.from) where.push(gte(fuelFills.date, range.from));
  if (range.to) where.push(lte(fuelFills.date, range.to));
  return db
    .select()
    .from(fuelFills)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(fuelFills.date))
    .all();
}

/**
 * The receipts by the transaction they belong to, for the months to read.
 *
 * Keyed by transaction rather than by day: two fill-ups in one day are two
 * receipts, and a date would put them on top of each other.
 */
export function fillsByTransaction(db: Db): Map<number, FuelFill> {
  const rows = db.select().from(fuelFills).where(sql`${fuelFills.transactionId} is not null`).all();
  return new Map(rows.map((f) => [f.transactionId!, f]));
}

/**
 * A fuel transaction that has no receipt yet, newest first — what the view
 * offers to fill in.
 */
export function fillsMissing(db: Db, categoryId: number | null, from: string, to: string): { id: number; date: string; amountOre: number; description: string }[] {
  if (categoryId === null) return [];
  return db
    .select({
      id: transactions.id,
      date: sql<string>`coalesce(${transactions.transactionDate}, ${transactions.bookingDate})`,
      amountOre: sql<number>`-${transactions.amount}`,
      description: sql<string>`coalesce(${transactions.label}, ${transactions.descriptionClean})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.categoryId, categoryId),
        isNull(transactions.deletedAt),
        eq(transactions.isTransfer, false),
        sql`coalesce(${transactions.transactionDate}, ${transactions.bookingDate}) between ${from} and ${to}`,
        sql`${transactions.amount} < 0`,
        sql`not exists (select 1 from fuel_fills f where f.transaction_id = ${transactions.id})`,
      ),
    )
    .orderBy(sql`coalesce(${transactions.transactionDate}, ${transactions.bookingDate}) desc`)
    .all();
}
