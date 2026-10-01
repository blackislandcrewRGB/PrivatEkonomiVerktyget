import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { transactions } from "../src/db/schema.js";
import { getCategoryPathMap, seed } from "../src/db/seed.js";
import { SCB_KPI } from "../src/prices/scb.js";
import { ensureSeries, putPoints } from "../src/prices/series.js";
import { pricesView } from "../src/prices/compare.js";
import { adjustedAverage, compare, indexBase, indexChange, indexOn, loadYear, type Comparison } from "../src/referenceBudget/compare.js";
import { setHousehold } from "../src/referenceBudget/household.js";
import { REFERENCE_BUDGET_DIR, parseReferenceBudget } from "../src/referenceBudget/load.js";
import { freshDb } from "./helpers.js";

/**
 * KPI-justerad referens. Konsumentverket's figures are already a forecast
 * of the year's price level, so the base is the year's KPI average per group
 * — an average, because a single month would be the season talking: clothes
 * are on sale in July, package holidays peak then. Each month of a window is
 * moved by its group's index against that base.
 */

type Db = ReturnType<typeof freshDb>;

/** Consecutive months from `from`, with these values. */
const months = (from: string, values: number[]) => {
  const out = new Map<string, number>();
  let [y, m] = from.split("-").map(Number);
  for (const v of values) {
    out.set(`${y}-${String(m).padStart(2, "0")}`, v);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
};
/** Twelve months at 100 and then a rise: a year to average and a month after it. */
const flatYear = (from: string, after: number[] = []) => months(from, [...Array(12).fill(10_000), ...after]);

describe("the base", () => {
  it("is the year's average, whole when the year is over", () => {
    const points = months("2026-01", [9_000, 9_000, 9_000, 9_000, 9_000, 9_000, 12_000, 12_000, 12_000, 12_000, 12_000, 12_000, 13_000]);
    expect(indexBase(points, 2026)).toEqual({ value: 10_500, from: "2026-01", to: "2026-12" });
  });

  it("is the latest twelve published months while the year is running", () => {
    const points = months("2025-09", [...Array(11).fill(10_000), 11_200]); // September 2025 – August 2026
    expect(indexBase(points, 2026)).toEqual({ value: 10_100, from: "2025-09", to: "2026-08" });
  });

  it("leaves the seasons out: a July sale is not the year's price level", () => {
    // Clothes: 100 most of the year, 94 in the July sale.
    const clothes = months("2025-08", [10_000, 10_000, 10_000, 10_000, 10_000, 9_400, 10_000, 10_000, 10_000, 10_000, 10_000, 9_400, 10_000]);
    const base = indexBase(clothes, 2026)!;
    expect(base.value).toBe(9_900);
    // August against the year: +1 %, not the +6,4 % July would have said.
    expect(indexChange(clothes, base, "2026-08")).toEqual({ pct: 1, month: "2026-08" });
  });

  it("is a month when the year file names one, and nothing with fewer than twelve months to go on", () => {
    const points = flatYear("2025-09");
    expect(indexBase(points, 2026, "2026-07")).toEqual({ value: 10_000, from: "2026-07", to: "2026-07" });
    expect(indexBase(points, 2026, "2026-10")).toBeNull();
    expect(indexBase(months("2026-01", [10_000, 10_000, 10_000]), 2026)).toBeNull();
    // A hole in the twelve months: no base rather than an average of eleven.
    const gap = flatYear("2025-09");
    gap.delete("2026-02");
    expect(indexBase(gap, 2026)).toBeNull();
  });
});

describe("the index arithmetic", () => {
  const points = months("2026-05", [9_800, 9_900, 10_000, 10_100, 10_200]); // May–September
  const base = { value: 10_000, from: "2026-07", to: "2026-07" };

  it("reads a month's value, or the latest before it", () => {
    expect(indexOn(points, "2026-07")).toEqual({ month: "2026-07", value: 10_000 });
    expect(indexOn(points, "2026-12")).toEqual({ month: "2026-09", value: 10_200 });
    expect(indexOn(points, "2026-04")).toBeNull();
  });

  it("moves the reference month by month from the base, averaged and rounded once", () => {
    // 1 000 kr × (1,00 + 1,01 + 1,02) / 3.
    expect(adjustedAverage(100_000, points, base, { from: "2026-07", to: "2026-09", counted: 3 })).toBe(101_000);
    expect(adjustedAverage(100_000, points, base, { from: "2026-05", to: "2026-07", counted: 3 })).toBe(99_000);
    // A window whose data starts late counts only the months there is data for.
    expect(adjustedAverage(100_000, points, base, { from: "2026-07", to: "2026-09", counted: 1 })).toBe(102_000);
    // Not yet published: the latest published month stands in.
    expect(adjustedAverage(100_000, points, base, { from: "2026-10", to: "2026-10", counted: 1 })).toBe(102_000);
  });

  it("adjusts nothing for a month before the series starts, or an empty window", () => {
    expect(adjustedAverage(100_000, points, base, { from: "2026-03", to: "2026-05", counted: 3 })).toBeNull();
    expect(adjustedAverage(100_000, points, base, { from: "2026-07", to: "2026-09", counted: 0 })).toBeNull();
  });
});

describe("the year file", () => {
  it("gives every item a KPI group that SCB is asked for, and leaves the base to the year's average", () => {
    const year = loadYear(freshDb(), 2026)!;
    expect(year.priceBase).toBeNull();
    const codes = new Set(SCB_KPI.series.map((s) => s.coicop));
    for (const it of year.items) expect(codes.has(it.kpi ?? ""), it.key).toBe(true);
    expect(Object.fromEntries(year.items.map((i) => [i.key, i.kpi]))).toMatchObject({ food_home: "01", clothing: "03", hygiene: "13.1", home_insurance: "12.1", other_media: "09.6" });
  });

  it("refuses a KPI group that isn't fetched, and a malformed price base", () => {
    // The file as it is, changing one thing at a time.
    const file = () => JSON.parse(fs.readFileSync(path.join(REFERENCE_BUDGET_DIR, "2026.json"), "utf8"));
    const unknownGroup = file();
    unknownGroup.items[0].kpi = "07";
    expect(() => parseReferenceBudget(JSON.stringify(unknownGroup), "x.json")).toThrow("food_home: KPI-gruppen 07 hämtas inte från SCB");
    const badBase = file();
    badBase.priceBase = "2026-7";
    expect(() => parseReferenceBudget(JSON.stringify(badBase), "x.json")).toThrow("priceBase ska vara en månad");
  });
});

describe("compare with KPI", () => {
  let seq = 0;
  const setup = () => {
    const db = freshDb();
    seed(db);
    setHousehold(db, { persons: [{ role: "me", ageGroup: "25-50", food: "food_home" }], excluded: [] });
    const cat = getCategoryPathMap(db).get("Prylar & hem/Kläder")!;
    db.insert(transactions).values({ source: "manual", bookingDate: "2026-08-10", descriptionRaw: "x", descriptionClean: "x", amount: -60_000, categoryId: cat, fingerprint: `k${++seq}`, occurrenceIndex: 1 }).run();
    return db;
  };
  const index = (db: Db, key: string, points: Map<string, number>) => {
    const cfg = SCB_KPI.series.find((s) => s.key === key)!;
    const series = ensureSeries(db, { key, name: cfg.name, unit: "index", source: SCB_KPI.table.source, frequency: "monthly" });
    putPoints(db, series, [...points].map(([m, value]) => ({ date: `${m}-01`, value })));
  };
  const item = (c: Comparison, target: string) => c.items.find((i) => i.target === target)!;
  const run = (db: Db, kpi: boolean) => {
    const r = compare(db, "2026-08", "mine", { kpi });
    if (!r.ok) throw new Error(r.reason);
    return r.comparison;
  };

  it("leaves the reference as published when not asked", () => {
    const db = setup();
    index(db, "kpi_clothing", flatYear("2025-08", [10_200]));
    const c = run(db, false);
    expect(item(c, "clothing")).toMatchObject({ referenceOre: 82_000, reference12Ore: 82_000, reference3Ore: 82_000, kpiAdjustment: null });
    expect(c.kpi).toEqual({ on: false, base: { kind: "year", year: 2026 }, adjusted: 0, unadjusted: [], reason: null });
  });

  it("moves each item by its own group against the year's average, and compares against the moved reference", () => {
    const db = setup();
    // Clothes at 100 from August 2025 to June 2026, then 102 in July and August.
    index(db, "kpi_clothing", months("2025-08", [...Array(11).fill(10_000), 10_200, 10_200]));
    const c = run(db, true);
    const clothing = item(c, "clothing");
    // Base: September 2025 – August 2026 = (10 × 100 + 2 × 102) / 12 = 100,333…
    expect(clothing.kpiAdjustment).toEqual({ code: "03", name: "Kläder och skodon", changePct: 1.7, month: "2026-08", base: { from: "2025-09", to: "2026-08" } });
    // Data only in August: 820 kr × 102 / 100,333.
    expect(clothing.reference3Ore).toBe(83_362);
    expect(clothing.diff3).toEqual({ ore: 60_000 - 83_362, pct: -28 });
    // Only clothing has an index here: the rest stay as published, and the view is told which.
    expect(c.kpi.adjusted).toBe(1);
    expect(c.kpi.unadjusted).toContain("Livsmedel");
    expect(c.total.reference3Ore - c.total.referenceOre).toBe(83_362 - 82_000);
  });

  it("adjusts nothing with fewer than twelve months of KPI, and says why", () => {
    const db = setup();
    index(db, "kpi_food_beverages", months("2026-03", [9_900, 9_950, 10_000, 10_050, 10_100, 10_150]));
    const c = run(db, true);
    expect(c.kpi).toMatchObject({ adjusted: 0, reason: "KPI från SCB saknas eller täcker färre än tolv månader, så referensen visas som den är publicerad." });
    expect(item(c, "food").reference3Ore).toBe(273_000);
  });
});

describe("Analys › Priser", () => {
  it("keeps the reference budget's series out of the food groups", () => {
    const db = freshDb();
    const cfg = SCB_KPI.series.find((s) => s.key === "kpi_clothing")!;
    const series = ensureSeries(db, { key: cfg.key, name: cfg.name, unit: "index", source: SCB_KPI.table.source, frequency: "monthly" });
    putPoints(db, series, [{ date: "2026-08-01", value: 10_000 }]);
    const view = pricesView(db, { from: "2025-09-01", to: "2026-09-21", today: "2026-09-21" });
    expect(view.food.subgroups.map((s) => s.key)).not.toContain("kpi_clothing");
  });
});
