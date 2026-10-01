import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringIncome, transactions } from "../src/db/schema.js";
import { linkRecurring } from "../src/recurring/link.js";
import { buildOverview, nextPayday } from "../src/overview/overview.js";
import { cashflow } from "../src/cashflow/cashflow.js";
import { deriveConstants, importPayslip, listMonths, notePendingChanges, salaryForecasts, setMonth, setSalarySettings, storePayslip, weekOvertime } from "../src/salary/salary.js";
import { parsePayslip } from "../src/salary/hogia.js";
import { fetchTaxTable } from "../src/salary/tax.js";
import { setShiftDay, setShifts } from "../src/fuel/fuel.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";
import { EXAMPLE_AGREEMENT, JULY, pinSalarySettings } from "./payslips.js";

const LIMITS = { shiftLimit: EXAMPLE_AGREEMENT.shiftLimit, weekLimit: EXAMPLE_AGREEMENT.weekLimit };
const fakeSkv = async (url: string) => {
  const q = new URL(url).searchParams;
  const rows: [number, number, number][] = [
    [24701, 24800, 4464],
    [27801, 27900, 5017],
    [27901, 28000, 5039],
  ];
  const results = q.get("_offset") === "0" ? rows.map(([f, t, tax]) => ({ "antal dgr": "30B", "inkomst fr.o.m.": String(f), "inkomst t.o.m.": String(t), "kolumn 1": String(tax) })) : [];
  return { ok: true, json: async () => ({ results }) };
};

/** The July payslip read, the table fetched, the salary as a recurring income (estimate 22 500 kr on the 24th). */
async function setup() {
  const db = freshDb({ seeded: true });
  pinSalarySettings(db);
  importPayslip(db, "Lonespec_2607.htm", JULY);
  deriveConstants(db);
  await fetchTaxTable(db, 2026, 32, fakeSkv);
  const espar = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id;
  db.insert(recurringIncome).values({ name: "Lön", amount: 2250000, dayOfMonth: 24, accountId: espar, matchPattern: "LÖN" }).run();
  return { db, espar };
}

describe("Löneprognos in the rest of the tool", () => {
  it("next payday: the forecast's net and pay day replace the estimate", async () => {
    const { db } = await setup();
    expect(nextPayday(db, "2026-09-19")).toMatchObject({ date: "2026-09-24", expected: 2250000, expectedSource: "estimate", forecast: null });
    setMonth(db, "2026-08", { hours: 157.5 });
    const p = nextPayday(db, "2026-09-19")!;
    expect(p).toMatchObject({ date: "2026-09-25", month: "2026-09", expected: 2288295, expectedSource: "forecast", forecast: { workMonth: "2026-08", hours: 157.5 } });
    // The timeline shows the same.
    const o = buildOverview(db, "2026-09-19");
    expect(o.timeline.events.find((e: { kind: string }) => e.kind === "income")).toMatchObject({ date: "2026-09-25", amount: 2288295 });
  });

  it("Kassaflöde: the vacation left at 31 March lands with the April salary, also with no hours entered for March", async () => {
    const { db } = await setup();
    // A September payslip's balance: 81,70 hours left.
    storePayslip(db, "sep.htm", { ...parsePayslip(JULY), payDate: "2026-09-25", workMonth: "2026-08", vacationRemaining: 81.7, sha256: "sep" });
    const april = cashflow(db, "2027-02-01", { partner: false }).events.find((e) => e.kind === "income" && e.date === "2027-04-23");
    expect(april).toMatchObject({ name: "Lön (prognos, vanlig månad + outtagen semester)" });
    expect(april!.amount).toBeGreaterThan(2250000 + 1000000);
    expect(nextPayday(db, "2027-04-10")).toMatchObject({ date: "2027-04-23", expectedSource: "forecast", forecast: { assumed: true, vacationPayout: 1986699 } });
  });

  it("Kassaflöde: every month with hours entered gets its forecast, the others the estimate", async () => {
    const { db } = await setup();
    setMonth(db, "2026-08", { hours: 157.5 });
    setMonth(db, "2026-09", { hours: 140 });
    const incomes = cashflow(db, "2026-09-19", { partner: false }).events.filter((e) => e.kind === "income");
    expect(incomes.map((e) => [e.date, e.name, e.amount, !!e.estimate])).toEqual([
      ["2026-09-25", "Lön (prognos, 157,5 tim)", 2288295, false],
      ["2026-10-23", "Lön (prognos, 140 tim)", 2480000 - 446400, false],
      ["2026-11-24", "Lön", 2250000, true],
    ]);
  });

  it("the salary in: compared with the forecast, a to-do when more than 500 kr off", async () => {
    const { db, espar } = await setup();
    setMonth(db, "2026-08", { hours: 157.5 });
    db.insert(transactions)
      .values({ source: "swedbank", accountId: espar, bookingDate: "2026-09-25", transactionDate: "2026-09-25", descriptionRaw: "LÖN", descriptionClean: "LÖN", amount: 2208295, fingerprint: "lon" })
      .run();
    linkRecurring(db);
    const p = nextPayday(db, "2026-09-26")!;
    expect(p.received).toMatchObject({ amount: 2208295, forecast: 2288295, diff: -80000 });
    const task = buildOverview(db, "2026-09-26").tasks.find((t) => t.id === "salary_diff:2026-09");
    expect(task?.text.replace(/ /g, " ")).toBe("Lönen blev 800 kr lägre än beräknat (22 083 kr mot 22 883 kr) – kolla specen");
    const app = createApp(db, { databasePath: ":memory:" });
    const [m] = await (await app.request("/api/salary/months")).json();
    expect(m).toMatchObject({ actual: { amount: 2208295 }, diff: -80000 });
  });

  it("new values from a payslip are a to-do until looked at", async () => {
    const { db } = await setup();
    notePendingChanges(db, [{ month: "2027-06", changes: [{ field: "monthlySalary", from: 2400000, to: 2480000 }] }]);
    const t = buildOverview(db, "2026-09-19").tasks.find((x) => x.id === "salary_constants:2027-06")!;
    expect(t.text.replace(/ /g, " ")).toBe("Nya lönevärden från juni 2027: månadslön 24 000 kr → 24 800 kr");
    expect(t.salary).toEqual({ action: "ack", month: "2027-06" });
    const app = createApp(db, { databasePath: ":memory:" });
    await app.request("/api/salary/changes/ack", { method: "POST", body: JSON.stringify({ month: "2027-06" }), headers: { "Content-Type": "application/json" } });
    expect(buildOverview(db, "2026-09-19").tasks.some((x) => x.kind === "salary")).toBe(false);
  });

  it("hours from Pendling's shifts × hours per shift, when chosen for the month", async () => {
    const { db } = await setup();
    setShifts(db, "2026-09", 14);
    setMonth(db, "2026-09", { hours: 140, hoursMode: "shifts" });
    expect(listMonths(db)[0]).toMatchObject({ shifts: 14, hoursFromShifts: 147, effectiveHours: 147 });
    setSalarySettings(db, { shiftHours: 11 });
    expect(salaryForecasts(db).get("2026-10")).toMatchObject({ hours: 154 });
    // Vacation is part of the month's hours, not of its shifts.
    setMonth(db, "2026-09", { hours: 140, hoursMode: "shifts", vacationHours: 40 });
    expect(listMonths(db)[0]).toMatchObject({ hoursFromShifts: 194, effectiveHours: 194 });
    // Without shifts for the month: the hours as entered.
    setMonth(db, "2026-10", { hours: 150, hoursMode: "shifts" });
    expect(listMonths(db)[1]).toMatchObject({ shifts: null, effectiveHours: 150 });
  });

  it("without hour limits in the settings no overtime follows from the days worked", async () => {
    const days = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"];
    expect(weekOvertime(days, "2026-07", 14, { shiftLimit: null, weekLimit: null })).toEqual({ hours: 0, weeks: [] });
    // Only a week limit: the shifts count in full.
    expect(weekOvertime(days, "2026-07", 14, { shiftLimit: null, weekLimit: 60 }).hours).toBe(10);
    const { db } = await setup();
    setSalarySettings(db, { shiftLimit: null, weekLimit: null });
    for (const d of days) setShiftDay(db, d, true);
    setMonth(db, "2026-07", { hours: 0, hoursMode: "shifts", overtimePassHours: 3 });
    // The hours entered stand, as nothing is worked out from the days.
    expect(listMonths(db)[0]).toMatchObject({ overtimeFromDays: null, effectiveOvertimePassHours: 3 });
  });

  it("overtime per week from the days worked: two weeks of five 10,5-hour shifts give 1 hour (July's payslip)", async () => {
    // July 2026: 15 shifts, two weeks with five (6–12 and 20–26 July).
    const days = ["06", "07", "08", "09", "10", "13", "14", "15", "20", "21", "22", "23", "24", "28", "29"].map((d) => `2026-07-${d}`);
    expect(weekOvertime(days, "2026-07", 10.5, LIMITS)).toEqual({
      hours: 1,
      weeks: [
        { from: "2026-07-06", to: "2026-07-12", shifts: 5, hours: 52.5, over: 0.5 },
        { from: "2026-07-20", to: "2026-07-26", shifts: 5, hours: 52.5, over: 0.5 },
      ],
    });
    // Over 13 a shift counts per shift (and only 13 of it toward the week).
    expect(weekOvertime(["2026-07-06", "2026-07-07"], "2026-07", 14, LIMITS).hours).toBe(2);
    // A week across two months belongs to the month of its Thursday: 29 June–5 July is July's.
    const cross = ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03"];
    expect(weekOvertime(cross, "2026-07", 10.5, LIMITS).hours).toBe(0.5);
    expect(weekOvertime(cross, "2026-06", 10.5, LIMITS).hours).toBe(0);

    const { db } = await setup();
    for (const d of days) setShiftDay(db, d, true);
    setMonth(db, "2026-07", { hours: 0, hoursMode: "shifts" });
    expect(listMonths(db)[0]).toMatchObject({ effectiveHours: 157.5, effectiveOvertimePassHours: 1 });
    // The August pay day, to the öre.
    expect(salaryForecasts(db).get("2026-08")).toMatchObject({ payDate: "2026-08-25", net: 2294952 });
  });
});
