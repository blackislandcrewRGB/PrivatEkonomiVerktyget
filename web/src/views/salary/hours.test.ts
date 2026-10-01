import { describe, expect, it } from "vitest";
import { hoursBar } from "./hours";

describe("the hours bar", () => {
  it("under the working time: part filled, the marker at 140 of 165,6, nothing over", () => {
    const b = hoursBar(120, 140, 165.6);
    expect(b.state).toBe("under");
    expect(b.fill).toBeCloseTo(120 / 165.6);
    expect(b.marker).toBeCloseTo(140 / 165.6);
    expect(b.over).toBe(0);
  });

  it("at the working time is still under: no mertid", () => {
    expect(hoursBar(140, 140, 165.6).state).toBe("under");
  });

  it("between the working time and full time: mertid, past the marker", () => {
    const b = hoursBar(157.5, 140, 165.6);
    expect(b.state).toBe("between");
    expect(b.fill).toBeGreaterThan(b.marker);
    expect(b.fill).toBeLessThan(1);
    expect(hoursBar(165.6, 140, 165.6).state).toBe("between");
  });

  it("over full time: the bar is full and the hours over are given", () => {
    const b = hoursBar(170, 140, 165.6);
    expect(b).toMatchObject({ state: "over", fill: 1, over: 4.4 });
  });
});
