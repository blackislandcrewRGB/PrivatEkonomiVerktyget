import { describe, expect, it } from "vitest";
import { importPayslip, deriveConstants, listMonths, modelMonth, salaryForecasts, setMonth } from "../src/salary/salary.js";
import { fetchTaxTable } from "../src/salary/tax.js";
import { listSickDays, setSickDay, sickOf, sickPeriods, SickError } from "../src/salary/sick.js";
import { setShiftDay } from "../src/fuel/fuel.js";
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
    // Without days marked, the count is all there is: the sick hours are in it.
    const other = await withJuly();
    setShiftDay(other, "2026-09-01", true);
    setShiftDay(other, "2026-09-01", false);
    setMonth(other, "2026-09", { hours: 0, hoursMode: "shifts" });
    setSickDay(other, "2026-09-16", 10.5);
    expect(listMonths(other).find((x) => x.month === "2026-09")!.sick.hours).toBe(10.5);
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
    expect((await put("2026-09-22", { hours: 30 })).status).toBe(400);
    expect((await put("2026-09-22", {})).status).toBe(400);
    expect((await app.request("/api/salary/sick/2026-09-21", { method: "DELETE" })).status).toBe(200);
    expect((await (await app.request("/api/salary")).json()).sickDays).toHaveLength(3);
  });
});
