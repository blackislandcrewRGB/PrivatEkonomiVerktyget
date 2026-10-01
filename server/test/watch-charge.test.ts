import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, transactions } from "../src/db/schema.js";
import { chargePattern } from "../src/recurring/watchCharge.js";
import { findings } from "../src/watch/watch.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

/**
 * 'Påminn innan nästa dragning': a subscription started for a while.
 *
 * The tool can't cancel anything. What it can do is turn the charge into a
 * fixed expense — where pausing and the price watch already live — and ask
 * before every draw, in time to do something about it.
 */

type Db = ReturnType<typeof freshDb>;
type App = ReturnType<typeof createApp>;

const PRIVAT = "Swedbank Privatkonto";
const MASTERCARD = "Swedbank Mastercard Guld";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;

let seq = 0;
function charge(db: Db, o: { desc: string; amount?: number; date?: string; account?: string; label?: string; isTransfer?: boolean }) {
  const date = o.date ?? "2026-09-10";
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: acc(db, o.account ?? PRIVAT),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      counterparty: o.desc,
      label: o.label ?? null,
      amount: o.amount ?? -9900,
      isTransfer: o.isTransfer ?? false,
      fingerprint: `wc${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  return { db, app: createApp(db, { databasePath: ":memory:" }) };
}

const watch = (app: App, id: number) => app.request(`/api/transactions/${id}/watch-charge`, { method: "POST" });

describe("the stable part of a merchant's text", () => {
  it("drops the reference that is different every month", () => {
    expect(chargePattern("Podme 4F8-2A61C9")).toBe("Podme");
    expect(chargePattern("GOOGLE*CLOUD KLM")).toBe("GOOGLE");
    expect(chargePattern("K*Systembola")).toBe("Systembola");
    // Nothing to cut: the whole text is what it is called.
    expect(chargePattern("EXEMPELBOLAG AB")).toBe("EXEMPELBOLAG AB");
    // Cutting would leave too little to match on, so it doesn't.
    expect(chargePattern("7-Eleven 1234")).toBe("7-Eleven 1234");
  });
});

describe("watching a charge", () => {
  it("makes a fixed expense out of the row, watched from the day it was drawn", async () => {
    const { db, app } = setup();
    const row = charge(db, { desc: "Podme 4F8-2A61C9" });

    const res = await watch(app, row.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: "Podme",
      amount: 9900,
      anchorDay: 10,
      matchPattern: "Podme",
      billingCycle: "monthly",
      remindBeforeCharge: true,
      paused: false,
      // A card charge is dated the day it was made, not the day it was booked.
      dateBasis: "transaction",
      paymentMethod: "card",
      accountId: acc(db, PRIVAT),
    });
    // The charge that started it is linked, so the expense knows its history.
    expect(db.select().from(transactions).where(eq(transactions.id, row.id)).get()!.recurringExpenseId).not.toBeNull();
  });

  it("asks three days before the next draw, and not before that", async () => {
    const { db, app } = setup();
    await watch(app, charge(db, { desc: "Podme 4F8-2A61C9" }).id);

    // Only the charge kind: a thin buffer is found on any database with a
    // krona of spending in it, and has its own tests.
    const charges = (today: string) => findings(db, today).filter((f) => f.kind === "charge_coming");
    expect(charges("2026-10-06")).toEqual([]);
    expect(charges("2026-10-07").map((f) => f.text.replace(/ /g, " "))).toEqual([
      "Podme dras 10/10 (99 kr), om 3 dagar – säga upp den innan dess?",
    ]);
  });

  it("only watches the expense a charge already belongs to, instead of making a second one", async () => {
    const { db, app } = setup();
    const expense = db
      .insert(recurringExpenses)
      .values({ name: "Spotify", amount: 12900, anchorDay: 10, accountId: acc(db, PRIVAT), matchPattern: "SPOTIFY", paymentMethod: "card" })
      .returning()
      .get();
    const row = charge(db, { desc: "SPOTIFY P0A1B2C3", amount: -12900 });
    db.update(transactions).set({ recurringExpenseId: expense.id }).where(eq(transactions.id, row.id)).run();

    expect(await (await watch(app, row.id)).json()).toMatchObject({ id: expense.id, name: "Spotify", remindBeforeCharge: true });
    expect(db.select().from(recurringExpenses).all()).toHaveLength(1);
  });

  it("takes the card's own account and keeps a name given by hand", async () => {
    const { db, app } = setup();
    const row = charge(db, { desc: "ANTHROPIC* CLAUDE SUB", label: "Claude", account: MASTERCARD, amount: -21500 });
    expect(await (await watch(app, row.id)).json()).toMatchObject({
      name: "Claude",
      matchPattern: "ANTHROPIC",
      paymentMethod: "credit_card",
      accountId: acc(db, MASTERCARD),
    });
  });

  it("says no to what can't draw again", async () => {
    const { db, app } = setup();
    const income = await watch(app, charge(db, { desc: "LÖN", amount: 3000000 }).id);
    expect(income.status).toBe(400);
    expect(await income.json()).toEqual({ error: "Bara ett köp kan bevakas." });

    const moved = await watch(app, charge(db, { desc: "Överföring", isTransfer: true }).id);
    expect(await moved.json()).toEqual({ error: "En överföring dras inte om." });
    expect((await watch(app, 9999)).status).toBe(400);
  });
});

describe("Gör till fast utgift…", () => {
  const post = (app: App, id: number, body: object) =>
    app.request(`/api/transactions/${id}/make-recurring`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

  it("starts from the purchase: its merchant as name and bank's text, the amount, day and account", async () => {
    const { db, app } = setup();
    const row = charge(db, { desc: "APPLE.COM/SE", amount: -79900, date: "2026-05-25" });
    expect(await (await app.request(`/api/transactions/${row.id}/recurring-draft`)).json()).toEqual({
      name: "Apple.com/se",
      pattern: "APPLE.COM/SE",
      amount: 79900,
      date: "2026-05-25",
      accountName: PRIVAT,
    });
  });

  it("a yearly one on the purchase's day and month, with the purchase and last year's linked", async () => {
    const { db, app } = setup();
    const lastYear = charge(db, { desc: "APPLE.COM/SE", amount: -79900, date: "2025-05-27" });
    const row = charge(db, { desc: "APPLE.COM/SE", amount: -79900, date: "2026-05-25" });
    const other = charge(db, { desc: "APPLE.COM/BILL", amount: -2900, date: "2026-05-04" });
    const r = await post(app, row.id, { name: "Apple Developer", cycle: "yearly", pattern: "APPLE.COM/SE" });
    expect(r.status).toBe(200);
    const e = await r.json();
    expect(e).toMatchObject({ name: "Apple Developer", amount: 79900, billingCycle: "yearly", anchorDay: 25, anchorMonth: 5, matchPattern: "APPLE.COM/SE", accountId: acc(db, PRIVAT) });
    const linked = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!.recurringExpenseId;
    expect([linked(row.id), linked(lastYear.id), linked(other.id)]).toEqual([e.id, e.id, null]);
    // Once it is one, it can't be made again.
    expect(await (await post(app, row.id, { name: "Igen", cycle: "yearly", pattern: "APPLE" })).json()).toEqual({ error: "Köpet hör redan till en fast utgift." });
  });

  it("a monthly one; refuses a missing name, a text not in the purchase, and what isn't a purchase", async () => {
    const { db, app } = setup();
    const row = charge(db, { desc: "SPOTIFY P3A", amount: -11900, date: "2026-09-10", account: MASTERCARD });
    expect((await post(app, row.id, { name: " ", cycle: "monthly", pattern: "SPOTIFY" })).status).toBe(400);
    expect(await (await post(app, row.id, { name: "Spotify", cycle: "monthly", pattern: "NETFLIX" })).json()).toEqual({ error: 'Bankens text "NETFLIX" finns inte i köpets text.' });
    expect((await post(app, row.id, { name: "Spotify", cycle: "weekly", pattern: "SPOTIFY" })).status).toBe(400);
    const e = await (await post(app, row.id, { name: "Spotify", cycle: "monthly", pattern: "SPOTIFY" })).json();
    expect(e).toMatchObject({ billingCycle: "monthly", anchorDay: 10, anchorMonth: null, paymentMethod: "credit_card" });
    const refund = charge(db, { desc: "SPOTIFY", amount: 11900 });
    expect((await app.request(`/api/transactions/${refund.id}/recurring-draft`)).status).toBe(400);
    expect(db.select().from(recurringExpenses).all().filter((x) => x.name === "Spotify")).toHaveLength(1);
  });
});
