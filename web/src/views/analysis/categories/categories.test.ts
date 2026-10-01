import { describe, expect, it } from "vitest";
import { monthShares, shareRows, topSeries, totalLabel } from "./bars";
import { keyFigures, median, wholeMonths } from "./figures";
import { heat } from "./heat";
import type { CategoryData } from "./types";

const series = [
  { key: "1", categoryId: 1, name: "Mat", color: "#117733" },
  { key: "2", categoryId: 2, name: "Boende", color: "#56B4E9" },
  { key: "3", categoryId: 3, name: "Bil", color: "#E69F00" },
];
type Row = CategoryData["data"][number];
const row = (month: string, mat: number, boende: number, bil: number) => ({ month, "1": mat, "2": boende, "3": bil, total: mat + boende + bil }) as unknown as Row;
/** Three whole months and September so far (to 26/9). */
const DATA: CategoryData = {
  months: ["2026-06", "2026-07", "2026-08", "2026-09"],
  series,
  data: [row("2026-06", 400000, 380000, 100000), row("2026-07", 500000, 380000, 1130800), row("2026-08", 420000, 380000, -20000), row("2026-09", 240000, 370000, 130000)],
  parent: null,
};
const tableTotal = DATA.data.reduce((s, d) => s + d.total, 0);

describe("Per kategori's key figures, from the table's data", () => {
  it("the whole months: all but a last one the period ends inside", () => {
    expect(wholeMonths(DATA.months, "2026-09-26")).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(wholeMonths(DATA.months, "2026-09-30")).toEqual(DATA.months);
  });

  it("Totalt is the table's total; Snitt and median over the whole months; the largest category's share of the total", () => {
    const f = keyFigures(DATA, "2026-09-26");
    expect(f.total).toBe(tableTotal);
    const whole = [880000, 2010800, 780000];
    expect(f.average).toBe(Math.round(whole.reduce((a, b) => a + b) / 3));
    expect(f.median).toBe(880000);
    expect(f).toMatchObject({ whole: 3, partial: "2026-09" });
    // Mat 1 560 000 over the four months, the table's row sum.
    expect(f.largest?.series.name).toBe("Mat");
    expect(f.largest?.sum).toBe(1560000);
    expect(f.largest?.share).toBeCloseTo(1560000 / tableTotal);
    // July, and Bil made most of it.
    expect(f.dearest).toMatchObject({ month: "2026-07", total: 2010800, top: { sum: 1130800 } });
    expect(f.dearest?.top?.series.name).toBe("Bil");
  });

  it("a period ending with its month: every month whole, none left out", () => {
    const f = keyFigures(DATA, "2026-09-30");
    expect(f).toMatchObject({ whole: 4, partial: null });
    expect(median([1, 3, 2, 4])).toBe(3);
  });
});

describe("the bars", () => {
  it("Andelar: each month's shares add up to 100 %, a refund taking no part", () => {
    for (const r of shareRows(DATA)) {
      const sum = series.reduce((a, s) => a + (r as unknown as Record<string, number>)[s.key], 0);
      expect(sum).toBeCloseTo(1);
    }
    // August's Bil is a refund: no share, the rest between Mat and Boende.
    expect(monthShares(DATA.data[2], series)).toEqual({ "1": 420000 / 800000, "2": 380000 / 800000, "3": 0 });
    expect(monthShares(row("x", 0, 0, 0), series)).toEqual({ "1": 0, "2": 0, "3": 0 });
  });

  it("the total over a bar, and the segment on top", () => {
    expect(totalLabel(3210000)).toBe("32,1k");
    expect(totalLabel(85000)).toBe("850");
    expect(totalLabel(0)).toBe("");
    expect(topSeries(DATA.data[0], series)).toBe("3");
    expect(topSeries(DATA.data[2], series)).toBe("2");
  });
});

describe("the table's tones", () => {
  it("under 80 % green, 120–200 % orange, over 200 % red; in between, empty, a refund or no average: none", () => {
    expect(heat(79, 100)).toBe("under");
    expect(heat(80, 100)).toBeNull();
    expect(heat(119, 100)).toBeNull();
    expect(heat(120, 100)).toBe("over");
    expect(heat(200, 100)).toBe("over");
    expect(heat(201, 100)).toBe("far");
    expect(heat(0, 100)).toBeNull();
    expect(heat(-50, 100)).toBeNull();
    expect(heat(50, 0)).toBeNull();
  });
});
