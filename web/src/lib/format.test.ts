import { describe, expect, it } from "vitest";
import { formatKr, longDate } from "./format";

describe("formatKr", () => {
  it("uses a real minus sign and thin spaces between thousands", () => {
    expect(formatKr(-123456)).toBe("−1 234,56 kr");
    expect(formatKr(-123456789)).toBe("−1 234 567,89 kr");
  });
  it("adds + to incomes only when asked, and never shows −0", () => {
    expect(formatKr(50000)).toBe("500,00 kr");
    expect(formatKr(50000, { sign: "always" })).toBe("+500,00 kr");
    expect(formatKr(-0)).toBe("0,00 kr");
    expect(formatKr(0, { sign: "always" })).toBe("0,00 kr");
  });
  it("drops ,00 for whole kronor when asked", () => {
    expect(formatKr(-65200, { whole: true })).toBe("−652 kr");
    expect(formatKr(-65250, { whole: true })).toBe("−652,50 kr");
  });
});

describe("longDate", () => {
  it("names the weekday and month, with the year only when it is another year", () => {
    expect(longDate("2026-09-16", 2026)).toBe("Onsdag 16 september");
    expect(longDate("2025-12-31", 2026)).toBe("Onsdag 31 december 2025");
  });
});
