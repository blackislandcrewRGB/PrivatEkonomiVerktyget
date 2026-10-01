import { and, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { fxRates, recurringExpenses, transactions } from "../db/schema.js";

/**
 * A fixed expense priced in another currency: Claude's 90 € a month plus
 * Swedish VAT, drawn in kronor on the Mastercard at the bank's rate.
 *
 * The kronor amount is worked out, never typed: the price with VAT, times
 * Riksbanken's latest rate, plus the markup the bank has taken on the
 * account's own charges in that currency (their kronor over their foreign
 * amount, against Riksbanken's rate that day). It is written to `amount`
 * whenever the rate or the price changes, so everything that reads the amount
 * — the forecast, the card invoice, Delad ekonomi — follows the rate.
 */

type Expense = typeof recurringExpenses.$inferSelect;

/** How many of the account's latest charges in the currency the markup is taken from. */
const MARKUP_CHARGES = 5;
/** A markup outside this is a refund or a split charge, not the bank's rate. */
const MAX_MARKUP = 0.05;

/** Riksbanken's rate for the currency on or before a day (kronor per unit), with its day. */
export function fxRate(db: Db, currency: string, on?: string): { rate: number; date: string } | null {
  const pair = `${currency}SEK` as (typeof fxRates.$inferSelect)["pair"];
  const row = db
    .select({ rateE6: fxRates.rateE6, date: fxRates.date })
    .from(fxRates)
    .where(on ? and(eq(fxRates.pair, pair), lte(fxRates.date, on)) : eq(fxRates.pair, pair))
    .orderBy(desc(fxRates.date))
    .get();
  return row ? { rate: row.rateE6 / 1e6, date: row.date } : null;
}

/**
 * The bank's markup on Riksbanken's rate for charges in a currency on an
 * account: the median over its latest charges, 0 without any to go by.
 */
export function bankMarkup(db: Db, accountId: number | null, currency: string): number {
  if (accountId === null) return 0;
  const rows = db
    .select({ amount: transactions.amount, foreignAmount: transactions.foreignAmount, day: transactions.transactionDate, booked: transactions.bookingDate })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.foreignCurrency, currency), isNotNull(transactions.foreignAmount), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.bookingDate))
    .limit(MARKUP_CHARGES * 2)
    .all();
  const markups: number[] = [];
  for (const r of rows) {
    if (!r.foreignAmount || Math.sign(r.foreignAmount) !== Math.sign(r.amount)) continue;
    const riksbank = fxRate(db, currency, r.day ?? r.booked);
    if (!riksbank) continue;
    const m = r.amount / r.foreignAmount / riksbank.rate - 1;
    if (m >= 0 && m <= MAX_MARKUP) markups.push(m);
    if (markups.length === MARKUP_CHARGES) break;
  }
  if (!markups.length) return 0;
  const sorted = markups.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The price with VAT, in hundredths of the currency. */
export const withVat = (e: Pick<Expense, "foreignAmount" | "vatPercent">) => Math.round((e.foreignAmount ?? 0) * (1 + (e.vatPercent ?? 0) / 100));

export interface ForeignPrice {
  currency: string;
  /** Hundredths of the currency. */
  price: number;
  vatPercent: number;
  withVat: number;
  rate: number;
  rateDate: string;
  markup: number;
  /** Öre. */
  amount: number;
}

/** What an expense priced in a currency comes to in kronor today; null when it isn't, or there is no rate yet. */
export function foreignPrice(db: Db, e: Pick<Expense, "currency" | "foreignAmount" | "vatPercent" | "accountId">): ForeignPrice | null {
  if (!e.currency || !e.foreignAmount) return null;
  const fx = fxRate(db, e.currency);
  if (!fx) return null;
  const markup = bankMarkup(db, e.accountId, e.currency);
  const gross = withVat(e);
  return {
    currency: e.currency,
    price: e.foreignAmount,
    vatPercent: e.vatPercent ?? 0,
    withVat: gross,
    rate: fx.rate,
    rateDate: fx.date,
    markup,
    amount: Math.round(gross * fx.rate * (1 + markup)),
  };
}

/**
 * Writes today's kronor to an expense priced in a currency: its amount, and a
 * coming new price's (see priceChange.ts). Returns whether anything changed.
 */
export function priceInKronor(db: Db, e: Expense): boolean {
  const p = foreignPrice(db, e);
  const next = e.nextForeignAmount ? foreignPrice(db, { ...e, foreignAmount: e.nextForeignAmount }) : null;
  const patch: Partial<Expense> = {};
  if (p && p.amount > 0 && p.amount !== e.amount) patch.amount = p.amount;
  if (next && next.amount > 0 && next.amount !== e.nextAmount) patch.nextAmount = next.amount;
  if (!Object.keys(patch).length) return false;
  db.update(recurringExpenses).set(patch).where(eq(recurringExpenses.id, e.id)).run();
  return true;
}

/** Writes today's kronor to every expense priced in a currency. Returns how many changed. */
export function refreshForeignPrices(db: Db): number {
  return db
    .select()
    .from(recurringExpenses)
    .where(isNotNull(recurringExpenses.currency))
    .all()
    .filter((e) => priceInKronor(db, e)).length;
}
