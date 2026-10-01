import { describe, expect, it } from "vitest";
import { salaryBar, segmentLabel } from "./salaryBar";

describe("salaryBar", () => {
  it("adds up to the salary with what is left, in whole kronor", () => {
    const bar = salaryBar({ fixed: 973640, food: 439000, fuel: 155660, salary: 2486520 });
    expect(bar.segments.map((s) => [s.key, s.ore])).toEqual([
      ["fixed", 973600],
      ["food", 439000],
      ["fuel", 155700],
      ["left", 918200],
    ]);
    expect(bar.segments.reduce((s, x) => s + x.ore, 0)).toBe(2486500);
    expect(bar.segments.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    expect(bar.over).toBeNull();
  });

  it("over the salary: nothing left, the width is the sum, and it says by how much", () => {
    const bar = salaryBar({ fixed: 2000000, food: 500000, fuel: 100000, salary: 2500000 });
    expect(bar.segments.map((s) => s.key)).toEqual(["fixed", "food", "fuel"]);
    expect(bar.scale).toBe(2600000);
    expect(bar.over).toBe(100000);
    expect(bar.segments.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  it("without a salary (the household): the parts of the sum, nothing left", () => {
    const bar = salaryBar({ fixed: 1500000, food: 800000, fuel: 0, salary: null });
    expect(bar.segments.map((s) => s.key)).toEqual(["fixed", "food"]);
    expect(bar.scale).toBe(2300000);
    expect(bar.over).toBeNull();
  });
});

describe("segmentLabel", () => {
  it("name and amount, the amount alone, or nothing under about 60 px", () => {
    expect(segmentLabel("Mat", "4 390", 120)).toBe("full");
    expect(segmentLabel("Bränsle", "1 557", 64)).toBe("amount");
    expect(segmentLabel("Bränsle", "1 557", 40)).toBe("none");
  });
});
