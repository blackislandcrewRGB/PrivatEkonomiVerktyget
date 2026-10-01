import { describe, expect, it } from "vitest";
import { dayBars } from "./dayBars";

describe("dayBars", () => {
  const out = { "2026-09-01": -10000, "2026-09-11": -40000, "2026-09-25": -20000 };

  it("has a bar per day, scaled to the largest, adding up to Ut", () => {
    const bars = dayBars("2026-09", out, "2026-09-25");
    expect(bars).toHaveLength(30);
    expect(bars[10]).toMatchObject({ date: "2026-09-11", ore: 40000, share: 1 });
    expect(bars[0].share).toBe(0.25);
    expect(bars[1]).toMatchObject({ ore: 0, share: 0 });
    expect(bars.reduce((s, b) => s + b.ore, 0)).toBe(-Object.values(out).reduce((a, b) => a + b, 0));
  });

  it("marks today, and labels the 1st, every fifth day and a last day that isn't crowded", () => {
    const sep = dayBars("2026-09", out, "2026-09-25");
    expect(sep.filter((b) => b.today).map((b) => b.day)).toEqual([25]);
    expect(sep.filter((b) => b.label).map((b) => b.day)).toEqual([1, 6, 11, 16, 21, 26, 30]);
    expect(dayBars("2026-02", {}, "2026-09-25").filter((b) => b.label).map((b) => b.day)).toEqual([1, 6, 11, 16, 21, 26]);
    expect(dayBars("2026-10", {}, "2026-09-25").some((b) => b.today)).toBe(false);
  });

  it("is all stubs for a month without Ut", () => {
    expect(dayBars("2026-08", {}, "2026-09-25").every((b) => b.share === 0)).toBe(true);
  });
});
