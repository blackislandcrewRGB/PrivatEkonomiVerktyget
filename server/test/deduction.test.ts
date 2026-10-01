import { describe, expect, it } from "vitest";
import { deductionYears, getDeductionSettings, setDeductionSettings, thresholdFor } from "../src/fuel/deduction.js";
import { setFuelSettings, setShiftDay, setShifts } from "../src/fuel/fuel.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";
import { saveTaxReturn } from "../src/taxReturns/taxReturns.js";

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("Reseavdrag", () => {
  it("per income year: shifts × 4,0 mil × 25 kr/mil less the year's threshold, and the tax it saves at the marginal tax", () => {
    const db = freshDb({ seeded: true });
    for (const [m, n] of [["2026-01", 16], ["2026-02", 19], ["2026-03", 20], ["2026-04", 21], ["2026-05", 20], ["2026-06", 21], ["2026-07", 22], ["2026-08", 13], ["2026-09", 20]] as const) setShifts(db, m, n);
    setShifts(db, "2025-12", 12);
    const d = deductionYears(db, "2026-09-19");
    expect(d.oneWayKm).toBe(20);
    const [y2026, y2025] = d.years;
    expect(y2026).toMatchObject({ year: "2026", shifts: 172, milPerShift: 4, gross: 1720000, threshold: 1500000, deductible: 220000, taxEffect: 70400, shiftsToThreshold: 150 });
    expect(y2026.months).toHaveLength(9);
    // 2025: 12 shifts = 1 200 kr, under the 11 000 kr threshold.
    expect(y2025).toMatchObject({ year: "2025", shifts: 12, gross: 120000, threshold: 1100000, deductible: 0, taxEffect: 0, shiftsToThreshold: 110 });
  });

  it("the days marked are listed with their month; the distance follows Inställningar › Bil", () => {
    const db = freshDb({ seeded: true });
    setShiftDay(db, "2026-09-02", true);
    setShiftDay(db, "2026-09-03", true);
    setFuelSettings(db, { kmPerShift: 60 });
    const [y] = deductionYears(db, "2026-09-19").years;
    expect(y.months).toEqual([{ month: "2026-09", shifts: 2, days: ["2026-09-02", "2026-09-03"] }]);
    expect(y.gross).toBe(2 * 6 * 2500);
  });

  it("a year without a threshold of its own uses the latest earlier one", () => {
    const s = getDeductionSettings(freshDb());
    expect(thresholdFor(s, "2027")).toEqual({ amount: 1500000, from: "2026" });
    expect(thresholdFor(s, "2024")).toEqual({ amount: 1100000, from: "2025" });
  });

  it("the settings: rate, marginal tax and thresholds, checked", async () => {
    const db = freshDb({ seeded: true });
    setDeductionSettings(db, { marginalTax: 0.5, thresholds: { "2027": 1600000 } });
    expect(getDeductionSettings(db)).toEqual({ ratePerMil: 2500, marginalTax: 0.5, thresholds: { "2025": 1100000, "2026": 1500000, "2027": 1600000 } });
    const app = createApp(db, { databasePath: ":memory:" });
    expect((await app.request("/api/fuel/deduction/settings", json("PUT", { marginalTax: 1.2 }))).status).toBe(400);
    expect((await app.request("/api/fuel/deduction/settings", json("PUT", { thresholds: { "20x6": 1 } }))).status).toBe(400);
    expect(await (await app.request("/api/fuel/deduction/settings", json("PUT", { ratePerMil: 2200 }))).json()).toMatchObject({ ratePerMil: 2200 });
    expect((await (await app.request("/api/fuel/deduction?today=2026-09-19")).json()).years[0]).toMatchObject({ year: "2026", shifts: 0, deductible: 0 });
  });
});

describe("Reseavdrag against the tax return", () => {
  const nine = [["2026-01", 16], ["2026-02", 19], ["2026-03", 20], ["2026-04", 21], ["2026-05", 20], ["2026-06", 21], ["2026-07", 22], ["2026-08", 13], ["2026-09", 20]] as const;

  it("lists 2.1 per declared year, and backtests last year: the model on its shifts against what was declared", () => {
    const db = freshDb({ seeded: true });
    saveTaxReturn(db, 2024, { boxes: { commuteDeduction: 2_000_000 } }, "2026-09-19");
    // 2025: 116 shifts over its twelve months = 11 600 kr, 600 kr over the 11 000 kr threshold.
    for (let m = 1; m <= 12; m++) setShifts(db, `2025-${String(m).padStart(2, "0")}`, m <= 10 ? 10 : 8);
    let d = deductionYears(db, "2026-09-19");
    expect(d.declared).toEqual([{ year: "2024", amount: 2_000_000 }]);
    expect(d.backtest).toEqual({ year: "2025", declared: null, computed: 60_000, shifts: 116, months: 12, diff: null });

    saveTaxReturn(db, 2025, { boxes: { commuteDeduction: 65_000 } }, "2026-09-19");
    d = deductionYears(db, "2026-09-19");
    expect(d.backtest).toEqual({ year: "2025", declared: 65_000, computed: 60_000, shifts: 116, months: 12, diff: -5_000 });
  });

  it("has nothing to compute when last year's shifts are missing", () => {
    const db = freshDb({ seeded: true });
    saveTaxReturn(db, 2025, { boxes: { commuteDeduction: 65_000 } }, "2026-09-19");
    expect(deductionYears(db, "2026-09-19").backtest).toEqual({ year: "2025", declared: 65_000, computed: null, shifts: 0, months: 0, diff: null });
  });

  it("forecasts this year: the shifts filled in, and the months after this one at the whole months' average", () => {
    const db = freshDb({ seeded: true });
    for (const [m, n] of nine) setShifts(db, m, n);
    const f = deductionYears(db, "2026-09-19").forecast!;
    // January–August: 152 shifts, 19 a month; October–December 3 × 19 more: 229 shifts = 22 900 kr, 7 900 kr over the threshold.
    expect(f).toEqual({ year: "2026", declareYear: "2027", shifts: 229, perMonth: 19, monthsEstimated: 3, gross: 2_290_000, deductible: 790_000, taxEffect: 252_800 });
    // A month filled in ahead counts as filled.
    setShifts(db, "2026-10", 16);
    expect(deductionYears(db, "2026-09-19").forecast).toMatchObject({ shifts: 172 + 16 + 38, monthsEstimated: 2 });
  });

  it("has no forecast before a whole month of the year has shifts", () => {
    const db = freshDb({ seeded: true });
    setShifts(db, "2026-01", 3);
    expect(deductionYears(db, "2026-01-19").forecast).toBeNull();
  });
});
