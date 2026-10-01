import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, categories, recurringExpenses, transactions } from "../src/db/schema.js";
import { csnProgress, flow } from "../src/networth/flow.js";
import { createManualBalance } from "../src/networth/manualBalances.js";
import { setBufferAccount } from "../src/networth/endurance.js";
import { freshDb } from "./helpers.js";

/**
 * Flöde per månad.
 *
 * What is checked is that the surplus is traced rather than assumed: that
 * money moved into the portfolio and money left on the buffer account are
 * both found, that what neither explains is called unexplained and shown with
 * its sign, and that a refund is netted off here while Uthållighet keeps it
 * out — with the difference written down instead of hidden.
 */

type Db = ReturnType<typeof freshDb>;

const TODAY = "2026-09-20";

const accountId = (db: Db, name: string) => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, name)).get()!.id;
const categoryId = (db: Db, key: string) => db.select({ id: categories.id }).from(categories).where(eq(categories.systemKey, key)).get()!.id;

let n = 1;

function row(
  db: Db,
  opts: { account?: string; date: string; ore: number; categoryId?: number; isTransfer?: boolean; recurringExpenseId?: number; shared?: boolean },
) {
  return db
    .insert(transactions)
    .values({
      accountId: accountId(db, opts.account ?? "Swedbank Privatkonto"),
      bookingDate: opts.date,
      transactionDate: opts.date,
      descriptionRaw: "rad",
      descriptionClean: "rad",
      amount: opts.ore,
      categoryId: opts.categoryId ?? null,
      isTransfer: opts.isTransfer ?? false,
      recurringExpenseId: opts.recurringExpenseId ?? null,
      shared: opts.shared ?? false,
      source: "manual",
      fingerprint: `flow-${n++}`,
    })
    .returning()
    .get();
}

/** Salary, a fixed charge and some spending, over the three whole months. */
function threeMonths(db: Db) {
  const salary = categoryId(db, "salary");
  const expense = db.insert(recurringExpenses).values({ name: "Hyra", amount: 500_000, paymentMethod: "autogiro", anchorDay: 25 }).returning().get();
  for (const m of ["2026-06", "2026-07", "2026-08"]) {
    row(db, { date: `${m}-25`, ore: 3_000_000, categoryId: salary });
    row(db, { date: `${m}-25`, ore: -500_000, recurringExpenseId: expense.id });
    row(db, { date: `${m}-10`, ore: -1_000_000 });
  }
  return expense;
}

describe("flöde per månad", () => {
  it("is income less what went out, per whole month", () => {
    const db = freshDb({ seeded: true });
    threeMonths(db);
    // September is not over and must not be averaged in.
    row(db, { date: "2026-09-10", ore: -9_000_000 });

    const f = flow(db, TODAY);
    expect([f.from, f.to]).toEqual(["2026-06-01", "2026-08-31"]);
    expect(f.perMonth).toEqual({ incomeOre: 3_000_000, fixedOre: 500_000, variableOre: 1_000_000, leftOre: 1_500_000 });
    expect(f.fixedShareOfIncome).toBeCloseTo(500 / 3000, 6);
    expect(f.monthly.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("traces the surplus into the portfolio and onto the buffer account", () => {
    const db = freshDb({ seeded: true });
    threeMonths(db);
    const savings = categoryId(db, "savings");
    const buffer = accountId(db, "Swedbank e-sparkonto");
    setBufferAccount(db, buffer);
    for (const m of ["2026-06", "2026-07", "2026-08"]) {
      // Into the portfolio: a transfer category, so it is not an expense.
      row(db, { date: `${m}-26`, ore: -900_000, categoryId: savings, isTransfer: true });
      // Onto the savings account, and a little of it back off again.
      row(db, { account: "Swedbank e-sparkonto", date: `${m}-26`, ore: 500_000, isTransfer: true });
      row(db, { account: "Swedbank e-sparkonto", date: `${m}-28`, ore: -100_000, isTransfer: true });
    }

    const f = flow(db, TODAY);
    expect(f.destinations.portfolioOre).toBe(900_000);
    // The net change of the account, not the transfers into it: money that
    // left again the same week was never saved.
    expect(f.destinations.bufferOre).toBe(400_000);
    expect(f.destinations.unexplainedOre).toBe(1_500_000 - 900_000 - 400_000);
    expect(f.savingsRate).toBeCloseTo(900 / 3000, 6);
  });

  it("shows a negative unexplained rather than hiding it", () => {
    const db = freshDb({ seeded: true });
    threeMonths(db);
    const savings = categoryId(db, "savings");
    // More put aside than was left over: the accounts paid for the rest, and
    // that is worth seeing.
    for (const m of ["2026-06", "2026-07", "2026-08"]) row(db, { date: `${m}-26`, ore: -2_500_000, categoryId: savings, isTransfer: true });

    const f = flow(db, TODAY);
    expect(f.destinations.portfolioOre).toBe(2_500_000);
    expect(f.destinations.unexplainedOre).toBe(1_500_000 - 2_500_000);
  });

  it("nets a refund off, and says how much it was", () => {
    const db = freshDb({ seeded: true });
    threeMonths(db);
    // An insurance payment on a car service: money that came back, in the
    // category the spending was in. Uncategorised money in is deliberately
    // not treated as a refund.
    row(db, { date: "2026-06-09", ore: 850_000, categoryId: categoryId(db, "groceries") });

    const f = flow(db, TODAY);
    // 30 000 spent over three months less 8 500 back = 7 167 a month.
    expect(f.perMonth.variableOre).toBe(Math.round((3_000_000 - 850_000) / 3));
    // Uthållighet counts the spending without it, so the difference is
    // written out here instead of leaving two figures to disagree in silence.
    expect(f.refundsOre).toBe(Math.round(850_000 / 3));
  });

  it("has no buffer line when no account is chosen", () => {
    const db = freshDb({ seeded: true });
    threeMonths(db);
    setBufferAccount(db, null);
    // Unset, the account that looks like savings is still suggested; an
    // explicit none leaves the whole surplus unexplained.
    db.update(accounts).set({ name: "Konto 2" }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    const f = flow(db, TODAY);
    expect(f.destinations.bufferAccount).toBeNull();
    expect(f.destinations.bufferOre).toBe(0);
  });
});

describe("CSN", () => {
  function loan(db: Db) {
    const expense = db.insert(recurringExpenses).values({ name: "CSN", amount: 180_000, paymentMethod: "autogiro", anchorDay: 31 }).returning().get();
    createManualBalance(db, { key: "csn", kind: "debt", name: "CSN", amountOre: 20_000_000, valueDate: "2026-01-01", recurringExpenseId: expense.id });
    return expense;
  }

  it("counts this year's charges, and the rate they were actually drawn at", () => {
    const db = freshDb({ seeded: true });
    const expense = loan(db);
    // Two ordinary months and one smaller: CSN varies over the year, so the
    // rate is what was really drawn, not the amount on the expense.
    row(db, { date: "2026-07-31", ore: -180_000, recurringExpenseId: expense.id });
    row(db, { date: "2026-08-31", ore: -180_000, recurringExpenseId: expense.id });
    row(db, { date: "2026-09-15", ore: -150_000, recurringExpenseId: expense.id });
    // Last year's charge belongs to last year.
    row(db, { date: "2025-12-31", ore: -180_000, recurringExpenseId: expense.id });

    const c = csnProgress(db, TODAY)!;
    expect(c.chargesThisYear).toBe(3);
    expect(c.paidThisYearOre).toBe(510_000);
    expect(c.rateOre).toBe(170_000);
    expect(c.remainingOre).toBe(20_000_000 - 510_000);
    expect(c.paidSinceAnchorOre).toBe(510_000);
    // 194 900 ÷ 1 700 = 115 months from September.
    expect(c.monthsLeft).toBe(Math.ceil((20_000_000 - 510_000) / 170_000));
    expect(c.payoffMonth).toBe("2036-04");
  });

  it("has no end date before anything has been drawn", () => {
    const db = freshDb({ seeded: true });
    loan(db);
    const c = csnProgress(db, TODAY)!;
    expect(c.paidThisYearOre).toBe(0);
    // A rate of nothing is not a rate, and a date worked out from it would
    // be a made-up year.
    expect(c.rateOre).toBeNull();
    expect(c.monthsLeft).toBeNull();
    expect(c.payoffMonth).toBeNull();
  });

  it("is absent when there is no loan written down", () => {
    const db = freshDb({ seeded: true });
    db.delete(transactions).run();
    // freshDb seeds one, so this is the case of a database where it was
    // deleted on purpose.
    const existing = csnProgress(db, TODAY);
    expect(existing).not.toBeNull();
  });
});
