import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, recurringIncome, transactions } from "../src/db/schema.js";
import { linkRecurring } from "../src/recurring/link.js";
import { expenseOccurrences, buildOverview } from "../src/overview/overview.js";
import { setSettlementStart } from "../src/settings.js";
import { sharedMonth } from "../src/shared/settlement.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});
const espar = (db: Db) => db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id;
const TODAY = "2026-09-18";

let seq = 0;
function charge(db: Db, date: string, amount: number) {
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: espar(db),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "CSN",
      descriptionClean: "CSN",
      counterparty: "CSN",
      amount,
      fingerprint: `csn${++seq}`,
    })
    .run();
}

function setup() {
  const db = freshDb({ seeded: true });
  const app = createApp(db, { databasePath: ":memory:" });
  const csn = db
    .insert(recurringExpenses)
    .values({ name: "CSN", amount: 180000, anchorDay: 27, paymentMethod: "autogiro", accountId: espar(db), matchPattern: "CSN" })
    .returning()
    .get();
  return { db, app, csn };
}

describe("amount per month for a recurring expense", () => {
  it("replaces the usual amount in the month's occurrence and the forecast", async () => {
    const { db, app, csn } = setup();
    db.insert(recurringIncome).values({ name: "Lön", amount: 2500000, dayOfMonth: 30, accountId: espar(db) }).run();
    const before = buildOverview(db, TODAY).forecast!;
    const res = await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-09`, json("PUT", { amount: 160000 }));
    expect(res.status).toBe(200);
    const occ = expenseOccurrences(db, TODAY, "2026-09-30").find((o) => o.expenseId === csn.id)!;
    expect(occ.amount).toBe(160000);
    expect(buildOverview(db, TODAY).forecast!.left - before.left).toBe(20000);

    await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-09`, json("PUT", { amount: null }));
    expect(expenseOccurrences(db, TODAY, "2026-09-30").find((o) => o.expenseId === csn.id)!.amount).toBe(180000);
  });

  it("doesn't flag 'amount changed' when the charge matches the month's own amount", async () => {
    const { db, app, csn } = setup();
    charge(db, "2026-08-27", -170000);
    linkRecurring(db);
    const list = async () => ((await (await app.request("/api/recurring-expenses")).json()) as { id: number; amountChanged: boolean; variesByMonth: boolean }[]).find((e) => e.id === csn.id)!;
    expect((await list()).amountChanged).toBe(true);
    await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-08`, json("PUT", { amount: 170000 }));
    expect(await list()).toMatchObject({ amountChanged: false, variesByMonth: true });
    expect(buildOverview(db, TODAY).warnings.some((w) => w.kind === "amount_changed")).toBe(false);
  });

  it("doesn't flag an old month without its own amount once later months are planned", async () => {
    const { db, app, csn } = setup();
    charge(db, "2026-08-31", -181000);
    linkRecurring(db);
    const list = async () => ((await (await app.request("/api/recurring-expenses")).json()) as { id: number; amountChanged: boolean }[]).find((e) => e.id === csn.id)!;
    expect((await list()).amountChanged).toBe(true);
    await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-10`, json("PUT", { amount: 150000 }));
    expect((await list()).amountChanged).toBe(false);
    // A month with its own amount still warns when the charge differs from it.
    await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-08`, json("PUT", { amount: 175000 }));
    expect((await list()).amountChanged).toBe(true);
  });

  it("lists the year's months with own amount, expected and charged", async () => {
    const { db, app, csn } = setup();
    charge(db, "2026-07-27", -180000);
    charge(db, "2026-08-31", -170000); // late: still August's charge
    linkRecurring(db);
    await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-10`, json("PUT", { amount: 230000 }));
    const months = (await (await app.request(`/api/recurring-expenses/${csn.id}/months?year=2026`)).json()) as {
      month: string;
      amount: number | null;
      expected: number;
      charged: number | null;
    }[];
    expect(months).toHaveLength(12);
    expect(months[6]).toMatchObject({ month: "2026-07", amount: null, expected: 180000, charged: 180000 });
    expect(months[7]).toMatchObject({ month: "2026-08", amount: null, expected: 180000, charged: 170000 });
    expect(months[9]).toMatchObject({ month: "2026-10", amount: 230000, expected: 230000, charged: null });
  });

  it("rejects bad months and amounts", async () => {
    const { app, csn } = setup();
    expect((await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-13`, json("PUT", { amount: 100 }))).status).toBe(400);
    expect((await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-09`, json("PUT", { amount: -5 }))).status).toBe(400);
  });

  it("is the expected amount in the shared economy for a shared expense", async () => {
    const { db, app, csn } = setup();
    db.update(recurringExpenses).set({ shared: true }).where(eq(recurringExpenses.id, csn.id)).run();
    setSettlementStart(db, "2026-09");
    await app.request(`/api/recurring-expenses/${csn.id}/amounts/2026-09`, json("PUT", { amount: 160000 }));
    const rows = sharedMonth(db, "2026-09", TODAY).iPaid.groups.find((g) => g.key === "recurring")!.rows;
    expect(rows).toMatchObject([{ description: "CSN", amount: 160000, status: "forvantat" }]);
  });
});
