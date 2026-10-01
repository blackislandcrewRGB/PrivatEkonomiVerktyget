import { describe, expect, it } from "vitest";
import { inflowParts } from "./inflowBar";

describe("what goes to the pension each month", () => {
  it("is three parts that add up to the month's total, in the bar's colours", () => {
    const f = { incomePensionOre: 447_700, premiumPensionOre: 70_000, safLoOre: 135_400, totalOre: 653_100 };
    const parts = inflowParts(f);
    expect(parts.map((p) => [p.key, p.short, p.colour.split(" ")[0]])).toEqual([
      ["income", "Inkomstpension", "bg-ink"],
      ["premium", "Premiepension", "bg-accent"],
      ["saflo", "SAF-LO", "bg-wallet-isk"],
    ]);
    expect(parts.reduce((s, p) => s + p.ore, 0)).toBe(f.totalOre);
  });
});
