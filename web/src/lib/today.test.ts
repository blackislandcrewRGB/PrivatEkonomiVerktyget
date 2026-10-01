import { afterEach, describe, expect, it, vi } from "vitest";
import { todayIso } from "./today";

afterEach(() => vi.useRealTimers());

describe("todayIso", () => {
  it("is the local day, also just after midnight when UTC is still on yesterday", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00:30 local time on 1 October: in Sweden, UTC is 22:30 on 30 September.
    vi.setSystemTime(new Date(2026, 9, 1, 0, 30));
    expect(todayIso()).toBe("2026-10-01");
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59));
    expect(todayIso()).toBe("2026-12-31");
  });

  it("takes a given moment", () => {
    expect(todayIso(new Date(2027, 0, 2, 1, 0))).toBe("2027-01-02");
  });
});
