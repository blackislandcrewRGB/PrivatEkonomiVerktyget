import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { accounts, transactions } from "../src/db/schema.js";
import { ensureSeries, putPoints } from "../src/prices/series.js";
import { KPI_TOTAL } from "../src/salary/annualIncome.js";
import { keepUp, priceLevel, realPeriods, realSavings, realTotals, realYears, taxOver, type ValuePoint } from "../src/savings/real.js";
import { savingsCategoryIds } from "../src/savings/savings.js";
import { setQuarterValue } from "../src/tax/isk.js";
import { freshDb } from "./helpers.js";

/** KPI in hundredths, by month. */
function kpi(db: Db, months: Record<string, number>) {
  const series = ensureSeries(db, { key: KPI_TOTAL, name: "KPI totalt", unit: "index", source: "scb", frequency: "monthly" });
  putPoints(db, series, Object.entries(months).map(([m, value]) => ({ date: `${m}-01`, value })));
}
let seq = 0;
function row(db: Db, o: { date: string; amount: number; accountId?: number | null; categoryId?: number | null; text?: string }) {
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: o.accountId ?? null,
      bookingDate: o.date,
      transactionDate: o.date,
      descriptionRaw: o.text ?? "X",
      descriptionClean: o.text ?? "X",
      amount: o.amount,
      categoryId: o.categoryId ?? null,
      fingerprint: `r${++seq}`,
    })
    .run();
}
const kr = (n: number) => n * 100;

// Prices: 2 % up to March, then 10 250 in April and May and 10 300 in June, the newest published month.
const LEVEL = { "2025-12": 10000, "2026-01": 10100, "2026-02": 10100, "2026-03": 10200, "2026-04": 10250, "2026-05": 10250, "2026-06": 10300 };
const POINTS: ValuePoint[] = [
  { date: "2026-01-01", valueOre: kr(100_000), source: "entered" },
  { date: "2026-04-01", valueOre: kr(115_000), source: "entered" },
  { date: "2026-07-15", valueOre: kr(120_000), source: "today" },
];
const FLOWS = [
  { date: "2026-02-15", amount: kr(10_000) },
  // On a value's day: after the value, so in the next period.
  { date: "2026-04-01", amount: kr(5_000) },
  { date: "2026-05-01", amount: -kr(2_000) },
];

describe("Sparande efter inflation", () => {
  it("per period: the return on the money in it, prices over the same months, and the real return", () => {
    const db = freshDb();
    kpi(db, LEVEL);
    const level = priceLevel(db)!;
    expect(level.latest).toBe("2026-06");
    // July isn't published: June's level.
    expect(level.of("2026-07")).toBe(10300);
    const [q1, q2] = realPeriods(POINTS, FLOWS, level);
    // 5 000 kr more than put in, on 100 000 kr and half of the 10 000 put in mid-period.
    expect(q1.netOre).toBe(kr(10_000));
    expect(q1.nominal).toBeCloseTo(5_000 / 105_000, 10);
    // The value on 1 January is December's prices, on 1 April March's.
    expect(q1.inflation).toBeCloseTo(0.02, 10);
    expect(q1.real).toBeCloseTo(1.047619047619 / 1.02 - 1, 10);
    // 5 000 kr in on its first day (the whole period), 2 000 kr out with 75 of 105 days left.
    expect(q2.netOre).toBe(kr(3_000));
    expect(q2.nominal).toBeCloseTo(2_000 / (115_000 + 5_000 - 2_000 * (75 / 105)), 10);
    expect(q2.inflation).toBeCloseTo(10300 / 10200 - 1, 10);
    expect(q2.ongoing).toBe(true);
  });

  it("since the start: what was put in counted at today's prices, and the gain split into purchasing power and inflation", () => {
    const db = freshDb();
    kpi(db, LEVEL);
    const level = priceLevel(db)!;
    const periods = realPeriods(POINTS, FLOWS, level);
    const t = realTotals(POINTS, FLOWS, periods, level);
    expect(t.netOre).toBe(kr(13_000));
    expect(t.nominalGainOre).toBe(kr(7_000));
    // 100 000 at December's 10 000, 10 000 at February's 10 100, 5 000 and −2 000 at April's and May's 10 250, all to June's 10 300.
    const today = 100_000 * 1.03 + (10_000 * 10300) / 10100 + (5_000 * 10300) / 10250 - (2_000 * 10300) / 10250;
    expect(t.netTodayOre! / 100).toBeCloseTo(today, 1);
    expect(t.realGainOre! / 100).toBeCloseTo(120_000 - today, 1);
    expect(t.inflationOre! / 100).toBeCloseTo(today - 113_000, 1);
    expect(t.realGainOre! + t.inflationOre!).toBe(t.nominalGainOre);
    expect(t.inflation).toBeCloseTo(0.03, 10);
    expect(t.nominal).toBeCloseTo((1 + periods[0].nominal!) * (1 + periods[1].nominal!) - 1, 10);
    expect(t.real).toBeCloseTo((1 + t.nominal!) / 1.03 - 1, 10);
    expect(t.deposited).toBe(kr(15_000));
    expect(t.withdrawn).toBe(kr(2_000));
  });

  it("the line to keep up with prices: the start and the money since, carried to each value's day", () => {
    const db = freshDb();
    kpi(db, LEVEL);
    const [k0, k1, k2] = keepUp(POINTS, FLOWS, priceLevel(db));
    expect(k0).toBe(kr(100_000));
    // 1 April is March's prices: 100 000 kr from December's and 10 000 kr from February's.
    expect(k1! / 100).toBeCloseTo(100_000 * 1.02 + (10_000 * 10200) / 10100, 1);
    // Today is the same as 'in today's money' since the start.
    const t = realTotals(POINTS, FLOWS, realPeriods(POINTS, FLOWS, priceLevel(db)), priceLevel(db));
    expect(k2).toBe(t.netTodayOre);
  });

  it("per year: a period ending 1 January belongs to the year before, and the year's ISK tax beside it", () => {
    const db = freshDb();
    kpi(db, { ...LEVEL, "2025-09": 9900 });
    const points: ValuePoint[] = [{ date: "2025-10-01", valueOre: kr(90_000), source: "entered" }, ...POINTS];
    const periods = realPeriods(points, FLOWS, priceLevel(db));
    const years = realYears(periods, (y) => (y === 2025 ? { ore: kr(1_302), estimated: false } : { ore: kr(900), estimated: true }));
    expect(years.map((y) => [y.year, y.iskTaxOre, y.iskTaxEstimated])).toEqual([
      [2025, kr(1_302), false],
      [2026, kr(900), true],
    ]);
    // 2025 is the one period 1 Oct → 1 Jan: 90 000 to 100 000 kr with nothing put in; September's to December's prices.
    expect(years[0].nominal).toBeCloseTo(10_000 / 90_000, 10);
    expect(years[0].inflation).toBeCloseTo(10000 / 9900 - 1, 10);
    expect(years[1].inflation).toBeCloseTo(0.03, 10);
  });

  it("the ISK tax over a span: each year's by the share of its days covered", () => {
    const tax = (y: number) => ({ ore: y === 2025 ? kr(1_000) : kr(2_000) });
    // 1 Oct–1 Jan is a quarter of 2025 (92 of 365 days); 1 Jan–1 Jul half of 2026 (181 of 365).
    expect(taxOver("2025-10-01", "2026-07-01", tax)).toBe(Math.round(kr(1_000) * (92 / 365) + kr(2_000) * (181 / 365)));
    expect(taxOver("2026-01-01", "2027-01-01", tax)).toBe(kr(2_000));
    expect(taxOver("2026-01-01", "2026-07-01", () => ({ ore: null }))).toBeNull();
  });

  it("without KPI the kronor stay nominal and nothing is made up", () => {
    const periods = realPeriods(POINTS, FLOWS, null);
    const t = realTotals(POINTS, FLOWS, periods, null);
    expect(periods.every((p) => p.inflation === null && p.real === null)).toBe(true);
    expect(t.nominalGainOre).toBe(kr(7_000));
    expect([t.netTodayOre, t.realGainOre, t.inflationOre, t.real]).toEqual([null, null, null, null]);
  });

  it("from the database: the ISK's entered values and the Sparande transfers, and the buffer's interest against prices", () => {
    const db = freshDb({ seeded: true });
    kpi(db, { "2024-12": 10000, "2025-12": 10200, "2026-01": 10250, "2026-03": 10300 });
    setQuarterValue(db, "2026-01-01", kr(100_000));
    setQuarterValue(db, "2026-04-01", kr(104_000));
    const savings = savingsCategoryIds(db)[0];
    const bank = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
    // Swish to Avanza: 2 000 kr out of the bank is 2 000 kr into the savings.
    row(db, { date: "2026-02-10", amount: -kr(2_000), accountId: bank, categoryId: savings });
    // The e-savings account: its rows begin in 2024, 10 000 kr all 2025, 100 kr interest on 30 December.
    const buffer = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!;
    db.update(accounts).set({ balance: kr(10_100), balanceUpdatedAt: "2026-04-01", trackBalance: true }).where(eq(accounts.id, buffer.id)).run();
    row(db, { date: "2024-08-21", amount: kr(10_000), accountId: buffer.id });
    row(db, { date: "2025-12-30", amount: kr(100), accountId: buffer.id, text: "Sparränta" });

    const r = realSavings(db, "2026-04-01");
    expect(r.kpiMonth).toBe("2026-03");
    // The value entered for today is today's: no other.
    expect(r.points.map((p) => [p.date, p.source])).toEqual([
      ["2026-01-01", "entered"],
      ["2026-04-01", "entered"],
    ]);
    expect(r.totals!.netOre).toBe(kr(2_000));
    expect(r.totals!.nominalGainOre).toBe(kr(2_000));
    expect(r.buffer!.name).toBe("Swedbank e-sparkonto");
    const [y2025] = r.buffer!.years;
    expect(y2025.year).toBe(2025);
    expect(y2025.interestOre).toBe(kr(100));
    // Twelve month-ends at 10 000 kr and the year's last at 10 100, with the start: 13 balances.
    expect(y2025.averageOre).toBe(Math.round((12 * kr(10_000) + kr(10_100)) / 13));
    expect(y2025.inflation).toBeCloseTo(0.02, 10);
    // 2 % of the average less the 100 kr of interest.
    expect(y2025.lostOre).toBe(Math.round(y2025.averageOre * 0.02 - kr(100)));
    expect(r.buffer!.balanceOre).toBe(kr(10_100));
  });
});
