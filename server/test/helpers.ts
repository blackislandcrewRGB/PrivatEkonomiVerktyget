import fs from "node:fs";
import path from "node:path";
import { openDb, runMigrations, type Db } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import { seedExampleHousehold } from "../src/db/exampleHousehold.js";

/** `seeded`: the categories and rules, and the example household (accounts, contacts, pensions, balances). */
export function freshDb(opts: { seeded?: boolean } = {}): Db {
  const db = openDb(":memory:");
  runMigrations(db);
  if (opts.seeded) {
    seed(db);
    seedExampleHousehold(db);
  }
  return db;
}

/** Made-up bank exports (see fixtures/generate-bank-fixtures.ts). */
export const SAMPLES_DIR = path.join(import.meta.dirname, "fixtures/bank");

export function swedbankSample(): { name: string; bytes: Buffer } {
  const name = fs.readdirSync(SAMPLES_DIR).find((f) => /^Transaktioner_.*\.csv$/.test(f))!;
  return { name, bytes: fs.readFileSync(path.join(SAMPLES_DIR, name)) };
}

/** Encodes a string as Windows-1252 (enough for Swedish text and the en dash). */
export function cp1252(text: string): Buffer {
  return Buffer.from(text.replace(/–/g, "\x96"), "latin1");
}

export const HEADER =
  "Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp";

export function metaLine(from = "2026-01-01", to = "2026-01-31") {
  return `* Transaktioner Period ${from}–${to} Skapad ${to} 10:00 CEST`;
}

export interface CsvRow {
  account?: string;
  product?: string;
  /** Transaction date (and value date). */
  date: string;
  /** Booking date, defaults to date. */
  bookingDate?: string;
  ref?: string;
  desc: string;
  amount: string;
}

export function csvLine(r: CsvRow, n: number): string {
  return [
    n,
    "80000",
    r.account ?? "1234561234",
    `"${r.product ?? "Privatkonto"}"`,
    "SEK",
    r.bookingDate ?? r.date,
    r.date,
    r.date,
    `"${r.ref ?? r.desc}"`,
    `"${r.desc}"`,
    r.amount,
  ].join(",");
}

/** Builds a Swedbank-style CSV (cp1252, CRLF). */
export function buildCsv(rows: CsvRow[], opts: { meta?: string | null; eol?: string } = {}): Buffer {
  const eol = opts.eol ?? "\r\n";
  const lines = [...(opts.meta === null ? [] : [opts.meta ?? metaLine()]), HEADER, ...rows.map((r, i) => csvLine(r, i + 1))];
  return cp1252(lines.join(eol) + eol);
}

/**
 * Keeps the metadata + header lines of a real export and only the data lines
 * for which keep(line) is true. Byte-exact for kept lines.
 */
export function filterCsvLines(bytes: Buffer, keep: (line: string, index: number) => boolean): Buffer {
  const text = bytes.toString("latin1");
  const lines = text.split("\r\n");
  const out = lines.filter((l, i) => i < 2 || l === "" || keep(l, i - 2));
  return Buffer.from(out.join("\r\n"), "latin1");
}

/**
 * Real invoices and receipts, kept out of git in samples/privat/ because they
 * carry a name, an address, a card or a membership number. They are there on
 * the Mac; in a fresh clone they are not, and the tests that read them skip.
 */
export const PRIVATE_SAMPLES_DIR = path.resolve(import.meta.dirname, "../../samples/privat");
export const NORWEGIAN_INVOICE = "Faktura September .pdf";
export const MASTERCARD_INVOICE = "Faktura Kreditkortet Swedbank.pdf";
export const WILLYS_RECEIPT = "Kvitto Willys.pdf";
export const hasPrivateSample = (name: string) => fs.existsSync(path.join(PRIVATE_SAMPLES_DIR, name));
export function privateSample(name: string): { name: string; bytes: Buffer } {
  return { name, bytes: fs.readFileSync(path.join(PRIVATE_SAMPLES_DIR, name)) };
}

/**
 * The personal details the real invoices hold (name, address, OCR, account),
 * from samples/privat/personuppgifter.json: the tests check that none of it is
 * stored, without the details themselves being in git.
 */
export function privateSecrets(key: string): string[] {
  const file = path.join(PRIVATE_SAMPLES_DIR, "personuppgifter.json");
  if (!fs.existsSync(file)) return [];
  const list = (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)[key];
  return Array.isArray(list) ? list.map(String) : [];
}

/** The Bank Norwegian invoice ('Faktura September .pdf'), from samples/privat/. Guard with hasNorwegianInvoice. */
export const hasNorwegianInvoice = hasPrivateSample(NORWEGIAN_INVOICE);
export function samplePdf(): { name: string; bytes: Buffer } {
  // Never throws: vitest runs a skipped describe's body to collect it.
  return hasNorwegianInvoice ? privateSample(NORWEGIAN_INVOICE) : { name: NORWEGIAN_INVOICE, bytes: Buffer.alloc(0) };
}

export const SWEDBANK_FILES = {
  privatUttag: "SWEDBANK - UTTAG PRIVATKONTO.csv",
  privatInsattningar: "SWEDBANK - Insättningar PRIVATKONTO.csv",
  esparUttag: "SWEDBANK - Uttag ESPARKONTO.csv",
  esparInsattningar: "SWEDBANK - Insättningar ESPARKONTO.csv",
} as const;

export function sampleFile(name: string): { name: string; bytes: Buffer } {
  return { name, bytes: fs.readFileSync(path.join(SAMPLES_DIR, name)) };
}

export function allSwedbankFiles() {
  return Object.values(SWEDBANK_FILES).map(sampleFile);
}

/**
 * A small one-page PDF that says "Kvitto", made here: for tests that need a PDF
 * and not any particular one. Offsets in the xref are counted, so readers that
 * check them (Quick Look for the thumbnail) take it.
 */
export function tinyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 40 >>\nstream\nBT /F1 18 Tf 40 55 Td (Kvitto) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

