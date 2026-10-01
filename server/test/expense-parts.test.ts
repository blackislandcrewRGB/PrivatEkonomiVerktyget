import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, transactions } from "../src/db/schema.js";
import { linkRecurring } from "../src/recurring/link.js";
import { setSettlementStart } from "../src/settings.js";
import { sharedMonth } from "../src/shared/settlement.js";
import { expenseOccurrences } from "../src/overview/overview.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});
const espar = (db: Db) => db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id;
const row = (db: Db, id: number) => db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get()!;

let seq = 0;
function tele2(db: Db, date: string, ore: number) {
  return db
    .insert(transactions)
    .values({ source: "swedbank", accountId: espar(db), bookingDate: date, transactionDate: date, descriptionRaw: "TELE2", descriptionClean: "TELE2", counterparty: "TELE2", amount: -ore, fingerprint: `t${++seq}` })
    .returning()
    .get();
}

/**
 * Tele2 draws 947 kr on the 28th for both broadband and phones. Bredband
 * (439 kr, TELE2) and Mobilabonnemang (578 kr, no pattern, another day) are
 * both shared; Mobilabonnemang is made part of Bredband's charge.
 */
async function setup() {
  const db = freshDb({ seeded: true });
  const app = createApp(db, { databasePath: ":memory:" });
  setSettlementStart(db, "2026-07");
  const bb = db
    .insert(recurringExpenses)
    .values({ name: "Bredband", amount: 43900, anchorDay: 28, paymentMethod: "autogiro", accountId: espar(db), matchPattern: "TELE2", shared: true })
    .returning()
    .get();
  const mobil = db.insert(recurringExpenses).values({ name: "Mobilabonnemang", amount: 57800, anchorDay: 3, paymentMethod: "card", shared: true }).returning().get();
  tele2(db, "2026-07-28", 94700);
  const aug = tele2(db, "2026-08-28", 94700);
  linkRecurring(db);
  const res = await app.request(`/api/recurring-expenses/${mobil.id}`, json("PATCH", { partOfId: bb.id }));
  expect(res.status).toBe(200);
  return { db, app, bb, mobil, aug };
}

describe("an expense drawn together with another", () => {
  it("follows the other one's day and account, and has no charge of its own", async () => {
    const { db, app, bb, mobil } = await setup();
    expect(row(db, mobil.id)).toMatchObject({ partOfId: bb.id, anchorDay: 28, accountId: espar(db), paymentMethod: "autogiro" });
    const list = (await (await app.request("/api/recurring-expenses")).json()) as any[];
    expect(list.find((e) => e.id === mobil.id)).toMatchObject({ partOfName: "Bredband", linkedCount: 2, latestCharge: { amount: -57800 }, amountChanged: false });
    // Bredband's share of 947 kr is what is left: 369 kr, not its 439 kr.
    expect(list.find((e) => e.id === bb.id)).toMatchObject({ partNames: ["Mobilabonnemang"], latestCharge: { amount: -36900 }, amountChanged: true });

    // Moving Bredband's day moves Mobilabonnemang's.
    await app.request(`/api/recurring-expenses/${bb.id}`, json("PATCH", { anchorDay: 27 }));
    expect(row(db, mobil.id).anchorDay).toBe(27);
    // …and its own day can't be set apart from it.
    await app.request(`/api/recurring-expenses/${mobil.id}`, json("PATCH", { anchorDay: 3, name: "Mobil" }));
    expect(row(db, mobil.id)).toMatchObject({ anchorDay: 27, name: "Mobil" });
  });

  it("is drawn when the other one is, each with its share; the whole charge counts once in the shared economy", async () => {
    const { db, bb, mobil, aug } = await setup();
    const aug26 = sharedMonth(db, "2026-08", "2026-09-19").iPaid.groups.find((g) => g.kind === "recurring")!;
    expect(aug26.rows.map((r) => [r.description, r.amount, r.status])).toEqual([
      ["Bredband", 36900, "dragen"],
      ["Mobilabonnemang", 57800, "dragen"],
    ]);
    expect(aug26.total).toBe(94700);
    expect(db.select().from(transactions).where(eq(transactions.id, aug.id)).get()).toMatchObject({ recurringExpenseId: bb.id, shared: true });

    // September: nothing drawn yet, each expected at its own amount (1 017 kr together).
    const sep = expenseOccurrences(db, "2026-09-19", null).filter((o) => o.period === "2026-09");
    expect(sep.map((o) => [o.name, o.amount, o.status])).toEqual([
      ["Bredband", 43900, "kommande"],
      ["Mobilabonnemang", 57800, "kommande"],
    ]);
    // A changeover month with an odd charge: the difference lands on Bredband.
    tele2(db, "2026-09-28", 102500);
    linkRecurring(db);
    const drawn = expenseOccurrences(db, "2026-09-29", null).filter((o) => o.period === "2026-09");
    expect(drawn.map((o) => [o.name, o.status, o.transaction?.amount])).toEqual([
      ["Bredband", "dragen", -44700],
      ["Mobilabonnemang", "dragen", -57800],
    ]);
    expect(mobil.id).toBeGreaterThan(0);
  });

  it("only counts the shared part when only one of them is shared", async () => {
    const { db, app, bb } = await setup();
    await app.request(`/api/recurring-expenses/${bb.id}`, json("PATCH", { shared: false }));
    const rows = sharedMonth(db, "2026-08", "2026-09-19").iPaid.groups.find((g) => g.kind === "recurring")!.rows;
    expect(rows.map((r) => [r.description, r.amount])).toEqual([["Mobilabonnemang", 57800]]);
    // The charge stays shared: part of it is.
    expect(db.select().from(transactions).where(eq(transactions.recurringExpenseId, bb.id)).all().every((t) => t.shared)).toBe(true);
  });

  it("takes the latest charge less the others' amounts as the new amount, and refuses loops", async () => {
    const { db, app, bb, mobil } = await setup();
    expect((await app.request(`/api/recurring-expenses/${bb.id}/accept-latest-amount`, json("POST", {}))).status).toBe(200);
    expect(row(db, bb.id).amount).toBe(36900);
    expect((await app.request(`/api/recurring-expenses/${mobil.id}/accept-latest-amount`, json("POST", {}))).status).toBe(400);

    expect((await app.request(`/api/recurring-expenses/${mobil.id}`, json("PATCH", { partOfId: mobil.id }))).status).toBe(400);
    expect((await app.request(`/api/recurring-expenses/${bb.id}`, json("PATCH", { partOfId: mobil.id }))).status).toBe(400);
    const other = db.insert(recurringExpenses).values({ name: "Annat", amount: 100, paymentMethod: "card" }).returning().get();
    expect((await app.request(`/api/recurring-expenses/${other.id}`, json("PATCH", { partOfId: mobil.id }))).status).toBe(400);

    // Taking it out again, or deleting Bredband, leaves Mobilabonnemang on its own.
    await app.request(`/api/recurring-expenses/${bb.id}`, json("DELETE"));
    expect(row(db, mobil.id).partOfId).toBeNull();
  });
});
