import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { transactions } from "../db/schema.js";
import { fixedVariable } from "../analysis/analysis.js";
import { savingsByMonth } from "../savings/savings.js";
import { addMonths, monthOf } from "../overview/dates.js";
import { getBufferAccount, monthlyCost } from "./endurance.js";
import { currentBalance, manualBalanceByKey } from "./manualBalances.js";

/**
 * Flöde per månad: vad som kom in, vad som gick ut, och vart resten tog vägen.
 *
 * This is the realised money — what actually happened over whole months —
 * while Uthållighet above it is what a month costs from here on. They are
 * different questions and they use different bases on purpose: a charge that
 * happened is not the same as a charge that is planned, and pretending
 * otherwise would make one of the two wrong.
 *
 * The surplus is traced rather than assumed. Deposits into the portfolio and
 * the change on the buffer account are both known; what neither explains is
 * called unexplained and left at that. A negative figure there is not an
 * error — it means more was put aside than was left over, so the accounts
 * shrank to pay for it, which is worth seeing.
 */

export interface MonthFlow {
  month: string;
  incomeOre: number;
  fixedOre: number;
  variableOre: number;
  /** Income less both: what a month had over. */
  leftOre: number;
  fixedShareOfIncome: number | null;
}

export interface CsnProgress {
  /** The anchor, and what is left of it now. */
  anchorOre: number;
  anchorDate: string;
  remainingOre: number;
  paidSinceAnchorOre: number;
  paidThisYearOre: number;
  chargesThisYear: number;
  /** What it is actually being paid down with a month, from the charges. */
  rateOre: number | null;
  monthsLeft: number | null;
  /** The month it would be paid off in, at that rate. */
  payoffMonth: string | null;
}

export interface Flow {
  from: string;
  to: string;
  months: number;
  perMonth: { incomeOre: number; fixedOre: number; variableOre: number; leftOre: number };
  /**
   * Money that came back — an insurance payment, a reimbursement — already
   * netted off the variable figure above. It is written out because the same
   * spending appears gross in Uthållighet, and two figures that differ
   * without saying why are two figures nobody trusts.
   */
  refundsOre: number;
  fixedShareOfIncome: number | null;
  /** Net into the portfolio over income, the same figure Analys › Sparande shows. */
  savingsRate: number | null;
  destinations: {
    /** Per month: into the portfolio. */
    portfolioOre: number;
    /** Per month: what the buffer account actually grew by. */
    bufferOre: number;
    bufferAccount: { id: number; name: string } | null;
    /** What neither of them explains. Negative: the accounts paid for it. */
    unexplainedOre: number;
  };
  monthly: MonthFlow[];
  csn: CsnProgress | null;
}

/**
 * What the buffer account grew by.
 *
 * The net change, not the transfers into it: on this household the salary
 * lands on the savings account and some fixed charges are drawn from it, so
 * counting only the transfers in would call money 'saved' that left again the
 * same week.
 */
function bufferChange(db: Db, accountId: number, from: string, to: string): number {
  const row = db
    .select({ sum: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), gte(transactions.bookingDate, from), lt(transactions.bookingDate, to), isNull(transactions.deletedAt)))
    .get();
  return row?.sum ?? 0;
}

/** The student loan: what is left, what has been paid, and when it ends at this rate. */
export function csnProgress(db: Db, today: string): CsnProgress | null {
  const row = manualBalanceByKey(db, "csn");
  if (!row) return null;
  const now = currentBalance(db, row, today);

  const year = today.slice(0, 4);
  const charges =
    row.recurringExpenseId === null
      ? []
      : db
          .select({ amount: transactions.amount })
          .from(transactions)
          .where(
            and(
              eq(transactions.recurringExpenseId, row.recurringExpenseId),
              gte(transactions.bookingDate, `${year}-01-01`),
              sql`${transactions.bookingDate} <= ${today}`,
              sql`${transactions.amount} < 0`,
              isNull(transactions.deletedAt),
            ),
          )
          .all();
  const paidThisYearOre = charges.reduce((s, t) => s - t.amount, 0);
  // The rate the loan is actually being paid down with, not the standing
  // amount on the expense: CSN varies over the year, and the average of what
  // has really been drawn is what 'current rate' means.
  const rateOre = charges.length > 0 ? Math.round(paidThisYearOre / charges.length) : null;
  const monthsLeft = rateOre && rateOre > 0 ? Math.ceil(now.amountOre / rateOre) : null;

  return {
    anchorOre: row.amountOre,
    anchorDate: row.valueDate,
    remainingOre: now.amountOre,
    paidSinceAnchorOre: now.paidOre,
    paidThisYearOre,
    chargesThisYear: charges.length,
    rateOre,
    monthsLeft,
    payoffMonth: monthsLeft === null ? null : addMonths(monthOf(today), monthsLeft),
  };
}

export function flow(db: Db, today: string, months = 3): Flow {
  const lastWhole = addMonths(monthOf(today), -1);
  const from = `${addMonths(lastWhole, -(months - 1))}-01`;
  const to = `${addMonths(lastWhole, 1)}-01`;
  // fixedVariable takes an inclusive end, so it gets the last day of the
  // last whole month; the account sums take the exclusive first of the next.
  const lastDay = new Date(Date.UTC(Number(lastWhole.slice(0, 4)), Number(lastWhole.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const fv = fixedVariable(db, from, lastDay, "mine");
  const savings = savingsByMonth(db, from, lastDay);
  const bufferAccount = getBufferAccount(db);
  const bufferOre = bufferAccount ? bufferChange(db, bufferAccount.id, from, to) : 0;

  const per = (total: number) => Math.round(total / months);
  // What Uthållighet counts: spending without the refunds netted off. A
  // refund that came once is not a reason to expect a cheaper month ahead,
  // which is why that calculation keeps it out and this one doesn't.
  const grossVariable = monthlyCost(db, today, months).variableOre;
  const leftTotal = fv.total.income - fv.total.fixed - fv.total.variable;
  const portfolioTotal = savings.total.net;

  return {
    from,
    to: lastDay,
    months,
    perMonth: {
      incomeOre: per(fv.total.income),
      fixedOre: per(fv.total.fixed),
      variableOre: per(fv.total.variable),
      leftOre: per(leftTotal),
    },
    refundsOre: Math.max(0, grossVariable - per(fv.total.variable)),
    fixedShareOfIncome: fv.total.income > 0 ? fv.total.fixed / fv.total.income : null,
    savingsRate: savings.total.rate,
    destinations: {
      portfolioOre: per(portfolioTotal),
      bufferOre: per(bufferOre),
      bufferAccount,
      unexplainedOre: per(leftTotal - portfolioTotal - bufferOre),
    },
    monthly: fv.months.map((m) => ({
      month: m.month,
      incomeOre: m.income,
      fixedOre: m.fixed,
      variableOre: m.variable,
      leftOre: m.income - m.fixed - m.variable,
      fixedShareOfIncome: m.fixedShareOfIncome,
    })),
    csn: csnProgress(db, today),
  };
}
