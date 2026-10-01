import type { Cashflow } from "../../../api";
import { plusDays } from "../format";
import { paydays } from "./chartMarks";

type Day = Cashflow["days"][number];

export type ListRange = "salary" | "30" | "90";

/** How many days after the salary its bills may come and still belong to it (the 25th after the 23rd). */
const BILLS_AFTER_SALARY_DAYS = 7;

/**
 * The last day listed. 'salary': through the next salary and the bills it
 * pays (the first day with a fixed charge or an invoice within a week after
 * it), or 30 days without a salary in sight; '30': 30 days; '90': all.
 */
export function listEnd(data: Pick<Cashflow, "today" | "days">, range: ListRange): string {
  const last = data.days.at(-1)!.date;
  if (range === "90") return last;
  const thirty = plusDays(data.today, 30);
  if (range === "30") return thirty < last ? thirty : last;
  const payday = paydays(data.days).find((d) => d > data.today);
  if (!payday) return thirty < last ? thirty : last;
  const bills = data.days.find((d) => d.date > payday && d.date <= plusDays(payday, BILLS_AFTER_SALARY_DAYS) && d.events.some((e) => e.amount < 0 && (e.kind === "fixed" || e.kind === "invoice")));
  return bills?.date ?? payday;
}

export interface DayRow {
  date: string;
  balance: number;
  events: Day["events"];
  today: boolean;
  lowest: boolean;
}

/** The days with something happening up to the end, and the lowest day even when nothing happens on it. */
export function dayRows(data: Pick<Cashflow, "today" | "days" | "lowest">, range: ListRange): DayRow[] {
  const end = listEnd(data, range);
  return data.days
    .filter((d) => d.date <= end && (d.events.length > 0 || d.date === data.lowest.date))
    .map((d) => ({ date: d.date, balance: d.balance, events: d.events, today: d.date === data.today, lowest: d.date === data.lowest.date }));
}
