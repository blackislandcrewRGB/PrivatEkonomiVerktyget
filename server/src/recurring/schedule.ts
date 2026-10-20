import type { recurringExpenses, transactions } from "../db/schema.js";
import { nextBankDay, previousBankDay } from "../calendar/bankDays.js";
import { pastPlanAt } from "./plans.js";

type Expense = typeof recurringExpenses.$inferSelect;
/**
 * Without billingCycle (or 'monthly'): drawn every month. Yearly: once a year, in anchorMonth.
 * With planHistory the day of a month before a plan change is the plan's then (plans.ts).
 */
export type Schedule = Pick<Expense, "scheduleType" | "anchorDay" | "bankDayRule"> & Partial<Pick<Expense, "billingCycle" | "anchorMonth" | "planHistory">>;
type Charge = Pick<typeof transactions.$inferSelect, "bookingDate" | "transactionDate" | "postedDate">;

/** A linked charge within this many days of the predicted date is on schedule. */
export const ON_SCHEDULE_DAYS = 2;
/** Up to this many days off still links, flagged 'avvek från schemat'. */
export const OFF_SCHEDULE_DAYS = 5;
/** suggestSchedule needs at least this many linked charges. */
export const MIN_DRAWS_FOR_SUGGESTION = 4;
/**
 * A yearly charge links from this many days before its date to this many
 * after: invoices are paid ahead (the vehicle tax 9 June, due 30 June), an
 * inspection is booked some weeks before its deadline.
 */
export const YEARLY_EARLY_DAYS = 45;
export const YEARLY_LATE_DAYS = 10;

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const yearly = (e: Schedule) => e.billingCycle === "yearly";

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

export function addMonthsToPeriod(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * The date an expense is drawn for a month (its period). May fall in the next
 * or previous month after moving to a bank day (28 Feb 2026 is a Saturday: 2
 * March), and still belongs to the month it is for. Null when no day is known.
 */
export function occurrenceInMonth(e: Schedule, year: number, month1: number): string | null {
  const plan = pastPlanAt(e, `${year}-${pad(month1)}`) ?? e;
  // The same schedule and month always give the same day: suggestSchedule asks 96 schedules about every charge.
  const key = `${plan.scheduleType}|${plan.anchorDay}|${plan.bankDayRule}|${year}|${month1}`;
  let date = occurrences.get(key);
  if (date === undefined) {
    if (occurrences.size >= MAX_KEPT_OCCURRENCES) occurrences.clear();
    occurrences.set(key, (date = computeOccurrence(plan, year, month1)));
  }
  return date;
}

const occurrences = new Map<string, string | null>();
const MAX_KEPT_OCCURRENCES = 50_000;

function computeOccurrence(e: Pick<Schedule, "scheduleType" | "anchorDay" | "bankDayRule">, year: number, month1: number): string | null {
  const last = daysInMonth(year, month1);
  let day: number;
  if (e.scheduleType === "last_day") day = last;
  else if (e.anchorDay === null) return null;
  else day = Math.min(e.anchorDay, last);
  const nominal = `${year}-${pad(month1)}-${pad(day)}`;
  return e.bankDayRule === "next" ? nextBankDay(nominal) : e.bankDayRule === "previous" ? previousBankDay(nominal) : nominal;
}

/** occurrenceInMonth for a 'YYYY-MM' period; a yearly expense only has one in its month (none without a month). */
export function occurrenceFor(e: Schedule, period: string): string | null {
  const month = Number(period.slice(5, 7));
  if (yearly(e) && e.anchorMonth !== month) return null;
  return occurrenceInMonth(e, Number(period.slice(0, 4)), month);
}

/** A yearly expense's draws around a year: the year before, the same and the one after (none without a month). */
function yearlyAround(e: Schedule, year: number): { period: string; date: string }[] {
  if (!e.anchorMonth) return [];
  return [year - 1, year, year + 1].flatMap((y) => {
    const date = occurrenceInMonth(e, y, e.anchorMonth!);
    return date ? [{ period: `${y}-${pad(e.anchorMonth!)}`, date }] : [];
  });
}

/** The first draw on or after `fromDate` (the month before is checked too: its draw may have moved into this one). */
export function nextOccurrence(e: Schedule, fromDate: string): { period: string; date: string } | null {
  if (yearly(e)) return yearlyAround(e, Number(fromDate.slice(0, 4))).find((o) => o.date >= fromDate) ?? null;
  let period = addMonthsToPeriod(fromDate.slice(0, 7), -1);
  for (let i = 0; i < 14; i++, period = addMonthsToPeriod(period, 1)) {
    const date = occurrenceFor(e, period);
    if (date === null) return null;
    if (date >= fromDate) return { period, date };
  }
  return null;
}

/**
 * The draw nearest a date: its period, predicted date and the distance in
 * days. Looks at the month before, the same and the one after, so a charge on
 * 2 March for a 28 February draw belongs to February.
 */
export function nearestOccurrence(e: Schedule, date: string): { period: string; date: string; distance: number } | null {
  let best: { period: string; date: string; distance: number } | null = null;
  if (yearly(e)) {
    for (const o of yearlyAround(e, Number(date.slice(0, 4)))) {
      const distance = Math.abs(dayNumber(o.date) - dayNumber(date));
      if (!best || distance < best.distance) best = { ...o, distance };
    }
    return best;
  }
  for (const offset of [-1, 0, 1]) {
    const period = addMonthsToPeriod(date.slice(0, 7), offset);
    const predicted = occurrenceFor(e, period);
    if (predicted === null) return null;
    const distance = Math.abs(dayNumber(predicted) - dayNumber(date));
    if (!best || distance < best.distance) best = { period, date: predicted, distance };
  }
  return best;
}

/** The date of a charge that is compared with the schedule (see recurring_expenses.date_basis). */
export function chargeDate(e: Pick<Expense, "dateBasis">, t: Charge): string {
  return e.dateBasis === "transaction" ? (t.transactionDate ?? t.bookingDate) : (t.postedDate ?? t.bookingDate);
}

export interface ScheduleSuggestion extends Schedule {
  /** Charges the schedule predicts to the day. */
  matches: number;
  total: number;
  /** The current schedule's hits, for comparison. */
  currentMatches: number;
}

/**
 * The schedule that predicts most of the linked charges to the day: a fixed
 * day (1–31) or the last day of the month, each with no bank-day rule or
 * moved to the next/previous bank day. Ties go to the simpler schedule (no
 * rule, then the current one, then 'last day' over the same dates as day 31).
 * Null with fewer than four charges, and when the current schedule predicts
 * the three latest charges to the day but the suggestion doesn't (the day was
 * just changed: Pocket moved from the 2nd to the 4th). Never applied automatically.
 */
export function suggestSchedule(current: Schedule, dates: string[]): ScheduleSuggestion | null {
  if (dates.length < MIN_DRAWS_FOR_SUGGESTION) return null;
  // On the day exactly: the draw for the month before, the same or the one after is that date. The months once per charge, not per schedule.
  const around = new Map(dates.map((d) => [d, [0, -1, 1].map((n) => addMonthsToPeriod(d.slice(0, 7), n))]));
  const onDay = (s: Schedule, d: string) => (yearly(s) ? nearestOccurrence(s, d)?.distance === 0 : around.get(d)!.some((period) => occurrenceFor(s, period) === d));
  const hits = (s: Schedule) => dates.filter((d) => onDay(s, d)).length;
  const rules = ["none", "next", "previous"] as const;
  const candidates: Schedule[] = [
    ...rules.map((bankDayRule) => ({ scheduleType: "last_day" as const, anchorDay: null, bankDayRule })),
    ...rules.flatMap((bankDayRule) =>
      Array.from({ length: 31 }, (_, i) => ({ scheduleType: "day_of_month" as const, anchorDay: i + 1, bankDayRule })),
    ),
  ];
  const same = (a: Schedule, b: Schedule) =>
    a.scheduleType === b.scheduleType && a.bankDayRule === b.bankDayRule && (a.scheduleType === "last_day" || a.anchorDay === b.anchorDay);
  const rank = (s: Schedule) => [s.bankDayRule === "none" ? 0 : 1, same(s, current) ? 0 : 1, s.scheduleType === "last_day" ? 0 : 1];
  let best: { s: Schedule; n: number } | null = null;
  for (const s of candidates) {
    const n = hits(s);
    if (!best || n > best.n) best = { s, n };
    else if (n === best.n) {
      const [a, b] = [rank(s), rank(best.s)];
      if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = { s, n };
    }
  }
  // Nothing to suggest: no hits, or the current schedule is already the best one.
  if (!best || best.n === 0 || same(best.s, current) || best.n <= hits(current)) return null;
  const latest = [...dates].sort().slice(-3);
  const fitsLatest = (s: Schedule) => latest.every((d) => onDay(s, d));
  if (fitsLatest(current) && !fitsLatest(best.s)) return null;
  return { ...best.s, matches: best.n, total: dates.length, currentMatches: hits(current) };
}

/** Days from a yearly charge's predicted date to the charge (negative: paid ahead). */
export function signedDistance(predicted: string, date: string): number {
  return dayNumber(date) - dayNumber(predicted);
}

/** 'fast dag 28, flyttas till nästa bankdag' / 'sista dagen i månaden' / 'varje år 20 juni'. */
export function describeSchedule(s: Schedule): string {
  if (yearly(s)) {
    if (!s.anchorMonth) return "årsvis, ingen månad";
    const day = s.scheduleType === "last_day" ? "sista" : s.anchorDay === null ? null : String(s.anchorDay);
    return day ? `varje år ${day} ${MONTHS[s.anchorMonth - 1]}` : `varje år i ${MONTHS[s.anchorMonth - 1]}`;
  }
  const base = s.scheduleType === "last_day" ? "sista dagen i månaden" : s.anchorDay === null ? "ingen dag" : `fast dag ${s.anchorDay}`;
  const rule = s.bankDayRule === "next" ? ", flyttas till nästa bankdag" : s.bankDayRule === "previous" ? ", flyttas till föregående bankdag" : "";
  return base + rule;
}
