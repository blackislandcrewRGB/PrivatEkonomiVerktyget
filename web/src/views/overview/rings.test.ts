import { describe, expect, it } from "vitest";
import { arc, ring } from "./rings";

describe("activity rings", () => {
  it("nothing spent: an empty ring at 0 %", () => {
    expect(ring(0, 624_210)).toEqual({ percent: 0, lap: 0, over: 0 });
  });

  it("under the usual: part of a lap (64 %)", () => {
    const r = ring(397_424, 624_210);
    expect(r.percent).toBe(64);
    expect(r.lap).toBeCloseTo(0.6367, 4);
    expect(r.over).toBe(0);
  });

  it("the usual exactly: a full lap and nothing red (100 %)", () => {
    expect(ring(153_222, 153_222)).toEqual({ percent: 100, lap: 1, over: 0 });
  });

  it("over the usual: a full lap and the rest in red from the top (123 %)", () => {
    const r = ring(188_500, 153_222);
    expect(r.percent).toBe(123);
    expect(r.lap).toBe(1);
    expect(r.over).toBeCloseTo(0.2302, 4);
  });

  it("twice the usual or more: two full laps, the percent still told (250 %)", () => {
    expect(ring(250_000, 100_000)).toEqual({ percent: 250, lap: 1, over: 1 });
  });

  it("no usual to go by: no ring and no percent", () => {
    expect(ring(50_000, 0)).toEqual({ percent: null, lap: 0, over: 0 });
    expect(ring(50_000, undefined)).toEqual({ percent: null, lap: 0, over: 0 });
  });

  it("a refund doesn't run the ring backwards", () => {
    expect(ring(-5_000, 100_000)).toEqual({ percent: 0, lap: 0, over: 0 });
  });

  it("the dash for a share of a circle", () => {
    expect(arc(50, 0.5)).toBe(`${(Math.PI * 50).toFixed(2)} ${(Math.PI * 100).toFixed(2)}`);
  });
});
