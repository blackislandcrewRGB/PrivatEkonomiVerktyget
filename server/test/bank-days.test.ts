import { describe, expect, it } from "vitest";
import { easterSunday, isBankDay, lastBankDayOfMonth, nextBankDay, previousBankDay, swedishBankHolidays } from "../src/calendar/bankDays.js";

describe("Swedish bank holidays", () => {
  it("computes Easter for any year", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2038)).toBe("2038-04-25"); // the latest possible
    expect(easterSunday(2285)).toBe("2285-03-22"); // the earliest possible
  });

  it("lists the bank holidays 2025–2027", () => {
    expect([...swedishBankHolidays(2025).keys()]).toEqual([
      "2025-01-01", "2025-01-06", "2025-04-18", "2025-04-21", "2025-05-01", "2025-05-29",
      "2025-06-06", "2025-06-20", "2025-12-24", "2025-12-25", "2025-12-26", "2025-12-31",
    ]);
    expect([...swedishBankHolidays(2026).keys()]).toEqual([
      "2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14",
      "2026-06-06", "2026-06-19", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31",
    ]);
    expect([...swedishBankHolidays(2027).keys()]).toEqual([
      "2027-01-01", "2027-01-06", "2027-03-26", "2027-03-29", "2027-05-01", "2027-05-06",
      "2027-06-06", "2027-06-25", "2027-12-24", "2027-12-25", "2027-12-26", "2027-12-31",
    ]);
    expect(swedishBankHolidays(2026).get("2026-06-19")).toBe("Midsommarafton");
  });

  it("knows weekends and holidays are not bank days", () => {
    expect(isBankDay("2026-09-18")).toBe(true); // Friday
    expect(isBankDay("2026-09-19")).toBe(false); // Saturday
    expect(isBankDay("2026-04-03")).toBe(false); // Långfredagen
    expect(isBankDay("2026-12-31")).toBe(false); // Nyårsafton, a Thursday
  });

  it("moves to the next or previous bank day", () => {
    expect(nextBankDay("2026-02-28")).toBe("2026-03-02"); // Saturday -> Monday
    expect(nextBankDay("2026-04-03")).toBe("2026-04-07"); // Långfredagen -> after annandag påsk
    expect(previousBankDay("2026-04-06")).toBe("2026-04-02");
    expect(nextBankDay("2026-12-24")).toBe("2026-12-28");
    expect(nextBankDay("2026-09-18")).toBe("2026-09-18");
  });

  it("finds the last bank day of a month", () => {
    expect(lastBankDayOfMonth("2026-05")).toBe("2026-05-29"); // 31 May is a Sunday
    expect(lastBankDayOfMonth("2026-09")).toBe("2026-09-30");
    expect(lastBankDayOfMonth("2026-10")).toBe("2026-10-30"); // 31 Oct is a Saturday
    expect(lastBankDayOfMonth("2026-12")).toBe("2026-12-30"); // nyårsafton
  });
});
