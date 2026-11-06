import { describe, expect, it } from "vitest";
import { backtestInput, importPayslip, deriveConstants, listMonths, listPayslips, modelMonth, salaryForecasts, setMonth } from "../src/salary/salary.js";
import { setSalarySettings } from "../src/salary/salary.js";
import { fetchTaxTable } from "../src/salary/tax.js";
import { listSickDays, setSickDay, sickOf, sickPeriods, SickError } from "../src/salary/sick.js";
import { setShiftDay, setShifts } from "../src/fuel/fuel.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";
import { JULY, pinSalarySettings } from "./payslips.js";

const fakeSkv = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;

async function withJuly() {
  const db = freshDb({ seeded: true });
  pinSalarySettings(db);
  importPayslip(db, "Lonespec_2607.htm", JULY);
  deriveConstants(db);
  await fetchTaxTable(db, 2026, 32, fakeSkv).catch(() => undefined);
  return db;
}

/** Wednesday to Friday, then Monday afternoon (two hours). */
const WEEK = [
  ["2026-09-16", 10.5],
  ["2026-09-17", 10.5],
  ["2026-09-18", 10.5],
  ["2026-09-21", 2],
] as const;

describe("sjukfrånvaro", () => {
  it("a sick day within five days of the last continues the period; a later one starts a new", () => {
    const days = [...WEEK, ["2026-09-29", 10.5] as const].map(([date, hours]) => ({ date, hours }));
    expect(sickPeriods(days).map((p) => [p.from, p.to, p.hours])).toEqual([
      ["2026-09-16", "2026-09-21", 33.5],
      ["2026-09-29", "2026-09-29", 10.5],
    ]);
    // Exactly five days later is still the same period, six is not.
    expect(sickPeriods([{ date: "2026-09-01", hours: 8 }, { date: "2026-09-06", hours: 8 }])).toHaveLength(1);
    expect(sickPeriods([{ date: "2026-09-01", hours: 8 }, { date: "2026-09-07", hours: 8 }])).toHaveLength(2);
  });

  it("saves quarters of an hour up to 24 on a date, replaces a day, and takes it away", async () => {
    const db = freshDb();
    setSickDay(db, "2026-09-16", 10.5);
    setSickDay(db, "2026-09-16", 8);
    expect(listSickDays(db)).toEqual([{ date: "2026-09-16", hours: 8 }]);
    setSickDay(db, "2026-09-16", null);
    expect(listSickDays(db)).toEqual([]);
    for (const bad of [0, -1, 25, 1.1, Number.NaN]) expect(() => setSickDay(db, "2026-09-16", bad)).toThrow(SickError);
    expect(() => setSickDay(db, "16/9", 8)).toThrow("Datum ska vara ÅÅÅÅ-MM-DD.");
  });

  it("the hours are deducted at the hourly salary and paid at 80 %, with one karensavdrag per period (not assumed on a payslip yet)", async () => {
    const db = await withJuly();
    const none = modelMonth(db, "2026-09", { hours: 147 })!;
    for (const [d, h] of WEEK) setSickDay(db, d, h);
    const m = modelMonth(db, "2026-09", { hours: 147 })!;
    const rate = m.thresholds.mertidRate;
    const pay = Math.round(rate * 0.8);
    // An average week (140 × 12 / 52 = 32,31 hours) of sick pay, 20 % of it.
    const karens = Math.round(32.31 * pay * 0.2);
    const line = (code: string) => m.lines.find((l) => l.code === code)!;
    expect(line("sjav")).toMatchObject({ name: "Avdrag sjukfrånvaro", quantity: 33.5, unitPrice: rate, amount: -Math.round(33.5 * rate), unverified: true });
    expect(line("sjlon")).toMatchObject({ name: "Sjuklön 80 %", quantity: 33.5, unitPrice: pay, amount: Math.round(33.5 * pay), unverified: true });
    expect(line("karens")).toMatchObject({ name: "Karensavdrag", quantity: 1, amount: -karens, unverified: true });
    // The rest of the month is as it was: the mertid still comes from the hours, sick ones among them.
    expect(m.gross - none.gross).toBe(-Math.round(33.5 * rate) + Math.round(33.5 * pay) - karens);
    expect(m.lines.find((l) => l.code === "160")).toEqual(none.lines.find((l) => l.code === "160"));
    // A second period in the month: a second karensavdrag.
    setSickDay(db, "2026-09-29", 10.5);
    expect(modelMonth(db, "2026-09", { hours: 147 })!.lines.find((l) => l.code === "karens")).toMatchObject({ quantity: 2 });
    // Without sick days: no lines. Given explicitly, as the backtest does: what is given.
    expect(modelMonth(db, "2026-09", { hours: 147, sick: { hours: 0, karens: 0 } })!.lines.some((l) => ["sjav", "sjlon", "karens"].includes(l.code))).toBe(false);
  });

  it("the karensavdrag is in the month the period starts, not in the one it continues into", async () => {
    const db = await withJuly();
    setSickDay(db, "2026-09-29", 10.5);
    setSickDay(db, "2026-09-30", 10.5);
    setSickDay(db, "2026-10-01", 10.5);
    expect(sickOf(db, "2026-09")).toMatchObject({ hours: 21, karens: 1 });
    expect(sickOf(db, "2026-10")).toMatchObject({ hours: 10.5, karens: 0 });
    expect(modelMonth(db, "2026-10", { hours: 140 })!.lines.some((l) => l.code === "karens")).toBe(false);
    expect(modelMonth(db, "2026-10", { hours: 140 })!.lines.some((l) => l.code === "sjlon")).toBe(true);
  });

  it("the karensavdrag is made from the period's sick pay: never more than it, and what the first days didn't cover from the next", async () => {
    const db = await withJuly();
    const pay = Math.round(modelMonth(db, "2026-09", { hours: 140 })!.thresholds.mertidRate * 0.8);
    const full = Math.round(32.31 * pay * 0.2);
    // A lone part day of two hours: the avdrag takes all its sick pay, no more.
    setSickDay(db, "2026-09-08", 2);
    const lone = modelMonth(db, "2026-09", { hours: 140 })!;
    const line = (m: typeof lone, code: string) => m.lines.find((l) => l.code === code)?.amount ?? 0;
    expect(line(lone, "karens")).toBe(-Math.round(2 * pay));
    expect(line(lone, "sjlon") + line(lone, "karens")).toBe(0);
    // Not a whole avdrag: no count and price that wouldn't add up.
    expect(lone.lines.find((l) => l.code === "karens")).toMatchObject({ quantity: null, unitPrice: null });
    // A period from 30 September (two hours) into October (a whole day): September's sick pay first, the rest from October's.
    setSickDay(db, "2026-09-08", null);
    setSickDay(db, "2026-09-30", 2);
    setSickDay(db, "2026-10-01", 10.5);
    expect(line(modelMonth(db, "2026-09", { hours: 140 })!, "karens")).toBe(-Math.round(2 * pay));
    expect(line(modelMonth(db, "2026-10", { hours: 140 })!, "karens")).toBe(-(full - Math.round(2 * pay)));
  });

  it("a period over three months: the karensavdrag months add up to exactly one avdrag", async () => {
    const db = await withJuly();
    const pay = Math.round(modelMonth(db, "2026-09", { hours: 140 })!.thresholds.mertidRate * 0.8);
    const full = Math.round(32.31 * pay * 0.2);
    // Half-hours, so each month's sick pay rounds on its own: 30/9 0,5 tim, 1/10–3/10 every day 0,5 tim (period continues), …
    setSickDay(db, "2026-09-30", 0.5);
    for (const d of ["01", "05", "10", "15", "20", "25", "30"]) setSickDay(db, `2026-10-${d}`, 0.5);
    setSickDay(db, "2026-11-03", 10.5);
    const karens = (m: string) => modelMonth(db, m, { hours: 140 })!.lines.find((l) => l.code === "karens")?.amount ?? 0;
    expect(karens("2026-09") + karens("2026-10") + karens("2026-11")).toBe(-full);
  });

  it("sick hours are not worked hours for the quarter's overtime, in the other months of the quarter too", async () => {
    const db = await withJuly();
    setSalarySettings(db, { quarterOvertime: true });
    setMonth(db, "2026-07", { hours: 165.6 + 10.5 });
    setMonth(db, "2026-08", { hours: 165.6 });
    setSickDay(db, "2026-07-16", 10.5);
    expect(modelMonth(db, "2026-09", { hours: 165.6 })!.thresholds.quarter).toMatchObject({ hours: 496.8, over: 0 });
  });

  it("sick hours are not worked hours for the quarter's overtime", async () => {
    const db = await withJuly();
    setSalarySettings(db, { quarterOvertime: true });
    // July and August at full time, September at full time worked plus a sick day on top of the schedule.
    setMonth(db, "2026-07", { hours: 165.6 });
    setMonth(db, "2026-08", { hours: 165.6 });
    setSickDay(db, "2026-09-16", 10.5);
    const sep = modelMonth(db, "2026-09", { hours: 165.6 + 10.5 })!;
    expect(sep.thresholds.quarter).toMatchObject({ hours: 496.8, over: 0 });
    expect(sep.lines.some((l) => l.name === "Övertidstill. (kvartal)")).toBe(false);
  });

  it("the backtest adds the sick hours entered to the payslip's hours worked", async () => {
    const db = await withJuly();
    const slip = listPayslips(db).find((p) => p.workMonth)!;
    const before = backtestInput(db, slip);
    setSickDay(db, `${slip.workMonth}-10`, 10.5);
    const after = backtestInput(db, slip);
    expect(after.hours).toBe(before.hours + 10.5);
  });

  it("from Pendling's shifts: sick days left unmarked there are added to the shifts' hours, marked ones are in them already", async () => {
    const db = await withJuly();
    // Eleven worked days marked, Monday the 21st among them (worked 8,5 of 10,5).
    for (const d of ["01", "02", "05", "06", "07", "21", "22", "23", "28", "29", "30"]) setShiftDay(db, `2026-09-${d}`, true);
    setMonth(db, "2026-09", { hours: 0, hoursMode: "shifts" });
    for (const [d, h] of WEEK) setSickDay(db, d, h);
    const m = listMonths(db).find((x) => x.month === "2026-09")!;
    // 11 × 10,5 = 115,5, plus the three whole days off (31,5): 147. The 2 hours on the marked Monday are in the 10,5.
    expect(m.effectiveHours).toBe(147);
    expect(m.sick).toMatchObject({ hours: 33.5, karens: 1 });
  });

  it("from a count of shifts without days marked (the days driven): a whole sick day is added, a part day is in its shift", async () => {
    const db = await withJuly();
    setShifts(db, "2026-09", 14);
    setMonth(db, "2026-09", { hours: 0, hoursMode: "shifts" });
    // A whole day off sick: no commute, so not among the 14. Two hours off a day driven: in that shift.
    setSickDay(db, "2026-09-16", 10.5);
    setSickDay(db, "2026-09-21", 2);
    const m = listMonths(db).find((x) => x.month === "2026-09")!;
    expect(m.effectiveHours).toBe(14 * 10.5 + 10.5);
    expect(m.sick.hours).toBe(12.5);
  });

  it("the forecast includes it, and the API sets, lists and takes away days with their periods", async () => {
    const db = await withJuly();
    setMonth(db, "2026-09", { hours: 147 });
    const before = salaryForecasts(db).get("2026-10")!.net;
    const app = createApp(db, { databasePath: ":memory:" });
    const put = (date: string, body: unknown) => app.request(`/api/salary/sick/${date}`, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    for (const [d, h] of WEEK) expect((await put(d, { hours: h })).status).toBe(200);
    const listed = await (await app.request("/api/salary")).json();
    expect(listed.sickDays).toHaveLength(4);
    expect(listed.sickPeriods).toMatchObject([{ from: "2026-09-16", to: "2026-09-21", hours: 33.5 }]);
    expect(salaryForecasts(db).get("2026-10")!.net).toBeLessThan(before);
    // The months listed have the sick lines in their forecast.
    const months = (await (await app.request("/api/salary/months")).json()) as { month: string; forecast: { lines: { code: string }[] } }[];
    expect(months.find((m) => m.month === "2026-09")!.forecast.lines.map((l) => l.code)).toEqual(expect.arrayContaining(["sjav", "sjlon", "karens"]));
    // The forecast being typed takes the sick leave from what is entered, never from the request.
    const typed = await (await app.request("/api/salary/model", { method: "POST", body: JSON.stringify({ month: "2026-08", hours: 140, sick: { hours: 10, karens: 2 } }), headers: { "Content-Type": "application/json" } })).json();
    expect(typed.lines.some((l: { code: string }) => ["sjav", "sjlon", "karens"].includes(l.code))).toBe(false);
    expect((await put("2026-09-22", { hours: 30 })).status).toBe(400);
    expect((await put("2026-09-22", {})).status).toBe(400);
    expect((await app.request("/api/salary/sick/2026-09-21", { method: "DELETE" })).status).toBe(200);
    expect((await (await app.request("/api/salary")).json()).sickDays).toHaveLength(3);
  });
});
