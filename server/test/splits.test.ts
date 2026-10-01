import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactionSplits, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { createApp } from "../src/app.js";
import { byCategoryAndMonth } from "../src/analysis/analysis.js";
import { spendingPace } from "../src/overview/overview.js";
import { fuelPurchases } from "../src/fuel/fuel.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});

let seq = 0;
function tx(db: Db, amount: number, desc: string, categoryPath = "Prylar & hem/Elektronik") {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId,
      bookingDate: "2026-09-14",
      transactionDate: "2026-09-14",
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount,
      categoryId: getCategoryPathMap(db).get(categoryPath)!,
      categorySource: "rule",
      fingerprint: `s${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  const app = createApp(db, { databasePath: ":memory:" });
  const cat = getCategoryPathMap(db);
  // One Amazon order: a cable and a pair of trousers.
  const amazon = tx(db, -289900, "Amazon");
  return { db, app, cat, amazon };
}

const put = (app: ReturnType<typeof createApp>, id: number, parts: { categoryId: number; amount: number }[]) =>
  app.request(`/api/transactions/${id}/splits`, json("PUT", { parts }));

describe("splitting a purchase across categories", () => {
  it("stores parts that sum to the row and puts the largest one on the row", async () => {
    const { db, app, cat, amazon } = setup();
    const kläder = cat.get("Prylar & hem/Kläder")!;
    const elektronik = cat.get("Prylar & hem/Elektronik")!;
    const res = await put(app, amazon.id, [
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.splits).toEqual([
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    // The row keeps the largest part's category, so anything reading the column still makes sense.
    const row = db.select().from(transactions).where(eq(transactions.id, amazon.id)).get()!;
    expect(row.categoryId).toBe(elektronik);
    expect(row.categorySource).toBe("manual");
    expect(row.amount).toBe(-289900); // the purchase itself never changes

    // Sending the parts again replaces them instead of adding more.
    await put(app, amazon.id, [
      { categoryId: kläder, amount: -200000 },
      { categoryId: elektronik, amount: -89900 },
    ]);
    const stored = db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, amazon.id)).all();
    expect(stored).toHaveLength(2);
    expect(db.select().from(transactions).where(eq(transactions.id, amazon.id)).get()!.categoryId).toBe(kläder);
  });

  it("refuses parts that don't add up, the wrong sign, doubles, transfers and too many", async () => {
    const { app, cat, amazon } = setup();
    const kläder = cat.get("Prylar & hem/Kläder")!;
    const elektronik = cat.get("Prylar & hem/Elektronik")!;
    const sparande = cat.get("Överföringar & sparande/Sparande")!;

    const short = await put(app, amazon.id, [
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -150000 },
    ]);
    expect(short.status).toBe(400);
    expect((await short.json()).error).toMatch(/saknas/);

    const wrongSign = await put(app, amazon.id, [
      { categoryId: kläder, amount: 120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    expect(wrongSign.status).toBe(400);

    const double = await put(app, amazon.id, [
      { categoryId: kläder, amount: -120000 },
      { categoryId: kläder, amount: -169900 },
    ]);
    expect((await double.json()).error).toMatch(/bara finnas en gång/);

    const transfer = await put(app, amazon.id, [
      { categoryId: sparande, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    expect((await transfer.json()).error).toMatch(/överföring|avstämning/);

    const one = await put(app, amazon.id, [{ categoryId: kläder, amount: -289900 }]);
    expect((await one.json()).error).toMatch(/minst två delar/);

    const many = await put(
      app,
      amazon.id,
      Array.from({ length: 11 }, () => ({ categoryId: kläder, amount: -26000 })),
    );
    expect((await many.json()).error).toMatch(/Högst 10 delar/);
  });

  it("never splits a transfer", async () => {
    const { db, app, cat } = setup();
    const move = tx(db, -500000, "Överföring", "Överföringar & sparande/Egna överföringar");
    db.update(transactions).set({ isTransfer: true }).where(eq(transactions.id, move.id)).run();
    const res = await put(app, move.id, [
      { categoryId: cat.get("Prylar & hem/Kläder")!, amount: -200000 },
      { categoryId: cat.get("Prylar & hem/Elektronik")!, amount: -300000 },
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/överföring/i);
  });

  it("sends the parts with the list row and finds the row under every part's category", async () => {
    const { app, cat, amazon } = setup();
    const kläder = cat.get("Prylar & hem/Kläder")!;
    const elektronik = cat.get("Prylar & hem/Elektronik")!;
    const prylar = cat.get("Prylar & hem")!;
    await put(app, amazon.id, [
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    const list = await (await app.request("/api/transactions?from=2026-09-01&to=2026-09-30")).json();
    expect(list.rows[0].splits).toEqual([
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    // Without a category filter the totals are the purchase's, not the parts'.
    expect(list.totals).toMatchObject({ out: -289900, partial: 0 });

    const ids = async (query: string) => ((await (await app.request(`/api/transactions?${query}`)).json()).rows as { id: number }[]).map((r) => r.id);
    expect(await ids(`categoryId=${kläder}`)).toContain(amazon.id); // the smaller part's category
    expect(await ids(`categoryId=${prylar}`)).toContain(amazon.id); // a main category, via the subcategory
    expect(await ids(`categoryIds=${kläder}`)).toContain(amazon.id);
  });

  it("counts only the part in the category in the list's totals, as Analys does", async () => {
    const { db, app, cat, amazon } = setup();
    const kläder = cat.get("Prylar & hem/Kläder")!;
    const elektronik = cat.get("Prylar & hem/Elektronik")!;
    const prylar = cat.get("Prylar & hem")!;
    const mat = cat.get("Mat")!;
    // The trousers in Kläder, the cable in Elektronik; a plain Kläder purchase besides.
    await put(app, amazon.id, [
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    tx(db, -49900, "Lindex", "Prylar & hem/Kläder");
    const totals = async (query: string) => (await (await app.request(`/api/transactions?from=2026-09-01&to=2026-09-30&${query}`)).json()).totals;
    expect(await totals(`categoryId=${kläder}`)).toMatchObject({ count: 2, in: 0, out: -120000 - 49900, partial: 1 });
    expect(await totals(`categoryId=${elektronik}`)).toMatchObject({ count: 1, in: 0, out: -169900, partial: 1 });
    // The main category holds both parts: the whole purchase, nothing partial.
    expect(await totals(`categoryId=${prylar}`)).toMatchObject({ count: 2, in: 0, out: -289900 - 49900, partial: 0 });
    // Several categories at once: the parts in any of them.
    expect(await totals(`categoryIds=${kläder},${mat}`)).toMatchObject({ out: -120000 - 49900, partial: 1 });
    // Ut per day is made of the same parts: the days add up to Ut.
    const kl = await totals(`categoryId=${kläder}`);
    expect(Object.values(kl.outByDay as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(kl.out);
    // And the same figure as Analys for the subcategory.
    const sub = byCategoryAndMonth(db, "2026-09-20", 1, "household", prylar).data.find((d) => d.month === "2026-09")!;
    expect(sub[String(kläder)]).toBe(120000 + 49900);
  });

  it("drops the split when the row is given a category again, by itself or in bulk", async () => {
    const { db, app, cat, amazon } = setup();
    const kläder = cat.get("Prylar & hem/Kläder")!;
    const elektronik = cat.get("Prylar & hem/Elektronik")!;
    const parts = [
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ];
    const splitCount = () => db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, amazon.id)).all().length;

    await put(app, amazon.id, parts);
    const patched = await (await app.request(`/api/transactions/${amazon.id}`, json("PATCH", { categoryId: cat.get("Mat/Livsmedel")! }))).json();
    expect(patched.splitCleared).toBe(true);
    expect(splitCount()).toBe(0);

    await put(app, amazon.id, parts);
    const bulk = await (await app.request("/api/transactions/bulk", json("POST", { ids: [amazon.id], categoryId: cat.get("Mat/Livsmedel")! }))).json();
    expect(bulk.splitsCleared).toBe(1);
    expect(splitCount()).toBe(0);

    // Taking the split away by hand puts the whole amount back on the row.
    await put(app, amazon.id, parts);
    expect((await (await app.request(`/api/transactions/${amazon.id}/splits`, json("DELETE"))).json()).removed).toBe(true);
    expect(splitCount()).toBe(0);
  });

  it("moves the parts along when a category is merged into another, and merges twins", async () => {
    const { db, app, cat, amazon } = setup();
    const kläder = cat.get("Prylar & hem/Kläder")!;
    const elektronik = cat.get("Prylar & hem/Elektronik")!;
    await put(app, amazon.id, [
      { categoryId: kläder, amount: -120000 },
      { categoryId: elektronik, amount: -169900 },
    ]);
    // Kläder & skönhet is removed and everything in it moves to Elektronik.
    const res = await app.request(`/api/categories/${kläder}?moveTo=${elektronik}`, json("DELETE"));
    expect(res.status).toBe(200);
    const stored = db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, amazon.id)).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ categoryId: elektronik, amount: -289900 });
  });
});

describe("what a split purchase does to the sums", () => {
  /** The Amazon order: a cable (Elektronik) and coffee (Livsmedel). */
  function splitOrder() {
    const { db, app, cat, amazon } = setup();
    const elektronik = cat.get("Prylar & hem/Elektronik")!;
    const livsmedel = cat.get("Mat/Livsmedel")!;
    return { db, app, cat, amazon, elektronik, livsmedel, parts: [
      { categoryId: elektronik, amount: -169900 },
      { categoryId: livsmedel, amount: -120000 },
    ] };
  }

  it("lands in both categories in Analys, without changing the total", async () => {
    const { db, app, cat, amazon, parts } = splitOrder();
    const prylar = String(cat.get("Prylar & hem")!);
    const mat = String(cat.get("Mat")!);
    const month = () => byCategoryAndMonth(db, "2026-09-20", 12, "mine", null).data.find((d) => d.month === "2026-09")!;

    expect(month()[prylar]).toBe(289900); // before: the whole order is electronics
    expect(month()[mat]).toBe(0);

    await put(app, amazon.id, parts);
    expect(month()[prylar]).toBe(169900);
    expect(month()[mat]).toBe(120000);
    expect(month().total).toBe(289900); // the purchase itself is unchanged
    expect(spendingPace(db, "2026-09-20").total).toBe(289900);
  });

  it("counts only its own part as fuel", async () => {
    const { db, app, cat } = setup();
    const drivmedel = cat.get("Bil/Drivmedel")!;
    const circle = tx(db, -100000, "CIRCLE K EXEMPELSTAD", "Bil/Drivmedel");
    expect(fuelPurchases(db, drivmedel, "2026-09-01", "2026-09-30").map((r) => r.amount)).toEqual([100000]);

    await put(app, circle.id, [
      { categoryId: drivmedel, amount: -70000 },
      { categoryId: cat.get("Mat/Livsmedel")!, amount: -30000 },
    ]);
    expect(fuelPurchases(db, drivmedel, "2026-09-01", "2026-09-30").map((r) => r.amount)).toEqual([70000]);
  });

  it("counts in both categories in Kategorier & regler, once each", async () => {
    const { app, cat, amazon, elektronik, livsmedel, parts } = splitOrder();
    const usage = async () => (await (await app.request("/api/categories/usage")).json()) as Record<string, { transactions: number; sum12: number }>;
    const before = await usage();
    expect(before[elektronik].transactions).toBe(1);
    expect(before[livsmedel]?.transactions ?? 0).toBe(0);

    await put(app, amazon.id, parts);
    const after = await usage();
    expect(after[elektronik]).toMatchObject({ transactions: 1, sum12: -169900 });
    expect(after[livsmedel]).toMatchObject({ transactions: 1, sum12: -120000 });
  });

  it("exports one line per part", async () => {
    const { app, amazon, parts } = splitOrder();
    await put(app, amazon.id, parts);
    const csv = await (await app.request("/api/data/export?format=csv")).text();
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(3); // the header and the two parts
    expect(lines[1]).toContain("Prylar & hem › Elektronik;-1699,00");
    expect(lines[1]).toContain(";1 av 2");
    expect(lines[2]).toContain("Mat › Livsmedel;-1200,00");
  });

  it("comes back when a bulk category change is undone", async () => {
    const { db, app, cat, amazon, parts } = splitOrder();
    await put(app, amazon.id, parts);
    const bulk = await (await app.request("/api/transactions/bulk", json("POST", { ids: [amazon.id], categoryId: cat.get("Nöje/Spel")! }))).json();
    expect(db.select().from(transactionSplits).all()).toHaveLength(0);

    const undo = await app.request("/api/transactions/undo", json("POST", { rows: bulk.before }));
    expect(undo.status).toBe(200);
    expect(db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, amazon.id)).all()).toHaveLength(2);
    expect(db.select().from(transactions).where(eq(transactions.id, amazon.id)).get()!.categoryId).toBe(cat.get("Prylar & hem/Elektronik")!);
  });
});
