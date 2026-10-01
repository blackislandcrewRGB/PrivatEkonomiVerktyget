import { describe, expect, it } from "vitest";
import type { ManualDataItem, ManualDataStatus } from "../../../api";
import { counts, foldedByDefault, oldest, parseFilter, summary } from "./status";

const item = (status: ManualDataStatus, o: Partial<ManualDataItem> = {}): ManualDataItem => ({
  key: `${status}${Math.random()}`,
  group: "G",
  title: "X",
  source: "",
  input: "form",
  cadence: "",
  asOf: "2026-09-01",
  ageDays: 20,
  enteredOn: null,
  status,
  note: "",
  link: { view: "overview" },
  ...o,
});

describe("Att fylla i's statuses", () => {
  it("counts each status, Inaktuell with Aldrig ifylld, and the four add up to Alla", () => {
    const items = [item("ok"), item("ok"), item("soon"), item("overdue"), item("never"), item("info")];
    const c = counts(items);
    expect(c).toEqual({ all: 6, soon: 1, late: 2, ok: 2, info: 1 });
    expect(c.soon + c.late + c.ok + c.info).toBe(c.all);
  });

  it("reads the filter from the address, anything unknown as Alla", () => {
    expect(parseFilter("?flik=att-fylla-i&status=soon")).toBe("soon");
    expect(parseFilter("?status=nonsens")).toBe("all");
    expect(parseFilter("")).toBe("all");
  });

  it("folds a group when all in it is up to date or only needed now and then", () => {
    expect(foldedByDefault([item("ok"), item("info")])).toBe(true);
    expect(foldedByDefault([item("ok"), item("soon")])).toBe(false);
  });

  it("sums a group up in its pill", () => {
    expect(summary([item("ok"), item("ok"), item("ok"), item("ok")])).toEqual({ text: "4 av 4 aktuella", tone: "ok" });
    expect(summary([item("ok"), item("ok"), item("info")])).toEqual({ text: "2 aktuella · 1 vid behov", tone: "neutral" });
    expect(summary([item("overdue"), item("soon"), item("ok")])).toEqual({ text: "1 inaktuell · 1 snart dags · 1 aktuell", tone: "late" });
  });

  it("says how old the oldest row is, by age or else by date", () => {
    expect(oldest([item("ok", { asOf: "2026-09-21", ageDays: 4 }), item("ok", { asOf: "2026-09-04", ageDays: 21 })], "2026")).toBe("21 dagar");
    expect(oldest([item("ok", { asOf: "2025-11-28", ageDays: 297 })], "2026")).toBe("9 mån");
    // An age wins over a year-only date; with nothing older than today, the oldest date.
    expect(oldest([item("ok", { asOf: "2026-08-10", ageDays: 46 }), item("ok", { asOf: "2026", ageDays: null })], "2026")).toBe("46 dagar");
    expect(oldest([item("ok", { asOf: "2026-09-25", ageDays: 0 }), item("ok", { asOf: "2026", ageDays: null })], "2026")).toBe("2026");
    expect(oldest([item("ok", { asOf: "2026-09-25", ageDays: 0 })], "2026")).toBe("i dag");
    expect(oldest([item("ok", { asOf: "2026", ageDays: null }), item("ok", { asOf: "2026-08", ageDays: null })], "2026")).toBe("2026");
  });
});
