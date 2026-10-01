import { describe, expect, it } from "vitest";
import type { FuelMonth, FuelOverview } from "../../api";
import { monthEstimate, shownMonths, yearAverage } from "./months";

const month = (m: string, over: Partial<FuelMonth> = {}): FuelMonth => ({
  month: m,
  shifts: 15,
  km: 800,
  spent: 150_000,
  trips: 0,
  price: { id: 1, date: `${m}-15`, price: 2000 },
  litres: null,
  receipts: 0,
  litresExact: false,
  priceLater: false,
  orePerKm: null,
  l100: 6,
  perShift: null,
  ...over,
});
const months = [
  ...["2026-12", "2026-11", "2026-10"].map((m) => month(m, { shifts: null, km: null, spent: 0, price: null })),
  month("2026-09", { shifts: 14, km: 760, spent: 106_448 }),
  ...Array.from({ length: 13 }, (_, i) => {
    const d = new Date(2026, 7 - i, 1);
    return month(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { spent: 100_000 + i * 1000, shifts: i === 12 ? null : 15 });
  }),
];
const DATA = {
  today: "2026-09-25",
  settings: { kmPerShift: 40, otherKmPerMonth: 200, baseConsumption: 6.5, congestionPerShift: 0, useCalibrated: true, categoryId: null, fuelCategoryId: 1 },
  latestPrice: { id: 1, date: "2026-09-19", price: 1949, ageDays: 6 },
  current: { month: "2026-09", shifts: 14, km: 760, consumption: 5.4, consumptionSource: "calibrated", price: { price: 1935, date: "2026-09-14", source: "national", why: "" }, expectedFuel: 130_000, expectedCongestion: 0, spent: 106_448, remaining: 23_552, perShift: 8985 },
  months,
  calibration: null,
} as unknown as FuelOverview;

describe("the months the chart and the table show", () => {
  it("a year back to this month, oldest first; the months ahead apart", () => {
    const s = shownMonths(DATA);
    expect(s.past.map((m) => m.month)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(s.ahead.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(s.points.at(-1)).toMatchObject({ month: "2026-09", current: true });
  });

  it("each bar is the table's reckoned and bought", () => {
    const s = shownMonths(DATA);
    for (const [i, p] of s.points.entries()) {
      expect(p.estimate).toBe(monthEstimate(s.past[i], DATA));
      expect(p.spent).toBe(s.past[i].spent);
    }
    // This month: the forecast; before: km × consumption × the month's price.
    expect(s.points.at(-1)!.estimate).toBe(130_000);
    expect(monthEstimate(month("2026-08"), DATA)).toBeCloseTo((800 * 5.4 * 2000) / 100);
  });
});

describe("'Snitt 12 mån'", () => {
  it("over the finished months with shifts, at most 12", () => {
    const a = yearAverage(DATA)!;
    // Aug 2026 back to Sep 2025: 12 months; Aug 2025 has no shifts and isn't counted.
    expect(a.months).toBe(12);
    expect(a.spent).toBe((100_000 * 12 + 1000 * (0 + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11)) / 12);
    expect(a.estimate).toBeCloseTo((800 * 5.4 * 2000) / 100);
    expect(yearAverage({ ...DATA, months: [month("2026-09")] })).toBeNull();
  });
});
