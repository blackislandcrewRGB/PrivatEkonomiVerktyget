import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringIncome, transactions } from "../src/db/schema.js";
import { importFiles } from "../src/import/importBatch.js";
import { importSwedbankCsv } from "../src/import/importSwedbank.js";
import { createApp } from "../src/app.js";
import { allSwedbankFiles, freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const espar = (db: Db) => db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!;

async function withSalary() {
  const db = freshDb({ seeded: true });
  await importFiles(db, allSwedbankFiles());
  const app = createApp(db, { databasePath: ":memory:" });
  const res = await app.request(
    "/api/recurring-income",
    json("POST", { name: "Lön", amount: 2450000, dayOfMonth: 25, accountId: espar(db).id, matchPattern: "LÖN" }),
  );
  const income = (await res.json()) as { id: number; linked: number };
  return { db, app, income };
}

type Listed = {
  id: number;
  amount: number;
  recent: { bookingDate: string; amount: number }[];
  recentMin: number;
  recentAvg: number;
  overrides: { month: string; amount: number }[];
};
const listIncome = async (app: ReturnType<typeof createApp>) => (await (await app.request("/api/recurring-income")).json()) as Listed[];

describe("recurring income", () => {
  it("shows the latest six actual salaries with minimum and average", async () => {
    const { app } = await withSalary();
    const [l] = await listIncome(app);
    // The extra 1 500 kr 'Lön' on 30 June is within the five days of the salary day and counts as one.
    expect(l.recent.map((r) => r.bookingDate)).toEqual(["2026-08-25", "2026-07-25", "2026-06-30", "2026-06-25", "2026-05-25", "2026-04-25"]);
    const amounts = [2450000, 2450000, 150000, 2450000, 2450000, 2450000];
    expect(l.recent.map((r) => r.amount)).toEqual(amounts);
    expect(l.recentMin).toBe(150000);
    expect(l.recentAvg).toBe(Math.round(amounts.reduce((a, b) => a + b) / 6));
  });

  it("a salary with another bank text is still the salary when its amount is the month's, once a month", async () => {
    const { db, app, income } = await withSalary();
    // September's expected amount; the bank sends the salary as a reference instead of 'Lön'.
    await app.request(`/api/recurring-income/${income.id}/overrides/2026-09`, json("PUT", { amount: 2450000 }));
    const add = (date: string, amount: number, text: string, n: number) =>
      db.insert(transactions).values({ source: "enable_banking", accountId: espar(db).id, bookingDate: date, descriptionRaw: text, descriptionClean: text, amount, fingerprint: `odd${n}` }).returning().get();
    const salary = add("2026-09-24", 2450000, "SWED2609240ABCDE", 1);
    // Same text, an amount that isn't the salary's: left alone.
    const other = add("2026-09-24", 150000, "SWED2609240XYZ", 2);
    const { linkRecurring } = await import("../src/recurring/link.js");
    linkRecurring(db);
    const byId = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;
    expect(byId(salary.id).recurringIncomeId).toBe(income.id);
    expect(byId(other.id).recurringIncomeId).toBeNull();
    // A second one the same month isn't taken as the salary too.
    const twice = add("2026-09-25", 2450000, "SWED2609250ABCDE", 3);
    linkRecurring(db);
    expect(byId(twice.id).recurringIncomeId).toBeNull();
  });

  it("stores an expected amount per month, and removes it with null", async () => {
    const { app, income } = await withSalary();
    expect((await app.request(`/api/recurring-income/${income.id}/overrides/2026-09`, json("PUT", { amount: 2610000 }))).status).toBe(200);
    await app.request(`/api/recurring-income/${income.id}/overrides/2026-10`, json("PUT", { amount: 2500000 }));
    await app.request(`/api/recurring-income/${income.id}/overrides/2026-09`, json("PUT", { amount: 2620000 }));
    expect((await listIncome(app))[0].overrides).toEqual([
      { month: "2026-09", amount: 2620000 },
      { month: "2026-10", amount: 2500000 },
    ]);
    await app.request(`/api/recurring-income/${income.id}/overrides/2026-10`, json("PUT", { amount: null }));
    expect((await listIncome(app))[0].overrides).toEqual([{ month: "2026-09", amount: 2620000 }]);
    expect((await app.request(`/api/recurring-income/${income.id}/overrides/2026-13`, json("PUT", { amount: 1 }))).status).toBe(400);
  });

  it("edits fields and rebuilds links when the pattern changes", async () => {
    const { db, app, income } = await withSalary();
    const linked = () => db.select().from(transactions).where(eq(transactions.recurringIncomeId, income.id)).all().length;
    expect(linked()).toBe(7); // six salaries and the extra 30 June one
    await app.request(`/api/recurring-income/${income.id}`, json("PATCH", { name: "Lön Exempel", amount: 2460000 }));
    expect(db.select().from(recurringIncome).get()).toMatchObject({ name: "Lön Exempel", amount: 2460000 });
    expect(linked()).toBe(7);
    await app.request(`/api/recurring-income/${income.id}`, json("PATCH", { matchPattern: "FINNS INTE" }));
    // Only the salaries within 1 % of the usual amount (now 24 600 kr) are still it, by their amount: the six, not the 1 500 kr one.
    expect(linked()).toBe(6);
    expect((await app.request(`/api/recurring-income/${income.id}`, json("PATCH", { dayOfMonth: 0 }))).status).toBe(400);
  });

  it("deleting removes the income and its links but keeps the transactions", async () => {
    const { db, app, income } = await withSalary();
    const before = db.select().from(transactions).all().length;
    await app.request(`/api/recurring-income/${income.id}/overrides/2026-09`, json("PUT", { amount: 2610000 }));
    await app.request(`/api/recurring-income/${income.id}`, { method: "DELETE" });
    expect(db.select().from(recurringIncome).all()).toEqual([]);
    expect(db.select().from(transactions).all().length).toBe(before);
    expect(db.select().from(transactions).where(eq(transactions.recurringIncomeId, income.id)).all()).toEqual([]);
  });
});

describe("labels", () => {
  it("renames a row for display without touching the bank's text, fingerprint or grouping", async () => {
    const { buildCsv } = await import("./helpers.js");
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([{ date: "2026-09-10", desc: "K*CAFEEXEMPEL AB", amount: "-245.00" }]), "a.csv");
    const app = createApp(db, { databasePath: ":memory:" });
    const before = db.select().from(transactions).get()!;

    const res = await app.request(`/api/transactions/${before.id}`, json("PATCH", { label: "  Lunch med Kim " }));
    expect(res.status).toBe(200);
    const after = db.select().from(transactions).get()!;
    expect(after).toMatchObject({ label: "Lunch med Kim", descriptionClean: "K*CAFEEXEMPEL AB", fingerprint: before.fingerprint });
    expect(after.manuallyEditedAt).not.toBeNull();

    // Search finds both the label and the bank text; the review groups still use the bank text.
    const search = async (q: string) =>
      ((await (await app.request(`/api/transactions?q=${encodeURIComponent(q)}`)).json()) as { rows: unknown[] }).rows.length;
    expect(await search("lunch med kim")).toBe(1);
    expect(await search("CAFEEXEMPEL")).toBe(1);
    const groups = (await (await app.request("/api/review/groups")).json()).groups as { merchant: string }[];
    expect(groups.map((g) => g.merchant)).toEqual(["CAFEEXEMPEL AB"]);

    // Re-import leaves the label alone.
    importSwedbankCsv(db, buildCsv([{ date: "2026-09-10", desc: "K*CAFEEXEMPEL AB", amount: "-245.00" }]), "a.csv");
    expect(db.select().from(transactions).all()).toHaveLength(1);
    expect(db.select().from(transactions).get()!.label).toBe("Lunch med Kim");

    // Clearing the label shows the bank text again.
    await app.request(`/api/transactions/${before.id}`, json("PATCH", { label: "" }));
    expect(db.select().from(transactions).get()!.label).toBeNull();
  });

  it("locks amount and date on imported rows", async () => {
    const { buildCsv } = await import("./helpers.js");
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([{ date: "2026-09-10", desc: "ICA", amount: "-10.00" }]), "a.csv");
    const app = createApp(db, { databasePath: ":memory:" });
    const t = db.select().from(transactions).get()!;
    expect((await app.request(`/api/transactions/${t.id}`, json("PATCH", { amount: -500 }))).status).toBe(400);
    expect((await app.request(`/api/transactions/${t.id}`, json("PATCH", { bookingDate: "2026-09-11" }))).status).toBe(400);
    expect(db.select().from(transactions).get()).toMatchObject({ amount: -1000, bookingDate: "2026-09-10" });
  });
});

describe("manual transactions", () => {
  it("creates a one-off income and updates the account balance on request", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const account = espar(db);
    db.update(accounts).set({ balance: 100000 }).where(eq(accounts.id, account.id)).run();
    const others = db.select().from(accounts).all().filter((a) => a.id !== account.id);
    const res = await app.request(
      "/api/transactions",
      json("POST", { bookingDate: "2026-09-18", amount: 50000, accountId: account.id, label: "Födelsedagspengar", updateBalance: true }),
    );
    expect(res.status).toBe(200);
    const t = (await res.json()) as { id: number; source: string; label: string; descriptionClean: string };
    expect(t).toMatchObject({ source: "manual", label: "Födelsedagspengar", descriptionClean: "Födelsedagspengar" });
    expect(espar(db).balance).toBe(150000);
    for (const o of others) expect(db.select().from(accounts).where(eq(accounts.id, o.id)).get()!.balance).toBe(o.balance);

    // Manual rows can change amount, date and text.
    await app.request(`/api/transactions/${t.id}`, json("PATCH", { amount: 60000, bookingDate: "2026-09-17", label: "Gåva" }));
    expect(db.select().from(transactions).where(eq(transactions.id, t.id)).get()).toMatchObject({
      amount: 60000,
      bookingDate: "2026-09-17",
      label: "Gåva",
      descriptionClean: "Gåva",
    });
  });

  it("validates input", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    expect((await app.request("/api/transactions", json("POST", { bookingDate: "2026-09-18", amount: 100 }))).status).toBe(400);
    expect((await app.request("/api/transactions", json("POST", { label: "x", bookingDate: "igår", amount: 100 }))).status).toBe(400);
    expect((await app.request("/api/transactions", json("POST", { label: "x", bookingDate: "2026-09-18", amount: 0 }))).status).toBe(400);
    expect(
      (await app.request("/api/transactions", json("POST", { label: "x", bookingDate: "2026-09-18", amount: 100, updateBalance: true }))).status,
    ).toBe(400);
  });
});
