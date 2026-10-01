import { describe, expect, it } from "vitest";
import { CIRCUMFERENCE, donutSegments, regionColour } from "./regions";

describe("the region donut", () => {
  it("lays the regions end to end around the circle, together the whole of it", () => {
    const segments = donutSegments([
      { region: "usa", amountOre: 11_000_000, share: 0.55 },
      { region: "global", amountOre: 6_000_000, share: 0.3 },
      { region: "sweden", amountOre: 3_000_000, share: 0.15 },
    ]);
    expect(segments.reduce((s, x) => s + x.length, 0)).toBeCloseTo(CIRCUMFERENCE, 9);
    expect(segments.map((s) => s.offset)).toEqual([-0, -segments[0].length, -(segments[0].length + segments[1].length)]);
    expect(segments.map((s) => s.colour)).toEqual(["var(--v2-caution)", "var(--v2-accent)", "var(--v2-positive)"]);
  });

  it("gives a fourth region its own colour, and one it doesn't know the next spare", () => {
    expect(regionColour("other")).toBe("var(--v2-eating-out)");
    expect(regionColour("japan", ["usa", "japan", "india"])).toBe("var(--v2-yellow)");
    expect(regionColour("india", ["usa", "japan", "india"])).toBe("var(--v2-job)");
  });
});
