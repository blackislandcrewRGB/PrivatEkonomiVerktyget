import { describe, expect, it } from "vitest";
import { barWidths, sortCategories } from "./sort";
import type { AverageCategory } from "./types";

const c = (key: string, name: string, perMonth: number | null, total: number, parentKey: string | null = null): AverageCategory => ({
  key,
  categoryId: Number(key),
  parentKey,
  name,
  color: "#000000",
  total,
  perWeek: null,
  perMonth,
});

const ROWS = [
  c("1", "Mat", 400_000, 5_000_000),
  c("11", "Livsmedel", 300_000, 3_600_000, "1"),
  c("12", "Alkohol", 100_000, 1_400_000, "1"),
  c("2", "Övrigt", 400_000, 4_900_000),
  c("3", "Bil", 200_000, 2_500_000),
];

describe("Snitt's categories", () => {
  it("largest first by the average per month, then by name; subcategories in the same order under their main one", () => {
    expect(sortCategories(ROWS, "largest", 12).map((g) => [g.main.name, g.children.map((x) => x.name)])).toEqual([
      ["Mat", ["Livsmedel", "Alkohol"]],
      ["Övrigt", []],
      ["Bil", []],
    ]);
  });

  it("A–Ö in Swedish order (Ö last)", () => {
    expect(sortCategories(ROWS, "az", 12).map((g) => [g.main.name, g.children.map((x) => x.name)])).toEqual([
      ["Bil", []],
      ["Mat", ["Alkohol", "Livsmedel"]],
      ["Övrigt", []],
    ]);
  });

  it("without a whole month, by the sum", () => {
    const rows = ROWS.map((r) => ({ ...r, perMonth: null }));
    expect(sortCategories(rows, "largest", 0).map((g) => g.main.name)).toEqual(["Mat", "Övrigt", "Bil"]);
    expect(barWidths(sortCategories(rows, "largest", 0), 0).get("2")).toBeCloseTo(4_900_000 / 5_000_000, 10);
  });

  it("bars: a main category against the largest, a subcategory against its main one, a refund as nothing", () => {
    const w = barWidths(sortCategories([...ROWS, c("4", "Resor", -5_000, -60_000)], "largest", 12), 12);
    expect(Object.fromEntries(w)).toEqual({ "1": 1, "11": 0.75, "12": 0.25, "2": 1, "3": 0.5, "4": 0 });
  });
});
