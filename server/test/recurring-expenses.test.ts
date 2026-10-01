import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { accounts, recurringExpenses, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { linkRecurring } from "../src/recurring/link.js";
import { importFiles } from "../src/import/importBatch.js";
import { createApp } from "../src/app.js";
import { todayLocal } from "../src/overview/dates.js";
import { allSwedbankFiles, freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const byName = (db: Db, name: string) => db.select().from(recurringExpenses).where(eq(recurringExpenses.name, name)).get()!;
const accountId = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const categoryId = (db: Db, path: string) => getCategoryPathMap(db).get(path)!;

/**
 * Made-up fixed expenses, each with the bank's text for it as the Swedbank
 * fixtures have it (öre; day of the month it is drawn). Rent and the bills are
 * drawn from e-sparkonto, the subscriptions with the card on Privatkonto.
 */
const FIXED: { name: string; amount: number; method: "card" | "autogiro" | "transfer"; account: string; day: number; pattern: string; category: string; shared?: boolean }[] = [
  { name: "Hyra", amount: 750000, method: "transfer", account: "Swedbank e-sparkonto", day: 25, pattern: "EXEMPELHEM BOSTAD", category: "Boende/Hyra", shared: true },
  { name: "CSN", amount: 150000, method: "autogiro", account: "Swedbank e-sparkonto", day: 25, pattern: "CSN", category: "Lån & avbetalning/CSN" },
  { name: "Mobil", amount: 57800, method: "autogiro", account: "Swedbank e-sparkonto", day: 28, pattern: "TELE2", category: "IT & tele/Bredband & mobil", shared: true },
  { name: "Bilförsäkring", amount: 23100, method: "autogiro", account: "Swedbank e-sparkonto", day: 30, pattern: "TRE KRONOR", category: "Försäkring" },
  { name: "Hemförsäkring", amount: 18900, method: "autogiro", account: "Swedbank e-sparkonto", day: 1, pattern: "IF SKADEFÖRS", category: "Försäkring", shared: true },
  // The charges are 150 and 29 kr: these two are out of date.
  { name: "A-kassa", amount: 14000, method: "autogiro", account: "Swedbank e-sparkonto", day: 5, pattern: "AKASSA", category: "Försäkring/A-kassa" },
  { name: "Medlemskap", amount: 2400, method: "autogiro", account: "Swedbank e-sparkonto", day: 10, pattern: "NYCKELKUND", category: "Bank & avgifter" },
  { name: "Gym", amount: 29900, method: "autogiro", account: "Swedbank e-sparkonto", day: 2, pattern: "FITNESS24", category: "Hälsa" },
  { name: "Apple", amount: 2900, method: "card", account: "Swedbank Privatkonto", day: 3, pattern: "APPLE.COM/BILL", category: "Nöje/Streaming" },
  { name: "Spotify", amount: 11900, method: "card", account: "Swedbank Privatkonto", day: 15, pattern: "SPOTIFY", category: "Nöje/Streaming" },
];

function addFixedExpenses(db: Db) {
  for (const e of FIXED) {
    db.insert(recurringExpenses)
      .values({
        name: e.name,
        amount: e.amount,
        anchorDay: e.day,
        // Card charges are compared on the purchase day, autogiro on the booking day.
        dateBasis: e.method === "card" ? "transaction" : "booking",
        paymentMethod: e.method,
        accountId: accountId(db, e.account),
        matchPattern: e.pattern,
        categoryId: categoryId(db, e.category),
        shared: e.shared ?? false,
      })
      .run();
  }
}

const linkedTo = (db: Db, name: string) =>
  db.select().from(transactions).where(eq(transactions.recurringExpenseId, byName(db, name).id)).orderBy(transactions.bookingDate).all();

describe("linking fixed expenses to the imported history", () => {
  it("links the imported e-sparkonto history backwards in time", async () => {
    const db = freshDb({ seeded: true });
    await importFiles(db, allSwedbankFiles());
    addFixedExpenses(db);
    const r = linkRecurring(db);
    // One draw a month from 19 March to 18 September: the 25th, 28th and 30th fall in six of them, the 1st, 2nd, 5th and 10th too.
    for (const name of ["Hyra", "CSN", "Mobil", "Bilförsäkring", "Hemförsäkring", "A-kassa", "Medlemskap", "Gym"]) expect(linkedTo(db, name), name).toHaveLength(6);
    expect(linkedTo(db, "Hyra")[0].bookingDate).toBe("2026-03-25");
    expect(linkedTo(db, "Hyra").every((t) => t.amount === -750000)).toBe(true);
    // Apple: the 19 kr charge each month, and the card purchases Privatkonto has are never taken for it.
    expect(linkedTo(db, "Apple").every((t) => t.amount === -2900 && /APPLE/.test(t.descriptionClean))).toBe(true);
    expect(r.expenses).toBeGreaterThanOrEqual(8 * 6);
    expect(r.expenses).toBe(FIXED.reduce((n, e) => n + linkedTo(db, e.name).length, 0));
  });

  it("links rows imported after the expense too", async () => {
    const db = freshDb({ seeded: true });
    addFixedExpenses(db);
    await importFiles(db, allSwedbankFiles());
    expect(linkedTo(db, "Hyra")).toHaveLength(6);
    expect(linkedTo(db, "Gym")).toHaveLength(6);
  });
});

describe("recurring expenses API", async () => {
  const setup = async () => {
    const db = freshDb({ seeded: true });
    await importFiles(db, allSwedbankFiles());
    addFixedExpenses(db);
    linkRecurring(db);
    const app = createApp(db, { databasePath: ":memory:" });
    return { db, app };
  };
  type Listed = { id: number; name: string; amount: number; amountChanged: boolean; latestCharge: { amount: number } | null; linkedCount: number };
  const list = async (app: ReturnType<typeof createApp>) => (await (await app.request("/api/recurring-expenses")).json()) as Listed[];

  it("flags expenses whose latest charge has another amount", async () => {
    const { app } = await setup();
    const changed = (await list(app)).filter((e) => e.amountChanged).map((e) => [e.name, e.amount, -e.latestCharge!.amount]);
    expect(changed).toEqual(
      expect.arrayContaining([
        ["A-kassa", 14000, 15000],
        ["Medlemskap", 2400, 2900],
      ]),
    );
    expect(changed).toHaveLength(2);
  });

  it("updates the amount only on request", async () => {
    const { app, db } = await setup();
    const akassa = (await list(app)).find((e) => e.name === "A-kassa")!;
    const res = await app.request(`/api/recurring-expenses/${akassa.id}/accept-latest-amount`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(byName(db, "A-kassa")).toMatchObject({ amount: 15000 });
    expect(byName(db, "A-kassa").manuallyEditedAt).not.toBeNull();
    expect((await list(app)).find((e) => e.name === "A-kassa")!.amountChanged).toBe(false);
  });

  it("edits fields, validates, and relinks when the pattern changes", async () => {
    const { app, db } = await setup();
    const gym = byName(db, "Gym");
    const patch = (body: unknown) =>
      app.request(`/api/recurring-expenses/${gym.id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

    expect((await patch({ amount: -5 })).status).toBe(400);
    expect((await patch({ anchorDay: 40 })).status).toBe(400);
    expect((await patch({ boundUntil: "snart" })).status).toBe(400);

    expect((await patch({ shared: true, note: "Delas med Mio", boundUntil: "2027-01-31" })).status).toBe(200);
    expect(byName(db, "Gym")).toMatchObject({ shared: true, note: "Delas med Mio", boundUntil: "2027-01-31" });

    await patch({ matchPattern: "FINNS INTE" });
    expect((await list(app)).find((e) => e.name === "Gym")!.linkedCount).toBe(0);
    await patch({ matchPattern: "FITNESS24" });
    expect((await list(app)).find((e) => e.name === "Gym")!.linkedCount).toBe(6);
  });

  it("'Delad' on an expense makes its charges shared or own, never private rows", async () => {
    const { db, app } = await setup();
    const hyra = byName(db, "Hyra");
    expect(hyra.shared).toBe(true);
    const charges = () => db.select().from(transactions).where(eq(transactions.recurringExpenseId, hyra.id)).all();
    expect(charges()).toHaveLength(6);
    expect(charges().every((t) => t.shared)).toBe(true);

    const hidden = charges()[0];
    db.update(transactions).set({ private: true, shared: false }).where(eq(transactions.id, hidden.id)).run();
    const patch = (shared: boolean) =>
      app.request(`/api/recurring-expenses/${hyra.id}`, { method: "PATCH", body: JSON.stringify({ shared }), headers: { "Content-Type": "application/json" } });
    await patch(false);
    expect(charges().filter((t) => t.shared)).toEqual([]);
    await patch(true);
    expect(charges().filter((t) => !t.shared).map((t) => t.id)).toEqual([hidden.id]);
  });

  it("creates and deletes; deleting unlinks its transactions", async () => {
    const { app, db } = await setup();
    const res = await app.request("/api/recurring-expenses", {
      method: "POST",
      body: JSON.stringify({ name: "Badhus", amount: 39900, paymentMethod: "autogiro", anchorDay: 1 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const hyra = byName(db, "Hyra");
    await app.request(`/api/recurring-expenses/${hyra.id}`, { method: "DELETE" });
    expect(db.select().from(recurringExpenses).where(eq(recurringExpenses.name, "Hyra")).get()).toBeUndefined();
    expect(db.select({ n: sql<number>`count(*)` }).from(transactions).where(eq(transactions.recurringExpenseId, hyra.id)).get()!.n).toBe(0);
  });

  it("lists this month's draw and status per expense, none when paused", async () => {
    const { app, db } = await setup();
    const month = todayLocal().slice(0, 7);
    const hyra = byName(db, "Hyra");
    await app.request(`/api/recurring-expenses/${hyra.id}`, { method: "PATCH", body: JSON.stringify({ paused: true }), headers: { "Content-Type": "application/json" } });
    type WithMonth = Listed & { thisMonth: { period: string; dueDate: string; status: string } | null };
    const rows = (await list(app)) as WithMonth[];
    expect(rows.find((e) => e.name === "Hyra")!.thisMonth).toBeNull();
    const monthly = rows.filter((e) => e.thisMonth);
    expect(monthly.length).toBeGreaterThan(8);
    for (const e of monthly) {
      expect(e.thisMonth!.period).toBe(month);
      expect(["kommande", "dragen", "forfallen", "markerad_betald", "passerad"]).toContain(e.thisMonth!.status);
    }
  });

  it("a yearly expense links one charge a year, from 45 days before its date to 10 after, never 'off schedule'", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const spar = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!;
    let n = 0;
    const charge = (date: string, amount: number, text = "FORDONSSKATT TRA") =>
      db.insert(transactions)
        .values({ source: "swedbank", accountId: spar.id, bookingDate: date, transactionDate: date, descriptionRaw: text, descriptionClean: text, amount, fingerprint: `y${++n}` })
        .returning()
        .get();
    const a = charge("2025-06-09", -300000);
    const b = charge("2026-06-09", -305000);
    const early = charge("2026-04-01", -100000); // 90 days before: not this year's
    const again = charge("2026-06-20", -305000); // a second one the same year: only one of them, the nearer the date
    const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect((await app.request("/api/recurring-expenses", json("POST", { name: "Bilskatt", amount: 305000, paymentMethod: "transfer", accountId: spar.id, billingCycle: "yearly", anchorMonth: 13, anchorDay: 30 }))).status).toBe(400);
    const created = await (
      await app.request("/api/recurring-expenses", json("POST", { name: "Bilskatt", amount: 305000, paymentMethod: "transfer", accountId: spar.id, matchPattern: "FORDONSSKATT", billingCycle: "yearly", anchorMonth: 6, anchorDay: 30 }))
    ).json();
    const linked = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!.recurringExpenseId;
    expect([a, b, early, again].map((t) => linked(t.id))).toEqual([created.id, null, null, created.id]);
    const [e] = (await (await app.request("/api/recurring-expenses")).json()).filter((x: { id: number }) => x.id === created.id);
    expect(e).toMatchObject({ anchorMonth: 6, scheduleText: "varje år 30 juni", offSchedule: 0, linkedCount: 2 });
    expect(e.nextDate).toMatch(/-06-30$/);
    expect(e.thisYear).toMatchObject({ period: expect.stringMatching(/^\d{4}-06$/), dueDate: expect.stringMatching(/-06-30$/) });
  });

  it("gives the last 12 months and the linked charges, newest first", async () => {
    const { app, db } = await setup();
    const gym = byName(db, "Gym");
    const res = await app.request(`/api/recurring-expenses/${gym.id}/history`);
    const h = (await res.json()) as { months: { month: string; charged: number | null; expected: number }[]; charges: { bookingDate: string; amount: number }[] };
    // This month as the app sees it: local time, not UTC (they differ 00–02 on the 1st).
    const month = todayLocal().slice(0, 7);
    expect(h.months).toHaveLength(12);
    expect(h.months.at(-1)!.month).toBe(month);
    expect(h.months[0].month < h.months[1].month).toBe(true);
    expect(h.charges).toHaveLength(6);
    expect(h.charges.map((c) => c.bookingDate)).toEqual([...h.charges.map((c) => c.bookingDate)].sort().reverse());
    // Charged per month adds up to at most the charges linked (older ones fall outside the 12 months).
    const charged = h.months.reduce((s, m) => s + (m.charged ?? 0), 0);
    expect(charged).toBeGreaterThan(0);
    expect(charged).toBeLessThanOrEqual(-h.charges.reduce((s, c) => s + c.amount, 0));
    expect((await app.request("/api/recurring-expenses/9999/history")).status).toBe(404);
  });
});
