import type { PastPlan, recurringExpenses } from "../db/schema.js";

/**
 * Plans: a subscription changes plan (Plus to Pro, and back) and with it the
 * price and often the day it is drawn, because the provider starts a new
 * period the day you switch. The expense's own columns are the plan it is on
 * now; the ones before are kept in `plan_history`, each up to and including a
 * month. A period (YYYY-MM, or a yearly one's YYYY) is looked up here, so a
 * charge drawn on the 28th for September stays September's after the day
 * became the 6th, and keeps September's price.
 */

type Expense = typeof recurringExpenses.$inferSelect;
export type PlanFields = Pick<PastPlan, "amount" | "foreignAmount" | "scheduleType" | "anchorDay" | "bankDayRule" | "name">;
type WithHistory = { planHistory?: PastPlan[] | null; anchorMonth?: number | null };

/** A period as a month: a yearly one's ('2026') is the month of its draw (as periodMonth in changes.ts). */
const monthOfPeriod = (e: Pick<WithHistory, "anchorMonth">, period: string) =>
  period.length === 4 ? `${period}-${String(e.anchorMonth ?? 1).padStart(2, "0")}` : period.slice(0, 7);

/** The plan before the current one that holds for a period, or null when the period is on the current plan. */
export function pastPlanAt(e: WithHistory, period: string): PastPlan | null {
  if (!e.planHistory?.length) return null;
  const month = monthOfPeriod(e, period);
  return e.planHistory.find((p) => month <= p.until) ?? null;
}

/** The plan a period is on: price, day and name. */
export function planAt(e: Pick<Expense, "amount" | "foreignAmount" | "scheduleType" | "anchorDay" | "bankDayRule" | "planName"> & WithHistory, period: string): PlanFields {
  const past = pastPlanAt(e, period);
  return past ?? { amount: e.amount, foreignAmount: e.foreignAmount, scheduleType: e.scheduleType, anchorDay: e.anchorDay, bankDayRule: e.bankDayRule, name: e.planName };
}

/** The first month of the plan it is on now (the month after the latest past plan), or null when it never changed. */
export function currentPlanFrom(e: WithHistory): string | null {
  const last = e.planHistory?.at(-1);
  return last ? monthAfter(last.until) : null;
}

/** The plans in order with the month each began (the first has none known), the current one last. */
export function planTimeline(
  e: Pick<Expense, "amount" | "foreignAmount" | "scheduleType" | "anchorDay" | "bankDayRule" | "planName"> & WithHistory,
): { from: string | null; until: string | null; plan: PlanFields }[] {
  const past = e.planHistory ?? [];
  const out = past.map((p, i) => ({
    from: i === 0 ? null : monthAfter(past[i - 1].until),
    until: p.until as string | null,
    plan: { amount: p.amount, foreignAmount: p.foreignAmount, scheduleType: p.scheduleType, anchorDay: p.anchorDay, bankDayRule: p.bankDayRule, name: p.name },
  }));
  out.push({ from: currentPlanFrom(e), until: null, plan: planAt(e, "9999-12") });
  return out;
}

/** The plan the expense is on now written as a past plan, ending the month before `from`. */
export function snapshot(e: Pick<Expense, "amount" | "foreignAmount" | "scheduleType" | "anchorDay" | "bankDayRule" | "planName">, until: string): PastPlan {
  return { until, amount: e.amount, foreignAmount: e.foreignAmount, scheduleType: e.scheduleType, anchorDay: e.anchorDay, bankDayRule: e.bankDayRule, name: e.planName };
}

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
/** The month before another (YYYY-MM). */
export const monthBefore = (month: string) => shiftMonth(month, -1);
/** The month after another (YYYY-MM). */
export const monthAfter = (month: string) => shiftMonth(month, 1);
