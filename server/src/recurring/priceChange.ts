import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringExpenses, transactions } from "../db/schema.js";
import { periodMonth } from "./changes.js";
import { chargeDate, nearestOccurrence } from "./schedule.js";
import { currentPlanFrom, monthBefore, pastPlanAt, snapshot } from "./plans.js";
import { priceInKronor } from "./foreignPrice.js";

/**
 * A new price from a period on: a subscription downgraded (Claude Max to Pro)
 * is cheaper from its next draw, not before. Until then the change waits on
 * the expense (`next_from`, `next_amount`, `next_foreign_amount`); the
 * periods from it expect the new price, the ones before keep the old. Once a
 * charge for that period or later has come, the new price is simply the
 * price and the change is gone.
 */

type Expense = typeof recurringExpenses.$inferSelect;
type Priced = Pick<Expense, "amount"> & Partial<Pick<Expense, "nextFrom" | "nextAmount" | "anchorMonth" | "planHistory">>;

/** Whether a period (YYYY-MM, or a yearly one's YYYY) is under the new price. */
const changed = (e: Partial<Pick<Expense, "nextFrom" | "anchorMonth">>, period: string) =>
  !!e.nextFrom && periodMonth({ anchorMonth: e.anchorMonth ?? null }, period) >= e.nextFrom;

/** The kronor expected for a period: the plan's price before a plan change, the new price from a coming change on. */
export function priceFor(e: Priced, period: string): number {
  const past = pastPlanAt(e, period);
  if (past) return past.amount;
  return changed(e, period) && e.nextAmount ? e.nextAmount : e.amount;
}

/** Priced in a currency: the price before VAT for a period. */
export function foreignAmountFor(e: Pick<Expense, "foreignAmount" | "nextFrom" | "nextForeignAmount" | "anchorMonth"> & Partial<Pick<Expense, "planHistory">>, period: string): number | null {
  const past = pastPlanAt(e, period);
  if (past) return past.foreignAmount;
  return changed(e, period) && e.nextForeignAmount ? e.nextForeignAmount : e.foreignAmount;
}

/** The period a linked charge is for, as a month. */
function chargeMonth(e: Expense, t: { bookingDate: string; transactionDate: string | null; postedDate: string | null }): string {
  // As chargePeriod in amounts.ts (which imports this).
  return periodMonth(e, nearestOccurrence(e, chargeDate(e, t))?.period ?? t.bookingDate.slice(0, 7));
}

/** What a plan change sets from a month on; what is left out stays as it is. */
export interface PlanSwitch {
  from: string;
  /** Kronor, or for one priced in a currency the new price before VAT in `foreignAmount`. */
  amount?: number | null;
  foreignAmount?: number | null;
  /** The new draw day (a plan change often starts a new billing period). */
  anchorDay?: number | null;
  name?: string | null;
}

/** Why a plan can't change from a month, or null: it has to be after the plan it is on began. */
export function planSwitchError(e: Pick<Expense, "planHistory">, from: string): string | null {
  const began = currentPlanFrom(e);
  return began !== null && from <= began ? `Planbytet ska ligga efter det förra, som började ${began}.` : null;
}

/**
 * Puts the expense on a new plan from a month: the plan it is on is kept for
 * the months before (price and day), so they keep both. A coming change that
 * was waiting is gone. Returns the expense as it is now.
 */
export function switchPlan(db: Db, e: Expense, to: PlanSwitch): Expense {
  const history = [...(e.planHistory ?? []), snapshot(e, monthBefore(to.from))];
  const row = db
    .update(recurringExpenses)
    .set({
      planHistory: history,
      amount: to.amount ?? e.amount,
      foreignAmount: to.foreignAmount ?? e.foreignAmount,
      ...(to.anchorDay != null ? { scheduleType: "day_of_month" as const, anchorDay: to.anchorDay } : {}),
      planName: to.name ?? null,
      nextFrom: null,
      nextAmount: null,
      nextForeignAmount: null,
      nextPlanName: null,
    })
    .where(eq(recurringExpenses.id, e.id))
    .returning()
    .get();
  if (row.currency) priceInKronor(db, row);
  return db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!;
}

/** Makes every change whose period has been drawn the price. Returns how many. */
export function applyPriceChanges(db: Db): number {
  let applied = 0;
  for (const e of db.select().from(recurringExpenses).where(isNotNull(recurringExpenses.nextFrom)).all()) {
    const drawn = db
      .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, e.id), isNull(transactions.deletedAt)))
      .all()
      .some((t) => chargeMonth(e, t) >= e.nextFrom!);
    if (!drawn) continue;
    // A change that no longer comes after the plan it is on (it was changed since) is just dropped.
    if (planSwitchError(e, e.nextFrom!)) {
      db.update(recurringExpenses).set({ nextFrom: null, nextAmount: null, nextForeignAmount: null, nextPlanName: null }).where(eq(recurringExpenses.id, e.id)).run();
      continue;
    }
    switchPlan(db, e, { from: e.nextFrom!, amount: e.nextAmount, foreignAmount: e.nextForeignAmount, name: e.nextPlanName });
    applied++;
  }
  return applied;
}
