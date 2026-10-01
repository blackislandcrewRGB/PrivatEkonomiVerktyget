import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, networthSnapshots, savingsValues, transactions, type NetworthSnapshot } from "../db/schema.js";
import { addMonths, monthOf } from "../overview/dates.js";
import { valuePortfolio } from "../savings/portfolio.js";
import { balanceSheet, type BalanceSheet } from "./networth.js";

/**
 * Historik: nettoförmögenheten månad för månad.
 *
 * A snapshot is taken once, for a month that has ended, and never recomputed.
 * A history that changed when an old transaction was edited would not be a
 * history — it would be a second opinion about the present.
 *
 * Months from before the tool was keeping them can sometimes be worked out
 * backwards, and those are marked. What cannot be worked out is not guessed:
 * a month whose savings value is unknown is left out entirely rather than
 * plotted without it, because a line that dips by two hundred thousand kronor
 * for a reason that never happened is worse than a line that starts later.
 */

const KEEP_MONTHS = 12;

/** The last day of a month: '2026-08' -> '2026-08-31'. */
export function lastDayOf(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

// ---------- Turning a sheet into a snapshot ----------

type Row = BalanceSheet["liquid"][number];
const sumWhere = (rows: Row[], match: (key: string) => boolean) => rows.filter((r) => match(r.key)).reduce((s, r) => s + r.amountOre, 0);

export function snapshotFrom(month: string, sheet: BalanceSheet, opts: { estimated?: boolean; note?: string | null } = {}) {
  return {
    month,
    date: sheet.on,
    accountsOre: sumWhere(sheet.liquid, (k) => k.startsWith("account:")),
    securitiesOre: sumWhere(sheet.liquid, (k) => k.startsWith("securities:")),
    cashOre: sumWhere(sheet.liquid, (k) => k.startsWith("cash:")),
    partnerOre: sumWhere(sheet.liquid, (k) => k === "partner"),
    cardsOre: sumWhere(sheet.debts, (k) => k.startsWith("card:")),
    otherDebtOre: sumWhere(sheet.debts, (k) => !k.startsWith("card:")),
    csnOre: sheet.totals.csnOre,
    illiquidOre: sheet.totals.illiquidOre,
    netExCsnOre: sheet.totals.netExCsnOre,
    netIncCsnOre: sheet.totals.netIncCsnOre,
    estimated: opts.estimated ?? false,
    note: opts.note ?? null,
  };
}

// ---------- Working a month out backwards ----------

/**
 * What a bank account held on a past day.
 *
 * The balance is a single number that was true when the bank last said so, so
 * the rows booked between that day and the day asked about are taken off it
 * again. Rows booked after it are not in the balance yet and are left alone.
 */
export function accountBalanceOn(db: Db, accountId: number, on: string, balance: number, balanceDate: string): number {
  const since = db
    .select({ sum: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), gt(transactions.bookingDate, on), lte(transactions.bookingDate, balanceDate), isNull(transactions.deletedAt)))
    .get();
  return balance - (since?.sum ?? 0);
}

/**
 * The savings on a past day: the holdings as they stood then (the trades up
 * to that day) at the prices if they reach back that far, else the newest
 * value entered by hand on or before it. Null when neither does, which is
 * what stops a month from being estimated at all. Today's holdings at an old
 * price would count a purchase made since as if it had always been there.
 */
export function savingsOn(db: Db, on: string): number | null {
  const valued = valuePortfolio(db, on, { holdingsOn: true });
  if (valued.holdings.length > 0 && valued.missing.length === 0) {
    return valued.accounts.reduce((s, a) => s + a.securitiesOre + (a.cashOre ?? 0), 0);
  }
  const manual = db.select().from(savingsValues).where(lte(savingsValues.date, on)).orderBy(desc(savingsValues.date)).all();
  if (manual.length === 0) return null;
  // One row per holding on its newest day at or before `on`.
  const newest = new Map<number, number>();
  for (const v of manual) if (!newest.has(v.holdingId)) newest.set(v.holdingId, v.value);
  return [...newest.values()].reduce((s, v) => s + v, 0);
}

/**
 * A month as it can be worked out today. Null when the savings are unknown:
 * a net worth missing the portfolio is not a smaller net worth, it is a
 * different question.
 */
export function estimateMonth(db: Db, month: string): ReturnType<typeof snapshotFrom> | null {
  const on = lastDayOf(month);
  const savings = savingsOn(db, on);
  if (savings === null) return null;

  const sheet = balanceSheet(db, on);
  const banks = db.select().from(accounts).where(and(eq(accounts.kind, "bank"), eq(accounts.trackBalance, true))).all();
  const accountsOre = banks.reduce((s, a) => s + accountBalanceOn(db, a.id, on, a.balance, a.balanceUpdatedAt?.slice(0, 10) ?? on), 0);

  // The sheet's own account and savings figures are today's; everything else
  // on it — the cards, the partner, the loan — is already worked out for the
  // day asked about.
  const base = snapshotFrom(month, sheet, { estimated: true, note: "Framräknad i efterhand: kontosaldon ur transaktionerna, sparandet ur senast inlagda värde." });
  const restated = { ...base, accountsOre, securitiesOre: savings, cashOre: 0 };
  const liquid = restated.accountsOre + restated.securitiesOre + restated.cashOre + restated.partnerOre;
  const debts = restated.cardsOre + restated.otherDebtOre;
  return {
    ...restated,
    netExCsnOre: liquid - debts,
    netIncCsnOre: liquid - debts - restated.csnOre,
  };
}

// ---------- Keeping the history ----------

/**
 * Takes the snapshots that are due and fills in what can be worked out.
 *
 * A month is recorded exactly only on the day it ends, because that is the
 * only day the account balances are its own. Any other month is worked out
 * backwards and marked as an estimate — using today's balances for a month
 * that ended three weeks ago would be a guess wearing the word 'recorded'.
 *
 * Idempotent and safe to run any day: a month that already has a snapshot is
 * never touched, so a recorded month is never replaced by an estimate of
 * itself, and a server that was off on the 31st catches up later.
 */
export function captureDue(db: Db, today: string): { captured: string[]; estimated: string[] } {
  const have = new Set(db.select({ month: networthSnapshots.month }).from(networthSnapshots).all().map((r) => r.month));
  const thisMonth = monthOf(today);
  const lastWhole = addMonths(thisMonth, -1);
  const captured: string[] = [];
  const estimated: string[] = [];

  // The last day of the month: the figures standing right now are that
  // month's own, and nothing has to be worked out.
  if (today === lastDayOf(thisMonth) && !have.has(thisMonth) && savingsOn(db, today) !== null) {
    db.insert(networthSnapshots).values(snapshotFrom(thisMonth, balanceSheet(db, today))).run();
    have.add(thisMonth);
    captured.push(thisMonth);
  }

  for (let i = 0; i < KEEP_MONTHS; i++) {
    const month = addMonths(lastWhole, -i);
    if (have.has(month)) continue;
    const row = estimateMonth(db, month);
    if (!row) continue;
    db.insert(networthSnapshots).values(row).run();
    have.add(month);
    estimated.push(month);
  }
  return { captured, estimated: estimated.reverse() };
}

export interface History {
  months: NetworthSnapshot[];
  /** Today, as a point to end the line on. Not stored: the month isn't over. */
  today: { month: string; date: string; netExCsnOre: number; netIncCsnOre: number; illiquidOre: number };
  /** The oldest month that could be worked out, and why it stops there. */
  earliest: string | null;
  missing: string | null;
}

export function history(db: Db, today: string): History {
  captureDue(db, today);
  const from = addMonths(monthOf(today), -KEEP_MONTHS);
  const months = db
    .select()
    .from(networthSnapshots)
    .where(sql`${networthSnapshots.month} >= ${from}`)
    .orderBy(networthSnapshots.month)
    .all();
  const sheet = balanceSheet(db, today);

  // Why the line starts where it does. The savings are the binding
  // constraint: everything else can be worked out from the transactions.
  const earliest = months[0]?.month ?? null;
  const before = earliest ? addMonths(earliest, -1) : addMonths(monthOf(today), -1);
  const missing = savingsOn(db, lastDayOf(before)) === null ? `Längre bak går inte att räkna: inget värde för sparandet finns före ${lastDayOf(before)}.` : null;

  return {
    months,
    today: {
      month: monthOf(today),
      date: today,
      netExCsnOre: sheet.totals.netExCsnOre,
      netIncCsnOre: sheet.totals.netIncCsnOre,
      illiquidOre: sheet.totals.illiquidOre,
    },
    earliest,
    missing,
  };
}
