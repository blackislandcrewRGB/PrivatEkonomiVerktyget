import { describe, expect, it } from "vitest";
import { allocation } from "./allocation";
import { rateLabel } from "./SavedCard";

const zones = (base: number, bet: number) => ({
  base: { zone: "base" as const, valueOre: base, share: base / (base + bet), targetShare: 0.8 },
  bet: { zone: "bet" as const, valueOre: bet, share: bet / (base + bet), targetShare: 0.2 },
});

describe("Sparande", () => {
  it("the allocation bar: base, bet zone and cash add up to everything on the account", () => {
    const a = allocation({ zones: zones(14_000_000, 7_600_000), totalOre: 21_600_000, accounts: [{ account: "isk", securitiesOre: 21_600_000, cashOre: 400_000, cashDate: null, totalOre: 22_000_000 }] });
    expect(a.total).toBe(22_000_000);
    expect(a.segments.map((s) => s.key)).toEqual(["base", "bet", "cash"]);
    expect(a.segments.reduce((s, x) => s + x.ore, 0)).toBe(a.total);
    expect(a.segments.reduce((s, x) => s + x.width, 0)).toBeCloseTo(1, 10);
    // The zones are labelled with their share of the securities, as the policy counts.
    expect(a.segments[1].share).toBeCloseTo(7_600_000 / 21_600_000, 10);
    // The target mark where the base would end at 80 % of the securities.
    expect(a.mark).toBeCloseTo(0.8 * (21_600_000 / 22_000_000), 10);
    expect(a.target).toEqual({ base: 0.8, bet: 0.2 });
  });

  it("without cash: no cash segment, and the mark at the target itself", () => {
    const a = allocation({ zones: zones(8_000_000, 2_000_000), totalOre: 10_000_000, accounts: [{ account: "isk", securitiesOre: 10_000_000, cashOre: null, cashDate: null, totalOre: 10_000_000 }] });
    expect(a.segments.map((s) => s.key)).toEqual(["base", "bet"]);
    expect(a.mark).toBe(0.8);
  });

  it("the savings rate as a pill: up green, down red, nothing grey", () => {
    expect(rateLabel(0.31)).toEqual({ text: "+31 %", tone: "up" });
    expect(rateLabel(-0.229)).toEqual({ text: "−23 %", tone: "down" });
    expect(rateLabel(0)).toEqual({ text: "0 %", tone: "zero" });
    expect(rateLabel(null)).toEqual({ text: "0 %", tone: "zero" });
    expect(rateLabel(0.004)).toEqual({ text: "0 %", tone: "zero" });
  });
});
