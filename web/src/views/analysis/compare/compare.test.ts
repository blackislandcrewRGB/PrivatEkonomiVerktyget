import { describe, expect, it } from "vitest";
import { asKind, bScale, decodePeriod, encodePeriod, fromSearch, monthPeriod, quarterPeriod, relative, resolveB, swap, toSearch, yearPeriod } from "./periods";
import { compareGroups, deltaTone, largestDiffs, type Line } from "./delta";

const line = (key: string, a: number, b: number, parentKey: string | null = null): Line => ({ key, categoryId: Number(key) || null, parentKey, name: key, a, b, diff: a - b, pct: b ? (a - b) / Math.abs(b) : null });

describe("Jämför perioder: the periods", () => {
  it("the period before: the month, the quarter or the year before, across the new year", () => {
    expect(relative(monthPeriod("2026-01"), "fore")).toEqual(monthPeriod("2025-12"));
    expect(relative(quarterPeriod(2026, 1), "fore")).toEqual(quarterPeriod(2025, 4));
    expect(relative(yearPeriod(2026), "fore")).toEqual(yearPeriod(2025));
    // A range: as many days just before.
    expect(relative({ kind: "custom", from: "2026-03-01", to: "2026-03-10" }, "fore")).toEqual({ kind: "custom", from: "2026-02-19", to: "2026-02-28" });
  });

  it("the same a year earlier, over the new year and past 29 February", () => {
    expect(relative(monthPeriod("2026-01"), "ifjol")).toEqual(monthPeriod("2025-01"));
    expect(relative(quarterPeriod(2026, 4), "ifjol")).toEqual(quarterPeriod(2025, 4));
    expect(relative({ kind: "custom", from: "2025-12-20", to: "2026-01-10" }, "ifjol")).toEqual({ kind: "custom", from: "2024-12-20", to: "2025-01-10" });
    expect(relative({ kind: "custom", from: "2024-02-29", to: "2024-03-05" }, "ifjol")).toEqual({ kind: "custom", from: "2023-02-28", to: "2023-03-05" });
    // February in a leap year back to an ordinary one ends on the 28th.
    expect(relative(monthPeriod("2024-02"), "ifjol")).toEqual(monthPeriod("2023-02"));
  });

  it("Snitt 12 mån: the twelve whole months before A, as A's share of them", () => {
    expect(relative(monthPeriod("2026-08"), "snitt12")).toEqual({ kind: "custom", from: "2025-08-01", to: "2026-07-31" });
    expect(relative(quarterPeriod(2026, 1), "snitt12")).toEqual({ kind: "custom", from: "2025-01-01", to: "2025-12-31" });
    expect(bScale(monthPeriod("2026-08"), { relative: "snitt12" })).toBeCloseTo(1 / 12, 10);
    expect(bScale(quarterPeriod(2026, 3), { relative: "snitt12" })).toBeCloseTo(0.25, 10);
    expect(bScale(monthPeriod("2026-08"), { relative: "fore" })).toBe(1);
  });

  it("A's length: the period of that kind that holds A's start", () => {
    expect(asKind(monthPeriod("2026-08"), "quarter")).toEqual(quarterPeriod(2026, 3));
    expect(asKind(monthPeriod("2026-08"), "year")).toEqual(yearPeriod(2026));
    expect(asKind(quarterPeriod(2026, 3), "month")).toEqual(monthPeriod("2026-07"));
  });

  it("⇄ swaps A and B, and not with the average", () => {
    const a = monthPeriod("2026-08");
    expect(swap(a, { relative: "fore" })).toEqual({ a: monthPeriod("2026-07"), b: { period: a } });
    expect(swap(a, { relative: "snitt12" })).toBeNull();
    // Swapped, Δ changes sign.
    const l = line("1", 1_130_800, 345_800);
    const back = line("1", l.b, l.a);
    expect(back.diff).toBe(-l.diff);
    expect(deltaTone(back.diff)).toBe("less");
  });

  it("the address: A and B written and read back; 'fore' left out", () => {
    for (const p of [monthPeriod("2026-08"), quarterPeriod(2026, 3), yearPeriod(2025), { kind: "custom" as const, from: "2026-08-03", to: "2026-09-10" }]) {
      expect(decodePeriod(encodePeriod(p))).toEqual(p);
    }
    const q = toSearch("?flik=jamfor", quarterPeriod(2026, 3), { relative: "ifjol" });
    expect(q).toBe("?flik=jamfor&a=2026-K3&b=ifjol");
    const back = fromSearch(new URLSearchParams(q));
    expect(resolveB(back.a, back.b)).toEqual(quarterPeriod(2025, 3));
    expect(toSearch("?flik=jamfor", monthPeriod("2026-08"), { relative: "fore" })).toBe("?flik=jamfor&a=2026-08");
    // Nothing in the address: the last whole month against the one before.
    expect(fromSearch(new URLSearchParams(""), "2026-09-26")).toEqual({ a: monthPeriod("2026-08"), b: { relative: "fore" } });
  });
});

describe("Jämför perioder: the differences", () => {
  const rows = [line("1", 400_000, 530_000), line("11", 300_000, 400_000, "1"), line("12", 100_000, 130_000, "1"), line("2", 1_130_800, 345_800), line("3", 0, 0), line("4", 525_600, 151_600), line("5", 28_200, 134_000), line("6", 47_400, 47_400)];

  it("the four largest |Δ| among the main categories, largest first", () => {
    expect(largestDiffs(rows).map((l) => l.key)).toEqual(["2", "4", "1", "5"]);
  });

  it("largest difference first or the categories' order; rows with both at 0 left out; the subcategories under theirs", () => {
    expect(compareGroups(rows, "diff").map((g) => g.main.key)).toEqual(["2", "4", "1", "5", "6"]);
    expect(compareGroups(rows, "category").map((g) => g.main.key)).toEqual(["1", "2", "4", "5", "6"]);
    expect(compareGroups(rows, "diff")[2].children.map((c) => c.key)).toEqual(["11", "12"]);
  });

  it("tones: more in A orange, less green, the same grey", () => {
    expect([deltaTone(10_000), deltaTone(-10_000), deltaTone(40)]).toEqual(["more", "less", "even"]);
  });
});
