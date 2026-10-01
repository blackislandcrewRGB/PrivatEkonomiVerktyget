import type { Db } from "../db/client.js";
import { cashflow, type CashEvent } from "../cashflow/cashflow.js";
import { mainIncome } from "../overview/overview.js";
import { addDays } from "../overview/dates.js";
import { upcomingRefunds } from "../tax/refund.js";

/**
 * Framåt, under Pengar totalt: how the figure changes over the coming salary
 * cycle — from today to the day before the salary after the next — by what
 * comes in and goes out of the bank: the salary, Mio's payments, the card
 * invoices, rent and the other fixed expenses, anything planned. The same
 * events as Kassaflöde: a card invoice counts what is likely to be bought on
 * the card before its period ends; what is paid straight from the bank day
 * by day is left out, so the end figure is before that spending.
 * Without a salary to go by, 30 days.
 */

const FALLBACK_DAYS = 30;

export interface Ahead {
  from: string;
  /** The day before the salary after the next (or 30 days on). */
  to: string;
  startOre: number;
  items: Pick<CashEvent, "date" | "kind" | "name" | "amount" | "estimate" | "paced" | "taxRefundYear">[];
  endOre: number;
  /** The salary days that bound it. */
  salaries: string[];
  /** A tax refund (or kvarskatt) further off than the cycle: said as a line of its own. */
  later: { incomeYear: number; payDate: string; amount: number }[];
}

export function ahead(db: Db, today: string, startOre: number): Ahead {
  const flow = cashflow(db, today);
  const main = mainIncome(db);
  const salaries = main ? flow.events.filter((e) => e.kind === "income" && e.name.startsWith(main.name)).map((e) => e.date) : [];
  const to = salaries[1] ? addDays(salaries[1], -1) : addDays(today, FALLBACK_DAYS);
  const items = flow.events
    .filter((e) => e.date >= today && e.date <= to)
    .map(({ date, kind, name, amount, estimate, paced, taxRefundYear }) => ({
      date,
      kind,
      name,
      amount,
      ...(estimate ? { estimate } : {}),
      ...(paced ? { paced } : {}),
      ...(taxRefundYear ? { taxRefundYear } : {}),
    }));
  const later = upcomingRefunds(db, today)
    .filter((r) => r.payDate > to)
    .map((r) => ({ incomeYear: r.incomeYear, payDate: r.payDate, amount: r.refund! * 100 }));
  return { from: today, to, startOre, items, endOre: startOre + items.reduce((s, e) => s + e.amount, 0), salaries: salaries.slice(0, 2), later };
}
