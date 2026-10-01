import { describe, expect, it } from "vitest";
import type { ImportLog } from "../../../api";
import { bandLabel, groupHistory, periodText, rowTotals, totalsOf, totalsText } from "./group";

const TODAY = "2026-09-25";
let nextId = 1;
/** An import at a UTC instant; bank syncs are named after their account. */
const imp = (importedAt: string, via: ImportLog["via"], rowsNew = 1, rowsSkipped = 2, filename = via === "file" ? `fil-${nextId}.csv` : "Enable Banking · Swedbank ••0001"): ImportLog => ({
  id: nextId++,
  source: "swedbank",
  filename,
  periodFrom: null,
  periodTo: null,
  importedAt,
  rowsTotal: rowsNew + rowsSkipped,
  rowsNew,
  rowsSkipped,
  via,
});

/** Newest first, as the server sends them. Times in UTC; Stockholm is UTC+2 in September. */
const HISTORY = [
  imp("2026-09-25T04:00:00Z", "enable_banking"), // today
  imp("2026-09-24T16:00:00Z", "enable_banking"), // yesterday
  imp("2026-09-24T10:00:00Z", "enable_banking"),
  imp("2026-09-23T22:30:00Z", "file"), // 00:30 on the 24th in Stockholm: yesterday
  imp("2026-09-23T16:00:00Z", "enable_banking"), // the 23rd and the 22nd: only syncs
  imp("2026-09-22T10:00:00Z", "enable_banking"),
  imp("2026-09-22T04:00:00Z", "enable_banking"),
  imp("2026-09-21T16:00:00Z", "enable_banking"), // the 21st: a file and syncs
  imp("2026-09-21T08:00:00Z", "file", 163, 0),
  imp("2026-09-21T04:00:00Z", "enable_banking"),
  imp("2026-09-19T04:00:00Z", "enable_banking"), // the 19th: syncs, alone
  imp("2026-09-18T13:00:00Z", "file", 0, 14),
];

describe("groupHistory", () => {
  const bands = groupHistory(HISTORY, TODAY);

  it("a band per day, newest first, by Swedish time", () => {
    expect(bands.map((b) => b.days)).toEqual([["2026-09-25"], ["2026-09-24"], ["2026-09-23", "2026-09-22"], ["2026-09-21"], ["2026-09-19"], ["2026-09-18"]]);
  });

  it("today's and yesterday's bank syncs one by one", () => {
    expect(bands[0].rows.map((r) => r.kind)).toEqual(["sync"]);
    expect(bands[1].rows.map((r) => r.kind)).toEqual(["sync", "sync", "file"]);
  });

  it("older days' syncs as one row per day, files never", () => {
    const withFile = bands[3];
    expect(withFile.rows.map((r) => r.kind)).toEqual(["file", "syncs"]);
    const syncs = withFile.rows[1];
    expect(syncs.kind === "syncs" && syncs.imps).toHaveLength(2);
    expect(bands[4].rows.map((r) => r.kind)).toEqual(["syncs"]);
    expect(bands[5].rows.map((r) => r.kind)).toEqual(["file"]);
    // Every file is a row of its own, on whatever day.
    const fileRows = bands.flatMap((b) => b.rows).filter((r) => r.kind === "file");
    expect(fileRows).toHaveLength(HISTORY.filter((i) => i.via === "file").length);
  });

  it("a run of older days with only syncs becomes one band with one row", () => {
    const run = bands[2];
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0]).toMatchObject({ kind: "syncs", days: ["2026-09-23", "2026-09-22"] });
    expect(run.rows[0].kind === "syncs" && run.rows[0].imps).toHaveLength(3);
    expect(bandLabel(run.days, "2026")).toBe("Onsdag 23 – tisdag 22 september");
  });

  it("a band's totals are the sum of its rows, and all bands of all imports", () => {
    for (const b of bands) expect(b.totals).toEqual(rowTotals(b.rows));
    const all = bands.reduce((a, b) => ({ files: a.files + b.totals.files, syncs: a.syncs + b.totals.syncs, rowsNew: a.rowsNew + b.totals.rowsNew, rowsSkipped: a.rowsSkipped + b.totals.rowsSkipped }), {
      files: 0,
      syncs: 0,
      rowsNew: 0,
      rowsSkipped: 0,
    });
    expect(all).toEqual(totalsOf(HISTORY));
    expect(totalsText(bands[3].totals)).toBe("1 fil · 2 banksynkar · 165 nya · 4 dubbletter");
  });

  it("only syncs, or only files, group the same way", () => {
    const syncs = groupHistory(HISTORY.filter((i) => i.via === "enable_banking"), TODAY);
    // Without its file the 21st joins the run of sync days.
    expect(syncs.map((b) => b.days)).toEqual([["2026-09-25"], ["2026-09-24"], ["2026-09-23", "2026-09-22", "2026-09-21", "2026-09-19"]]);
    const files = groupHistory(HISTORY.filter((i) => i.via === "file"), TODAY);
    expect(files.flatMap((b) => b.rows).every((r) => r.kind === "file")).toBe(true);
  });
});

describe("texts", () => {
  it("totals leave out what is none, with Swedish digit groups", () => {
    expect(totalsText({ files: 17, syncs: 0, rowsNew: 2067, rowsSkipped: 56 })).toMatch(/^17 filer · 2\s067 nya · 56 dubbletter$/);
    expect(totalsText({ files: 0, syncs: 1, rowsNew: 0, rowsSkipped: 1 })).toBe("1 banksynk · 1 dubblett");
  });

  it("the band's day, across months and years", () => {
    expect(bandLabel(["2026-09-25"], "2026")).toBe("Fredag 25 september");
    expect(bandLabel(["2026-10-01", "2026-09-29"], "2026")).toBe("Torsdag 1 oktober – tisdag 29 september");
    expect(bandLabel(["2025-12-31"], "2026")).toBe("Onsdag 31 december 2025");
    expect(bandLabel(["2026-01-01", "2025-12-31"], "2026")).toBe("Torsdag 1 januari – onsdag 31 december 2025");
  });

  it("a file's period, with the year when it isn't this year's", () => {
    expect(periodText("2026-09-03", "2026-09-17", "2026")).toBe("3/9 – 17/9");
    expect(periodText("2025-09-22", "2026-09-18", "2026")).toBe("22/9 2025 – 18/9 2026");
    expect(periodText("2025-08-01", "2025-08-31", "2026")).toBe("1/8 – 31/8 2025");
  });
});
