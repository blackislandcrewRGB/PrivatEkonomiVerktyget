import { describe, expect, it } from "vitest";
import { fixedFigures, fixedShareTone, incomeBar, monthSpread, type FixedData, type FixedMonth } from "./figures";
import { netLabel, netTone } from "./FixedBars";

const month = (m: string, fixed: number, variable: number, income: number): FixedMonth => ({
  month: m,
  fixed,
  variable,
  income,
  net: income - fixed - variable,
  fixedShareOfIncome: income > 0 ? fixed / income : null,
});
const total = (months: FixedMonth[]) => {
  const [fixed, variable, income] = (["fixed", "variable", "income"] as const).map((k) => months.reduce((s, m) => s + m[k], 0));
  return { fixed, variable, income, net: income - fixed - variable, fixedShareOfIncome: income > 0 ? fixed / income : null };
};

describe("Fasta mot rörliga's figures", () => {
  it("the income bar: fixed, variable and net add up to the income", () => {
    const { segments, over } = incomeBar({ fixed: 1_000_000, variable: 1_500_000, income: 3_500_000, net: 1_000_000, fixedShareOfIncome: 1 / 3.5 });
    expect(over).toBe(0);
    expect(segments.map((s) => s.key)).toEqual(["fixed", "variable", "net"]);
    expect(segments.reduce((s, x) => s + x.ore, 0)).toBe(3_500_000);
    expect(segments.reduce((s, x) => s + x.width, 0)).toBeCloseTo(1, 10);
    expect(segments.map((s) => s.ofIncome)).toEqual([1_000_000 / 3_500_000, 1_500_000 / 3_500_000, 1_000_000 / 3_500_000]);
  });

  it("more out than in: no net, the bar is the spending, and by how much", () => {
    const { segments, over } = incomeBar({ fixed: 1_000_000, variable: 2_000_000, income: 2_500_000, net: -500_000, fixedShareOfIncome: 0.4 });
    expect(over).toBe(500_000);
    expect(segments.map((s) => s.key)).toEqual(["fixed", "variable"]);
    expect(segments.map((s) => s.width)).toEqual([1 / 3, 2 / 3]);
  });

  it("the averages and ranges are over the whole months, the month so far left out", () => {
    const months = [month("2026-06", 800_000, 1_000_000, 2_500_000), month("2026-07", 600_000, 2_600_000, 3_000_000), month("2026-08", 1_000_000, 500_000, 2_600_000), month("2026-09", 100_000, 50_000, 2_700_000)];
    const data: FixedData = { months, total: total(months) };
    const f = fixedFigures(data, "2026-09-26");
    expect(f.wholeMonths).toBe(3);
    expect(f.fixed).toEqual({ average: 800_000, min: { month: "2026-07", value: 600_000 }, max: { month: "2026-08", value: 1_000_000 } });
    expect(f.variable.average).toBeCloseTo(1_366_666.67, 1);
    expect(f.net.min).toEqual({ month: "2026-07", value: -200_000 });
    expect(f.positive).toBe(2);
    expect(f.share.min).toEqual({ month: "2026-07", value: 0.2 });
    expect(f.share.max!.month).toBe("2026-08");
    // Once September is over it counts.
    expect(fixedFigures(data, "2026-09-30").wholeMonths).toBe(4);
  });

  it("the net pill: '+9k' green, '−7k' red, whole kronor under 1 000", () => {
    expect([netLabel(872_700), netLabel(-749_600), netLabel(45_000), netLabel(0)]).toEqual(["+9k", "−7k", "+450", "±0"]);
    expect([netTone(872_700), netTone(-749_600), netTone(40)]).toEqual(["positive", "negative", "zero"]);
  });

  it("the fixed share's tones by the figure shown: under 25 % green, 25–40 % grey, over 40 % orange", () => {
    expect([0.2494, 0.2496, 0.25, 0.4, 0.40049, 0.4006].map(fixedShareTone)).toEqual(["low", "normal", "normal", "normal", "normal", "high"]);
  });

  it("a month's spread: the three make up the income; a month that went back has its deficit red", () => {
    expect(monthSpread(month("2026-08", 700_000, 700_000, 2_000_000))).toEqual({ fixed: 0.35, variable: 0.35, net: 0.3, back: false });
    const back = monthSpread(month("2025-11", 685_200, 2_523_500, 2_459_100));
    expect(back.back).toBe(true);
    expect(back.fixed + back.variable + back.net).toBeCloseTo(1, 10);
    expect(back.net).toBeCloseTo(749_600 / (685_200 + 2_523_500 + 749_600), 10);
  });
});
