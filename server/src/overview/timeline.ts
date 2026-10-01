import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringIncome, transactions } from "../db/schema.js";
import { nearestDue } from "../recurring/link.js";
import type { ExpenseStatus, InvoiceStatus, Occurrence, Payday, UpcomingInvoice } from "./overview.js";
import { addDays, addMonths, dueDateIn, monthOf } from "./dates.js";
import { scheduleDeadlines } from "../salary/schedule.js";

/** Kommande 14 dagar: today and the 13 days after. */
export const TIMELINE_DAYS = 14;

export interface TimelineEvent {
  date: string;
  /** 'work': Jobb, the day a month's work schedule is due (no amount). */
  kind: "income" | "expense" | "invoice" | "work";
  name: string;
  /** Öre, positive (0 for 'work'). */
  amount: number;
  accountId: number | null;
  /** A fixed expense drawn on a credit card (paid via the invoice, not from a balance). */
  onCard: boolean;
  /**
   * Expense: its status. Income: 'expected'. Invoice: 'unpaid'/'partial' for
   * an invoice that exists, 'estimate' for the next one before it does.
   * Work: 'expected', or 'received' once ticked off.
   */
  status: ExpenseStatus | "expected" | "unpaid" | "partial" | "estimate" | "received";
  expenseId?: number;
  period?: string;
  statementId?: number;
  /** Work: the month the schedule covers. */
  month?: string;
}

export interface TimelineAccount {
  accountId: number;
  accountName: string;
  kind: "bank" | "credit_card";
  /** Payday, or the day after the timeline without one. */
  before: string;
  beforePayday: boolean;
  /** Still to be drawn before `before` (what the forecast counts, for a bank account). */
  total: number;
  count: number;
  /** Still to be drawn up to the timeline's `accountsTo`. */
  windowTotal: number;
  windowCount: number;
  items: { expenseId: number; period: string; name: string; amount: number; dueDate: string; beforePayday: boolean }[];
}

export interface Timeline {
  from: string;
  to: string;
  payday: string | null;
  events: TimelineEvent[];
  /** Per account: fixed expenses still to be drawn, up to `accountsTo`. */
  accounts: TimelineAccount[];
  /** The last day the account rows cover: the day before payday, or the 14 days' end if that is later. */
  accountsTo: string;
  /** Everything in the account rows (öre, positive). */
  accountsTotal: number;
}

/**
 * The next 14 days: the salary and other incomes not yet in, fixed expenses
 * (on bank accounts and cards), and card invoices due (the latest one unless
 * paid, and the next Mastercard invoice's estimate), and the work schedule's
 * deadline (Jobb). Under it, per account, what is still to be drawn: up
 * to payday, or the 14 days if payday comes sooner.
 */
export function buildTimeline(
  db: Db,
  today: string,
  input: {
    payday: Payday | null;
    occurrences: Occurrence[];
    invoices: InvoiceStatus[];
    upcoming: UpcomingInvoice[];
    accounts: { id: number; name: string; kind: "bank" | "credit_card" }[];
  },
): Timeline {
  const from = today;
  const to = addDays(today, TIMELINE_DAYS - 1);
  const within = (d: string) => d >= from && d <= to;
  const kindOf = new Map(input.accounts.map((a) => [a.id, a.kind]));
  const events: TimelineEvent[] = [];

  const { payday } = input;
  if (payday && !payday.late && within(payday.date)) {
    events.push({ date: payday.date, kind: "income", name: payday.name, amount: payday.expected, accountId: payday.accountId, onCard: false, status: "expected" });
  }
  events.push(...otherIncome(db, from, to, payday?.incomeId ?? null));

  for (const o of input.occurrences) {
    if (!within(o.dueDate)) continue;
    events.push({
      date: o.dueDate,
      kind: "expense",
      name: o.name,
      amount: o.amount,
      accountId: o.accountId,
      onCard: o.accountId !== null && kindOf.get(o.accountId) === "credit_card",
      status: o.status,
      expenseId: o.expenseId,
      period: o.period,
    });
  }

  for (const i of input.invoices) {
    if (i.status === "paid" || !within(i.dueDate)) continue;
    events.push({
      date: i.dueDate,
      kind: "invoice",
      name: i.accountName,
      amount: i.amountDue - i.paidAmount,
      accountId: i.accountId,
      onCard: false,
      status: i.status,
      statementId: i.statementId,
    });
  }
  for (const u of input.upcoming) {
    if (!within(u.dueDate) || events.some((e) => e.kind === "invoice" && e.accountId === u.accountId && e.date === u.dueDate)) continue;
    events.push({ date: u.dueDate, kind: "invoice", name: u.accountName, amount: u.estimate, accountId: u.accountId, onCard: false, status: "estimate" });
  }

  for (const s of scheduleDeadlines(db, from, to)) {
    events.push({ date: s.date, kind: "work", name: s.name, amount: 0, accountId: null, onCard: false, status: s.received ? "received" : "expected", month: s.month });
  }

  const order = { income: 0, invoice: 1, expense: 2, work: 3 };
  events.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || b.amount - a.amount);

  const before = payday && !payday.late ? payday.date : addDays(to, 1);
  // The account rows reach the next salary when it is further off than the 14 days.
  const accountsTo = before > addDays(to, 1) ? addDays(before, -1) : to;
  const inRows = (d: string) => d >= from && d <= accountsTo;
  // Bank accounts first (they are what the forecast is about), then cards.
  const accounts: TimelineAccount[] = [...input.accounts]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "bank" ? -1 : 1))
    .map((a) => {
      const items = input.occurrences
        .filter((o) => o.accountId === a.id && o.status === "kommande" && inRows(o.dueDate))
        .map((o) => ({ expenseId: o.expenseId, period: o.period, name: o.name, amount: o.amount, dueDate: o.dueDate, beforePayday: o.dueDate < before }));
      const early = items.filter((o) => o.beforePayday);
      return {
        accountId: a.id,
        accountName: a.name,
        kind: a.kind,
        before,
        beforePayday: !!payday && !payday.late,
        total: early.reduce((s, o) => s + o.amount, 0),
        count: early.length,
        windowTotal: items.reduce((s, o) => s + o.amount, 0),
        windowCount: items.length,
        items,
      };
    })
    .filter((a) => a.windowCount > 0);

  return {
    from,
    to,
    payday: payday && !payday.late ? payday.date : null,
    events,
    accounts,
    accountsTo,
    accountsTotal: accounts.reduce((s, a) => s + a.windowTotal, 0),
  };
}

/** Active recurring incomes other than the salary, due in the window and not yet in. */
function otherIncome(db: Db, from: string, to: string, paydayIncomeId: number | null): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const i of db.select().from(recurringIncome).where(eq(recurringIncome.active, true)).all()) {
    if (i.id === paydayIncomeId) continue;
    const received = db
      .select({ bookingDate: transactions.bookingDate })
      .from(transactions)
      .where(and(eq(transactions.recurringIncomeId, i.id), isNull(transactions.deletedAt)))
      .all()
      .map((t) => nearestDue(t.bookingDate, i.dayOfMonth).month);
    for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) {
      const date = dueDateIn(m, i.dayOfMonth);
      if (date < from || date > to || received.includes(m)) continue;
      out.push({ date, kind: "income", name: i.name, amount: i.amount, accountId: i.accountId, onCard: false, status: "expected" });
    }
  }
  return out;
}
