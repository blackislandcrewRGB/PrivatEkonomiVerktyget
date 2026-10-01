import { parse } from "csv-parse/sync";
import { fingerprint } from "./fingerprint.js";
import { decodeBankText, isIsoDate, normalizeWhitespace, parseAmountToOre } from "./text.js";

export interface SwedbankRow {
  /** 1-based line number in the file, for error messages. */
  line: number;
  clearing: string;
  accountNumber: string;
  product: string;
  currency: string;
  bookingDate: string;
  transactionDate: string | null;
  valueDate: string | null;
  reference: string;
  descriptionRaw: string;
  descriptionClean: string;
  amount: number; // öre
  fingerprint: string;
}

export interface SwedbankFile {
  period: { from: string; to: string } | null;
  encoding: "utf-8" | "windows-1252";
  rows: SwedbankRow[];
}

export class ImportParseError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ImportParseError";
  }
}

const COLUMNS = {
  clearing: "Clearingnummer",
  accountNumber: "Kontonummer",
  product: "Produkt",
  currency: "Valuta",
  bookingDate: "Bokföringsdag",
  transactionDate: "Transaktionsdag",
  valueDate: "Valutadag",
  reference: "Referens",
  description: "Beskrivning",
  amount: "Belopp",
} as const;

const REQUIRED: (keyof typeof COLUMNS)[] = ["accountNumber", "bookingDate", "description", "amount"];

/** Quick check used to pick a parser for an uploaded file. */
export function looksLikeSwedbankCsv(bytes: Uint8Array): boolean {
  const head = decodeBankText(bytes.subarray(0, 4096)).text;
  return /Bokf.ringsdag/.test(head) && /Belopp/.test(head) && /Kontonummer/.test(head);
}

/**
 * Fingerprint for a Swedbank row:
 * sha256(kontonummer | bokföringsdag | transaktionsdag | valutadag | referens | description_clean | belopp i öre)
 */
export function swedbankFingerprint(r: {
  accountNumber: string;
  bookingDate: string;
  transactionDate: string | null;
  valueDate: string | null;
  reference: string;
  descriptionClean: string;
  amount: number;
}): string {
  return fingerprint([
    r.accountNumber,
    r.bookingDate,
    r.transactionDate ?? "",
    r.valueDate ?? "",
    r.reference,
    r.descriptionClean,
    r.amount,
  ]);
}

export function parseSwedbankCsv(bytes: Uint8Array): SwedbankFile {
  const { text, encoding } = decodeBankText(bytes);
  const lines = text.split(/\r\n|\n|\r/);

  const headerIndex = lines.findIndex((l) => /^﻿?"?Radnummer"?\s*[,;\t]/.test(l) || (/Bokf.ringsdag/.test(l) && /Belopp/.test(l)));
  if (headerIndex === -1) {
    throw new ImportParseError("Filen ser inte ut som en transaktionsexport från Swedbank (hittar ingen rubrikrad).");
  }

  // Everything before the header is metadata, e.g.
  // "* Transaktioner Period 2024-08-18–2026-09-18 Skapad 2026-09-18 13:27 CEST"
  // with spaces, commas or semicolons as separators and '–', '-' or a space between the dates.
  const meta = lines.slice(0, headerIndex).join(" ");
  const periodMatch = /Period\W*(\d{4}-\d{2}-\d{2})\s*[–—\-\s,;]\s*(\d{4}-\d{2}-\d{2})/i.exec(meta);

  const headerLine = lines[headerIndex];
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    headerLine.split(d).length > headerLine.split(best).length ? d : best,
  );

  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parse(lines.slice(headerIndex).join("\n"), {
      delimiter,
      bom: true,
      relax_column_count: false,
      skip_empty_lines: true,
      info: true,
    }) as unknown as typeof records;
  } catch (e) {
    throw new ImportParseError("Kunde inte läsa CSV-filen.", [String((e as Error).message)]);
  }

  const header = records[0].record.map((h) => h.trim());
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, name]) => [key, header.indexOf(name)]),
  ) as Record<keyof typeof COLUMNS, number>;
  const missing = REQUIRED.filter((k) => col[k] === -1).map((k) => COLUMNS[k]);
  if (missing.length) {
    throw new ImportParseError(`Kolumner saknas i filen: ${missing.join(", ")}.`);
  }

  const errors: string[] = [];
  const rows: SwedbankRow[] = [];
  const get = (rec: string[], key: keyof typeof COLUMNS) => (col[key] === -1 ? "" : (rec[col[key]] ?? "").trim());
  const optionalDate = (v: string) => (v === "" ? null : v);

  for (let i = 1; i < records.length; i++) {
    const rec = records[i].record;
    const line = headerIndex + records[i].info.lines;
    const accountNumber = get(rec, "accountNumber").replace(/[\s-]/g, "");
    const bookingDate = get(rec, "bookingDate");
    const transactionDate = optionalDate(get(rec, "transactionDate"));
    const valueDate = optionalDate(get(rec, "valueDate"));
    const amountText = get(rec, "amount");
    const amount = parseAmountToOre(amountText);
    // Keep the raw description exactly as in the file (only the CSV quoting removed).
    const descriptionRaw = col.description === -1 ? "" : (rec[col.description] ?? "");
    const descriptionClean = normalizeWhitespace(descriptionRaw);

    const rowErrors: string[] = [];
    if (!/^\d+$/.test(accountNumber)) rowErrors.push("ogiltigt kontonummer");
    if (!isIsoDate(bookingDate)) rowErrors.push(`ogiltig bokföringsdag "${bookingDate}"`);
    if (transactionDate && !isIsoDate(transactionDate)) rowErrors.push(`ogiltig transaktionsdag "${transactionDate}"`);
    if (valueDate && !isIsoDate(valueDate)) rowErrors.push(`ogiltig valutadag "${valueDate}"`);
    if (amount === null) rowErrors.push(`ogiltigt belopp "${amountText}"`);
    if (descriptionClean === "") rowErrors.push("beskrivning saknas");
    if (rowErrors.length) {
      errors.push(`Rad ${line}: ${rowErrors.join(", ")}`);
      continue;
    }

    const base = {
      line,
      clearing: get(rec, "clearing").replace(/\D/g, ""),
      accountNumber,
      product: get(rec, "product"),
      currency: get(rec, "currency") || "SEK",
      bookingDate,
      transactionDate,
      valueDate,
      reference: get(rec, "reference"),
      descriptionRaw,
      descriptionClean,
      amount: amount!,
    };
    rows.push({ ...base, fingerprint: swedbankFingerprint(base) });
  }

  // All or nothing: a partially read file could silently drop transactions.
  if (errors.length) {
    throw new ImportParseError(`${errors.length} rad(er) kunde inte läsas. Inget har importerats.`, errors.slice(0, 20));
  }

  const dates = rows.map((r) => r.bookingDate).sort();
  const period = periodMatch
    ? { from: periodMatch[1], to: periodMatch[2] }
    : dates.length
      ? { from: dates[0], to: dates[dates.length - 1] }
      : null;

  return { period, encoding, rows };
}
