import { describe, expect, it } from "vitest";
import { payslips } from "../src/db/schema.js";
import { manualData } from "../src/manualData/manualData.js";
import { findings } from "../src/watch/watch.js";
import { saveTaxReturn } from "../src/taxReturns/taxReturns.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const row = (db: Db, today: string) => manualData(db, today).find((i) => i.key === "tax_return");
const missing = (db: Db, today: string) => findings(db, today).filter((f) => f.kind === "tax_return_missing");
const withPayslip = () => {
  const db = freshDb({ seeded: true });
  db.insert(payslips).values({ payDate: "2026-01-23", gross: 1, tax: 0, net: 1, filename: "a.htm", sha256: "due-1" }).run();
  return db;
};

describe("Att fylla i › Deklarationskvittens", () => {
  it("is not asked for before the tool is in use (no payslip, no return)", () => {
    expect(row(freshDb({ seeded: true }), "2026-05-10")).toBeUndefined();
  });

  it("is due in March, late after 2 May, and up to date once last year's receipt is in", () => {
    const db = withPayslip();
    saveTaxReturn(db, 2024, { submittedAt: "2025-03-21", boxes: { employmentIncome: 1 } }, "2026-01-10");
    // February: last spring's (2024) is in.
    expect(row(db, "2026-02-20")).toMatchObject({ status: "ok", note: "Inkomståret 2024 är inläst (skickad 21/3 2025).", group: "Skatt", link: { view: "imports" } });
    expect(row(db, "2026-03-01")).toMatchObject({ status: "soon", note: "Deklarera inkomståret 2025 senast 2 maj och läs in kvittensen." });
    expect(row(db, "2026-05-02")!.status).toBe("soon");
    expect(row(db, "2026-05-03")).toMatchObject({ status: "overdue", note: "Kvittensen för inkomståret 2025 saknas." });
    saveTaxReturn(db, 2025, { submittedAt: "2026-04-02", boxes: { employmentIncome: 1 } }, "2026-05-10");
    expect(row(db, "2026-05-10")).toMatchObject({ status: "ok", asOf: "2025", note: "Inkomståret 2025 är inläst (skickad 2/4 2026)." });
  });

  it("says none is read in when the tool has payslips but no return", () => {
    expect(row(withPayslip(), "2026-02-10")).toMatchObject({ status: "never", note: "Ingen deklaration inläst." });
  });
});

describe("Vakt › Deklarationen saknas", () => {
  it("after 2 May without last year's receipt, once per income year; gone when it is read in", () => {
    const db = withPayslip();
    expect(missing(db, "2026-05-02")).toEqual([]);
    expect(missing(db, "2026-05-03")).toMatchObject([{ key: "tax_return_missing:2025", text: expect.stringMatching(/^Deklarationen för 2025 saknas/) }]);
    expect(missing(db, "2026-11-30")[0].key).toBe("tax_return_missing:2025");
    saveTaxReturn(db, 2025, { boxes: { employmentIncome: 1 } }, "2026-06-01");
    expect(missing(db, "2026-06-01")).toEqual([]);
  });

  it("says nothing in a tool not in use", () => {
    expect(missing(freshDb({ seeded: true }), "2026-06-01")).toEqual([]);
  });
});
