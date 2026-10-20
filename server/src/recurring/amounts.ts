import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringExpenseAmounts, recurringExpenses, transactions } from "../db/schema.js";
import { chargeDate, nearestOccurrence } from "./schedule.js";
import { chargeOwnerId, chargeShare, partsByOwner } from "./parts.js";
import { withVat } from "./foreignPrice.js";
import { foreignAmountFor, priceFor } from "./priceChange.js";
import { planAt, planTimeline } from "./plans.js";

type Expense = typeof recurringExpenses.$inferSelect;

type Charge = Pick<typeof transactions.$inferSelect, "bookingDate" | "transactionDate" | "postedDate">;

/** The month a charge pays for: by the schedule's nearest draw if there is one (a 2 March charge for 28 Feb is February). */
export function chargePeriod(e: Pick<Expense, "scheduleType" | "anchorDay" | "bankDayRule" | "dateBasis">, t: Charge): string {
  return nearestOccurrence(e, chargeDate(e, t))?.period ?? t.bookingDate.slice(0, 7);
}

/**
 * Loads every per-month amount once. The returned function gives the amount
 * expected for an expense in a month: the month's own amount if set, else the usual one.
 */
export function expectedAmounts(
  db: Db,
): (e: Pick<Expense, "id" | "amount"> & Partial<Pick<Expense, "nextFrom" | "nextAmount" | "anchorMonth" | "planHistory">>, month: string) => number {
  const byKey = new Map(db.select().from(recurringExpenseAmounts).all().map((r) => [`${r.recurringExpenseId}|${r.month}`, r.amount]));
  // A new price from a period on (priceChange.ts) counts from then.
  return (e, month) => byKey.get(`${e.id}|${month}`) ?? priceFor(e, month);
}

/** A charge in the currency within a cent of the price is the price. */
const FOREIGN_TOLERANCE = 1;
/** Without the charge's foreign amount: this far from the kronor amount is still the rate. */
const KRONOR_TOLERANCE = 0.03;

/**
 * The latest linked charge and whether it differs from what was expected for
 * its month. An expense planned month by month (own amounts for the charge's
 * month or later) only warns when the charge's month has its own amount and
 * the charge differs from it: a past month without one says nothing about the
 * amounts already planned.
 */
export function latestChargeCheck(db: Db, e: Expense, expected = expectedAmounts(db), parts = partsByOwner(db)) {
  const latest = db
    .select({
      bookingDate: transactions.bookingDate,
      transactionDate: transactions.transactionDate,
      postedDate: transactions.postedDate,
      amount: transactions.amount,
      foreignAmount: transactions.foreignAmount,
      foreignCurrency: transactions.foreignCurrency,
    })
    .from(transactions)
    .where(and(eq(transactions.recurringExpenseId, chargeOwnerId(e)), isNull(transactions.deletedAt)))
    .orderBy(transactions.bookingDate, transactions.id)
    .all()
    .at(-1);
  if (!latest) return { latest: null, expected: e.amount, changed: false, foreign: null };
  // Priced in a currency: compared in it, so the rate moving is no change of
  // price. A charge without its foreign amount: in kronor, within the rate's
  // day-to-day swing.
  if (e.currency && e.foreignAmount && e.partOfId === null) {
    const period = chargePeriod(e, latest);
    const gross = withVat({ foreignAmount: foreignAmountFor(e, period), vatPercent: e.vatPercent });
    const want = expected(e, period);
    if (latest.foreignCurrency === e.currency && latest.foreignAmount) {
      const charged = Math.abs(latest.foreignAmount);
      return {
        latest: { bookingDate: latest.bookingDate, amount: latest.amount },
        expected: want,
        changed: Math.abs(charged - gross) > FOREIGN_TOLERANCE,
        foreign: { currency: e.currency, expected: gross, charged },
      };
    }
    return {
      latest: { bookingDate: latest.bookingDate, amount: latest.amount },
      expected: want,
      changed: Math.abs(Math.abs(latest.amount) - want) > want * KRONOR_TOLERANCE,
      foreign: null,
    };
  }
  const { bookingDate } = latest;
  const period = chargePeriod(e, latest);
  // Drawn together with others: this expense's share of the charge (a part never warns; the owner takes the difference).
  const amount = -chargeShare(e, parts, expected, Math.abs(latest.amount), period);
  const own = db
    .select({ month: recurringExpenseAmounts.month })
    .from(recurringExpenseAmounts)
    .where(eq(recurringExpenseAmounts.recurringExpenseId, e.id))
    .all()
    .map((r) => r.month);
  const want = expected(e, period);
  const differs = e.partOfId === null && Math.abs(amount) !== want;
  const plannedAhead = !own.includes(period) && own.some((m) => m > period);
  return { latest: { bookingDate, amount }, expected: want, changed: differs && !plannedAhead, foreign: null };
}

/** Twelve months of a year: the month's own amount (if set), what is expected, and what was charged. */
export function monthsOfYear(db: Db, e: Expense, year: number, expected = expectedAmounts(db), parts = partsByOwner(db)) {
  const own = new Map(
    db.select().from(recurringExpenseAmounts).where(eq(recurringExpenseAmounts.recurringExpenseId, e.id)).all().map((r) => [r.month, r.amount]),
  );
  const charges = db
    .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.recurringExpenseId, chargeOwnerId(e)), isNull(transactions.deletedAt)))
    .all();
  const began = new Set(planTimeline(e).flatMap((p) => (p.from ? [p.from] : [])));
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const charged = charges.filter((c) => chargePeriod(e, c) === month);
    return {
      month,
      // The plan the month is on (Plus, Pro), and whether it began a new one: the month of a change often has two charges, the old plan's and the new one's.
      plan: planAt(e, month).name,
      planChange: began.has(month),
      charges: charged.length,
      amount: own.get(month) ?? null,
      // What the month costs when it has no amount of its own: its plan's price.
      usual: priceFor(e, month),
      expected: own.get(month) ?? priceFor(e, month),
      charged: charged.length ? chargeShare(e, parts, expected, charged.reduce((s, c) => s - c.amount, 0), month) : null,
    };
  });
}
