import { and, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { loadSplits, partsOf } from "../splits.js";
import {
  accounts,
  bankAccounts,
  bankConnections,
  categories,
  recurringExpenseMarks,
  recurringExpenses,
  recurringIncome,
  recurringIncomeOverrides,
  statements,
  transactions,
} from "../db/schema.js";
import { nearestDue } from "../recurring/link.js";
import { chargePeriod, expectedAmounts, latestChargeCheck } from "../recurring/amounts.js";
import { chargeOwnerId, chargeShare, partsByOwner } from "../recurring/parts.js";
import { nextOccurrence, occurrenceFor } from "../recurring/schedule.js";
import { lastBankDayOfMonth } from "../calendar/bankDays.js";
import { categoryIdByKey, getCategoryPathMap } from "../db/seed.js";
import { findDuplicatePairs } from "../routes/transactions.js";
import { partnerOutstanding } from "../shared/settlement.js";
import { liquidCash, valuePortfolio } from "../savings/portfolio.js";
import { balanceSheet, invoiceDebt } from "../networth/networth.js";
import { endurance } from "../networth/endurance.js";
import { addDays, addMonths, daysBetween, daysInMonth, dueDateIn, monthOf } from "./dates.js";
import { buildTimeline, TIMELINE_DAYS } from "./timeline.js";
import { fuelUntilPayday, getFuelSettings, listPrices, shiftsByMonth } from "../fuel/fuel.js";
import { findings, type Finding } from "../watch/watch.js";
import { referenceYearDue } from "../referenceBudget/due.js";
import { nightlyBackupProblem } from "../db/nightlyBackup.js";
import { pendingChanges, salaryForecasts, type SalaryForecast } from "../salary/salary.js";
import { accountFor, activeIn, counts, skippedPeriods } from "../recurring/changes.js";

export const STALE_BALANCE_DAYS = 7;
export const INVOICE_WARNING_DAYS = 5;
export const PACE_DAYS = 30;
/** A salary this many days late is still expected (rather than skipped to next month). */
const LATE_SALARY_GRACE_DAYS = 5;
/** A card payment this close to the amount due counts as paying it. */
const PAYMENT_TOLERANCE = 100;
/** A payment this many days after the due date still pays the invoice. */
const PAYMENT_DAYS_AFTER_DUE = 3;
/** From this day of the month, a missing Mastercard invoice for the month is a to-do. */
export const INVOICE_REMINDER_DAY = 10;
/** A salary this far from its forecast is a to-do. */
export const SALARY_DIFF_LIMIT = 50_000;

type Account = typeof accounts.$inferSelect;
type Expense = typeof recurringExpenses.$inferSelect;

export type ExpenseStatus = "kommande" | "dragen" | "forfallen" | "markerad_betald" | "passerad";

export interface Occurrence {
  expenseId: number;
  name: string;
  accountId: number | null;
  paymentMethod: Expense["paymentMethod"];
  amount: number; // positive öre (the expense's amount)
  dueDate: string;
  period: string;
  status: ExpenseStatus;
  transaction: { id: number; bookingDate: string; amount: number } | null;
  /** Counted in the forecast: coming, before payday, drawn from a bank account. */
  inForecast: boolean;
}

// ---------- Payday ----------

export interface Payday {
  incomeId: number;
  name: string;
  accountId: number | null;
  date: string;
  month: string;
  daysUntil: number;
  expected: number;
  expectedSource: "forecast" | "override" | "estimate";
  override: number | null;
  estimate: number;
  /** Löneprognos for the month: hours in, net and pay day out. */
  forecast: SalaryForecast | null;
  late: boolean;
  /** This month's salary, if it has arrived, and how far it was from the forecast. availableDate: the day it was in the balance. */
  received: { month: string; bookingDate: string; availableDate: string; amount: number; forecast: number | null; diff: number | null } | null;
  /**
   * The salary booked but not yet in the balance: Swedbank books it the day
   * before, with the pay day as its transaction day. Until then it is the
   * next salary, on that day and with its own amount.
   */
  pending: { bookingDate: string; availableDate: string; amount: number } | null;
}

/** The main income: the largest active recurring income (the salary). */
export function mainIncome(db: Db) {
  const incomes = db.select().from(recurringIncome).where(eq(recurringIncome.active, true)).all();
  return [...incomes].sort((a, b) => b.amount - a.amount || a.id - b.id)[0] ?? null;
}

/** The salary that came in, by the month it was paid for (nearest its day). */
export function salaryActuals(db: Db): Map<string, { bookingDate: string; amount: number }> {
  const income = mainIncome(db);
  const out = new Map<string, { bookingDate: string; amount: number }>();
  if (!income) return out;
  const rows = db
    .select({ bookingDate: transactions.bookingDate, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.recurringIncomeId, income.id), isNull(transactions.deletedAt)))
    .orderBy(transactions.bookingDate)
    .all();
  for (const r of rows) out.set(nearestDue(r.bookingDate, income.dayOfMonth).month, r);
  return out;
}

/**
 * The main income and its next expected date and amount. A month with a
 * Löneprognos (hours entered under Lön) takes its pay day and net; otherwise
 * the amount entered for the month, else the estimate, on the income's day.
 */
export function nextPayday(db: Db, today: string): Payday | null {
  const income = mainIncome(db);
  if (!income) return null;
  const forecasts = salaryForecasts(db);

  const rows = db
    .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.recurringIncomeId, income.id), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.bookingDate))
    .all();
  // Booked, but in the balance only from a later day: not received until then.
  const inBalanceFrom = (t: (typeof rows)[number]) => (t.transactionDate && t.transactionDate > t.bookingDate ? t.transactionDate : t.bookingDate);
  const isPending = (t: (typeof rows)[number]) => t.amount > 0 && inBalanceFrom(t) > today;
  const linked = rows.filter((t) => !isPending(t));
  const receivedIn = (month: string) => linked.find((t) => nearestDue(t.bookingDate, income.dayOfMonth).month === month);
  const pendingRow = rows.find(isPending) ?? null;
  const pendingMonth = pendingRow ? nearestDue(pendingRow.bookingDate, income.dayOfMonth).month : null;

  const thisMonth = monthOf(today);
  let date = "";
  let month = "";
  for (const m of [addMonths(thisMonth, -1), thisMonth, addMonths(thisMonth, 1), addMonths(thisMonth, 2)]) {
    const due = m === pendingMonth ? inBalanceFrom(pendingRow!) : (forecasts.get(m)?.payDate ?? dueDateIn(m, income.dayOfMonth));
    if (receivedIn(m)) continue;
    if (daysBetween(due, today) > LATE_SALARY_GRACE_DAYS) continue;
    date = due;
    month = m;
    break;
  }
  const override =
    db
      .select({ amount: recurringIncomeOverrides.amount })
      .from(recurringIncomeOverrides)
      .where(and(eq(recurringIncomeOverrides.recurringIncomeId, income.id), eq(recurringIncomeOverrides.month, month)))
      .get()?.amount ?? null;
  const got = receivedIn(thisMonth);
  const forecast = forecasts.get(month) ?? null;
  const gotForecast = forecasts.get(thisMonth)?.net ?? null;
  return {
    incomeId: income.id,
    name: income.name,
    accountId: income.accountId,
    date,
    month,
    daysUntil: Math.max(0, daysBetween(today, date)),
    // Booked already: what comes is its amount, whatever was expected.
    expected: pendingRow && pendingMonth === month ? pendingRow.amount : (forecast?.net ?? override ?? income.amount),
    expectedSource: forecast ? "forecast" : override !== null ? "override" : "estimate",
    override,
    estimate: income.amount,
    forecast,
    late: date < today,
    received: got
      ? {
          month: thisMonth,
          bookingDate: got.bookingDate,
          availableDate: inBalanceFrom(got),
          amount: got.amount,
          forecast: gotForecast,
          diff: gotForecast === null ? null : got.amount - gotForecast,
        }
      : null,
    pending: pendingRow && pendingMonth === month ? { bookingDate: pendingRow.bookingDate, availableDate: inBalanceFrom(pendingRow), amount: pendingRow.amount } : null,
  };
}

// ---------- Card invoices ----------

export interface InvoiceStatus {
  statementId: number;
  accountId: number;
  accountName: string;
  dueDate: string;
  amountDue: number;
  minPayment: number | null;
  paidAmount: number;
  status: "paid" | "partial" | "unpaid";
  paidBy: "payment" | "manual" | null;
  daysUntilDue: number;
}

/**
 * The latest invoice per card account and whether it is paid: ticked off by
 * hand, or card payments to the account (from the bank side, otherwise the
 * card's own 'Inbetalning' rows) from the day after the invoice period (a
 * Mastercard invoice is often paid weeks before it is due) up to 3 days after
 * the due date add up to the amount due, give or take 1 kr.
 */
export function cardInvoices(db: Db, today: string): InvoiceStatus[] {
  const out: InvoiceStatus[] = [];
  for (const account of db.select().from(accounts).where(eq(accounts.kind, "credit_card")).all()) {
    const s = db.select().from(statements).where(eq(statements.accountId, account.id)).orderBy(desc(statements.dueDate), desc(statements.id)).get();
    if (!s) continue;
    const from = s.periodTo ? addDays(s.periodTo, 1) : addDays(s.dueDate, -25);
    const to = addDays(s.dueDate, PAYMENT_DAYS_AFTER_DUE);
    const inWindow = and(gte(transactions.bookingDate, from), lte(transactions.bookingDate, to), isNull(transactions.deletedAt));
    const bankSide = db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(and(inWindow, eq(transactions.counterAccountId, account.id), sql`${transactions.amount} < 0`))
      .all();
    const cardSide = db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(and(inWindow, eq(transactions.accountId, account.id), eq(transactions.isTransfer, true), sql`${transactions.amount} > 0`))
      .all();
    const paidAmount = bankSide.length ? bankSide.reduce((a, t) => a - t.amount, 0) : cardSide.reduce((a, t) => a + t.amount, 0);
    const byPayment = paidAmount >= s.amountDue - PAYMENT_TOLERANCE;
    out.push({
      statementId: s.id,
      accountId: account.id,
      accountName: account.name,
      dueDate: s.dueDate,
      amountDue: s.amountDue,
      minPayment: s.minPayment,
      paidAmount,
      status: s.paidAt || byPayment ? "paid" : paidAmount > 0 ? "partial" : "unpaid",
      paidBy: s.paidAt ? "manual" : byPayment ? "payment" : null,
      daysUntilDue: daysBetween(today, s.dueDate),
    });
  }
  return out;
}

// ---------- The next Mastercard invoice ----------

const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

export interface UpcomingInvoice {
  accountId: number;
  accountName: string;
  /** The day after the latest invoice's period. */
  periodFrom: string;
  /** Where the next invoice will end: as the latest invoice says, else about the 5th. */
  periodTo: string;
  /** The last bank day of that month. */
  dueDate: string;
  /** Purchases on the card since the latest invoice, up to today. */
  soFar: number;
  /** Fixed expenses on the card expected from tomorrow up to the end of the period. */
  expectedFixed: number;
  estimate: number;
}

/**
 * The next invoice of each card with an imported (PDF) invoice, before it
 * exists: period from the day after the latest one to its announced end
 * (or about the 5th of next month), due the last bank day of that month,
 * about what has been bought on the card since plus the card's fixed
 * expenses still to come in the period. Only Mastercard (the invoice cycle
 * Bank Norwegian uses is handled by the shared economy).
 */
export function upcomingInvoices(db: Db, today: string): UpcomingInvoice[] {
  const out: UpcomingInvoice[] = [];
  for (const account of db.select().from(accounts).where(eq(accounts.source, "mastercard")).all()) {
    const last = db
      .select()
      .from(statements)
      .where(and(eq(statements.accountId, account.id), eq(statements.source, "pdf")))
      .orderBy(desc(statements.periodTo))
      .get();
    if (!last?.periodTo || last.periodTo >= today) continue;
    const periodFrom = addDays(last.periodTo, 1);
    const periodTo = last.nextPeriodTo ?? `${addMonths(monthOf(last.periodTo), 1)}-05`;
    const dueDate = lastBankDayOfMonth(monthOf(periodTo));
    const bought = db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, account.id),
          isNull(transactions.deletedAt),
          eq(transactions.isTransfer, false),
          gte(transactions.bookingDate, periodFrom),
          lte(transactions.bookingDate, periodTo < today ? periodTo : today),
        ),
      )
      .all();
    const soFar = -bought.reduce((s, t) => s + t.amount, 0);
    const expected = expectedAmounts(db);
    const skipped = skippedPeriods(db);
    let expectedFixed = 0;
    for (const e of db.select().from(recurringExpenses).all().filter(counts)) {
      for (let from = addDays(today, 1); ; ) {
        const next = nextOccurrence(e, from);
        if (!next || next.date > periodTo) break;
        // Drawn on this card that period (before or after a move), not after a last draw, not marked as not drawn.
        if (accountFor(e, next.period) !== account.id || !activeIn(e, next.period) || skipped.has(`${e.id}|${next.period}`)) {
          from = addDays(next.date, 1);
          continue;
        }
        const drawn = db
          .select({ id: transactions.id, bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate })
          .from(transactions)
          .where(and(eq(transactions.recurringExpenseId, chargeOwnerId(e)), isNull(transactions.deletedAt)))
          .all()
          .some((t) => chargePeriod(e, t) === next.period);
        if (!drawn) expectedFixed += expected(e, next.period);
        from = addDays(next.date, 1);
      }
    }
    out.push({ accountId: account.id, accountName: account.name, periodFrom, periodTo, dueDate, soFar, expectedFixed, estimate: soFar + expectedFixed });
  }
  return out;
}

/**
 * Mastercard accounts whose invoice for this month isn't imported yet, from
 * the 10th: the invoice (period ending around the 4th–8th) is in the
 * internet bank a few days after. Only for accounts that had an invoice imported.
 */
export function missingInvoices(db: Db, today: string): { accountId: number; label: string; month: string; monthName: string }[] {
  if (Number(today.slice(8, 10)) < INVOICE_REMINDER_DAY) return [];
  const month = monthOf(today);
  const out: { accountId: number; label: string; month: string; monthName: string }[] = [];
  for (const account of db.select().from(accounts).where(eq(accounts.source, "mastercard")).all()) {
    const pdfs = db.select().from(statements).where(and(eq(statements.accountId, account.id), eq(statements.source, "pdf"))).all();
    if (pdfs.length === 0) continue;
    if (pdfs.some((s) => s.periodTo && s.periodTo >= `${month}-01`)) continue;
    out.push({ accountId: account.id, label: "Mastercard", month, monthName: MONTH_NAMES[Number(month.slice(5, 7)) - 1] });
  }
  return out;
}

// ---------- Recurring expenses ----------

/**
 * Occurrences of every active monthly expense from the start of this month up
 * to payday (or the end of this month, or `until`, whichever is latest), with status:
 * dragen (linked to an imported row for the period) / markerad_betald (ticked
 * off) / kommande (due today or later) / forfallen (due date passed, nothing
 * matched, and the charge is one that gets imported) / passerad (due date
 * passed on an account that never gets imported rows: tick it off).
 */
export function expenseOccurrences(db: Db, today: string, payday: string | null, until: string | null = null): Occurrence[] {
  // A paused one up to its last draw.
  const expenses = db.select().from(recurringExpenses).all().filter(counts);
  const accountById = new Map(db.select().from(accounts).all().map((a) => [a.id, a]));
  // Accounts that actually get imported rows.
  const imported = new Set(
    db
      .select({ id: transactions.accountId })
      .from(transactions)
      .where(and(isNotNull(transactions.accountId), sql`${transactions.source} <> 'manual'`))
      .groupBy(transactions.accountId)
      .all()
      .map((r) => r.id),
  );
  const marks = new Set(
    db.select().from(recurringExpenseMarks).all().map((m) => `${m.recurringExpenseId}|${m.period}`),
  );
  const skipped = skippedPeriods(db);
  const expected = expectedAmounts(db);
  const parts = partsByOwner(db);

  const start = `${monthOf(today)}-01`;
  const end = [periodEnd(today, payday), until ?? ""].sort().at(-1)!;
  const months: string[] = [];
  for (let m = monthOf(start); m <= monthOf(end); m = addMonths(m, 1)) months.push(m);

  const out: Occurrence[] = [];
  for (const e of expenses) {
    if ((e.scheduleType === "day_of_month" && e.anchorDay === null) || (e.billingCycle === "yearly" && !e.anchorMonth)) continue;
    const links = db
      .select({
        id: transactions.id,
        bookingDate: transactions.bookingDate,
        transactionDate: transactions.transactionDate,
        postedDate: transactions.postedDate,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, chargeOwnerId(e)), isNull(transactions.deletedAt), gte(transactions.bookingDate, addDays(start, -10))))
      .all();
    for (const period of months) {
      if (!activeIn(e, period)) continue;
      // The old card before a move to another.
      const accountId = accountFor(e, period);
      const account = accountId !== null ? accountById.get(accountId) : undefined;
      // The predicted draw (moved to a bank day if the schedule says so); a draw
      // moved into the next month still belongs to this one.
      // A yearly expense has one, in its month.
      const dueDate = occurrenceFor(e, period);
      if (!dueDate || dueDate > end) continue;
      const linked = links.find((t) => chargePeriod(e, t) === period);
      // Drawn together with others: this expense's share of the charge.
      const tx = linked ? { id: linked.id, bookingDate: linked.bookingDate, amount: -chargeShare(e, parts, expected, -linked.amount, period) } : null;
      // Not drawn that period (paused for a while): no draw to expect.
      if (!tx && skipped.has(`${e.id}|${period}`)) continue;
      const status: ExpenseStatus = tx
        ? "dragen"
        : marks.has(`${e.id}|${period}`)
          ? "markerad_betald"
          : dueDate >= today
            ? "kommande"
            : e.matchPattern && accountId !== null && imported.has(accountId)
              ? "forfallen"
              : "passerad";
      out.push({
        expenseId: e.id,
        name: e.name,
        accountId,
        paymentMethod: e.paymentMethod,
        amount: expected(e, period),
        dueDate,
        period,
        status,
        transaction: tx,
        inForecast: status === "kommande" && !!payday && dueDate < payday && account?.kind === "bank",
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "sv"));
}

/** Where 'this period' of fixed expenses ends: payday, or the end of this month if later. */
export function periodEnd(today: string, payday: string | null): string {
  const monthEnd = dueDateIn(monthOf(today), 31);
  return payday && payday > monthEnd ? payday : monthEnd;
}

// ---------- Spending ----------

/**
 * Whose spending: 'mine' counts my own rows in full and shared rows at half
 * (the partner pays the other half); 'household' counts everything in full.
 */
export type Share = "mine" | "household";

/**
 * Also 'paid': what leaves my own accounts, every row I paid in full and
 * nothing of what the partner paid. For cash forecasts, where her part of
 * shared purchases comes back as her payments (Kassaflöde).
 */
export type Basis = Share | "paid";

/**
 * My part of a row: shared rows half; a row that is wholly the other
 * person's counts for them (so not for me if I paid it, all mine if she did).
 */
export function myPart(r: { shared: boolean; forOther: boolean; paidBy: "me" | "partner" }): number {
  if (r.shared) return 0.5;
  if (r.forOther) return r.paidBy === "partner" ? 1 : 0;
  return r.paidBy === "partner" ? 0 : 1;
}

/**
 * 'Variable' spending: not a transfer, not partner settlement, not linked to a
 * recurring expense, not income, not deleted. `amount` is my part for 'mine',
 * what I paid for 'paid'.
 */
export function variableRows(db: Db, from: string, to: string, share: Basis = "mine") {
  const rows = db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      bookingDate: transactions.bookingDate,
      transactionDate: transactions.transactionDate,
      accountId: transactions.accountId,
      label: transactions.label,
      counterparty: transactions.counterparty,
      descriptionClean: transactions.descriptionClean,
      categoryId: transactions.categoryId,
      shared: transactions.shared,
      forOther: transactions.forOther,
      paidBy: transactions.paidBy,
      parentId: categories.parentId,
      isSettlement: categories.isSettlement,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.bookingDate, from),
        lte(transactions.bookingDate, to),
        isNull(transactions.deletedAt),
        eq(transactions.isTransfer, false),
        isNull(transactions.recurringExpenseId),
        isNull(transactions.returnGroupId),
      ),
    )
    .all();
  const incomeTop = categoryIdByKey(db, "income");
  const tops = new Map(db.select({ id: categories.id, parentId: categories.parentId }).from(categories).all().map((c) => [c.id, c.parentId ?? c.id]));
  const splits = loadSplits(db);
  return rows
    .filter((r) => !r.isSettlement)
    .map((r) => {
      const part = share === "household" ? 1 : share === "paid" ? (r.paidBy === "partner" ? 0 : 1) : myPart(r);
      return {
        ...r,
        amount: r.amount * part,
        topId: r.categoryId === null ? null : (r.parentId ?? r.categoryId),
        // A purchase split across categories: its parts, each with its own
        // category, for everything that sums per category.
        parts: partsOf(r, splits).map((p) => ({
          categoryId: p.categoryId,
          topId: p.categoryId === null ? null : (tops.get(p.categoryId) ?? p.categoryId),
          amount: p.amount * part,
        })),
      };
    })
    .filter((r) => r.topId !== incomeTop && !(r.categoryId === null && r.amount > 0));
}

/** `exclude`: categories (and their subcategories) left out, e.g. fuel when it is forecast on its own. */
export function spendingPace(db: Db, today: string, share: Basis = "mine", exclude: ReadonlySet<number> = new Set(), only?: ReadonlySet<number>) {
  const from = addDays(today, -(PACE_DAYS - 1));
  const within = (set: ReadonlySet<number>, p: { categoryId: number | null; topId: number | null }) =>
    p.categoryId !== null && (set.has(p.categoryId) || (p.topId !== null && set.has(p.topId)));
  // Not excluded, and (with `only`) in one of those categories: uncategorized rows then don't count.
  const left = (p: { categoryId: number | null; topId: number | null }) => !within(exclude, p) && (!only || within(only, p));
  // Per account it was paid from (null: none), so a card's part can be paid with its invoice.
  const byAccount = new Map<number | null, number>();
  for (const r of variableRows(db, from, today, share).filter((x) => x.amount < 0)) {
    // Split purchases: only the parts in categories that aren't excluded.
    const ore = -r.parts.reduce((x, p) => (left(p) ? x + p.amount : x), 0);
    if (ore) byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0) + ore);
  }
  const spent = Math.round([...byAccount.values()].reduce((s, v) => s + v, 0)) || 0; // never -0
  return {
    days: PACE_DAYS,
    from,
    to: today,
    total: spent,
    perDay: Math.round(spent / PACE_DAYS),
    /** Per day, per account paid from. */
    perDayByAccount: new Map([...byAccount].map(([id, ore]) => [id, ore / PACE_DAYS])),
  };
}

export interface NoSpendDay {
  date: string;
  /** free: nothing bought; spent: something was; today: nothing yet; future. */
  status: "free" | "spent" | "today" | "future";
  /** What was bought (öre, positive), for the tooltip. */
  items: { name: string; amount: number }[];
}

/**
 * Dagar utan köp: this month day by day, whether anything was bought — a
 * pat on the back for the days nothing was. The food shop (Livsmedel) and
 * the car (fuel, parking, service, congestion and infrastructure charges:
 * the main category the fuel is in) don't count: they have to be paid. Fixed expenses, transfers and the
 * money between us aren't purchases (variableRows leaves them out). What I
 * paid, by the day of the purchase; a shared one counts, it was bought.
 */
export function noSpendDays(db: Db, today: string) {
  const month = monthOf(today);
  const from = `${month}-01`;
  const last = dueDateIn(month, 31);
  const fuel = getFuelSettings(db).fuelCategoryId;
  const car = fuel !== null ? (db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, fuel)).get()?.parentId ?? fuel) : null;
  const exempt = new Set([categoryIdByKey(db, "groceries") ?? null, fuel, car].filter((id): id is number => id !== null));
  const counts = (p: { categoryId: number | null; topId: number | null }) => !(p.categoryId !== null && (exempt.has(p.categoryId) || (p.topId !== null && exempt.has(p.topId))));
  const byDay = new Map<string, { name: string; amount: number }[]>();
  // A card purchase is booked a day or two after it was made: look a week back and go by the purchase day.
  for (const r of variableRows(db, addDays(from, -7), today, "paid")) {
    const day = r.transactionDate ?? r.bookingDate;
    if (r.amount >= 0 || day < from || day > today) continue;
    const ore = -r.parts.reduce((s, p) => (counts(p) ? s + p.amount : s), 0);
    if (ore <= 0) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), { name: r.label ?? r.counterparty ?? r.descriptionClean, amount: Math.round(ore) }]);
  }
  const days: NoSpendDay[] = [];
  for (let d = from; d <= last; d = addDays(d, 1)) {
    const items = byDay.get(d) ?? [];
    days.push({ date: d, status: d > today ? "future" : items.length ? "spent" : d === today ? "today" : "free", items });
  }
  return {
    month,
    days,
    free: days.filter((d) => d.status === "free").length,
    past: days.filter((d) => d.date < today).length,
    // What was bought this month, against the usual for the same days (the same things counted).
    amount: days.reduce((s, d) => s + d.items.reduce((x, i) => x + i.amount, 0), 0),
    usual: usualSpending(db, today, counts, "paid"),
  };
}

export interface EatingOutDay {
  date: string;
  /** out: a restaurant, café or takeaway that day; home: none; today: none yet; future. */
  status: "out" | "home" | "today" | "future";
  items: { name: string; amount: number }[];
}

/** Where eating out is kept: Mat › Restaurang & café and Mat › Hämtmat. */
const EATING_OUT = ["Mat/Restaurang & café", "Mat/Hämtmat"];

/**
 * Restaurang och hämtmat: the days of the month someone in the household
 * ate out or took food home — how often, not whether it was allowed. The
 * whole household (what the partner paid too, shared purchases in full),
 * by the day of the purchase.
 */
/** How many whole months back the usual spending in a category is taken over. */
const USUAL_MONTHS = 3;

/**
 * What the household usually spends in some categories: the average of the
 * last three whole months up to the same day of the month (so the middle of a
 * month is set against the middle of the others), and for a whole month. By
 * the purchase day; split purchases by their parts.
 */
type Part = { categoryId: number | null; topId: number | null };

export function usualSpending(db: Db, today: string, ids: ReadonlySet<number> | ((p: Part) => boolean), basis: Basis = "household") {
  const day = Number(today.slice(8, 10));
  const first = `${addMonths(monthOf(today), -USUAL_MONTHS)}-01`;
  const last = addDays(`${monthOf(today)}-01`, -1);
  const counts = typeof ids === "function" ? ids : (p: Part) => p.categoryId !== null && ids.has(p.categoryId);
  let toDate = 0;
  let whole = 0;
  for (const r of variableRows(db, addDays(first, -7), last, basis)) {
    const d = r.transactionDate ?? r.bookingDate;
    // Purchases, as this month's are counted.
    if (r.amount >= 0 || d < first || d > last) continue;
    const ore = -r.parts.reduce((s, p) => (counts(p) ? s + p.amount : s), 0);
    whole += ore;
    if (Number(d.slice(8, 10)) <= day) toDate += ore;
  }
  return { toDate: Math.round(toDate / USUAL_MONTHS), perMonth: Math.round(whole / USUAL_MONTHS), day, from: monthOf(first), to: monthOf(last) };
}

export function eatingOutDays(db: Db, today: string) {
  const month = monthOf(today);
  const from = `${month}-01`;
  const last = dueDateIn(month, 31);
  const paths = getCategoryPathMap(db);
  const out = new Set(EATING_OUT.map((p) => paths.get(p)).filter((id): id is number => id !== undefined));
  const byDay = new Map<string, { name: string; amount: number }[]>();
  for (const r of variableRows(db, addDays(from, -7), today, "household")) {
    const day = r.transactionDate ?? r.bookingDate;
    if (r.amount >= 0 || day < from || day > today) continue;
    const ore = -r.parts.reduce((s, p) => (p.categoryId !== null && out.has(p.categoryId) ? s + p.amount : s), 0);
    if (ore <= 0) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), { name: r.label ?? r.counterparty ?? r.descriptionClean, amount: Math.round(ore) }]);
  }
  const days: EatingOutDay[] = [];
  for (let d = from; d <= last; d = addDays(d, 1)) {
    const items = byDay.get(d) ?? [];
    days.push({ date: d, status: d > today ? "future" : items.length ? "out" : d === today ? "today" : "home", items });
  }
  const outDays = days.filter((d) => d.status === "out");
  return { month, days, count: outDays.length, amount: outDays.reduce((s, d) => s + d.items.reduce((x, i) => x + i.amount, 0), 0), usual: usualSpending(db, today, out) };
}

/** The ISO week number of a day. */
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  // The Thursday of the week decides its year and number.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
}

/** How many whole months back the usual week of food shopping is taken over. */
const GROCERY_AVERAGE_MONTHS = 3;

/**
 * Livsmedel this month week by week (Monday to Sunday, cut at the month's
 * ends), for the household, by the purchase day; against the usual week: the
 * last three whole months' groceries per seven days. Only the grocery shop:
 * restaurants and takeaway have their own dots.
 */
export function groceryWeeks(db: Db, today: string) {
  const month = monthOf(today);
  const from = `${month}-01`;
  const last = dueDateIn(month, 31);
  const groceries = categoryIdByKey(db, "groceries");
  const ids = new Set(groceries === undefined ? [] : [groceries, ...db.select().from(categories).where(eq(categories.parentId, groceries)).all().map((c) => c.id)]);
  const spent = (a: string, b: string) => {
    const byDay = new Map<string, number>();
    for (const r of variableRows(db, addDays(a, -7), b, "household")) {
      const day = r.transactionDate ?? r.bookingDate;
      if (day < a || day > b) continue;
      const ore = -r.parts.reduce((s, p) => (p.categoryId !== null && ids.has(p.categoryId) ? s + p.amount : s), 0);
      if (ore) byDay.set(day, (byDay.get(day) ?? 0) + ore);
    }
    return byDay;
  };

  const byDay = spent(from, today);
  const weeks: { week: number; from: string; to: string; amount: number; status: "past" | "current" | "future" }[] = [];
  for (let d = from; d <= last; ) {
    // To the Sunday, or the month's last day.
    let to = d;
    while (to < last && new Date(`${to}T00:00:00Z`).getUTCDay() !== 0) to = addDays(to, 1);
    let amount = 0;
    for (let x = d; x <= to; x = addDays(x, 1)) amount += byDay.get(x) ?? 0;
    weeks.push({ week: isoWeek(d), from: d, to, amount: Math.round(amount), status: d > today ? "future" : to < today ? "past" : "current" });
    d = addDays(to, 1);
  }

  const avgFrom = `${addMonths(month, -GROCERY_AVERAGE_MONTHS)}-01`;
  const avgTo = addDays(from, -1);
  const before = [...spent(avgFrom, avgTo).values()].reduce((s, v) => s + v, 0);
  const days = daysBetween(avgFrom, avgTo) + 1;
  return {
    month,
    weeks,
    total: weeks.reduce((s, w) => s + w.amount, 0),
    averagePerWeek: Math.round((before / days) * 7),
    averageFrom: monthOf(avgFrom),
    averageTo: monthOf(avgTo),
    usual: usualSpending(db, today, ids),
  };
}

/**
 * This month's variable spending per main category up to today's day, against
 * the average of the same days (1..N) in the three previous months.
 */
export function monthByCategory(db: Db, today: string, share: Share = "mine") {
  const day = Number(today.slice(8, 10));
  const cats = db.select().from(categories).all();
  const sumByTop = (from: string, to: string) => {
    const m = new Map<number | null, number>();
    for (const r of variableRows(db, from, to, share)) for (const p of r.parts) m.set(p.topId, (m.get(p.topId) ?? 0) - p.amount);
    for (const [k, v] of m) m.set(k, Math.round(v));
    return m;
  };
  const current = sumByTop(`${monthOf(today)}-01`, today);
  const previous = [1, 2, 3].map((n) => {
    const month = addMonths(monthOf(today), -n);
    const [y, mm] = month.split("-").map(Number);
    return sumByTop(`${month}-01`, `${month}-${String(Math.min(day, daysInMonth(y, mm))).padStart(2, "0")}`);
  });
  const keys = new Set([...current.keys(), ...previous.flatMap((p) => [...p.keys()])]);
  return [...keys]
    .map((topId) => {
      const cat = topId === null ? undefined : cats.find((c) => c.id === topId);
      return {
        categoryId: topId,
        name: cat?.name ?? "Utan kategori",
        color: cat?.color ?? "#a3a3a3",
        current: current.get(topId) ?? 0,
        average: Math.round(previous.reduce((s, p) => s + (p.get(topId) ?? 0), 0) / 3),
      };
    })
    .filter((r) => r.current !== 0 || r.average !== 0)
    .sort((a, b) => b.current - a.current || b.average - a.average);
}

// ---------- The whole overview ----------

export interface Warning {
  kind: "overdue_expense" | "invoice_due" | "invoice_missing" | "stale_balance" | "amount_changed" | "review" | "salary_late";
  text: string;
}

/**
 * Something to do on the overview (Att göra), with what its button needs.
 * The id is stable for the same thing, so it can be dismissed for the day.
 */
export interface OverviewTask {
  id: string;
  kind: "invoice_due" | "salary_late" | "stale_balance" | "invoice_missing" | "review" | "amount_changed" | "fuel_shifts" | "bank" | "watch" | "salary" | "reference_budget" | "backup";
  text: string;
  accountId?: number;
  statementId?: number;
  count?: number;
  items?: { expenseId: number; name: string; amount: number; latest?: number }[];
  /** Vakt: the finding and what its buttons need. */
  finding?: Finding;
  /** Lön: what the button does ('Visa' acknowledges new values). */
  salary?: { action: "open" | "ack"; month?: string };
}

export function buildOverview(db: Db, today: string) {
  const allAccounts = db.select().from(accounts).orderBy(accounts.id).all();
  const payday = nextPayday(db, today);
  const invoices = cardInvoices(db, today);
  // This period's fixed expenses, and far enough ahead for the timeline.
  const occurrences = expenseOccurrences(db, today, payday?.date ?? null, addDays(today, TIMELINE_DAYS - 1));
  const thisPeriod = periodEnd(today, payday?.date ?? null);
  const upcoming = upcomingInvoices(db, today);

  const balances = allAccounts.map((a) => {
    const invoice = invoices.find((i) => i.accountId === a.id) ?? null;
    // A card with an invoice: the debt is worked out from it — unpaid on
    // the invoice plus what has been bought since — rather than left at what
    // the invoice said on the day it was read. Paying it would otherwise
    // change nothing on the card. A debt typed in by hand after the
    // invoice's period wins, until an invoice with a later period arrives.
    const debt = a.kind === "credit_card" && a.trackBalance && invoice ? invoiceDebt(db, a.id, invoice, today) : null;
    const typed = !!a.manuallyEditedAt && !!a.balanceUpdatedAt && (!debt || a.balanceUpdatedAt.slice(0, 10) > debt.settledTo);
    const worked = debt && !typed ? debt : null;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      source: a.source,
      trackBalance: a.trackBalance,
      balance: worked ? -worked.amountOre : a.balance,
      updatedAt: worked ? today : a.balanceUpdatedAt,
      ageDays: worked ? 0 : a.balanceUpdatedAt ? daysBetween(a.balanceUpdatedAt.slice(0, 10), today) : null,
      stale: worked ? false : !a.balanceUpdatedAt || daysBetween(a.balanceUpdatedAt.slice(0, 10), today) > STALE_BALANCE_DAYS,
      /** How the card's debt was worked out, when it was (null: the balance as stored). */
      debt: worked,
      invoice,
      // The latest invoice came from a PDF: no need to ask for it by hand.
      invoiceImported: !!db
        .select({ id: statements.id })
        .from(statements)
        .where(and(eq(statements.accountId, a.id), eq(statements.source, "pdf")))
        .get(),
      nextInvoice: upcoming.find((u) => u.accountId === a.id) ?? null,
    };
  });

  // Forecast to payday: bank balances − coming fixed charges (bank accounts) − unpaid card invoices due before payday.
  // An account whose balance isn't followed is neither counted nor asked for.
  const bank = balances.filter((b) => b.kind === "bank" && b.trackBalance);
  const start = bank.reduce((s, b) => s + b.balance, 0);
  const fixed = occurrences.filter((o) => o.inForecast);
  const invoicesDue = payday
    ? invoices.filter((i) => i.status !== "paid" && i.dueDate < payday.date).map((i) => ({ ...i, remaining: i.amountDue - i.paidAmount }))
    : [];
  const otherIncome = payday ? otherIncomeBefore(db, today, payday) : [];
  // Pendling & bränsle: fuel still to buy this month (and next month's up to payday), a variable item.
  const fuel = payday ? fuelUntilPayday(db, today, payday.date) : null;
  const left =
    start +
    otherIncome.reduce((s, i) => s + i.amount, 0) -
    fixed.reduce((s, o) => s + o.amount, 0) -
    invoicesDue.reduce((s, i) => s + i.remaining, 0) -
    (fuel?.amount ?? 0);
  // The pace, and how much of it leaves the bank before payday: card purchases are paid with the next salary.
  const cards = new Set(allAccounts.filter((a) => a.kind === "credit_card").map((a) => a.id));
  const withBankShare = (p: ReturnType<typeof spendingPace>) => {
    const onCards = [...p.perDayByAccount].reduce((s, [id, v]) => (id !== null && cards.has(id) ? s + v : s), 0);
    const { perDayByAccount: _, ...rest } = p;
    return { ...rest, bankPerDay: Math.round(p.perDay - onCards), cardPerDay: Math.round(onCards) };
  };
  const pace = withBankShare(spendingPace(db, today, "mine"));
  const paceHousehold = withBankShare(spendingPace(db, today, "household"));
  const days = payday ? Math.max(1, payday.daysUntil) : null;

  // Recurring expenses grouped per account, with the next draw per payment method.
  const groups = allAccounts
    .map((a) => ({ accountId: a.id as number | null, accountName: a.name, kind: a.kind as Account["kind"] | null }))
    .concat([{ accountId: null, accountName: "Utan konto", kind: null }])
    .map((g) => {
      const items = occurrences.filter((o) => o.accountId === g.accountId && o.dueDate <= thisPeriod);
      const coming = items.filter((o) => o.status === "kommande");
      const nextDraws = [...new Set(coming.map((o) => o.paymentMethod))].map((method) => {
        const ofMethod = coming.filter((o) => o.paymentMethod === method);
        const date = ofMethod[0].dueDate;
        const onDate = ofMethod.filter((o) => o.dueDate === date);
        return { paymentMethod: method, date, count: onDate.length, amount: onDate.reduce((s, o) => s + o.amount, 0) };
      });
      return {
        ...g,
        items,
        total: items.reduce((s, o) => s + o.amount, 0),
        remaining: coming.reduce((s, o) => s + o.amount, 0),
        nextDraws,
      };
    })
    .filter((g) => g.items.length > 0);

  const warnings: Warning[] = [];
  const kr = (ore: number) => `${(ore / 100).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} kr`;
  for (const o of occurrences.filter((x) => x.status === "forfallen")) {
    warnings.push({ kind: "overdue_expense", text: `${o.name} (${kr(o.amount)}) skulle dragits ${o.dueDate} men syns inte i importerad data.` });
  }
  for (const i of invoices.filter((x) => x.status !== "paid" && x.daysUntilDue <= INVOICE_WARNING_DAYS)) {
    warnings.push({
      kind: "invoice_due",
      text:
        i.daysUntilDue < 0
          ? `Fakturan för ${i.accountName} (${kr(i.amountDue - i.paidAmount)}) förföll ${i.dueDate} och är inte betald.`
          : `Fakturan för ${i.accountName} (${kr(i.amountDue - i.paidAmount)}) förfaller ${i.dueDate}${i.daysUntilDue === 0 ? " – idag" : ` – om ${i.daysUntilDue} dagar`}.`,
    });
  }
  for (const b of bank.filter((x) => x.stale)) {
    warnings.push({
      kind: "stale_balance",
      text: b.updatedAt ? `Saldot för ${b.name} uppdaterades för ${b.ageDays} dagar sedan.` : `Saldot för ${b.name} är inte ifyllt.`,
    });
  }
  for (const e of changedAmounts(db)) {
    warnings.push({ kind: "amount_changed", text: `${e.name}: senaste dragningen var ${kr(e.latest)}, utgiften säger ${kr(e.amount)}.` });
  }
  if (payday?.late) warnings.push({ kind: "salary_late", text: `${payday.name} väntades ${payday.date} men har inte kommit in i importerad data.` });
  for (const m of missingInvoices(db, today)) {
    warnings.push({ kind: "invoice_missing", text: `${m.label}-fakturan för ${m.monthName} borde finnas i Swedbank – importera.` });
  }
  const review = reviewCount(db);
  if (review > 0) warnings.push({ kind: "review", text: `${review} rader att granska.` });

  // The same things as tasks, grouped, with what their buttons need.
  const tasks: OverviewTask[] = [];
  const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
  for (const i of invoices.filter((x) => x.status !== "paid" && x.daysUntilDue < TIMELINE_DAYS)) {
    const left = kr(i.amountDue - i.paidAmount);
    tasks.push({
      id: `invoice:${i.statementId}`,
      kind: "invoice_due",
      accountId: i.accountId,
      statementId: i.statementId,
      text:
        i.daysUntilDue < 0
          ? `${i.accountName}: fakturan ${left} förföll ${dm(i.dueDate)}`
          : `${i.accountName}: faktura ${left} förfaller ${i.daysUntilDue === 0 ? "i dag" : dm(i.dueDate)}`,
    });
  }
  if (payday?.late) {
    tasks.push({ id: `salary_late:${payday.month}`, kind: "salary_late", text: `${payday.name} väntades ${dm(payday.date)} men syns inte i importerad data` });
  }
  for (const b of bank.filter((x) => x.stale)) {
    tasks.push({
      id: `balance:${b.id}:${b.updatedAt ?? ""}`,
      kind: "stale_balance",
      accountId: b.id,
      text: b.updatedAt ? `${b.name}: saldot uppdaterades för ${b.ageDays} dagar sedan` : `${b.name}: saldo inte ifyllt`,
    });
  }
  for (const m of missingInvoices(db, today)) {
    tasks.push({ id: `invoice_missing:${m.accountId}:${m.month}`, kind: "invoice_missing", accountId: m.accountId, text: `${m.label}-fakturan för ${m.monthName} borde finnas i Swedbank` });
  }
  if (review > 0) tasks.push({ id: "review", kind: "review", count: review, text: `${review} att granska` });
  // Once the fuel module is in use: this month's shifts are what the forecast needs.
  const shifts = shiftsByMonth(db);
  if ((shifts.size > 0 || listPrices(db).length > 0) && !shifts.has(monthOf(today))) {
    const name = new Date(`${today.slice(0, 7)}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
    tasks.push({ id: `fuel_shifts:${monthOf(today)}`, kind: "fuel_shifts", text: `Fyll i antal arbetspass för ${name}, så räknas bränslet in` });
  }
  tasks.push(...bankTasks(db, today, dm));
  tasks.push(...salaryTasks(db, payday));
  // Konsumentverket: next year's figures from mid-November, added as a file.
  const reference = referenceYearDue(db, today);
  if (reference) tasks.push({ id: `reference_budget:${reference.year}`, kind: "reference_budget", text: `Nya referensvärden från Konsumentverket – lägg in ${reference.year}` });
  // The nightly copy for restic failed, or hasn't been taken for two days.
  const backup = nightlyBackupProblem(db);
  if (backup) tasks.push({ ...backup, kind: "backup" });
  // Vakt: missed draws, price drift and the rest, each its own task (dismissed for good).
  const watch = findings(db, today);
  tasks.push(...watch.map((f) => ({ id: f.key, kind: "watch" as const, text: f.text, finding: f })));
  // A fixed expense whose price drifted is already there, with its button.
  const drifted = new Set(watch.filter((f) => f.kind === "price_drift" && f.expenseId !== undefined).map((f) => f.expenseId));
  const changed = changedAmounts(db).filter((e) => !drifted.has(e.id));
  if (changed.length) {
    tasks.push({
      id: `amount_changed:${changed.map((e) => `${e.id}.${e.latest}`).join(",")}`,
      kind: "amount_changed",
      count: changed.length,
      text: changed.length === 1 ? `${changed[0].name} drogs med ${kr(changed[0].latest)}, utgiften säger ${kr(changed[0].amount)}` : `${changed.length} fasta utgifter drogs med ett annat belopp`,
      items: changed.map((e) => ({ expenseId: e.id, name: e.name, amount: e.amount, latest: e.latest })),
    });
  }

  return {
    today,
    payday,
    forecast: payday
      ? {
          start,
          startAccounts: bank.map((b) => ({ id: b.id, name: b.name, balance: b.balance })),
          otherIncome,
          fixed: fixed.reduce((s, o) => s + o.amount, 0),
          fixedCount: fixed.length,
          invoices: invoicesDue.map((i) => ({ accountName: i.accountName, dueDate: i.dueDate, amount: i.remaining })),
          fuel,
          left,
          days,
          perDay: Math.round(left / days!),
          // Shown, never counted: it isn't mine until the money has come in.
          partner: partnerOutstanding(db, today),
        }
      : null,
    pace,
    paceHousehold,
    // Pengar nu: the bank accounts whose balance is followed, and the cash on Avanza (it can be moved any day).
    money: (() => {
      const cash = liquidCash(db, today);
      return { bankOre: start, iskOre: cash.totalOre, totalOre: start + cash.totalOre, accounts: bank.map((b) => ({ id: b.id, name: b.name, balance: b.balance })) };
    })(),
    noSpend: noSpendDays(db, today),
    eatingOut: eatingOutDays(db, today),
    groceryWeeks: groceryWeeks(db, today),
    balances,
    upcomingInvoices: upcoming,
    recurring: groups,
    timeline: buildTimeline(db, today, { payday, occurrences, invoices, upcoming, accounts: allAccounts }),
    tasks,
    month: {
      day: Number(today.slice(8, 10)),
      categories: monthByCategory(db, today, "mine"),
      household: monthByCategory(db, today, "household"),
    },
    // Sparandet: what it is worth and how it is divided. No change since
    // yesterday and nothing coloured — short movements are noise, and the
    // Översikt is where one looks every day.
    portfolio: portfolioSummary(db, today),
    // Ekonomisk situation: one line, the two figures worth a daily glance.
    situation: situationSummary(db, today),
    warnings,
  };
}

/** The value, the day its prices are from, and the two zones. Nothing more. */
function portfolioSummary(db: Db, today: string) {
  const value = valuePortfolio(db, today);
  if (value.holdings.length === 0) return null;
  return {
    totalOre: value.totalOre,
    priceDate: value.priceDate,
    zones: { base: value.zones.base.share, bet: value.zones.bet.share },
    betState: value.policy.state,
    /** Holdings without a price or a rate: the total is short by them. */
    missing: value.missing.length,
    /** Holdings valued at an old price (older than three bank days). */
    stale: value.stale.length,
  };
}

/**
 * Nettoförmögenheten och bufferten. Two numbers and nothing else.
 *
 * The whole balance sheet is a tab of its own; what belongs on a page looked
 * at every day is the money in total (as the tab leads with) and whether the
 * buffer would carry three months. A change since last month is not here either — a net worth moves
 * with the market, and that is not a daily matter.
 */
function situationSummary(db: Db, today: string) {
  const sheet = balanceSheet(db, today);
  if (sheet.liquid.length === 0 && sheet.debts.length === 0) return null;
  const e = endurance(db, today);
  return {
    // Pengar totalt, as the tab leads with: the bank, the securities and cash on ISK.
    moneyOre: sheet.totals.moneyOre,
    netExCsnOre: sheet.totals.netExCsnOre,
    netIncCsnOre: sheet.totals.netIncCsnOre,
    bufferMonths: e.essential.buffer.months,
    bufferAccount: e.capital.bufferAccount?.name ?? null,
  };
}

/** Other active recurring incomes due between today and payday that haven't arrived. */
function otherIncomeBefore(db: Db, today: string, payday: Payday) {
  const out: { name: string; date: string; amount: number }[] = [];
  for (const i of db.select().from(recurringIncome).where(eq(recurringIncome.active, true)).all()) {
    if (i.id === payday.incomeId) continue;
    for (const m of [monthOf(today), addMonths(monthOf(today), 1)]) {
      const date = dueDateIn(m, i.dayOfMonth);
      if (date < today || date >= payday.date) continue;
      const got = db
        .select({ bookingDate: transactions.bookingDate })
        .from(transactions)
        .where(and(eq(transactions.recurringIncomeId, i.id), isNull(transactions.deletedAt)))
        .all()
        .some((t) => nearestDue(t.bookingDate, i.dayOfMonth).month === m);
      if (!got) out.push({ name: i.name, date, amount: i.amount });
    }
  }
  return out;
}

function changedAmounts(db: Db) {
  const out: { id: number; name: string; amount: number; latest: number }[] = [];
  const expected = expectedAmounts(db);
  for (const e of db.select().from(recurringExpenses).where(eq(recurringExpenses.paused, false)).all()) {
    const check = latestChargeCheck(db, e, expected);
    if (check.latest && check.changed) out.push({ id: e.id, name: e.name, amount: check.expected, latest: Math.abs(check.latest.amount) });
  }
  return out;
}

export function reviewCount(db: Db): number {
  const uncategorized =
    db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(and(isNull(transactions.deletedAt), isNull(transactions.categoryId), eq(transactions.isTransfer, false)))
      .get()?.n ?? 0;
  return uncategorized + findDuplicatePairs(db).length;
}


/**
 * Bankkopplingar (Enable Banking): a consent gone or running out (under 14
 * days), a sync that failed, an account the bank gives that isn't matched.
 */
function bankTasks(db: Db, today: string, dm: (d: string) => string): OverviewTask[] {
  const out: OverviewTask[] = [];
  for (const c of db.select().from(bankConnections).all()) {
    if (c.status === "pending") continue;
    const left = c.validUntil ? daysBetween(today, c.validUntil.slice(0, 10)) : null;
    if (c.status === "expired" || (left !== null && left < 0)) {
      out.push({ id: `bank:expired:${c.id}`, kind: "bank", text: `${c.aspspName}: samtycket har gått ut – förnya det så hämtas raderna igen` });
      continue;
    }
    if (left !== null && left < 14) {
      out.push({ id: `bank:consent:${c.id}:${today}`, kind: "bank", text: `${c.aspspName}: samtycket går ut om ${left} ${left === 1 ? "dag" : "dagar"} (${dm(c.validUntil!.slice(0, 10))})` });
    }
    if (c.lastError) out.push({ id: `bank:error:${c.id}:${c.lastErrorAt ?? ""}`, kind: "bank", text: `${c.aspspName}: synken misslyckades – ${c.lastError}` });
    const unmatched = db.select().from(bankAccounts).where(eq(bankAccounts.connectionId, c.id)).all().filter((a) => a.accountId === null).length;
    if (unmatched) out.push({ id: `bank:unmatched:${c.id}`, kind: "bank", text: `${c.aspspName}: ${unmatched} ${unmatched === 1 ? "konto är" : "konton är"} inte kopplat till något konto här` });
  }
  return out;
}

const FIELD_NAMES: Record<string, string> = {
  monthlySalary: "månadslön",
  industrySupplement: "fast tillägg",
  salarySupplement: "lönetillägg",
  hoursPerMonth: "arbetstidsmått",
  mertidRate: "mertid à-pris",
  vacationHourlyRate: "semestertimlön",
};

/**
 * Lön: the salary came in more than 500 kr off the forecast; a payslip brought
 * new values.
 */
function salaryTasks(db: Db, payday: Payday | null): OverviewTask[] {
  const out: OverviewTask[] = [];
  const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
  const r = payday?.received;
  if (r?.diff != null && Math.abs(r.diff) > SALARY_DIFF_LIMIT) {
    out.push({
      id: `salary_diff:${r.month}`,
      kind: "salary",
      salary: { action: "open" },
      text: `Lönen blev ${kr(Math.abs(r.diff))} ${r.diff < 0 ? "lägre" : "högre"} än beräknat (${kr(r.amount)} mot ${kr(r.forecast!)}) – kolla specen`,
    });
  }
  for (const c of pendingChanges(db)) {
    const month = new Date(`${c.month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
    const what = c.changes
      .map((x) => `${FIELD_NAMES[x.field] ?? x.field} ${x.field === "hoursPerMonth" ? x.from : kr(x.from ?? 0)} → ${x.field === "hoursPerMonth" ? x.to : kr(x.to ?? 0)}`)
      .join(", ");
    out.push({ id: `salary_constants:${c.month}`, kind: "salary", salary: { action: "ack", month: c.month }, text: `Nya lönevärden från ${month}: ${what}` });
  }
  return out;
}
