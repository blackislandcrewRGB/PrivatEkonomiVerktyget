import { describe, expect, it } from "vitest";
import type { FuelMonth } from "../../../api";
import { GAUGE_MARK, consumptionTone, fuelFigures, monthList } from "./figures";

const month = (m: Partial<FuelMonth> & { month: string }): FuelMonth => ({
  shifts: null,
  km: null,
  spent: 0,
  trips: 0,
  price: null,
  litres: null,
  receipts: 0,
  litresExact: false,
  priceLater: false,
  orePerKm: null,
  l100: null,
  perShift: null,
  ...m,
});

describe("Bränsle's figures", () => {
  it("the tone against the table value by the figures shown: the same is grey", () => {
    expect(consumptionTone(6.5, 6.5)).toBe("same");
    expect(consumptionTone(6.46, 6.5)).toBe("same");
    expect(consumptionTone(6.44, 6.5)).toBe("under");
    expect(consumptionTone(6.55, 6.5)).toBe("over");
  });

  it("the gauge: the table value's mark at three quarters, the fill the average against it, full at a third over", () => {
    const at = (l100: number) => fuelFigures([month({ month: "2026-06", l100, spent: 1, perShift: 1 })], 6).fill;
    expect(GAUGE_MARK).toBe(0.75);
    expect(at(6)).toBe(0.75);
    expect(at(4.8)).toBeCloseTo(0.6, 10);
    expect(at(8)).toBe(1);
    expect(at(10)).toBe(1);
  });

  it("the months with a trip, named", () => {
    expect(monthList(["2026-07", "2026-08"])).toBe("juli och augusti");
    expect(monthList(["2026-06", "2026-07", "2026-08"])).toBe("juni, juli och augusti");
    expect(monthList(["2025-12", "2026-01"])).toBe("december 2025 och januari 2026");
  });
});
