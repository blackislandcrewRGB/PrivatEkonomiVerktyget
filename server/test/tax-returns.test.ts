import { describe, expect, it, vi } from "vitest";
import { imports, taxReturns } from "../src/db/schema.js";
import { looksLikeTaxReturn, parseTaxReturn } from "../src/import/taxReturn.js";
import { importFiles } from "../src/import/importBatch.js";
import { importUndoStatus, undoImport } from "../src/import/undoImport.js";
import { importHistory } from "../src/import/history.js";
import type { PdfLine } from "../src/import/pdfText.js";
import { createApp } from "../src/app.js";
import { freshDb, hasPrivateSample, privateSample, privateSecrets } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;

// Made-up receipts are given to the batch as their text lines; the real ones are read.
const fake = vi.hoisted(() => ({ lines: null as PdfLine[] | null }));
vi.mock("../src/import/pdfText.js", async (original) => {
  const m = await original<typeof import("../src/import/pdfText.js")>();
  return { ...m, extractPdfLines: async (bytes: Uint8Array) => fake.lines ?? m.extractPdfLines(bytes) };
});

// Skatteverket's own test personnummer, a made-up name and receipt number.
const PNR = "191212121212";
const NAME = "Testsson, Kim";
const RECEIPT_NO = "20250321120814191212121212999999";

/**
 * A made-up receipt laid out as Skatteverket prints it. `rows`: the boxes as
 * [number, text, ...value items] ('312 400', or '312', '400' as the older
 * receipts split it).
 */
function receiptLines(o: { date: string; year?: number; rows: string[][] }): PdfLine[] {
  const line = (y: number, ...items: [number, string][]): PdfLine => ({ page: 1, y, items: items.map(([x, text]) => ({ x, text })) });
  let y = 620;
  return [
    line(816, [566, "1 (1)"]),
    line(810, [303, "Kvittens"]),
    line(798, [42, "* Skatteverket"], [304, "Datum"], [418, "E-tjänst"]),
    line(786, [304, o.date], [418, "Inkomstdeklaration 1"]),
    line(750, [45, "Kvittensnummer"], [304, "Inskickad via"], [419, "Bilagor som ingår"]),
    line(738, [45, RECEIPT_NO], [304, "E-tjänst"]),
    line(726, [45, "Namn"], [304, "Person-/Org.nr"]),
    line(714, [45, NAME], [304, PNR]),
    line(674, [45, "Inkomstdeklaration (INK1) -"]),
    ...(o.year ? [line(659, [45, `Inkomståret ${o.year}`])] : []),
    line(642, [46, "Inkomst av tjänst och kapital"]),
    ...o.rows.map(([n, text, ...value]) => line((y -= 20), [54, n], [79, text], ...value.map((v, i): [number, string] => [514 + i * 20, v]))),
  ];
}

const Y2024 = {
  date: "2025-03-21",
  year: 2024,
  rows: [
    ["1.1", "Lön, förmåner, sjukpenning m.m.", "312 400"],
    ["2.1", "Resor till och från arbetet", "20 150"],
    ["7.1", "Schablonintäkter", "1 234"],
    ["7.2", "Ränteinkomster, utdelningar m.m. Vinst enligt bilaga K4 avsnitt C m.m.", "88"],
    ["7.4", "K9 avsnitt B, K10, K10A, K11, K12 avsnitt B och K13.", "6", "084"],
    ["8.1", "Ränteutgifter m.m. Förlust enligt bilaga K4 avsnitt C m.m.", "450"],
  ],
};

const bytesOf = (s: string) => new TextEncoder().encode(s);
/** Everything the database holds, as text: for checking that nothing personal is in it. */
const everything = (db: Db) => JSON.stringify([db.select().from(taxReturns).all(), db.select().from(imports).all()]);

describe("reading a tax return receipt", () => {
  it("has the income year, the day it was sent and the five boxes by their numbers, in öre", () => {
    const lines = receiptLines(Y2024);
    expect(looksLikeTaxReturn(lines)).toBe(true);
    expect(parseTaxReturn(lines)).toEqual({
      incomeYear: 2024,
      submittedAt: "2025-03-21",
      boxes: { employmentIncome: 31_240_000, commuteDeduction: 2_015_000, iskStandardIncome: 123_400, capitalIncome: 8_800, capitalExpenses: 45_000 },
    });
  });

  it("goes by the numbers, not the texts, joins a value split in parts and skips boxes not asked for", () => {
    const r = parseTaxReturn(
      receiptLines({
        date: "2022-04-19",
        year: 2021,
        rows: [
          ["1.1", "Lön (omformulerad)", "120", "000"],
          ["7.4", "Vinst fondandelar", "18", "115"],
          ["8.3", "Förlust fondandelar", "457"],
        ],
      }),
    );
    expect(r.boxes).toEqual({ employmentIncome: 12_000_000, commuteDeduction: null, iskStandardIncome: null, capitalIncome: null, capitalExpenses: null });
  });

  it("leaves a box the receipt doesn't have empty", () => {
    const r = parseTaxReturn(receiptLines({ ...Y2024, rows: Y2024.rows.filter(([n]) => n !== "2.1" && n !== "8.1") }));
    expect(r.boxes.commuteDeduction).toBeNull();
    expect(r.boxes.capitalExpenses).toBeNull();
    expect(r.boxes.employmentIncome).toBe(31_240_000);
  });

  it("takes the year before the day it was sent when the receipt doesn't say (the oldest ones)", () => {
    expect(parseTaxReturn(receiptLines({ ...Y2024, year: undefined, date: "2021-05-03" })).incomeYear).toBe(2020);
  });

  it("keeps nothing but the year, the date and the boxes", () => {
    const text = JSON.stringify(parseTaxReturn(receiptLines(Y2024)));
    for (const s of [PNR, NAME, RECEIPT_NO, "Testsson"]) expect(text).not.toContain(s);
  });

  it("refuses one without any of the five boxes", () => {
    expect(() => parseTaxReturn(receiptLines({ ...Y2024, rows: [["7.4", "Vinst", "12"]] }))).toThrow(/inga av raderna/);
  });

  it("is not taken for a rent notice or an invoice", () => {
    expect(looksLikeTaxReturn(receiptLines(Y2024).filter((l) => !l.items.some((i) => i.text === "Kvittens")))).toBe(false);
  });
});

/** The receipt as Importer gets it: the lines stand in for the PDF's text. */
async function importReceipt(db: Db, lines: PdfLine[], dryRun = false) {
  fake.lines = lines;
  try {
    // '%PDF' so the batch takes it for a PDF; the name has the personnummer in it, as Skatteverket's files do.
    return await importFiles(db, [{ name: `Kvittens ${PNR} - Inkomstdeklaration 1 2025.pdf`, bytes: bytesOf("%PDF-1.4 x") }], { dryRun });
  } finally {
    fake.lines = null;
  }
}

describe("importing a tax return receipt", () => {
  it("previews without storing, then becomes its year's row; the history names it by its year, never by the file", async () => {
    const db = freshDb();
    const preview = await importReceipt(db, receiptLines(Y2024), true);
    expect(db.select().from(taxReturns).all()).toEqual([]);
    const f = preview.files[0];
    expect(f.ok && f.result.source === "tax_return" && f.result.taxReturn.incomeYear).toBe(2024);
    expect(f.filename).toBe("Deklarationskvittens 2024.pdf");

    await importReceipt(db, receiptLines(Y2024));
    const [row] = db.select().from(taxReturns).all();
    expect(row).toMatchObject({ incomeYear: 2024, submittedAt: "2025-03-21", employmentIncome: 31_240_000, source: "pdf", previous: null });
    expect(db.select().from(imports).all()).toMatchObject([{ source: "tax_return", filename: "Deklarationskvittens 2024.pdf", periodFrom: "2024-01-01", periodTo: "2024-12-31" }]);
    for (const s of [PNR, NAME, RECEIPT_NO]) expect(everything(db)).not.toContain(s);
  });

  it("is known the second time, and replaces the year when it differs (the preview says what it replaces)", async () => {
    const db = freshDb();
    await importReceipt(db, receiptLines(Y2024));
    const again = await importReceipt(db, receiptLines(Y2024), true);
    expect(again.files[0].ok && again.files[0].alreadyImported).toBe(true);

    const changed = { ...Y2024, date: "2025-04-02", rows: [["1.1", "Lön", "315 000"]] };
    const preview = await importReceipt(db, receiptLines(changed), true);
    const r = preview.files[0].ok ? preview.files[0].result : null;
    expect(r?.source === "tax_return" && r.taxReturn.replaces).toMatchObject({ submittedAt: "2025-03-21", source: "pdf", boxes: { employmentIncome: 31_240_000 } });

    await importReceipt(db, receiptLines(changed));
    expect(db.select().from(taxReturns).all()).toMatchObject([{ submittedAt: "2025-04-02", employmentIncome: 31_500_000, commuteDeduction: null }]);
    // Undoing the second puts the first back, with its own import.
    const [first, second] = db.select().from(imports).all();
    expect(importUndoStatus(db, first.id)).toMatchObject({ ok: false });
    undoImport(db, second.id);
    expect(db.select().from(taxReturns).all()).toMatchObject([{ submittedAt: "2025-03-21", employmentIncome: 31_240_000, importId: first.id, previous: null }]);
    // And undoing the first takes the year away.
    undoImport(db, first.id);
    expect(db.select().from(taxReturns).all()).toEqual([]);
    expect(db.select().from(imports).all()).toEqual([]);
  });

  it("is in the history with 'Ångra' until the year is changed by hand", async () => {
    const db = freshDb();
    await importReceipt(db, receiptLines(Y2024));
    expect(importHistory(db).imports).toMatchObject([{ source: "tax_return", undo: { ok: true, rows: 0, statement: false } }]);
    const app = createApp(db, { databasePath: ":memory:" });
    const res = await app.request("/api/tax-returns/2024", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submittedAt: "2025-03-21", boxes: { employmentIncome: 31_250_000 } }),
    });
    expect(res.status).toBe(200);
    expect(importHistory(db).imports[0].undo).toMatchObject({ ok: false });
  });
});

describe("tax returns by hand (/api/tax-returns)", () => {
  const put = (app: ReturnType<typeof createApp>, year: number, body: unknown) =>
    app.request(`/api/tax-returns/${year}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("adds, lists newest first, changes and deletes a year", async () => {
    const db = freshDb();
    const app = createApp(db, { databasePath: ":memory:" });
    expect((await put(app, 2023, { submittedAt: "2024-04-01", boxes: { employmentIncome: 25_000_000, commuteDeduction: 1_800_000 } })).status).toBe(200);
    expect((await put(app, 2024, { submittedAt: null, boxes: { employmentIncome: 31_240_000 } })).status).toBe(200);
    const list = await (await app.request("/api/tax-returns")).json();
    expect(list.map((r: { incomeYear: number; source: string }) => `${r.incomeYear} ${r.source}`)).toEqual(["2024 manual", "2023 manual"]);
    expect(list[1].boxes).toEqual({ employmentIncome: 25_000_000, commuteDeduction: 1_800_000, iskStandardIncome: null, capitalIncome: null, capitalExpenses: null });
    expect((await app.request("/api/tax-returns/2023", { method: "DELETE" })).status).toBe(200);
    expect((await (await app.request("/api/tax-returns")).json()).length).toBe(1);
  });

  it("refuses a year to come, a wrong date, a negative amount or no amounts", async () => {
    const app = createApp(freshDb(), { databasePath: ":memory:" });
    const future = Number(new Date().getFullYear()) + 1;
    for (const [year, body] of [
      [future, { boxes: { employmentIncome: 1 } }],
      [2024, { submittedAt: "21/3", boxes: { employmentIncome: 1 } }],
      [2024, { boxes: { employmentIncome: -100 } }],
      [2024, { boxes: {} }],
    ] as const) {
      expect((await put(app, year, body)).status).toBe(400);
    }
  });
});

// The real receipts, out of git in samples/privat/ (deklaration-<inkomstår>.pdf).
const REAL = [2020, 2021, 2022, 2023, 2024].map((y) => `deklaration-${y}.pdf`);
describe.skipIf(!REAL.every(hasPrivateSample))("the real receipts, five years in one go", () => {
  it("are read by their numbers across the years' layouts, and nothing personal is kept", async () => {
    const db = freshDb();
    const files = REAL.map(privateSample);
    const result = await importFiles(db, files);
    expect(result.files.every((f) => f.ok)).toBe(true);
    const rows = db.select().from(taxReturns).all().sort((a, b) => a.incomeYear - b.incomeYear);
    expect(rows.map((r) => r.incomeYear)).toEqual([2020, 2021, 2022, 2023, 2024]);
    // Every year has a salary and a day it was sent; the commute deduction only from 2022.
    expect(rows.every((r) => r.employmentIncome! > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.submittedAt!))).toBe(true);
    expect(rows.map((r) => r.commuteDeduction !== null)).toEqual([false, false, true, true, true]);
    const secrets = privateSecrets("taxReturn");
    expect(secrets.length).toBeGreaterThan(0);
    const text = everything(db) + JSON.stringify(result);
    for (const s of secrets) expect(text).not.toContain(s);
  });
});
