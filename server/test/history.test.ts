import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, networthSnapshots, priceSnapshots, savingsHoldings, savingsValues, transactions } from "../src/db/schema.js";
import { createInstrument, createTrade, parsePrice, parseQuantity } from "../src/savings/instruments.js";
import { accountBalanceOn, captureDue, estimateMonth, history, lastDayOf, savingsOn } from "../src/networth/history.js";
import { freshDb } from "./helpers.js";

/**
 * Historiken.
 *
 * The rule under all of it: a month is recorded exactly only on the day it
 * ends, anything else is marked as worked out backwards, and a month whose
 * savings value is unknown is left out rather than plotted without it.
 */

type Db = ReturnType<typeof freshDb>;

const TODAY = "2026-09-20";
const accountId = (db: Db, name: string) => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, name)).get()!.id;

let n = 1;

function tx(db: Db, account: string, date: string, ore: number) {
  db.insert(transactions)
    .values({
      accountId: accountId(db, account),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "rad",
      descriptionClean: "rad",
      amount: ore,
      source: "manual",
      fingerprint: `hist-${n++}`,
    })
    .run();
}

/** A value for the savings, entered by hand as the old view does it. */
function savingsValue(db: Db, date: string, ore: number) {
  const holding = db.select().from(savingsHoldings).all()[0] ?? db.insert(savingsHoldings).values({ name: "Avanza" }).returning().get();
  db.insert(savingsValues).values({ holdingId: holding.id, date, value: ore }).run();
}

describe("att räkna en månad bakåt", () => {
  it("takes the rows booked since off the balance again", () => {
    const db = freshDb({ seeded: true });
    const id = accountId(db, "Swedbank Privatkonto");
    // 10 000 kr today, after spending 3 000 and being paid 1 000 in September.
    tx(db, "Swedbank Privatkonto", "2026-09-05", -300_000);
    tx(db, "Swedbank Privatkonto", "2026-09-10", 100_000);
    expect(accountBalanceOn(db, id, "2026-08-31", 1_000_000, TODAY)).toBe(1_200_000);
    // A row booked after the bank last said so is not in the balance yet, so
    // it must not be taken off it either.
    tx(db, "Swedbank Privatkonto", "2026-09-25", -500_000);
    expect(accountBalanceOn(db, id, "2026-08-31", 1_000_000, TODAY)).toBe(1_200_000);
  });

  it("uses a value entered by hand when the prices don't reach back", () => {
    const db = freshDb({ seeded: true });
    expect(savingsOn(db, "2026-08-31")).toBeNull();
    savingsValue(db, "2026-07-15", 20_000_000);
    // July's value is the newest one at or before the end of August.
    expect(savingsOn(db, "2026-08-31")).toBe(20_000_000);
    expect(savingsOn(db, "2026-06-30")).toBeNull();
  });

  it("values the holdings as they stood that day, not today's", () => {
    const db = freshDb({ seeded: true });
    const fund = createInstrument(db, { name: "Fonden", currency: "SEK", kind: "etf", zone: "base" });
    createTrade(db, { instrumentId: fund.id, account: "isk", side: "opening", date: "2026-07-01", quantityE4: parseQuantity("10")!, priceE4: parsePrice("100")! });
    // Ten more bought in September: not in August's savings.
    createTrade(db, { instrumentId: fund.id, account: "isk", side: "buy", date: "2026-09-10", quantityE4: parseQuantity("10")!, priceE4: parsePrice("110")! });
    db.insert(priceSnapshots).values({ instrumentId: fund.id, date: "2026-08-31", priceE4: parsePrice("105")!, currency: "SEK", source: "yahoo" }).run();
    expect(savingsOn(db, "2026-08-31")).toBe(105_000);
    expect(savingsOn(db, TODAY)).toBe(210_000);
    // Before the first trade there were no holdings to value: the value entered by hand, or nothing.
    expect(savingsOn(db, "2026-06-30")).toBeNull();
    savingsValue(db, "2026-06-15", 90_000);
    expect(savingsOn(db, "2026-06-30")).toBe(90_000);
  });

  it("leaves a month out entirely when the savings are unknown", () => {
    const db = freshDb({ seeded: true });
    tx(db, "Swedbank Privatkonto", "2026-09-05", -300_000);
    // A net worth missing the portfolio is not a smaller net worth — it is a
    // different question, and a line that dipped for that reason would be
    // describing something that never happened.
    expect(estimateMonth(db, "2026-08")).toBeNull();
    savingsValue(db, "2026-08-20", 20_000_000);
    expect(estimateMonth(db, "2026-08")?.securitiesOre).toBe(20_000_000);
  });

  it("knows the last day of a month, February included", () => {
    expect(lastDayOf("2026-08")).toBe("2026-08-31");
    expect(lastDayOf("2026-09")).toBe("2026-09-30");
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
  });
});

describe("att spara en månad", () => {
  it("records exactly only on the day the month ends", () => {
    const db = freshDb({ seeded: true });
    savingsValue(db, "2026-08-20", 20_000_000);

    // Any other day: what can be worked out is, and it says it was.
    const middle = captureDue(db, TODAY);
    expect(middle.captured).toEqual([]);
    expect(middle.estimated).toContain("2026-08");
    expect(db.select().from(networthSnapshots).where(eq(networthSnapshots.month, "2026-08")).get()?.estimated).toBe(true);
  });

  it("records the month itself on its last day", () => {
    const db = freshDb({ seeded: true });
    savingsValue(db, "2026-09-30", 20_000_000);
    const r = captureDue(db, "2026-09-30");
    expect(r.captured).toEqual(["2026-09"]);
    const row = db.select().from(networthSnapshots).where(eq(networthSnapshots.month, "2026-09")).get()!;
    expect(row.estimated).toBe(false);
    expect(row.date).toBe("2026-09-30");
  });

  it("never replaces a recorded month with an estimate of itself", () => {
    const db = freshDb({ seeded: true });
    savingsValue(db, "2026-08-31", 20_000_000);
    captureDue(db, "2026-08-31");
    const recorded = db.select().from(networthSnapshots).where(eq(networthSnapshots.month, "2026-08")).get()!;
    expect(recorded.estimated).toBe(false);

    // Three weeks later, with the balances long since moved on.
    tx(db, "Swedbank Privatkonto", "2026-09-05", -300_000);
    captureDue(db, TODAY);
    const after = db.select().from(networthSnapshots).where(eq(networthSnapshots.month, "2026-08")).get()!;
    expect(after).toEqual(recorded);
  });

  it("runs twice without writing twice", () => {
    const db = freshDb({ seeded: true });
    savingsValue(db, "2026-08-20", 20_000_000);
    captureDue(db, TODAY);
    const before = db.select().from(networthSnapshots).all();
    expect(captureDue(db, TODAY)).toEqual({ captured: [], estimated: [] });
    expect(db.select().from(networthSnapshots).all()).toEqual(before);
  });

  it("splits the assets and the debts by kind", () => {
    const db = freshDb({ seeded: true });
    savingsValue(db, "2026-08-20", 20_000_000);
    db.update(accounts).set({ balance: 500_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank Privatkonto")).run();
    captureDue(db, TODAY);

    const row = db.select().from(networthSnapshots).where(eq(networthSnapshots.month, "2026-08")).get()!;
    expect(row.accountsOre).toBe(500_000);
    expect(row.securitiesOre).toBe(20_000_000);
    // The loan (the example household's 200 000 kr) stands apart, and the car (80 000 kr) outside both nets.
    const loan = 20_000_000;
    expect(row.csnOre).toBe(loan);
    expect(row.illiquidOre).toBe(8_000_000);
    expect(row.netExCsnOre).toBe(500_000 + 20_000_000);
    expect(row.netIncCsnOre).toBe(500_000 + 20_000_000 - loan);
  });
});

describe("historiken som den visas", () => {
  it("ends on today, which is not stored", () => {
    const db = freshDb({ seeded: true });
    savingsValue(db, "2026-08-20", 20_000_000);
    const h = history(db, TODAY);
    expect(h.today.month).toBe("2026-09");
    // September isn't over, so it is a point on the line and not a row.
    expect(h.months.map((m) => m.month)).not.toContain("2026-09");
  });

  it("says why it doesn't go further back", () => {
    const db = freshDb({ seeded: true });
    const h = history(db, TODAY);
    expect(h.months).toEqual([]);
    expect(h.earliest).toBeNull();
    expect(h.missing).toMatch(/inget värde för sparandet finns före/);
  });

  it("keeps twelve months and no more", () => {
    const db = freshDb({ seeded: true });
    savingsValue(db, "2024-01-01", 10_000_000);
    captureDue(db, TODAY);
    const h = history(db, TODAY);
    expect(h.months).toHaveLength(12);
    expect(h.months[0].month).toBe("2025-09");
    expect(h.months.at(-1)!.month).toBe("2026-08");
  });
});
