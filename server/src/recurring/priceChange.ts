import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringExpenses, transactions } from "../db/schema.js";
import { periodMonth } from "./changes.js";
import { chargeDate, nearestOccurrence } from "./schedule.js";

/**
 * A new price from a period on: a subscription downgraded (Claude Max to Pro)
 * is cheaper from its next draw, not before. Until then the change waits on
 * the expense (`next_from`, `next_amount`, `next_foreign_amount`); the
 * periods from it expect the new price, the ones before keep the old. Once a
 * charge for that period or later has come, the new price is simply the
 * price and the change is gone.
 */

type Expense = typeof recurringExpenses.$inferSelect;
type Priced = Pick<Expense, "amount"> & Partial<Pick<Expense, "nextFrom" | "nextAmount" | "anchorMonth">>;

/** Whether a period (YYYY-MM, or a yearly one's YYYY) is under the new price. */
const changed = (e: Partial<Pick<Expense, "nextFrom" | "anchorMonth">>, period: string) =>
  !!e.nextFrom && periodMonth({ anchorMonth: e.anchorMonth ?? null }, period) >= e.nextFrom;

/** The kronor expected for a period: the new price from the change on. */
export function priceFor(e: Priced, period: string): number {
  return changed(e, period) && e.nextAmount ? e.nextAmount : e.amount;
}

/** Priced in a currency: the price before VAT for a period. */
export function foreignAmountFor(e: Pick<Expense, "foreignAmount" | "nextFrom" | "nextForeignAmount" | "anchorMonth">, period: string): number | null {
  return changed(e, period) && e.nextForeignAmount ? e.nextForeignAmount : e.foreignAmount;
}

/** The period a linked charge is for, as a month. */
function chargeMonth(e: Expense, t: { bookingDate: string; transactionDate: string | null; postedDate: string | null }): string {
  // As chargePeriod in amounts.ts (which imports this).
  return periodMonth(e, nearestOccurrence(e, chargeDate(e, t))?.period ?? t.bookingDate.slice(0, 7));
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
    db.update(recurringExpenses)
      .set({
        amount: e.nextAmount ?? e.amount,
        foreignAmount: e.nextForeignAmount ?? e.foreignAmount,
        nextFrom: null,
        nextAmount: null,
        nextForeignAmount: null,
      })
      .where(eq(recurringExpenses.id, e.id))
      .run();
    applied++;
  }
  return applied;
}
