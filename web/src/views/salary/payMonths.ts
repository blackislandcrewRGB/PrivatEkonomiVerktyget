import type { SalaryMonth } from "../../api";
import { addMonth } from "./format";

/**
 * The work month the next salary is for. With the pay day on the 25th and
 * the month paid the month after: up to the 25th it is last month's, after
 * it this month's; and once that salary is in, the month after. (The pay
 * day moves to the bank day before at a weekend: the salary in is what
 * counts then.)
 */
export function nextPayMonth(months: Pick<SalaryMonth, "month" | "actual">[], today: string, lagMonths: 0 | 1, payDay: number): string {
  const day = Number(today.slice(8, 10));
  let m = addMonth(today.slice(0, 7), -lagMonths + (day > payDay ? 1 : 0));
  const paid = new Set(months.filter((x) => x.actual).map((x) => x.month));
  while (paid.has(m)) m = addMonth(m);
  return m;
}

/** The latest month whose salary has come in. */
export const lastPaid = <T extends Pick<SalaryMonth, "month" | "actual">>(months: T[]): T | null =>
  [...months].filter((m) => m.actual).sort((a, b) => a.month.localeCompare(b.month)).at(-1) ?? null;

/**
 * The month the form starts on: the first gap from the first month entered
 * up to the month after the last one; with none entered, the month the next
 * salary is for.
 */
export function firstMissing(entered: string[], fallback: string): string {
  const sorted = [...entered].sort();
  if (sorted.length === 0) return fallback;
  const have = new Set(sorted);
  let m = sorted[0];
  while (have.has(m)) m = addMonth(m);
  return m;
}

/** The months the form's picker offers: a year back to three ahead, and any entered or chosen, newest first. */
export function pickerMonths(today: string, entered: string[], chosen: string): string[] {
  const now = today.slice(0, 7);
  const range = Array.from({ length: 16 }, (_, i) => addMonth(now, i - 12));
  return [...new Set([...range, ...entered, ...(chosen ? [chosen] : [])])].sort().reverse();
}
