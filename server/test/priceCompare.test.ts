import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, categories, fuelPrices, transactions } from "../src/db/schema.js";
import { setFuelSettings, setShifts } from "../src/fuel/fuel.js";
import {
  baseMonthFor,
  changePctE2,
  foodComparison,
  fuelComparison,
  getPriceCompareSettings,
  indexed,
  priceBefore,
  pricesView,
  setPriceCompareSettings,
} from "../src/prices/compare.js";
import { saveFill } from "../src/fuel/fills.js";
import { OilBulletinProvider } from "../src/prices/oilBulletin.js";
import type { BinaryFetcher, Fetcher } from "../src/prices/provider.js";
import { ScbKpiProvider } from "../src/prices/scb.js";
import { syncIndexes } from "../src/prices/sync.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { freshDb } from "./helpers.js";
import { SCB_KPI } from "../src/prices/scb.js";

/** The food series the recordings were made for; the reference budget's and Årsinkomst's series are fetched alongside in use, not here. */
const FOOD = { ...SCB_KPI, series: SCB_KPI.series.filter((s) => !s.use) };

/**
 * Jämförelsen: mina siffror mot de officiella.
 *
 * Both sides come from the recorded answers of steps 2 and 3, so the numbers
 * here are the real August index and the real weekly diesel average. What the
 * tests are for is the arithmetic between them — the indexing, and which week
 * a fill-up is held up against.
 */

type Db = ReturnType<typeof freshDb>;

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures/prices", name);
const KPI = fs.readFileSync(fixture("scb-kpi-history.json"), "utf8");
const WORKBOOK = fs.readFileSync(fixture("oil-bulletin-history.xlsx"));

const TODAY = "2026-09-20";

/** The sources of steps 2 and 3, answering from their recordings. */
async function withSources(db: Db) {
  const json = (async () => ({ ok: true, status: 200, text: async () => KPI })) as Fetcher;
  const bytes = (async () => ({ ok: true, status: 200, arrayBuffer: async () => WORKBOOK.buffer.slice(WORKBOOK.byteOffset, WORKBOOK.byteOffset + WORKBOOK.byteLength) })) as BinaryFetcher;
  await syncIndexes(db, [new ScbKpiProvider(json, FOOD), new OilBulletinProvider(bytes)], { today: TODAY, log: () => {} });
}

const accountId = (db: Db, name: string) => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, name)).get()!.id;
const categoryId = (db: Db, key: string) => db.select({ id: categories.id }).from(categories).where(eq(categories.systemKey, key)).get()!.id;
/** Bil › Drivmedel has no system key: it is found by its path, as the fuel module does. */
const fuelCategory = (db: Db) => getCategoryPathMap(db).get("Bil/Drivmedel")!;

let n = 1;

const buy = (db: Db, date: string, ore: number, category: string, opts: { label?: string; note?: string; shared?: boolean } = {}) =>
  buyIn(db, date, ore, categoryId(db, category), opts);

function buyIn(db: Db, date: string, ore: number, category: number, opts: { label?: string; note?: string; shared?: boolean } = {}) {
  db.insert(transactions)
    .values({
      accountId: accountId(db, "Swedbank Privatkonto"),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: opts.label ?? "köp",
      descriptionClean: opts.label ?? "köp",
      label: opts.label ?? null,
      note: opts.note ?? null,
      shared: opts.shared ?? false,
      categoryId: category,
      amount: -ore,
      source: "manual",
      fingerprint: `cmp-${n++}`,
    })
    .run();
}

const period = { from: "2025-09-01", to: TODAY, today: TODAY };

describe("att indexera", () => {
  it("makes the base month 100 and reads the rest against it", () => {
    expect(indexed(10_000, 10_000)).toBe(10_000);
    expect(indexed(11_000, 10_000)).toBe(11_000);
    expect(indexed(12_457, 11_502)).toBe(10_830);
  });

  it("gives nothing when either end is missing", () => {
    // A line drawn from a month with no figure is a line about nothing.
    expect(indexed(null, 10_000)).toBeNull();
    expect(indexed(10_000, null)).toBeNull();
    expect(indexed(10_000, 0)).toBeNull();
  });

  it("states a change in hundredths of a percent", () => {
    expect(changePctE2(10_000, 10_830)).toBe(830);
    expect(changePctE2(10_000, 9_500)).toBe(-500);
    expect(changePctE2(10_000, null)).toBeNull();
  });
});

describe("startmånaden", () => {
  it("is twelve months back until something else is chosen", () => {
    const db = freshDb({ seeded: true });
    expect(getPriceCompareSettings(db).baseMonth).toBeNull();
    expect(baseMonthFor(db, TODAY)).toBe("2025-09");

    setPriceCompareSettings(db, { baseMonth: "2024-01" });
    expect(baseMonthFor(db, TODAY)).toBe("2024-01");
    // Cleared again, and back to the twelve months.
    setPriceCompareSettings(db, { baseMonth: null });
    expect(baseMonthFor(db, TODAY)).toBe("2025-09");
    expect(() => setPriceCompareSettings(db, { baseMonth: "januari" })).toThrow(/ÅÅÅÅ-MM/);
  });
});

describe("maten mot KPI", () => {
  async function groceries(db: Db) {
    await withSources(db);
    // A year of shopping: 5 000 kr a month, and 6 000 in August.
    for (let i = 0; i < 12; i++) {
      const month = `${i < 4 ? 2025 : 2026}-${String(((8 + i) % 12) + 1).padStart(2, "0")}`;
      buy(db, `${month}-12`, month === "2026-08" ? 600_000 : 500_000, "groceries");
    }
  }

  it("indexes both lines to the same month and says which", async () => {
    const db = freshDb({ seeded: true });
    await groceries(db);
    const r = foodComparison(db, period);

    expect(r.base.month).toBe("2025-09");
    expect(r.base.mineOre).toBe(500_000);
    // Livsmedel och alkoholfria drycker, september 2025: 132,36.
    expect(r.base.kpi).toBe(13_236);
    expect(r.months[0]).toMatchObject({ month: "2025-09", mineIndex: 10_000, kpiIndex: 10_000 });
    expect(r.missing).toBeNull();
    expect(r.source?.fetchedAt).toBeTruthy();
  });

  it("stops at the last month both sides have", async () => {
    const db = freshDb({ seeded: true });
    await groceries(db);
    const r = foodComparison(db, period);

    // SCB has published through August; September is not a whole month
    // anyway. My September against their August would be a calendar drawn as
    // a price rise.
    expect(r.through).toBe("2026-08");
    expect(r.months.at(-1)?.month).toBe("2026-08");
    expect(r.change.mine).toBe(2_000); // 6 000 against 5 000 kr: +20 %
    // 124,57 against 132,36: food is 5,89 % cheaper than a year ago, and my
    // own shopping is a fifth dearer. That gap is the whole point of the view.
    expect(r.change.kpi).toBe(-589);
  });

  it("leaves a month with no shopping as a hole, not as free food", async () => {
    const db = freshDb({ seeded: true });
    await withSources(db);
    buy(db, "2025-09-12", 500_000, "groceries");
    buy(db, "2026-08-12", 600_000, "groceries");

    const r = foodComparison(db, period);
    const march = r.months.find((m) => m.month === "2026-03")!;
    expect(march.mineOre).toBeNull();
    expect(march.mineIndex).toBeNull();
    // Theirs is still there: only my own side has the gap.
    expect(march.kpiIndex).not.toBeNull();
  });

  it("counts the whole household, not my half", async () => {
    const db = freshDb({ seeded: true });
    await withSources(db);
    buy(db, "2025-09-12", 500_000, "groceries");
    // A shared shop: half of it is mine, but the price of food is not halved.
    buy(db, "2026-08-12", 500_000, "groceries", { shared: true });
    expect(foodComparison(db, period).months.at(-1)?.mineOre).toBe(500_000);
  });

  it("shows the subgroups on their own, without my line", async () => {
    const db = freshDb({ seeded: true });
    await groceries(db);
    const r = foodComparison(db, period);

    const coffee = r.subgroups.find((s) => s.key === "kpi_coffee")!;
    expect(coffee.name).toBe("Kaffe");
    expect(coffee.months[0].index).toBe(10_000);
    expect(coffee.changePctE2).toBe(-939); // 191,09 against 210,90
    // The headline is the one with my own line, so it is not among them.
    expect(r.subgroups.map((s) => s.key)).not.toContain("kpi_food_beverages");
    expect(r.subgroups).toHaveLength(8);
  });

  it("says why there is nothing to compare when there is nothing", async () => {
    const db = freshDb({ seeded: true });
    // No index fetched at all.
    expect(foodComparison(db, period).missing).toMatch(/KPI för 2025-09 är inte hämtat/);

    await withSources(db);
    // Fetched, but I have no shopping in the base month.
    buy(db, "2026-08-12", 600_000, "groceries");
    const r = foodComparison(db, period);
    expect(r.missing).toMatch(/Inga matinköp .* 2025-09/);
    expect(r.change.mine).toBeNull();
    expect(r.change.kpi).toBeNull();
  });

  it("follows the period asked for", async () => {
    const db = freshDb({ seeded: true });
    await groceries(db);
    const r = foodComparison(db, { from: "2026-06-01", to: TODAY, today: TODAY });
    expect(r.months.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    // The base month is still September 2025, outside the period: the lines
    // start where they start, but they mean the same thing as before.
    expect(r.base.month).toBe("2025-09");
    expect(r.months[0].kpiIndex).toBe(indexed(12_391, 13_236));
  });
});

describe("dieseln mot rikssnittet", () => {
  function tank(db: Db, date: string, ore: number, opts: { label?: string; note?: string } = {}) {
    buyIn(db, date, ore, fuelCategory(db), { label: opts.label ?? "Circle K", note: opts.note });
  }

  async function tanking(db: Db) {
    await withSources(db);
    setFuelSettings(db, { categoryId: fuelCategory(db) });
    // My own litre prices, as entered in Pendling & bränsle.
    db.insert(fuelPrices).values([
      { date: "2026-08-31", price: 2_299 },
      { date: "2026-09-14", price: 2_258 },
    ]).run();
  }

  it("holds a fill-up against the week it happened in", async () => {
    const db = freshDb({ seeded: true });
    await tanking(db);
    tank(db, "2026-09-17", 80_000);

    const r = fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY });
    expect(r.fills).toHaveLength(1);
    // Thursday belongs to the week that started on Monday the 14th.
    expect(r.fills[0]).toMatchObject({ week: "2026-09-14", mineOre: 2_258, avgOre: 2_235, diffOre: 23 });
    expect(r.average).toMatchObject({ diffOre: 23, count: 1, skipped: 0 });
  });

  it("uses the week's own average, not the newest one", async () => {
    const db = freshDb({ seeded: true });
    await tanking(db);
    tank(db, "2026-09-03", 70_000); // week of 31 August: 19,22 kr/l
    tank(db, "2026-09-17", 80_000); // week of 14 September: 22,35 kr/l

    const r = fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY });
    expect(r.fills.map((f) => f.avgOre)).toEqual([1_922, 2_235]);
    // 22,99 against 19,22 and 22,58 against 22,35.
    expect(r.fills.map((f) => f.diffOre)).toEqual([377, 23]);
    expect(r.average.diffOre).toBe(200);
  });

  it("leaves the trips out", async () => {
    const db = freshDb({ seeded: true });
    await tanking(db);
    tank(db, "2026-09-17", 80_000);
    tank(db, "2026-09-18", 90_000, { label: "Circle K Exempelstad", note: "resa norrut" });
    expect(fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY }).fills).toHaveLength(1);
  });

  it("skips a fill-up whose price was only entered afterwards", async () => {
    const db = freshDb({ seeded: true });
    await tanking(db);
    // Before the first price entered: reckoning it at a later price would be
    // a guess wearing my own name.
    tank(db, "2026-08-03", 70_000);
    const r = fuelComparison(db, { from: "2026-08-01", to: TODAY, today: TODAY });
    expect(r.fills).toEqual([]);
    expect(r.average).toMatchObject({ count: 0, skipped: 1, diffOre: null });
  });

  it("gives the line the weeks of the period", async () => {
    const db = freshDb({ seeded: true });
    await tanking(db);
    const r = fuelComparison(db, { from: "2026-08-01", to: TODAY, today: TODAY });
    expect(r.weeks[0]).toEqual({ week: "2026-07-27", ore: 2_015 });
    expect(r.weeks.at(-1)).toEqual({ week: "2026-09-14", ore: 2_235 });
  });

  it("says what the difference is worth in a month of shifts", async () => {
    const db = freshDb({ seeded: true });
    await tanking(db);
    tank(db, "2026-09-17", 80_000);
    // No shifts entered: a month nobody has said anything about is not a
    // month of no driving, so there is no figure.
    expect(fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY }).monthly).toBeNull();

    setShifts(db, "2026-09", 14);
    const r = fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY });
    // 14 shifts × 40 km + 200 km other = 760 km at 6,5 l/100 km = 49,4 l.
    expect(r.monthly).toMatchObject({ shifts: 14, month: "2026-09", litres: 49.4 });
    expect(r.monthly!.ore).toBe(Math.round(49.4 * 23));
  });

  it("says when the average isn't there to compare against", async () => {
    const db = freshDb({ seeded: true });
    setFuelSettings(db, { categoryId: fuelCategory(db) });
    expect(fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY }).missing).toMatch(/inte hämtat/);
  });

  it("never reckons a fill-up at a price entered after it", () => {
    const prices = [
      { id: 1, date: "2026-09-01", price: 2_200 },
      { id: 2, date: "2026-09-14", price: 2_258 },
    ];
    expect(priceBefore(prices, "2026-09-17")?.price).toBe(2_258);
    expect(priceBefore(prices, "2026-09-10")?.price).toBe(2_200);
    expect(priceBefore(prices, "2026-08-30")).toBeNull();
  });
});

describe("vyn i sin helhet", () => {
  it("carries both comparisons and what every series knows about itself", async () => {
    const db = freshDb({ seeded: true });
    await withSources(db);
    buy(db, "2025-09-12", 500_000, "groceries");

    const view = pricesView(db, period);
    expect(view.food.months.length).toBeGreaterThan(0);
    expect(view.fuel.weeks.length).toBeGreaterThan(0);
    expect(view.series).toHaveLength(10);
    const diesel = view.series.find((s) => s.key === "diesel_se_avg")!;
    expect(diesel).toMatchObject({ unit: "ore_per_liter", latest: "2026-09-14", count: 344 });
    expect(diesel.source).toMatch(/Weekly Oil Bulletin/);
  });
});

describe("dieseln när kvittot finns", () => {
  /** A receipt of 10 September: 52,10 l at 21,60 kr/l, 13,03 kr off. */
  const RECEIPT = { date: "2026-09-10", litresE2: 5_210, listPriceOre: 2_160, discountOre: 1_303, amountOre: 111_233 };

  async function tanked(db: Db) {
    await withSources(db);
    setFuelSettings(db, { categoryId: fuelCategory(db) });
    db.insert(fuelPrices).values([{ date: "2026-09-01", price: 2_194 }]).run();
    buyIn(db, "2026-09-10", 111_233, fuelCategory(db), { label: "CIRCLE K EXEMPELSTAD" });
    return db.select({ id: transactions.id }).from(transactions).where(eq(transactions.amount, -111_233)).get()!.id;
  }

  it("uses what the card was charged, not the price entered by hand", async () => {
    const db = freshDb({ seeded: true });
    const tx = await tanked(db);
    const period = { from: "2026-09-01", to: TODAY, today: TODAY };

    // Without the receipt: the entered list price, 21,94 kr/l.
    expect(fuelComparison(db, period).fills[0]).toMatchObject({ mineOre: 2_194, source: "entered", listOre: null });

    saveFill(db, { ...RECEIPT, transactionId: tx });
    const f = fuelComparison(db, period).fills[0];
    // 1 112,33 kr over 52,10 l is 21,35 kr/l, against 21,25 for the week that
    // started on the 7th — the fill-up's own week, not the newest one.
    expect(f).toMatchObject({ mineOre: 2_135, source: "receipt", listOre: 2_160, discountOre: 25, litres: 52.1, week: "2026-09-07", avgOre: 2_125, diffOre: 10 });
  });

  it("keeps what I pay apart from what the station asks", async () => {
    const db = freshDb({ seeded: true });
    const tx = await tanked(db);
    saveFill(db, { ...RECEIPT, transactionId: tx });

    const r = fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY });
    // My price against the average, and the pump's price against it: the
    // difference between the two is the discount, which is mine.
    expect(r.average).toMatchObject({ diffOre: 10, listDiffOre: 35, discountOre: 25, receipts: 1, count: 1, skipped: 0 });
    expect(r.average.listDiffOre! - r.average.diffOre!).toBe(25);
  });

  it("falls back to the entered price for a fill-up with no receipt", async () => {
    const db = freshDb({ seeded: true });
    const tx = await tanked(db);
    buyIn(db, "2026-09-03", 70_000, fuelCategory(db), { label: "CIRCLE K EXEMPELST" });
    saveFill(db, { ...RECEIPT, transactionId: tx });

    const r = fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY });
    expect(r.fills.map((f) => f.source)).toEqual(["entered", "receipt"]);
    expect(r.average.receipts).toBe(1);
    expect(r.average.count).toBe(2);
    // Only the receipts can say anything about a pump price or a discount.
    expect(r.average.listCount).toBe(1);
  });

  it("counts a fill-up with a receipt even when no price was ever entered", async () => {
    const db = freshDb({ seeded: true });
    await withSources(db);
    setFuelSettings(db, { categoryId: fuelCategory(db) });
    buyIn(db, "2026-09-10", 111_233, fuelCategory(db), { label: "CIRCLE K EXEMPELSTAD" });
    const tx = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.amount, -111_233)).get()!.id;
    saveFill(db, { ...RECEIPT, transactionId: tx });

    const r = fuelComparison(db, { from: "2026-09-01", to: TODAY, today: TODAY });
    expect(r.average).toMatchObject({ skipped: 0, count: 1 });
    expect(r.fills[0].mineOre).toBe(2_135);
  });
});
