import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { byCategoryAndMonth } from "../src/analysis/analysis.js";
import { spendingPace } from "../src/overview/overview.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});
const privat = (db: Db) => db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;

let seq = 0;
function tx(db: Db, date: string, amount: number, desc: string, account?: number) {
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: account ?? privat(db),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount,
      categoryId: getCategoryPathMap(db).get("Prylar & hem/Elektronik")!,
      categorySource: "rule",
      fingerprint: `r${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  const app = createApp(db, { databasePath: ":memory:" });
  // The phone bought 26/8 and sent back: refunded 11/9 in two parts.
  const phone = tx(db, "2026-08-26", -289900, "ELGIGANTEN");
  const r1 = tx(db, "2026-09-11", 3000, "ELGIGANTEN");
  const r2 = tx(db, "2026-09-11", 286900, "ELGIGANTEN");
  const other = tx(db, "2026-09-12", 286900, "KJELL & CO"); // same amount, other merchant
  return { db, app, phone, r1, r2, other };
}

describe("returned purchases", () => {
  it("suggests the refunds from the same merchant that add up to the purchase", async () => {
    const { app, phone, r1, r2 } = setup();
    const res = await (await app.request(`/api/transactions/${phone.id}/refunds`)).json();
    expect(res.candidates.map((c: { id: number }) => c.id)).toEqual([r1.id, r2.id]);
    expect(res.suggested.sort()).toEqual([r1.id, r2.id].sort());
  });

  it("takes the purchase and its refunds out of every sum, and can be undone", async () => {
    const { db, app, phone, r1, r2 } = setup();
    const prylar = String(getCategoryPathMap(db).get("Prylar & hem")!);
    const month = (m: string) => byCategoryAndMonth(db, "2026-09-18", 12, "mine", null).data.find((d) => d.month === m)![prylar] ?? 0;
    expect(month("2026-08")).toBe(289900);
    expect(spendingPace(db, "2026-09-18").total).toBe(289900 + 286900 * 0); // the other merchant is money in

    const res = await app.request(`/api/transactions/${phone.id}/return`, json("POST", { refundIds: [r1.id, r2.id] }));
    expect(res.status).toBe(200);
    expect(db.select().from(transactions).where(eq(transactions.returnGroupId, phone.id)).all()).toHaveLength(3);
    expect(month("2026-08")).toBe(0);
    expect(month("2026-09")).toBe(-286900); // only the other merchant's money in is left
    expect(spendingPace(db, "2026-09-18").total).toBe(0);
    const list = await (await app.request("/api/transactions?from=2026-08-01&to=2026-09-30")).json();
    expect(list.rows).toHaveLength(4); // still listed
    expect(list.totals).toMatchObject({ out: 0, in: 286900 });

    await app.request(`/api/transactions/${r1.id}/return`, json("DELETE"));
    expect(db.select().from(transactions).where(eq(transactions.returnGroupId, phone.id)).all()).toHaveLength(0);
    expect(month("2026-08")).toBe(289900);
  });

  it("can be marked before the money is back, and refuses refunds that don't belong", async () => {
    const { db, app, phone, other } = setup();
    expect((await app.request(`/api/transactions/${phone.id}/return`, json("POST", { refundIds: [other.id] }))).status).toBe(400);
    expect((await app.request(`/api/transactions/${phone.id}/return`, json("POST", { refundIds: [] }))).status).toBe(200);
    expect(db.select().from(transactions).where(eq(transactions.id, phone.id)).get()!.returnGroupId).toBe(phone.id);
    expect((await app.request(`/api/transactions/${other.id}/refunds`)).status).toBe(400); // money in isn't a purchase
  });
});
