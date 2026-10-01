import { describe, expect, it } from "vitest";
import { payslips } from "../src/db/schema.js";
import { annualIncome, deviation, KPI_TOTAL } from "../src/salary/annualIncome.js";
import { saveTaxReturn } from "../src/taxReturns/taxReturns.js";
import { ensureSeries, putPoints } from "../src/prices/series.js";
import { pensionStatementChecks, savePensionStatement } from "../src/networth/pension.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-20";
let seq = 0;
const payslip = (db: Db, payDate: string, gross: number) =>
  db.insert(payslips).values({ payDate, gross, tax: 0, net: gross, filename: `${payDate}.htm`, sha256: `an-${++seq}` }).run();
const declare = (db: Db, year: number, salary: number) => saveTaxReturn(db, year, { submittedAt: `${year + 1}-03-21`, boxes: { employmentIncome: salary } }, TODAY);
/** KPI totalt at the same value every month of a year. */
function kpi(db: Db, byYear: Record<number, number>) {
  const series = ensureSeries(db, { key: KPI_TOTAL, name: "KPI totalt", unit: "index", source: "SCB", frequency: "monthly" });
  putPoints(
    db,
    series,
    Object.entries(byYear).flatMap(([y, v]) => Array.from({ length: 12 }, (_, m) => ({ date: `${y}-${String(m + 1).padStart(2, "0")}-01`, value: v }))),
  );
}

describe("Lön › Årsinkomst", () => {
  it("lands this year on the payslips paid plus the months left at the average, with ± a standard deviation on each", () => {
    const db = freshDb();
    // January–August paid, 30 000 and 32 000 kr in turn; September not yet.
    for (let m = 1; m <= 8; m++) payslip(db, `2026-${String(m).padStart(2, "0")}-25`, m % 2 ? 3_000_000 : 3_200_000);
    const { current, years } = annualIncome(db, TODAY);
    // √(8 · 1 000² / 7) kr: the sample standard deviation of the eight.
    expect(current.deviation).toBe(106_904);
    expect(current).toMatchObject({
      year: 2026,
      paid: 24_800_000,
      paidMonths: 8,
      forecast: 0,
      remainingMonths: 4,
      average: 3_100_000,
      estimated: 12_400_000,
      expected: 37_200_000,
      low: 37_200_000 - 4 * 106_904,
      high: 37_200_000 + 4 * 106_904,
    });
    expect(years).toEqual([{ year: 2026, amount: 37_200_000, source: "forecast", declared: null, payslips: null, change: null, kpi: null }]);
  });

  it("has a bar per declared year, a gap for a year without, and the change nominal and real by KPI's yearly average", () => {
    const db = freshDb();
    declare(db, 2023, 30_000_000);
    declare(db, 2024, 33_000_000);
    payslip(db, "2026-01-25", 3_000_000);
    kpi(db, { 2023: 12_000, 2024: 12_300 });
    const { years } = annualIncome(db, TODAY);
    expect(years.map((y) => `${y.year} ${y.amount} ${y.source}`)).toEqual(["2023 30000000 declared", "2024 33000000 declared", "2025 null null", "2026 36000000 forecast"]);
    // +10 % nominally; prices rose 2,5 %: 1,10 / 1,025 − 1 ≈ 7,3 % real.
    expect(years[1].change!.nominal).toBeCloseTo(0.1, 10);
    expect(years[1].change!.real).toBeCloseTo(1.1 / 1.025 - 1, 10);
    // No KPI for 2026, and 2025 is missing: no change for it.
    expect(years[3].change).toBeNull();
  });

  it("shows a year's twelve payslips when it has no return, and both when it has", () => {
    const db = freshDb();
    for (let m = 1; m <= 12; m++) payslip(db, `2025-${String(m).padStart(2, "0")}-25`, 3_000_000);
    const before = annualIncome(db, TODAY).years.find((y) => y.year === 2025)!;
    expect(before).toMatchObject({ amount: 36_000_000, source: "payslips", payslips: 36_000_000, declared: null });
    declare(db, 2025, 36_240_000);
    const after = annualIncome(db, TODAY).years.find((y) => y.year === 2025)!;
    expect(after).toMatchObject({ amount: 36_240_000, source: "declared", payslips: 36_000_000, declared: 36_240_000 });
  });

  it("counts a standard deviation of fewer than two as none", () => {
    expect(deviation([])).toBe(0);
    expect(deviation([5])).toBe(0);
    expect(deviation([1, 3])).toBeCloseTo(Math.SQRT2, 10);
  });
});

describe("Pension › Årsbesked beside the declared salary", () => {
  it("gives the PGI the declared salary makes (× 0,93, capped) and the envelope's difference from it", () => {
    const db = freshDb({ seeded: true });
    savePensionStatement(db, { year: 2024, pensionableIncomeOre: 27_900_000, incomePensionRightOre: 4_464_000, premiumPensionRightOre: 697_500 });
    savePensionStatement(db, { year: 2023, pensionableIncomeOre: 26_500_000, incomePensionRightOre: 4_240_000, premiumPensionRightOre: 662_500 });
    declare(db, 2024, 30_010_000);
    const [y2024, y2023] = pensionStatementChecks(db);
    expect(y2024.declared).toEqual({ employmentIncomeOre: 30_010_000, pensionableIncomeOre: 27_909_300, diffOre: -9_300 });
    expect(y2023.declared).toBeNull();
    // Above the ceiling the declared PGI stops at 7,5 income base amounts.
    declare(db, 2023, 90_000_000);
    const capped = pensionStatementChecks(db)[1].declared!;
    expect(capped.pensionableIncomeOre).toBeLessThan(Math.round(90_000_000 * 0.93));
  });
});
