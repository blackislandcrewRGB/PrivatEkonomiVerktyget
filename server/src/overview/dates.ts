/** Date helpers on 'YYYY-MM-DD' strings (calendar dates, no time zones). */

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

export function todayLocal(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** 'YYYY-MM' shifted by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** The due date of `day` in `month`; days past the month's end fall on its last day (31 -> 30 Sep). */
export function dueDateIn(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

export const monthOf = (iso: string) => iso.slice(0, 7);

/** The first day of the 12 months up to and including this one ('Senaste 12 mån'). */
export const twelveMonthsBack = (today: string) => `${addMonths(monthOf(today), -11)}-01`;
