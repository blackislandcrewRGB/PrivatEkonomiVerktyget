import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  nearestOccurrence,
  nextOccurrence,
  occurrenceFor,
  occurrenceInMonth,
  suggestSchedule,
  type Schedule,
} from "../src/recurring/schedule.js";
import { lastBankDayOfMonth, nextBankDay, previousBankDay } from "../src/calendar/bankDays.js";

const day = (anchorDay: number, bankDayRule: Schedule["bankDayRule"] = "none"): Schedule => ({ scheduleType: "day_of_month", anchorDay, bankDayRule });
const last = (bankDayRule: Schedule["bankDayRule"] = "none"): Schedule => ({ scheduleType: "last_day", anchorDay: null, bankDayRule });

/** Months Jan 2025 … Aug 2026. */
const months = Array.from({ length: 20 }, (_, i) => {
  const d = new Date(Date.UTC(2025, i, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
});
const eom = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

describe("predicting a draw", () => {
  it("28 February 2026 is a Saturday: moved to Monday 2 March, still February's", () => {
    expect(occurrenceInMonth(day(28, "next"), 2026, 2)).toBe("2026-03-02");
    expect(nearestOccurrence(day(28, "next"), "2026-03-02")).toEqual({ period: "2026-02", date: "2026-03-02", distance: 0 });
    expect(occurrenceInMonth(day(28, "previous"), 2026, 2)).toBe("2026-02-27");
    expect(occurrenceInMonth(day(28), 2026, 2)).toBe("2026-02-28");
  });

  it("day 30 is 28 February; day 31 and 'last day' are always the last day", () => {
    expect(occurrenceInMonth(day(30), 2026, 2)).toBe("2026-02-28");
    expect(occurrenceInMonth(day(30), 2028, 2)).toBe("2028-02-29");
    expect(occurrenceInMonth(day(31), 2026, 4)).toBe("2026-04-30");
    expect(occurrenceInMonth(last(), 2026, 4)).toBe("2026-04-30");
  });

  it("the last bank day of May 2026 is Friday 29 May (31 May is a Sunday)", () => {
    expect(occurrenceInMonth(last("previous"), 2026, 5)).toBe("2026-05-29");
    expect(occurrenceInMonth(last("next"), 2026, 5)).toBe("2026-06-01");
    expect(nearestOccurrence(last("next"), "2026-06-01")?.period).toBe("2026-05");
  });

  it("nextOccurrence finds the first draw on or after a date, including one moved from the month before", () => {
    expect(nextOccurrence(day(28, "next"), "2026-03-01")).toEqual({ period: "2026-02", date: "2026-03-02" });
    expect(nextOccurrence(day(28, "next"), "2026-03-03")).toEqual({ period: "2026-03", date: "2026-03-30" }); // 28 Mar is a Saturday
    expect(nextOccurrence(day(8), "2026-09-18")).toEqual({ period: "2026-10", date: "2026-10-08" });
    expect(nextOccurrence({ scheduleType: "day_of_month", anchorDay: null, bankDayRule: "none" }, "2026-09-18")).toBeNull();
  });
});

describe("the kept draw days", () => {
  it("keep each schedule and month apart: the day, the rule and the kind all count", () => {
    // 28 February 2026 is a Saturday.
    const on = (s: Partial<Schedule>) => occurrenceInMonth({ scheduleType: "day_of_month", anchorDay: 28, bankDayRule: "none", ...s } as Schedule, 2026, 2);
    for (let i = 0; i < 2; i++) {
      expect(on({})).toBe("2026-02-28");
      expect(on({ bankDayRule: "next" })).toBe("2026-03-02");
      expect(on({ bankDayRule: "previous" })).toBe("2026-02-27");
      expect(on({ anchorDay: 27 })).toBe("2026-02-27");
      expect(on({ scheduleType: "last_day", anchorDay: null })).toBe("2026-02-28");
      expect(on({ anchorDay: null })).toBeNull();
    }
  });
});

describe("yearly expenses", () => {
  const tax: Schedule = { scheduleType: "day_of_month", anchorDay: 30, bankDayRule: "none", billingCycle: "yearly", anchorMonth: 6 };

  it("one draw a year, in its month; none without a month", () => {
    expect(occurrenceFor(tax, "2026-06")).toBe("2026-06-30");
    expect(occurrenceFor(tax, "2026-07")).toBeNull();
    expect(nextOccurrence(tax, "2026-09-20")).toEqual({ period: "2027-06", date: "2027-06-30" });
    expect(nextOccurrence(tax, "2026-06-01")).toEqual({ period: "2026-06", date: "2026-06-30" });
    expect(nearestOccurrence(tax, "2026-06-09")).toEqual({ period: "2026-06", date: "2026-06-30", distance: 21 });
    expect(nearestOccurrence(tax, "2026-12-01")).toMatchObject({ period: "2026-06" });
    expect(nearestOccurrence(tax, "2027-01-02")).toMatchObject({ period: "2027-06" });
    const noMonth = { ...tax, anchorMonth: null };
    expect(nextOccurrence(noMonth, "2026-09-20")).toBeNull();
    expect(occurrenceFor(noMonth, "2026-06")).toBeNull();
  });

  it("describes itself with the month", () => {
    expect(describeSchedule(tax)).toBe("varje år 30 juni");
    expect(describeSchedule({ ...tax, anchorDay: null })).toBe("varje år i juni");
    expect(describeSchedule({ ...tax, anchorMonth: null })).toBe("årsvis, ingen månad");
  });
});

describe("suggesting a schedule from history", () => {
  it("a card charge on the same day every month, weekends included", () => {
    const dates = months.map((m) => `${m}-18`);
    expect(suggestSchedule(day(20), dates)).toMatchObject({ scheduleType: "day_of_month", anchorDay: 18, bankDayRule: "none", matches: 20, total: 20, currentMatches: 0 });
  });

  it("an autogiro on the 28th moved to the next bank day", () => {
    const dates = months.map((m) => nextBankDay(`${m}-28`));
    expect(suggestSchedule(day(28), dates)).toMatchObject({ scheduleType: "day_of_month", anchorDay: 28, bankDayRule: "next", matches: 20 });
  });

  it("an autogiro on the last bank day", () => {
    const dates = months.map((m) => previousBankDay(eom(m)));
    expect(dates).toContain(lastBankDayOfMonth("2026-05"));
    expect(suggestSchedule(day(31), dates)).toMatchObject({ scheduleType: "last_day", bankDayRule: "previous", matches: 20 });
  });

  it("the last calendar day, no rule, beats day 31 on a tie", () => {
    const dates = months.map(eom);
    expect(suggestSchedule(day(30), dates)).toMatchObject({ scheduleType: "last_day", bankDayRule: "none", matches: 20 });
  });

  it("explains most of a series with a few odd ones, and says how many", () => {
    const dates = months.map((m) => nextBankDay(`${m}-28`));
    dates[3] = "2025-04-25";
    dates[9] = "2025-10-22";
    expect(suggestSchedule(day(28), dates)).toMatchObject({ anchorDay: 28, bankDayRule: "next", matches: 18, total: 20 });
  });

  it("says nothing when the current schedule fits the three latest charges (the day was just changed)", () => {
    const dates = months.map((m) => (m >= "2026-06" ? `${m}-04` : `${m}-02`));
    expect(suggestSchedule(day(4), dates)).toBeNull();
    expect(suggestSchedule(day(1), dates)).toMatchObject({ anchorDay: 2 });
  });

  it("needs at least four charges", () => {
    expect(suggestSchedule(day(1), ["2026-01-05", "2026-02-05", "2026-03-05"])).toBeNull();
  });
});
