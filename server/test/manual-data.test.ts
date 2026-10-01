import { describe, expect, it } from "vitest";
import { payslips, pensionStatements, settlements, taxTableRows, workShifts } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { manualData, STATUS_ORDER, type ManualDataItem } from "../src/manualData/manualData.js";
import { createPension, savePensionForecast } from "../src/networth/pension.js";
import { setSetting } from "../src/settings.js";
import { freshDb } from "./helpers.js";

/**
 * Att fylla i: each figure kept by hand, with how old it is and whether that
 * is too old. The rules are the point — when a row turns from Aktuell to
 * Snart dags to Inaktuell — and that a part of the tool not in use says
 * nothing at all.
 */

type Db = ReturnType<typeof freshDb>;
const row = (db: Db, today: string, key: string): ManualDataItem | undefined => manualData(db, today).find((i) => i.key === key);

const pension = (db: Db, valueDate: string) =>
  createPension(db, { kind: "occupational", provider: "Exempelbolaget Pension", name: "SAF-LO", amountOre: 10_000_000, valueDate });

describe("manual data", () => {
  it("lists nothing for a part of the tool not in use", () => {
    const db = freshDb();
    const keys = manualData(db, "2026-09-21").map((i) => i.key);
    expect(keys.filter((k) => k.startsWith("pension") || k === "shifts" || k === "payslip" || k === "settlement")).toEqual([]);
  });

  it("says a pension value is old after twelve months, and warns the month before", () => {
    const db = freshDb();
    const e = pension(db, "2025-10-15");
    expect(row(db, "2026-09-20", `pension:${e.id}`)?.status).toBe("soon");
    expect(row(db, "2026-10-15", `pension:${e.id}`)?.status).toBe("overdue");
    expect(row(db, "2026-09-20", `pension:${e.id}`)).toMatchObject({ asOf: "2025-10-15", ageDays: 340, source: "minpension.se" });
  });

  it("asks for a forecast that was never made, and knows one that was", () => {
    const db = freshDb();
    pension(db, "2026-09-01");
    expect(row(db, "2026-09-21", "pension_forecast")?.status).toBe("never");
    savePensionForecast(db, { madeOn: "2026-09-10", retirementAge: 65, monthlyPensionOre: 2_000_000, assumptions: "3 %", note: null });
    expect(row(db, "2026-09-21", "pension_forecast")).toMatchObject({ status: "ok", asOf: "2026-09-10" });
  });

  it("expects the envelope for the year two back from April", () => {
    const db = freshDb();
    pension(db, "2026-09-01");
    db.insert(pensionStatements).values({ year: 2024, pensionableIncomeOre: 1, incomePensionRightOre: 1, premiumPensionRightOre: 1 }).run();
    expect(row(db, "2027-03-31", "pension_statement")?.status).toBe("ok");
    expect(row(db, "2027-04-01", "pension_statement")).toMatchObject({ status: "overdue", note: "Kuvertet för inkomståret 2025 borde ha kommit." });
  });

  it("wants this month's shifts, and next month's from the 20th", () => {
    const db = freshDb();
    db.insert(workShifts).values({ month: "2026-08", shifts: 12 }).run();
    expect(row(db, "2026-09-05", "shifts")?.status).toBe("overdue");
    db.insert(workShifts).values({ month: "2026-09", shifts: 12 }).run();
    expect(row(db, "2026-09-19", "shifts")?.status).toBe("ok");
    expect(row(db, "2026-09-20", "shifts")?.status).toBe("soon");
  });

  it("says the tax table has fallen back to last year's, and in December asks for next year's", () => {
    const db = freshDb();
    db.insert(taxTableRows).values({ year: 2026, tableNo: 33, kind: "30B", incomeFrom: 0, incomeTo: 100, columns: "[0,0,0,0,0,0]" }).run();
    expect(row(db, "2026-11-30", "tax_table")?.status).toBe("ok");
    expect(row(db, "2026-12-01", "tax_table")?.status).toBe("soon");
    expect(row(db, "2027-01-02", "tax_table")).toMatchObject({ status: "overdue", note: "Tabellen för 2027 saknas — 2026 års används." });
  });

  it("wants the payslip around pay day, not before", () => {
    const db = freshDb();
    db.insert(payslips).values({ payDate: "2026-08-25", gross: 1, tax: 0, net: 1, filename: "a.htm", sha256: "a" }).run();
    // Pay day 25 September 2026 is a Friday.
    expect(row(db, "2026-09-10", "payslip")?.status).toBe("ok");
    expect(row(db, "2026-09-18", "payslip")?.status).toBe("soon");
    expect(row(db, "2026-09-29", "payslip")?.status).toBe("overdue");
    db.insert(payslips).values({ payDate: "2026-09-25", gross: 1, tax: 0, net: 1, filename: "b.htm", sha256: "b" }).run();
    expect(row(db, "2026-09-29", "payslip")).toMatchObject({ status: "ok", asOf: "2026-09-25" });
  });

  it("asks for last month's settlement, harder from the 15th", () => {
    const db = freshDb();
    setSetting(db, "settlement_start_month", "2026-08");
    expect(row(db, "2026-09-10", "settlement")?.status).toBe("soon");
    expect(row(db, "2026-09-15", "settlement")?.status).toBe("overdue");
    db.insert(settlements).values({ month: "2026-08", iPaid: 0, partnerPaid: 0, fromPartner: 0, toPartner: 0, carryIn: 0, result: 0 }).run();
    expect(row(db, "2026-09-15", "settlement")?.status).toBe("ok");
  });

  it("puts what is late first", () => {
    const db = freshDb();
    pension(db, "2024-01-01");
    pension(db, "2026-09-01");
    const statuses = manualData(db, "2026-09-21").map((i) => STATUS_ORDER.indexOf(i.status));
    expect(statuses).toEqual([...statuses].sort((a, b) => a - b));
    expect(manualData(db, "2026-09-21")[0].status).toBe("overdue");
  });

  it("is served at /api/manual-data", async () => {
    const db = freshDb();
    pension(db, "2026-09-01");
    const app = createApp(db, { databasePath: ":memory:" });
    const items = (await (await app.request("/api/manual-data?today=2026-09-21")).json()) as ManualDataItem[];
    expect(items.find((i) => i.key.startsWith("pension:"))).toMatchObject({ status: "ok", link: { view: "overview", search: "?flik=pension" } });
  });
});
