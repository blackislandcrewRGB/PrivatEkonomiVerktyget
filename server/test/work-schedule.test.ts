import { describe, expect, it } from "vitest";
import { scheduleDeadline } from "../src/salary/agreement.js";
import { setSalarySettings } from "../src/salary/salary.js";
import { scheduleDeadlines, setScheduleReceived } from "../src/salary/schedule.js";
import { buildOverview } from "../src/overview/overview.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

describe("the work schedule's deadline (the notice in days from the settings)", () => {
  it("is the month's first day minus 6, across month and year ends and leap years", () => {
    // October has 31 days: November's schedule by 26 October.
    expect(scheduleDeadline("2026-11", 6)).toBe("2026-10-26");
    // November has 30: the 25th.
    expect(scheduleDeadline("2026-12", 6)).toBe("2026-11-25");
    // January's in December, across the year end.
    expect(scheduleDeadline("2027-01", 6)).toBe("2026-12-26");
    expect(scheduleDeadline("2027-02", 6)).toBe("2027-01-26");
    // February: the 23rd, the 24th in a leap year.
    expect(scheduleDeadline("2027-03", 6)).toBe("2027-02-23");
    expect(scheduleDeadline("2028-03", 6)).toBe("2028-02-24");
  });

  it("lists the deadlines in a span, named for the month, with those received ticked off", () => {
    const db = freshDb();
    // No notice set: no deadlines.
    expect(scheduleDeadlines(db, "2026-10-01", "2027-01-31")).toEqual([]);
    setSalarySettings(db, { scheduleNoticeDays: 6 });
    expect(scheduleDeadlines(db, "2026-10-01", "2027-01-31").map((s) => `${s.date} ${s.month}`)).toEqual([
      "2026-10-26 2026-11",
      "2026-11-25 2026-12",
      "2026-12-26 2027-01",
      "2027-01-26 2027-02",
    ]);
    expect(scheduleDeadlines(db, "2026-10-26", "2026-10-26")[0]).toEqual({
      date: "2026-10-26",
      month: "2026-11",
      name: "Schemadeadline: schema för november ska vara mottaget",
      received: false,
    });
    expect(scheduleDeadlines(db, "2026-10-27", "2026-11-24")).toEqual([]);
    setScheduleReceived(db, "2026-11", true);
    expect(scheduleDeadlines(db, "2026-10-01", "2026-11-30").map((s) => s.received)).toEqual([true, false]);
    expect(setScheduleReceived(db, "2026-11", false)).toEqual([]);
    expect(() => setScheduleReceived(db, "2026-13", true)).toThrow();
  });

  it("is a Jobb event in Kommande 14 dagar, and the API ticks it off", async () => {
    const db = freshDb({ seeded: true });
    setSalarySettings(db, { scheduleNoticeDays: 6 });
    const work = () => buildOverview(db, "2026-10-20").timeline.events.filter((e) => e.kind === "work");
    expect(work()).toEqual([
      expect.objectContaining({ date: "2026-10-26", kind: "work", amount: 0, status: "expected", month: "2026-11", name: "Schemadeadline: schema för november ska vara mottaget" }),
    ]);
    const app = createApp(db, { databasePath: ":memory:" });
    const put = (month: string, body: object) => app.request(`/api/salary/schedule/${month}`, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect((await put("2026-11", { received: true })).status).toBe(200);
    expect(work()[0].status).toBe("received");
    expect((await put("2026-11", {})).status).toBe(400);
    const listed = await (await app.request("/api/salary/schedule?from=2026-12-01&to=2026-12-31")).json();
    expect(listed).toEqual([expect.objectContaining({ date: "2026-12-26", month: "2027-01", received: false })]);
    expect((await app.request("/api/salary/schedule?from=2026-12-31&to=2026-12-01")).status).toBe(400);
  });
});
