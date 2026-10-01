import type { RecurringExpense } from "../../../api";
import type { Share } from "../../../lib/share";
import { partOf } from "../model";

/** Still to be drawn this month: not drawn and not marked paid (förfallen and passerad too), as the groups count it. */
export const leftThisMonth = (e: RecurringExpense) => !!e.thisMonth && e.thisMonth.status !== "dragen" && e.thisMonth.status !== "markerad_betald";

/**
 * Den här månaden: what is left to draw (öre, Min del at half for shared
 * ones), how many of this month's draws that is, and the share drawn. Only
 * the monthly ones have a draw this month; paused ones have none.
 */
export function monthProgress(expenses: RecurringExpense[], share: Share) {
  const rows = expenses.filter((e) => e.thisMonth && !e.paused);
  const left = rows.filter(leftThisMonth);
  return {
    leftOre: left.reduce((s, e) => s + partOf(e, e.thisMonth!.amount, share), 0),
    leftCount: left.length,
    total: rows.length,
    drawnShare: rows.length ? (rows.length - left.length) / rows.length : 0,
  };
}
