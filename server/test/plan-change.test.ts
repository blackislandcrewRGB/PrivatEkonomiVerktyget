import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, transactions } from "../src/db/schema.js";
import { chargePeriod, expectedAmounts, monthsOfYear } from "../src/recurring/amounts.js";
import { linkRecurring } from "../src/recurring/link.js";
import { occurrenceFor } from "../src/recurring/schedule.js";
import { addMonths, monthOf, todayLocal } from "../src/overview/dates.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const MASTERCARD = "Swedbank Mastercard Guld";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const get = (db: Db, id: number) => db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get()!;

let seq = 0;
function charge(db: Db, date: string, kronor: number, account = MASTERCARD) {
  return db
    .insert(transactions)
    .values({
      source: "mastercard",
      accountId: acc(db, account),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "OPENAI *CHATGPT SUBSCR",
      descriptionClean: "OPENAI *CHATGPT SUBSCR",
      amount: -kronor * 100,
      fingerprint: `pc${++seq}`,
    })
    .returning()
    .get().id;
}

/** ChatGPT on a 249 kr plan drawn the 28th. */
function chatgpt(db: Db) {
  return db
    .insert(recurringExpenses)
    .values({ name: "ChatGPT", amount: 24900, anchorDay: 28, paymentMethod: "credit_card", accountId: acc(db, MASTERCARD), matchPattern: "CHATGPT", dateBasis: "transaction" })
    .returning()
    .get();
}
const post = (db: Db, id: number, body: unknown) => createApp(db, { databasePath: ":memory:" }).request(`/api/recurring-expenses/${id}/change-plan`, json("POST", body));

describe("byta plan", () => {
  it("an upgrade started by its charge: the plan before keeps its price and day, the new one gets the charge's", async () => {
    const db = freshDb({ seeded: true });
    const e = chatgpt(db);
    const sep = charge(db, "2026-09-28", 249);
    const oct = charge(db, "2026-10-06", 937);
    linkRecurring(db);
    // The 6 October charge is eight days from the 28th: not linked by itself.
    expect(db.select().from(transactions).where(eq(transactions.id, oct)).get()!.recurringExpenseId).toBeNull();
    const r = await post(db, e.id, { transactionId: oct, amount: 93700, anchorDay: 6, name: "Pro" });
    expect(r.status).toBe(200);
    const now = get(db, e.id);
    expect(now).toMatchObject({ amount: 93700, anchorDay: 6, planName: "Pro" });
    expect(now.planHistory).toEqual([{ until: "2026-09", amount: 24900, foreignAmount: null, scheduleType: "day_of_month", anchorDay: 28, bankDayRule: "none", name: null }]);
    // Both charges belong to it, each to its own month.
    expect(db.select().from(transactions).where(eq(transactions.id, oct)).get()!.recurringExpenseId).toBe(e.id);
    const sepRow = db.select().from(transactions).where(eq(transactions.id, sep)).get()!;
    expect(sepRow.recurringExpenseId).toBe(e.id);
    expect(chargePeriod(now, sepRow)).toBe("2026-09");
    expect(chargePeriod(now, db.select().from(transactions).where(eq(transactions.id, oct)).get()!)).toBe("2026-10");
    // The days and prices each month is expected at.
    expect([occurrenceFor(now, "2026-09"), occurrenceFor(now, "2026-10"), occurrenceFor(now, "2026-11")]).toEqual(["2026-09-28", "2026-10-06", "2026-11-06"]);
    const expected = expectedAmounts(db);
    expect([expected(now, "2026-08"), expected(now, "2026-09"), expected(now, "2026-10"), expected(now, "2026-11")]).toEqual([24900, 24900, 93700, 93700]);
    const months = monthsOfYear(db, now, 2026);
    expect(months[8]).toMatchObject({ month: "2026-09", usual: 24900, expected: 24900, charged: 24900, planChange: false });
    expect(months[9]).toMatchObject({ month: "2026-10", usual: 93700, expected: 93700, charged: 93700, plan: "Pro", planChange: true });
    // Linking again changes nothing.
    expect(linkRecurring(db)).toEqual({ income: 0, expenses: 0 });
  });

  it("a change in a month that already had a charge: both count, 249 + 937", async () => {
    const db = freshDb({ seeded: true });
    const e = db.update(recurringExpenses).set({ anchorDay: 3 }).where(eq(recurringExpenses.id, chatgpt(db).id)).returning().get();
    charge(db, "2026-09-03", 249);
    charge(db, "2026-10-03", 249);
    const upgrade = charge(db, "2026-10-12", 937);
    linkRecurring(db);
    expect((await post(db, e.id, { transactionId: upgrade, amount: 93700, anchorDay: 12 })).status).toBe(200);
    const now = get(db, e.id);
    const october = monthsOfYear(db, now, 2026)[9];
    expect(october).toMatchObject({ month: "2026-10", charges: 2, charged: 24900 + 93700, expected: 93700, planChange: true });
    expect(monthsOfYear(db, now, 2026)[8]).toMatchObject({ charges: 1, charged: 24900, expected: 24900 });
    // The next draw is expected at the new price on the new day.
    expect(occurrenceFor(now, "2026-11")).toBe("2026-11-12");
  });

  it("back down from a month to come: it waits, and when the first charge at it has come the plan is changed (the one before kept)", async () => {
    const db = freshDb({ seeded: true });
    const e = chatgpt(db);
    const oct = charge(db, "2026-10-06", 937);
    await post(db, e.id, { transactionId: oct, amount: 93700, anchorDay: 6, name: "Pro" });
    // A change to a month to come can't also move the day.
    const next = addMonths(monthOf(todayLocal()), 1);
    expect((await post(db, e.id, { from: next, amount: 24900, anchorDay: 20 })).status).toBe(400);
    const waiting = await (await post(db, e.id, { from: next, amount: 24900, name: "Plus" })).json();
    expect(waiting).toMatchObject({ amount: 93700, nextFrom: next, nextAmount: 24900, nextPlanName: "Plus" });
    expect(expectedAmounts(db)(get(db, e.id), next)).toBe(24900);
    // The charge at the new price comes on the 6th of that month.
    charge(db, `${next}-06`, 249);
    linkRecurring(db);
    const now = get(db, e.id);
    expect(now).toMatchObject({ amount: 24900, planName: "Plus", nextFrom: null, nextPlanName: null, anchorDay: 6 });
    expect(now.planHistory!.map((p) => [p.until, p.amount, p.anchorDay, p.name])).toEqual([
      ["2026-09", 24900, 28, null],
      [addMonths(next, -1), 93700, 6, "Pro"],
    ]);
    // The months keep what they were: September 249, October 937, the one after Pro 249 again.
    const expected = expectedAmounts(db);
    expect([expected(now, "2026-09"), expected(now, "2026-10"), expected(now, next)]).toEqual([24900, 93700, 24900]);
  });

  it("refuses a change that isn't after the plan it is on, a charge that isn't a purchase, one on another account or another expense's", async () => {
    const db = freshDb({ seeded: true });
    const e = chatgpt(db);
    const other = db
      .insert(recurringExpenses)
      .values({ name: "Annat", amount: 5000, anchorDay: 1, paymentMethod: "credit_card", accountId: acc(db, MASTERCARD), matchPattern: "ANNAT" })
      .returning()
      .get();
    const oct = charge(db, "2026-10-06", 937);
    await post(db, e.id, { transactionId: oct, amount: 93700, anchorDay: 6 });
    expect((await post(db, e.id, { from: "2026-10", amount: 24900 })).status).toBe(400);
    expect((await post(db, e.id, { from: "2026-09", amount: 24900 })).status).toBe(400);
    const nov = charge(db, "2026-11-06", 249);
    db.update(transactions).set({ recurringExpenseId: other.id }).where(eq(transactions.id, nov)).run();
    expect((await post(db, e.id, { transactionId: nov, amount: 24900 })).status).toBe(400);
    const elsewhere = charge(db, "2026-11-07", 249, "Bank Norwegian");
    expect((await post(db, e.id, { transactionId: elsewhere, amount: 24900 })).status).toBe(400);
    expect((await post(db, e.id, { from: "2026-12" })).status).toBe(400);
    expect((await post(db, e.id, { from: "2026-12", amount: -5 })).status).toBe(400);
    expect((await post(db, e.id, { from: "2026-13", amount: 5000 })).status).toBe(400);
    expect((await post(db, 9999, { from: "2026-12", amount: 5000 })).status).toBe(404);
  });

  it("taking a change back puts the plan before on again", async () => {
    const db = freshDb({ seeded: true });
    const e = chatgpt(db);
    const app = createApp(db, { databasePath: ":memory:" });
    expect((await app.request(`/api/recurring-expenses/${e.id}/undo-plan-change`, json("POST", {}))).status).toBe(400);
    await post(db, e.id, { transactionId: charge(db, "2026-10-06", 937), amount: 93700, anchorDay: 6, name: "Pro" });
    const back = await (await app.request(`/api/recurring-expenses/${e.id}/undo-plan-change`, json("POST", {}))).json();
    expect(back).toMatchObject({ amount: 24900, anchorDay: 28, planName: null, planHistory: [] });
  });

  it("the list says which plans it has had, and suggests a day only from the plan it is on", async () => {
    const db = freshDb({ seeded: true });
    const e = chatgpt(db);
    for (const d of ["2026-04-28", "2026-05-28", "2026-06-28", "2026-07-28", "2026-08-28", "2026-09-28"]) charge(db, d, 249);
    linkRecurring(db);
    await post(db, e.id, { transactionId: charge(db, "2026-10-06", 937), amount: 93700, anchorDay: 6, name: "Pro" });
    const app = createApp(db, { databasePath: ":memory:" });
    const listed = ((await (await app.request("/api/recurring-expenses")).json()) as { id: number; plans: { from: string | null; until: string | null; plan: { amount: number; name: string | null } }[]; suggestion: unknown }[]).find((x) => x.id === e.id)!;
    expect(listed.plans.map((p) => [p.from, p.until, p.plan.amount, p.plan.name])).toEqual([
      [null, "2026-09", 24900, null],
      ["2026-10", null, 93700, "Pro"],
    ]);
    expect(listed.suggestion).toBeNull();
  });
});

describe("byta plan från ett köp", () => {
  it("offers the expenses a purchase may be a new plan of: its text, its account, not yet linked", async () => {
    const db = freshDb({ seeded: true });
    const e = chatgpt(db);
    const oct = charge(db, "2026-10-06", 937);
    const app = createApp(db, { databasePath: ":memory:" });
    const candidates = async (id: number) => (await app.request(`/api/transactions/${id}/plan-candidates`)).json();
    expect(await candidates(oct)).toEqual([{ id: e.id, name: "ChatGPT", planName: null, amount: 24900, currency: null, vatPercent: null, from: "2026-10", day: 6 }]);
    // Another account, another text, or already linked: none.
    expect(await candidates(charge(db, "2026-10-07", 937, "Bank Norwegian"))).toEqual([]);
    const other = db.insert(transactions).values({ source: "mastercard", accountId: acc(db, MASTERCARD), bookingDate: "2026-10-08", descriptionRaw: "SPOTIFY", descriptionClean: "SPOTIFY", amount: -11900, fingerprint: "po1" }).returning().get();
    expect(await candidates(other.id)).toEqual([]);
    await post(db, e.id, { transactionId: oct, amount: 93700, anchorDay: 6 });
    expect(await candidates(oct)).toEqual([]);
  });
});

describe("ångra ett planbyte från ett köp", () => {
  it("puts the plan before on again and lets go of the charge that started the new one", async () => {
    const db = freshDb({ seeded: true });
    const e = chatgpt(db);
    const oct = charge(db, "2026-10-06", 937);
    await post(db, e.id, { transactionId: oct, amount: 93700, anchorDay: 6 });
    const app = createApp(db, { databasePath: ":memory:" });
    await app.request(`/api/recurring-expenses/${e.id}/undo-plan-change`, json("POST", { transactionId: oct }));
    expect(get(db, e.id)).toMatchObject({ amount: 24900, anchorDay: 28 });
    expect(db.select().from(transactions).where(eq(transactions.id, oct)).get()!.recurringExpenseId).toBeNull();
  });
});
