import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, fxRates, recurringExpenses, transactions } from "../src/db/schema.js";
import { bankMarkup, foreignPrice, refreshForeignPrices } from "../src/recurring/foreignPrice.js";
import { expectedAmounts, latestChargeCheck } from "../src/recurring/amounts.js";
import { linkRecurring } from "../src/recurring/link.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const MASTERCARD = "Swedbank Mastercard Guld";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const rate = (db: Db, date: string, sek: number) => db.insert(fxRates).values({ pair: "EURSEK", date, rateE6: Math.round(sek * 1e6), source: "riksbank" }).run();
let seq = 0;
/** A charge in euro on the Mastercard: kronor and euro, both in hundredths. */
function charge(db: Db, date: string, kronor: number, euro: number, expenseId: number | null = null) {
  return db
    .insert(transactions)
    .values({
      source: "mastercard",
      accountId: acc(db, MASTERCARD),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "ANTHROPIC* CLAUDE SUB",
      descriptionClean: "ANTHROPIC* CLAUDE SUB",
      amount: -kronor,
      foreignAmount: -euro,
      foreignCurrency: "EUR",
      recurringExpenseId: expenseId,
      fingerprint: `fp${++seq}`,
    })
    .returning()
    .get();
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("pris i valuta", () => {
  it("the bank's markup is learned from the account's own charges in the currency", () => {
    const db = freshDb({ seeded: true });
    expect(bankMarkup(db, acc(db, MASTERCARD), "EUR")).toBe(0);
    rate(db, "2026-07-29", 11.2);
    rate(db, "2026-08-29", 11.25);
    // 112,50 € for 1 266,00 kr (11,2533: +0,48 %) and 22,50 € for 254,60 kr (11,3156: +0,58 %).
    charge(db, "2026-07-30", 126600, 11250);
    charge(db, "2026-08-30", 25460, 2250);
    expect(bankMarkup(db, acc(db, MASTERCARD), "EUR")).toBeCloseTo((126600 / 11250 / 11.2 - 1 + 25460 / 2250 / 11.25 - 1) / 2, 6);
  });

  it("the kronor amount: the price with VAT at today's rate and the markup; written when saved and when the rate moves", async () => {
    const db = freshDb({ seeded: true });
    rate(db, "2026-09-23", 11.272);
    const app = createApp(db, { databasePath: ":memory:" });
    // A new one needs no kronor: they come from the rate.
    const created = await app.request(
      "/api/recurring-expenses",
      json("POST", { name: "Claude", currency: "EUR", foreignAmount: 9000, vatPercent: 25, anchorDay: 30, paymentMethod: "credit_card", accountId: acc(db, MASTERCARD), matchPattern: "CLAUDE" }),
    );
    expect(created.status).toBe(200);
    const e = await created.json();
    // 112,50 € × 11,272 = 1 268,10 kr (no charges yet to learn a markup from).
    expect(e.amount).toBe(126810);
    const listed = ((await (await app.request("/api/recurring-expenses")).json()) as { id: number; foreignPrice: unknown }[]).find((x) => x.id === e.id)!;
    expect(listed.foreignPrice).toEqual({ currency: "EUR", price: 9000, vatPercent: 25, withVat: 11250, rate: 11.272, rateDate: "2026-09-23", markup: 0, amount: 126810 });
    // Pro instead: 18 € + VAT.
    expect((await (await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { foreignAmount: 1800 }))).json()).amount).toBe(Math.round(2250 * 11.272));
    // A new rate: the kronor follow.
    rate(db, "2026-09-24", 11.5);
    expect(refreshForeignPrices(db)).toBe(1);
    expect(db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!.amount).toBe(Math.round(2250 * 11.5));
    // Back to kronor: the amount stays as it is.
    await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { currency: null, foreignAmount: null, vatPercent: null }));
    expect(foreignPrice(db, db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!)).toBeNull();
    // Refused.
    expect((await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { currency: "GBP" }))).status).toBe(400);
    expect((await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { vatPercent: 80 }))).status).toBe(400);
    // In USD with no rate fetched: the kronor must be given.
    const usd = await app.request("/api/recurring-expenses", json("POST", { name: "X", currency: "USD", foreignAmount: 2000, paymentMethod: "credit_card" }));
    expect(await usd.json()).toEqual({ error: "Ingen kurs för USD är hämtad än. Fyll i beloppet i kronor också." });
  });

  it("'Beloppet har ändrats' compares in the currency: the rate moving is no change, a new price is; Uppdatera takes the price", async () => {
    const db = freshDb({ seeded: true });
    rate(db, "2026-07-29", 11.2);
    const e = db
      .insert(recurringExpenses)
      .values({ name: "Claude", amount: 126000, currency: "EUR", foreignAmount: 9000, vatPercent: 25, anchorDay: 30, paymentMethod: "credit_card", accountId: acc(db, MASTERCARD), matchPattern: "CLAUDE" })
      .returning()
      .get();
    // Another rate, the same 112,50 €.
    charge(db, "2026-07-30", 127100, 11250, e.id);
    expect(latestChargeCheck(db, e)).toMatchObject({ changed: false, foreign: { currency: "EUR", expected: 11250, charged: 11250 } });
    // Pro: 22,50 €.
    charge(db, "2026-08-30", 25460, 2250, e.id);
    expect(latestChargeCheck(db, e)).toMatchObject({ changed: true, foreign: { expected: 11250, charged: 2250 } });
    const app = createApp(db, { databasePath: ":memory:" });
    const updated = await (await app.request(`/api/recurring-expenses/${e.id}/accept-latest-amount`, { method: "POST" })).json();
    expect(updated).toMatchObject({ foreignAmount: 1800, vatPercent: 25 });
    expect(latestChargeCheck(db, db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!).changed).toBe(false);
  });
});

describe("nytt pris från nästa dragning", () => {
  it("in kronor: the periods before keep the price, the ones from the change expect the new; the first charge at it makes it the price", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const e = db
      .insert(recurringExpenses)
      .values({ name: "Spotify", amount: 11900, anchorDay: 10, paymentMethod: "credit_card", accountId: acc(db, MASTERCARD), matchPattern: "SPOTIFY" })
      .returning()
      .get();
    const listed = async () => ((await (await app.request("/api/recurring-expenses")).json()) as { id: number; nextPeriod: string; thisMonthAmount: number }[]).find((x) => x.id === e.id)!;
    expect((await listed()).nextPeriod).toMatch(/^\d{4}-\d{2}$/);
    const r = await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { nextFrom: "2026-10", nextAmount: 5900 }));
    expect(await r.json()).toMatchObject({ amount: 11900, nextFrom: "2026-10", nextAmount: 5900 });
    const expected = expectedAmounts(db);
    const now = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!;
    expect([expected(now, "2026-09"), expected(now, "2026-10"), expected(now, "2026-11")]).toEqual([11900, 5900, 5900]);
    // September's charge at the old price: no change yet, and no warning.
    db.insert(transactions)
      .values({ source: "mastercard", accountId: acc(db, MASTERCARD), bookingDate: "2026-09-10", transactionDate: "2026-09-10", descriptionRaw: "SPOTIFY", descriptionClean: "SPOTIFY", amount: -11900, fingerprint: "sp1" })
      .run();
    linkRecurring(db);
    const september = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!;
    expect(september).toMatchObject({ amount: 11900, nextFrom: "2026-10" });
    expect(latestChargeCheck(db, september).changed).toBe(false);
    // October's at the new one: it is the price now.
    db.insert(transactions)
      .values({ source: "mastercard", accountId: acc(db, MASTERCARD), bookingDate: "2026-10-10", transactionDate: "2026-10-10", descriptionRaw: "SPOTIFY", descriptionClean: "SPOTIFY", amount: -5900, fingerprint: "sp2" })
      .run();
    linkRecurring(db);
    const october = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!;
    expect(october).toMatchObject({ amount: 5900, nextFrom: null, nextAmount: null });
    expect(latestChargeCheck(db, october).changed).toBe(false);
    // Taken back, and refused.
    await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { nextFrom: "2026-12", nextAmount: 9900 }));
    expect(await (await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { nextFrom: null }))).json()).toMatchObject({ nextFrom: null, nextAmount: null });
    expect((await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { nextFrom: "2026-13" }))).status).toBe(400);
    expect((await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { nextFrom: "2026-12", nextAmount: -1 }))).status).toBe(400);
  });

  it("priced in euro: Max to Pro from the next draw, the kronor from the rate, compared in euro", async () => {
    const db = freshDb({ seeded: true });
    rate(db, "2026-09-23", 11.272);
    const app = createApp(db, { databasePath: ":memory:" });
    const e = db
      .insert(recurringExpenses)
      .values({ name: "Claude", amount: 126810, currency: "EUR", foreignAmount: 9000, vatPercent: 25, anchorDay: 30, paymentMethod: "credit_card", accountId: acc(db, MASTERCARD), matchPattern: "CLAUDE" })
      .returning()
      .get();
    const patched = await (await app.request(`/api/recurring-expenses/${e.id}`, json("PATCH", { nextFrom: "2026-10", nextForeignAmount: 1800 }))).json();
    // 22,50 € × 11,272.
    expect(patched).toMatchObject({ amount: 126810, nextForeignAmount: 1800, nextAmount: Math.round(2250 * 11.272) });
    rate(db, "2026-09-24", 11.5);
    refreshForeignPrices(db);
    expect(db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()).toMatchObject({ amount: Math.round(11250 * 11.5), nextAmount: Math.round(2250 * 11.5) });
    // October's charge: 22,50 €, as expected for October.
    charge(db, "2026-10-30", 25900, 2250, e.id);
    const before = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!;
    expect(latestChargeCheck(db, before)).toMatchObject({ changed: false, foreign: { expected: 2250, charged: 2250 } });
    linkRecurring(db);
    expect(db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()).toMatchObject({ foreignAmount: 1800, nextFrom: null, nextForeignAmount: null });
  });
});
