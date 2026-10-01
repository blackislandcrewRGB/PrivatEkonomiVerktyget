import { describe, expect, it } from "vitest";
import { fuelGauge } from "./gauge";
import { thresholdBar } from "./threshold";

describe("the fuel gauge", () => {
  it("under: the share bought, and what is left", () => {
    expect(fuelGauge(111_233, 160_000)).toEqual({ state: "under", share: 1112 / 1600, left: 48_800, over: 0 });
  });

  it("exact, in whole kronor", () => {
    expect(fuelGauge(160_040, 160_000)).toEqual({ state: "exact", share: 1, left: 0, over: 0 });
  });

  it("over: full, and the excess", () => {
    expect(fuelGauge(178_900, 160_000)).toEqual({ state: "over", share: 1, left: 0, over: 18_900 });
  });

  it("nothing reckoned: empty, or full once something is bought", () => {
    expect(fuelGauge(0, 0)).toMatchObject({ state: "exact", share: 0 });
    expect(fuelGauge(50_000, 0)).toMatchObject({ state: "over", share: 1, over: 50_000 });
  });
});

describe("the deduction's threshold bar", () => {
  it("past the threshold: grey up to it, green after, the marker between", () => {
    const b = thresholdBar(2_350_000, 1_500_000);
    expect(b.reached).toBe(true);
    expect(b.grey).toBeCloseTo(1_500_000 / 2_350_000);
    expect(b.grey + b.green).toBeCloseTo(1);
    expect(b.marker).toBe(b.grey);
    expect(b.toGo).toBe(0);
  });

  it("under it: all grey, no green, and how much is left", () => {
    expect(thresholdBar(222_000, 1_100_000)).toEqual({ reached: false, grey: 1, green: 0, marker: null, toGo: 878_000 });
  });

  it("at it exactly, or with nothing yet", () => {
    expect(thresholdBar(1_500_000, 1_500_000)).toMatchObject({ reached: false, green: 0, toGo: 0 });
    expect(thresholdBar(0, 1_500_000)).toEqual({ reached: false, grey: 0, green: 0, marker: null, toGo: 1_500_000 });
  });
});
