import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringExpenseMarks, recurringExpenses } from "../db/schema.js";

/**
 * Changes to a fixed expense that hold from a month: a move to another
 * account (a new card) and a cancellation after a last draw. The periods
 * before stay as they were, so the charges already drawn keep their links,
 * count in Delad ekonomi and are never 'förfallen' for being on the old card.
 * And single periods it wasn't drawn (paused for a while), marked 'skipped'.
 */

type Expense = typeof recurringExpenses.$inferSelect;

/** A period as a month: a yearly one's ('2026') is the month of its draw. */
export function periodMonth(e: Pick<Expense, "anchorMonth">, period: string): string {
  return period.length === 4 ? `${period}-${String(e.anchorMonth ?? 1).padStart(2, "0")}` : period.slice(0, 7);
}

/** Paused ones with a last draw still count up to it. */
export const counts = (e: Pick<Expense, "paused" | "lastPeriod">): boolean => !e.paused || e.lastPeriod !== null;

/** Whether the charge for a period counts: not paused, or paused after it. */
export function activeIn(e: Pick<Expense, "paused" | "lastPeriod" | "anchorMonth">, period: string): boolean {
  return !e.paused || (e.lastPeriod !== null && periodMonth(e, period) <= e.lastPeriod);
}

/** The account the charge for a period is drawn from: the one before the move for the periods before it. */
export function accountFor(e: Pick<Expense, "accountId" | "previousAccountId" | "accountFrom" | "anchorMonth">, period: string): number | null {
  return e.previousAccountId !== null && e.accountFrom !== null && periodMonth(e, period) < e.accountFrom ? e.previousAccountId : e.accountId;
}

/**
 * The periods marked as not drawn (a subscription paused for a while), as
 * 'id|period': nothing is expected for them, so they are never 'förfallen',
 * missed, or shared. A charge that comes anyway still links and counts.
 */
export function skippedPeriods(db: Db): Set<string> {
  return new Set(
    db
      .select()
      .from(recurringExpenseMarks)
      .where(eq(recurringExpenseMarks.kind, "skipped"))
      .all()
      .map((m) => `${m.recurringExpenseId}|${m.period}`),
  );
}
