import { describe, expect, it } from "vitest";
import { firstMissing, lastPaid, nextPayMonth, pickerMonths } from "./payMonths";

const got = { bookingDate: "2026-09-24", amount: 1 };
const m = (month: string, paid = false) => ({ month, actual: paid ? got : null });

describe("which month the next salary is for", () => {
  it("up to the pay day, last month's work; after it, this month's", () => {
    expect(nextPayMonth([], "2026-09-19", 1, 25)).toBe("2026-08");
    expect(nextPayMonth([], "2026-09-25", 1, 25)).toBe("2026-08");
    expect(nextPayMonth([], "2026-09-26", 1, 25)).toBe("2026-09");
  });

  it("once that salary is in (a day early at a weekend), the month after", () => {
    expect(nextPayMonth([m("2026-08", true)], "2026-09-24", 1, 25)).toBe("2026-09");
    expect(nextPayMonth([m("2026-08", true), m("2026-09", true)], "2026-09-24", 1, 25)).toBe("2026-10");
  });

  it("paid the same month: this month's work up to the pay day", () => {
    expect(nextPayMonth([], "2026-09-19", 0, 25)).toBe("2026-09");
    expect(nextPayMonth([], "2026-12-28", 0, 25)).toBe("2027-01");
  });

  it("the latest month in", () => {
    expect(lastPaid([m("2026-09"), m("2026-07", true), m("2026-08", true)])?.month).toBe("2026-08");
    expect(lastPaid([m("2026-09")])).toBeNull();
  });
});

describe("the month the form starts on", () => {
  it("the month after the last one entered", () => {
    expect(firstMissing(["2026-07", "2026-08", "2026-09"], "2026-08")).toBe("2026-10");
  });

  it("a gap first", () => {
    expect(firstMissing(["2026-09", "2026-07"], "2026-08")).toBe("2026-08");
    expect(firstMissing(["2026-11", "2026-12"], "2026-08")).toBe("2027-01");
  });

  it("none entered: the month the next salary is for", () => {
    expect(firstMissing([], "2026-08")).toBe("2026-08");
  });

  it("the picker: a year back to three ahead, newest first, with any entered or chosen outside it", () => {
    const list = pickerMonths("2026-09-25", ["2024-05"], "2027-06");
    expect(list[0]).toBe("2027-06");
    expect(list).toContain("2026-12");
    expect(list).toContain("2025-09");
    expect(list).not.toContain("2025-08");
    expect(list.at(-1)).toBe("2024-05");
  });
});
