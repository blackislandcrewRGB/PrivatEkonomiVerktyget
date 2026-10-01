import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { createHolding, portfolio, savingsByMonth, setHoldingValue } from "../src/savings/savings.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-19";
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});

let seq = 0;
function row(db: Db, date: string, ore: number, category: string, text: string, account = "Swedbank Privatkonto") {
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, account)).get()!.id,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: text,
      descriptionClean: text,
      counterparty: text,
      amount: ore,
      categoryId: getCategoryPathMap(db).get(category)!,
      categorySource: "rule",
      isTransfer: category.startsWith("Överföringar"),
      fingerprint: `s${++seq}`,
    })
    .run();
}

/** Salary 30 000 kr a month; 5 000 kr to Avanza in June and August, 8 000 kr back out in July. */
function setup() {
  const db = freshDb({ seeded: true });
  for (const m of ["06", "07", "08"]) row(db, `2026-${m}-25`, 3000000, "Inkomst/Lön", "LÖN");
  row(db, "2026-06-26", -500000, "Överföringar & sparande/Sparande", "Swish Avanza");
  row(db, "2026-07-10", 800000, "Överföringar & sparande/Sparande", "AVANZA", "Swedbank e-sparkonto");
  row(db, "2026-08-26", -500000, "Överföringar & sparande/Sparande", "Swish Avanza");
  // Own transfers to the e-savings account are a buffer, not savings.
  row(db, "2026-08-27", -200000, "Överföringar & sparande/Egna överföringar", "Överföring");
  return db;
}

describe("Sparande", () => {
  it("per month: put in, taken out and the rate of the income; own transfers are not savings", () => {
    const db = setup();
    const { months, total } = savingsByMonth(db, "2026-06-01", "2026-08-31");
    expect(months.map((m) => [m.month, m.deposited, m.withdrawn, m.net, m.income])).toEqual([
      ["2026-06", 500000, 0, 500000, 3000000],
      ["2026-07", 0, 800000, -800000, 3000000],
      ["2026-08", 500000, 0, 500000, 3000000],
    ]);
    expect(months[0].rate).toBeCloseTo(1 / 6);
    expect(total).toMatchObject({ deposited: 1000000, withdrawn: 800000, net: 200000, income: 9000000 });
    expect(total.rate).toBeCloseTo(2 / 90);
  });

  it("the return is what the value grew beyond the money put in since the first value", () => {
    const db = setup();
    const isk = createHolding(db, "Avanza ISK");
    setHoldingValue(db, isk.id, "2026-06-01", 10000000, TODAY); // 100 000 kr
    setHoldingValue(db, isk.id, "2026-07-31", 9500000, TODAY); // +5 000 in, −8 000 out → 97 000 without growth
    setHoldingValue(db, isk.id, "2026-08-31", 10200000, TODAY); // +5 000 in → 100 000 without growth
    const p = portfolio(db)!;
    expect(p).toMatchObject({ since: "2026-06-01", startValue: 10000000, date: "2026-08-31", value: 10200000, deposited: 200000, change: 200000, return: 0 });
    expect(p.points.map((x) => [x.date, x.deposited, x.return])).toEqual([
      ["2026-06-01", null, null],
      ["2026-07-31", -300000, -200000],
      ["2026-08-31", 500000, 200000],
    ]);
    // A second value the same day replaces the first.
    setHoldingValue(db, isk.id, "2026-08-31", 10500000, TODAY);
    expect(portfolio(db)!.return).toBe(300000);
  });

  it("the API: holdings, values and the overview; no future dates or negative values", async () => {
    const db = setup();
    const app = createApp(db, { databasePath: ":memory:" });
    const isk = await (await app.request("/api/savings/holdings", json("POST", { name: "Avanza ISK" }))).json();
    expect((await app.request("/api/savings/holdings", json("POST", { name: " " }))).status).toBe(400);
    expect((await app.request(`/api/savings/holdings/${isk.id}/values?today=${TODAY}`, json("PUT", { date: "2026-09-20", value: 100 }))).status).toBe(400);
    expect((await app.request(`/api/savings/holdings/${isk.id}/values?today=${TODAY}`, json("PUT", { date: "2026-09-01", value: -1 }))).status).toBe(400);
    expect((await app.request(`/api/savings/holdings/${isk.id}/values?today=${TODAY}`, json("PUT", { date: "2026-09-01", value: 12345600 }))).status).toBe(200);

    const r = await (await app.request(`/api/savings?from=2026-06-01&to=2026-08-31&today=${TODAY}`)).json();
    expect(r.total.net).toBe(200000);
    expect(r.allTime).toEqual({ since: "2026-06-26", net: 200000 });
    expect(r.holdings).toEqual([{ id: isk.id, name: "Avanza ISK", values: [{ date: "2026-09-01", value: 12345600 }], latest: { date: "2026-09-01", value: 12345600 } }]);
    expect(r.portfolio).toMatchObject({ value: 12345600, return: 0, points: [{ date: "2026-09-01" }] });

    expect((await app.request(`/api/savings/holdings/${isk.id}/values/2026-09-01`, json("DELETE"))).status).toBe(200);
    expect((await app.request(`/api/savings/holdings/${isk.id}`, json("DELETE"))).status).toBe(200);
    expect((await (await app.request(`/api/savings?today=${TODAY}`)).json()).holdings).toEqual([]);
  });
});
