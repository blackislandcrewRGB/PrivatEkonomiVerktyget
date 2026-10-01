import { and, eq, isNotNull, isNull, lt, gt, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applyPriceChanges } from "./priceChange.js";
import { recurringExpenses, recurringIncome, recurringIncomeOverrides, transactions } from "../db/schema.js";
import { salaryForecasts } from "../salary/salary.js";
import { merchantText } from "../categorize/counterparty.js";
import { chargeDate, nearestOccurrence, OFF_SCHEDULE_DAYS, ON_SCHEDULE_DAYS, signedDistance, YEARLY_EARLY_DAYS, YEARLY_LATE_DAYS } from "./schedule.js";
import { groupShared, partsByOwner } from "./parts.js";
import { accountFor, activeIn, counts } from "./changes.js";

type Expense = typeof recurringExpenses.$inferSelect;
type Tx = typeof transactions.$inferSelect;

export const DAY_TOLERANCE = 5;
export const AMOUNT_TOLERANCE = 0.05;
/** An income without its usual bank text is still it when it is this close to what the month expected. */
export const INCOME_AMOUNT_TOLERANCE = 0.01;

const DAY_MS = 86_400_000;

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Distance in days from a date to the nearest occurrence of day_of_month
 * (clamped to short months, looking at the previous, same and next month), and
 * the 'YYYY-MM' of that occurrence: a charge due the 31st that lands on the 2nd
 * belongs to the month before.
 */
export function nearestDue(dateIso: string, dayOfMonth: number): { distance: number; month: string } {
  const d = Date.parse(`${dateIso}T00:00:00Z`);
  const date = new Date(d);
  let best = { distance: Infinity, month: "" };
  for (const offset of [-1, 0, 1]) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + offset;
    const first = new Date(Date.UTC(y, m, 1));
    const due = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(dayOfMonth, daysInMonth(first.getUTCFullYear(), first.getUTCMonth())));
    const distance = Math.abs(Math.round((d - due) / DAY_MS));
    if (distance < best.distance) best = { distance, month: new Date(due).toISOString().slice(0, 7) };
  }
  return best;
}

export function patternMatches(pattern: string | null, description: string): boolean {
  if (!pattern) return false;
  return merchantText(description).toLocaleLowerCase("sv").includes(pattern.trim().toLocaleLowerCase("sv"));
}

/**
 * Links unlinked transactions to recurring income and expenses: same account
 * (for an expense: the account of the charge's period, see changes.ts)
 * + match_pattern in the text + a date near the due day. Income: booking date
 * within ±5 days of its day. Expenses: the charge's date (transaction or
 * booking day, per expense) within ±2 days of the draw its schedule predicts,
 * else within ±5 days (off schedule); a yearly one from 45 days before its
 * date to 10 after (bills are paid ahead). The amount is never a requirement
 * (prices change); for expenses it only breaks ties when several share a
 * merchant (two insurances from the same company, 400 and 250 kr, the same day). Each recurring expense is
 * linked at most once per period.
 *
 * An income whose text doesn't match (the salary came as 'SWED2609240EXEMPEL'
 * instead of 'Lön') is still linked when it is on its account, near its day,
 * the month hasn't had it yet, and the amount is within 1 % of what the month
 * expected: Löneprognos's net for the salary, the month's own amount, or the
 * usual amount. Otherwise it would be counted again as still to come.
 */
export function linkRecurring(db: Db): { income: number; expenses: number } {
  const linked = { income: linkIncome(db), expenses: linkExpenses(db) };
  // A new price whose first period has now been drawn becomes the price.
  applyPriceChanges(db);
  return linked;
}

function linkIncome(db: Db): number {
  const incomes = db.select().from(recurringIncome).where(and(eq(recurringIncome.active, true), isNotNull(recurringIncome.matchPattern))).all();
  if (incomes.length === 0) return 0;
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.recurringIncomeId), isNull(transactions.deletedAt), gt(transactions.amount, 0), eq(transactions.isTransfer, false), eq(transactions.paidBy, "me")))
    .all();
  // The months each income has come in already, and what a month expected of it.
  const received = new Map(
    incomes.map((i) => [
      i.id,
      new Set(
        db
          .select({ bookingDate: transactions.bookingDate })
          .from(transactions)
          .where(and(eq(transactions.recurringIncomeId, i.id), isNull(transactions.deletedAt)))
          .all()
          .map((t) => nearestDue(t.bookingDate, i.dayOfMonth).month),
      ),
    ]),
  );
  const main = [...incomes].sort((a, b) => b.amount - a.amount || a.id - b.id)[0];
  let forecasts: ReturnType<typeof salaryForecasts> | null = null;
  const expected = (i: (typeof incomes)[number], month: string): number[] => {
    const own = db
      .select({ amount: recurringIncomeOverrides.amount })
      .from(recurringIncomeOverrides)
      .where(and(eq(recurringIncomeOverrides.recurringIncomeId, i.id), eq(recurringIncomeOverrides.month, month)))
      .get()?.amount;
    if (i.id === main.id && !forecasts) forecasts = salaryForecasts(db);
    const net = i.id === main.id ? forecasts!.get(month)?.net : undefined;
    return [own, net, i.amount].filter((a): a is number => a !== undefined && a !== null);
  };
  const near = (amount: number, targets: number[]) => targets.some((t) => Math.abs(amount - t) <= t * INCOME_AMOUNT_TOLERANCE);

  let linked = 0;
  for (const r of rows) {
    const candidates = incomes.filter((i) => i.accountId === r.accountId).map((i) => ({ i, due: nearestDue(r.bookingDate, i.dayOfMonth) })).filter((c) => c.due.distance <= DAY_TOLERANCE);
    const match =
      candidates.filter((c) => patternMatches(c.i.matchPattern, r.descriptionClean)).sort((a, b) => a.due.distance - b.due.distance)[0] ??
      candidates
        .filter((c) => !received.get(c.i.id)!.has(c.due.month) && near(r.amount, expected(c.i, c.due.month)))
        .sort((a, b) => a.due.distance - b.due.distance)[0];
    if (!match) continue;
    db.update(transactions).set({ recurringIncomeId: match.i.id }).where(eq(transactions.id, r.id)).run();
    received.get(match.i.id)!.add(match.due.month);
    linked++;
  }
  return linked;
}

/** Expenses that have a schedule (a day, or the last day; and a month for yearly ones) to link against. */
function scheduled(e: Expense): boolean {
  return (e.scheduleType === "last_day" || e.anchorDay !== null) && (e.billingCycle !== "yearly" || e.anchorMonth !== null);
}

/** Whether a charge is near enough its draw to link, and off schedule: ±5 days (±2 on schedule), yearly 45 days ahead to 10 after. */
function fits(e: Expense, occ: { date: string; distance: number }, date: string): { ok: boolean; off: boolean } {
  if (e.billingCycle === "yearly") {
    const d = signedDistance(occ.date, date);
    return { ok: d >= -YEARLY_EARLY_DAYS && d <= YEARLY_LATE_DAYS, off: false };
  }
  return { ok: occ.distance <= OFF_SCHEDULE_DAYS, off: occ.distance > ON_SCHEDULE_DAYS };
}

/** The period a linked charge pays for: its nearest predicted draw's month (the year for yearly ones). */
export function periodOfCharge(e: Expense, t: Pick<Tx, "bookingDate" | "transactionDate" | "postedDate">): string {
  const month = scheduled(e) ? (nearestOccurrence(e, chargeDate(e, t))?.period ?? t.bookingDate.slice(0, 7)) : t.bookingDate.slice(0, 7);
  return e.billingCycle === "yearly" ? month.slice(0, 4) : month;
}

/** Days between a linked charge and its predicted draw ('avvek från schemat' when more than ±2; never for yearly ones, paid ahead). */
export function scheduleDistance(e: Expense, t: Pick<Tx, "bookingDate" | "transactionDate" | "postedDate">): number | null {
  if (!scheduled(e)) return null;
  if (e.billingCycle === "yearly") return 0;
  return nearestOccurrence(e, chargeDate(e, t))?.distance ?? null;
}

/**
 * Charges within ±2 days of the predicted draw (after moving to a bank day)
 * are linked first; within ±5 days is the fallback, flagged as off schedule.
 */
function linkExpenses(db: Db): number {
  const expenses = db
    .select()
    .from(recurringExpenses)
    .where(and(isNotNull(recurringExpenses.matchPattern), isNotNull(recurringExpenses.accountId)))
    .all()
    // A paused one up to its last draw.
    .filter(counts)
    .filter(scheduled)
    // A part of another expense's charge has none of its own.
    .filter((e) => e.partOfId === null);
  if (expenses.length === 0) return 0;
  const parts = partsByOwner(db);
  const sharedGroup = new Map(expenses.map((e) => [e.id, groupShared(db, e.id)]));

  // Periods already taken by earlier links.
  const taken = new Set<string>();
  for (const t of db.select().from(transactions).where(and(isNotNull(transactions.recurringExpenseId), isNull(transactions.deletedAt))).all()) {
    const e = expenses.find((x) => x.id === t.recurringExpenseId);
    if (e) taken.add(`${e.id}|${periodOfCharge(e, t)}`);
  }

  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.recurringExpenseId), isNull(transactions.deletedAt), lt(transactions.amount, 0), eq(transactions.isTransfer, false), eq(transactions.paidBy, "me")))
    .all();

  const candidates: { rowId: number; e: Expense; period: string; off: number; outside: number; amountDiff: number; distance: number }[] = [];
  for (const r of rows) {
    for (const e of expenses) {
      if (!patternMatches(e.matchPattern, r.descriptionClean)) continue;
      const occ = nearestOccurrence(e, chargeDate(e, r));
      const fit = occ ? fits(e, occ, chargeDate(e, r)) : null;
      if (!occ || !fit?.ok) continue;
      // On the account of its period (the old card before a move), and not after a last draw.
      if (r.accountId !== accountFor(e, occ.period) || !activeIn(e, occ.period)) continue;
      // The charge pays for the expense and its parts.
      const whole = e.amount + (parts.get(e.id) ?? []).reduce((s, p) => s + p.amount, 0);
      const amountDiff = Math.abs(Math.abs(r.amount) - whole) / Math.max(whole, 1);
      candidates.push({
        rowId: r.id,
        e,
        period: e.billingCycle === "yearly" ? occ.period.slice(0, 4) : occ.period,
        off: fit.off ? 1 : 0,
        outside: amountDiff <= AMOUNT_TOLERANCE ? 0 : 1,
        amountDiff,
        distance: occ.distance,
      });
    }
  }
  candidates.sort((a, b) => a.off - b.off || a.outside - b.outside || a.amountDiff - b.amountDiff || a.distance - b.distance || a.rowId - b.rowId);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const usedRows = new Set<number>();
  let linked = 0;
  for (const c of candidates) {
    const key = `${c.e.id}|${c.period}`;
    if (usedRows.has(c.rowId) || taken.has(key)) continue;
    // A shared expense's charge is shared too (never a private row or one wholly the partner's).
    const r = byId.get(c.rowId)!;
    const share = sharedGroup.get(c.e.id)! && !r.private && !r.forOther;
    db.update(transactions).set({ recurringExpenseId: c.e.id, ...(share ? { shared: true } : {}) }).where(eq(transactions.id, c.rowId)).run();
    usedRows.add(c.rowId);
    taken.add(key);
    linked++;
  }
  return linked;
}

/**
 * The rows linked to an expense follow its 'Delad' when it is changed: all
 * shared, or all own. Private rows, the partner's money, rows wholly hers and
 * transfers are left alone. Returns how many rows changed.
 */
export function applyExpenseShared(db: Db, expenseId: number, shared: boolean): number {
  return db
    .update(transactions)
    .set({ shared })
    .where(
      and(
        eq(transactions.recurringExpenseId, expenseId),
        isNull(transactions.deletedAt),
        eq(transactions.private, false),
        eq(transactions.forOther, false),
        eq(transactions.paidBy, "me"),
        eq(transactions.isTransfer, false),
        ne(transactions.shared, shared),
      ),
    )
    .run().changes;
}

