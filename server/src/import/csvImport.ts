import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { extractCounterparty } from "../categorize/counterparty.js";
import { getSetting, setSetting } from "../settings.js";
import { assignOccurrenceIndexes, fingerprint } from "./fingerprint.js";
import { ImportError, runImport, type CoreResult } from "./importCore.js";
import { ImportParseError } from "./swedbank.js";
import { decodeBankText, isIsoDate, normalizeWhitespace } from "./text.js";

/**
 * A bank's export as a CSV file, read with a column mapping the household
 * makes once per account: which column is the date, which is the text, and
 * how the amount is written. Every Swedish bank exports something close to
 * this, so this is how an account at a bank without an importer of its own is
 * fed. The mapping is kept with the account (settings), so the next file from
 * the same bank is read without asking.
 */

export const DELIMITERS = [",", ";", "\t"] as const;
export const DATE_FORMATS = ["iso", "ymd", "dmy-slash", "dmy-dot", "dmy-dash", "mdy-slash"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface CsvMapping {
  delimiter: (typeof DELIMITERS)[number];
  /** Lines at the top that are not the table (a title, the period). */
  skipLines: number;
  /** The first line of the table is column names, not a transaction. */
  hasHeader: boolean;
  /** The column (0-based) with the booking day. */
  dateColumn: number;
  dateFormat: DateFormat;
  /** The column with what the transaction is: the merchant or the bank's text. */
  textColumn: number;
  /** A second text column to add to the first (a message, a reference). */
  extraTextColumn: number | null;
  /** One column with the amount and its sign, or one column for money out and one for money in. */
  amountMode: "signed" | "split";
  amountColumn: number | null;
  /** 'split': the column with money out and the one with money in, both written without a sign. */
  outColumn: number | null;
  inColumn: number | null;
  /** The decimal mark in the amounts. */
  decimal: "," | ".";
  /** 'signed': money out is a minus sign (how most banks write it). Off: money out is written positive. */
  outIsNegative: boolean;
}

export const DEFAULT_MAPPING: CsvMapping = {
  delimiter: ";",
  skipLines: 0,
  hasHeader: true,
  dateColumn: 0,
  dateFormat: "iso",
  textColumn: 1,
  extraTextColumn: null,
  amountMode: "signed",
  amountColumn: 2,
  outColumn: null,
  inColumn: null,
  decimal: ",",
  outIsNegative: true,
};

// ---------- Reading the file ----------

export interface CsvTable {
  encoding: "utf-8" | "windows-1252";
  /** Every line after the skipped ones, split into cells. */
  rows: string[][];
}

/** The file as rows of cells, with the delimiter and the lines to skip given. */
export function readTable(bytes: Uint8Array, mapping: Pick<CsvMapping, "delimiter" | "skipLines">): CsvTable {
  const { text, encoding } = decodeBankText(bytes);
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const body = lines.slice(Math.max(0, mapping.skipLines)).join("\n");
  try {
    const rows = parse(body, { delimiter: mapping.delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true }) as string[][];
    return { encoding, rows };
  } catch (e) {
    throw new ImportParseError("Filen gick inte att läsa som CSV med de här inställningarna.", [String((e as Error).message)]);
  }
}

/** The delimiter used most on the lines that look like a table: the first few that have any. */
export function guessDelimiter(text: string): CsvMapping["delimiter"] {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 12);
  const score = (d: string) => {
    const counts = lines.map((l) => l.split(d).length - 1).filter((n) => n > 0);
    if (!counts.length) return 0;
    // The same number on most lines is a table; the count itself breaks a tie.
    const mode = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0];
    return counts.filter((n) => n === mode).length * 100 + mode;
  };
  return [";", "\t", ","].map((d) => ({ d, s: score(d) })).sort((a, b) => b.s - a.s)[0].d as CsvMapping["delimiter"];
}

// ---------- Dates and amounts ----------

/** 'YYYY-MM-DD' from a date written in the given way, or null. */
export function parseDate(input: string, format: DateFormat): string | null {
  const s = input.trim();
  let y: string, m: string, d: string;
  const part = (re: RegExp) => re.exec(s);
  let r: RegExpExecArray | null;
  if (format === "iso" && (r = part(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) [, y, m, d] = r;
  else if (format === "ymd" && (r = part(/^(\d{4})(\d{2})(\d{2})$/))) [, y, m, d] = r;
  else if (format === "dmy-slash" && (r = part(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/))) [, d, m, y] = r;
  else if (format === "dmy-dot" && (r = part(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s.*)?$/))) [, d, m, y] = r;
  else if (format === "dmy-dash" && (r = part(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s.*)?$/))) [, d, m, y] = r;
  else if (format === "mdy-slash" && (r = part(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/))) [, m, d, y] = r;
  else return null;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * An amount in öre, with the decimal mark said and spaces, non-breaking
 * spaces and the other mark taken as thousands separators. Never through a
 * floating point number. Null when it isn't an amount.
 */
export function parseAmount(input: string, decimal: "," | "."): number | null {
  let s = input.trim().replace(/−/g, "-").replace(/[\s ]/g, "");
  if (!s) return null;
  const thousands = decimal === "," ? "." : ",";
  s = s.split(thousands).join("").replace(decimal, ".");
  s = s.replace(/^\+/, "");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const ore = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  if (!Number.isSafeInteger(ore)) return null;
  return m[1] ? -ore : ore;
}

// ---------- Guessing the mapping ----------

const HEADER_WORDS = {
  date: /(bokf|book|transaktionsdag|transaction ?date|datum|date|buchung)/i,
  text: /(text|beskrivning|description|meddelande|motpart|mottagare|payee|details|narrative|referens|reference)/i,
  amount: /(belopp|amount|summa|sum|value|värde)/i,
  out: /(debet|debit|uttag|utgift|ut\b|withdrawal|paid ?out)/i,
  inn: /(kredit|credit|ins[äa]ttning|inkomst|in\b|deposit|paid ?in)/i,
};

/** The header's cell for a column wins over a later one: the booking day over the value day. */
function firstIndex(header: string[], re: RegExp, not: number[] = []): number | null {
  const i = header.findIndex((h, k) => !not.includes(k) && re.test(h));
  return i === -1 ? null : i;
}

/** What a file most likely is, from its first lines: the delimiter, where the table starts, the columns and how dates and amounts are written. */
export function guessMapping(bytes: Uint8Array): CsvMapping {
  const { text } = decodeBankText(bytes);
  const delimiter = guessDelimiter(text);
  // The table starts at the first line with as many cells as the lines after it.
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const width = (l: string) => l.split(delimiter).length;
  const target = Math.max(...lines.slice(0, 20).map(width));
  let skipLines = lines.findIndex((l) => l.trim() && width(l) >= Math.max(2, target - 1));
  if (skipLines < 0) skipLines = 0;
  const { rows } = readTable(bytes, { delimiter, skipLines });
  const first = rows[0] ?? [];
  // A header has no amount or date in it.
  const hasHeader = first.length > 0 && first.every((c) => parseAmount(c, ",") === null && parseAmount(c, ".") === null) && !first.some((c) => /^\d{4}-\d{2}-\d{2}$/.test(c));
  const header = hasHeader ? first : [];
  const data = (hasHeader ? rows.slice(1) : rows).slice(0, 30);
  const column = (k: number) => data.map((r) => r[k] ?? "").filter(Boolean);

  const dateColumn = firstIndex(header, HEADER_WORDS.date) ?? Math.max(0, (data[0] ?? []).findIndex((c) => DATE_FORMATS.some((f) => parseDate(c, f) !== null)));
  const sampleDates = column(dateColumn);
  const dateFormat = DATE_FORMATS.find((f) => sampleDates.length > 0 && sampleDates.every((d) => parseDate(d, f) !== null)) ?? "iso";

  const out = firstIndex(header, HEADER_WORDS.out, [dateColumn]);
  const inn = firstIndex(header, HEADER_WORDS.inn, [dateColumn]);
  const amountColumn = firstIndex(header, HEADER_WORDS.amount, [dateColumn]);
  const split = amountColumn === null && out !== null && inn !== null;
  // Without names: the last column with numbers in it is the amount.
  const numeric = (k: number) => column(k).length > 0 && column(k).every((c) => parseAmount(c, ",") !== null || parseAmount(c, ".") !== null);
  const lastNumeric = [...Array(first.length).keys()].reverse().find((k) => k !== dateColumn && numeric(k)) ?? null;
  const amount = split ? null : (amountColumn ?? lastNumeric);

  const textColumn = firstIndex(header, HEADER_WORDS.text, [dateColumn, amount ?? -1, out ?? -1, inn ?? -1]) ?? first.findIndex((_, k) => k !== dateColumn && k !== amount && !numeric(k));
  const amountSample = split ? [...column(out!), ...column(inn!)] : amount === null ? [] : column(amount);
  const decimal: "," | "." = amountSample.some((a) => /,\d{1,2}$/.test(a.trim())) ? "," : amountSample.some((a) => /\.\d{1,2}$/.test(a.trim())) ? "." : ",";
  // Money out is written with a minus sign when any amount has one; a file of only positive amounts is read as money out written positive (a card's), which can be flipped.
  const outIsNegative = split || amountSample.length === 0 || amountSample.some((a) => /^[-−]/.test(a.trim()));

  return {
    delimiter,
    skipLines,
    hasHeader,
    dateColumn,
    dateFormat,
    textColumn: Math.max(0, textColumn),
    extraTextColumn: null,
    amountMode: split ? "split" : "signed",
    amountColumn: amount,
    outColumn: split ? out : null,
    inColumn: split ? inn : null,
    decimal,
    outIsNegative,
  };
}

// ---------- Parsing with a mapping ----------

export interface CsvRow {
  /** 1-based line in the file, for messages. */
  line: number;
  bookingDate: string;
  descriptionRaw: string;
  descriptionClean: string;
  amount: number;
}

export interface CsvParsed {
  encoding: CsvTable["encoding"];
  period: { from: string; to: string } | null;
  rows: CsvRow[];
}

const cell = (r: string[], k: number | null) => (k === null || k < 0 ? "" : (r[k] ?? ""));

/** Why a mapping can't be used, before any row is read. */
export function checkMapping(m: CsvMapping): string | null {
  if (!DELIMITERS.includes(m.delimiter)) return "Okänt skiljetecken.";
  if (!DATE_FORMATS.includes(m.dateFormat)) return "Okänt datumformat.";
  if (![m.dateColumn, m.textColumn].every((k) => Number.isInteger(k) && k >= 0)) return "Välj kolumn för datum och text.";
  if (m.amountMode === "signed" && !(Number.isInteger(m.amountColumn) && m.amountColumn! >= 0)) return "Välj kolumn för beloppet.";
  if (m.amountMode === "split" && !(Number.isInteger(m.outColumn) && m.outColumn! >= 0 && Number.isInteger(m.inColumn) && m.inColumn! >= 0)) return "Välj kolumn för både uttag och insättning.";
  if (m.decimal !== "," && m.decimal !== ".") return "Decimaltecknet är komma eller punkt.";
  return null;
}

/** The file's transactions. A line that can't be read fails the whole file, so a wrong mapping never imports half of it. */
export function parseCsv(bytes: Uint8Array, mapping: CsvMapping): CsvParsed {
  const bad = checkMapping(mapping);
  if (bad) throw new ImportParseError(bad);
  const { encoding, rows: table } = readTable(bytes, mapping);
  const rows: CsvRow[] = [];
  const errors: string[] = [];
  table.forEach((r, i) => {
    if (mapping.hasHeader && i === 0) return;
    const line = i + 1 + mapping.skipLines;
    if (r.every((c) => !c.trim())) return;
    const date = parseDate(cell(r, mapping.dateColumn), mapping.dateFormat);
    const raw = [cell(r, mapping.textColumn), cell(r, mapping.extraTextColumn)].filter((x) => x.trim()).join(" ");
    let amount: number | null;
    if (mapping.amountMode === "signed") {
      amount = parseAmount(cell(r, mapping.amountColumn), mapping.decimal);
      if (amount !== null && !mapping.outIsNegative) amount = -amount;
    } else {
      const out = parseAmount(cell(r, mapping.outColumn), mapping.decimal);
      const inn = parseAmount(cell(r, mapping.inColumn), mapping.decimal);
      amount = out === null && inn === null ? null : Math.abs(inn ?? 0) - Math.abs(out ?? 0);
    }
    const problems = [date === null && `datumet "${cell(r, mapping.dateColumn)}"`, amount === null && `beloppet "${mapping.amountMode === "signed" ? cell(r, mapping.amountColumn) : `${cell(r, mapping.outColumn)} / ${cell(r, mapping.inColumn)}`}"`, !raw.trim() && "texten"].filter(Boolean);
    if (problems.length) return void errors.push(`Rad ${line}: går inte att läsa: ${problems.join(", ")}.`);
    rows.push({ line, bookingDate: date!, descriptionRaw: raw, descriptionClean: normalizeWhitespace(raw), amount: amount! });
  });
  if (errors.length) {
    throw new ImportParseError(`${errors.length} ${errors.length === 1 ? "rad" : "rader"} gick inte att läsa med de här inställningarna. Inget är importerat.`, errors.slice(0, 10));
  }
  if (!rows.length) throw new ImportParseError("Hittar inga transaktioner i filen med de här inställningarna.");
  const dates = rows.map((r) => r.bookingDate).sort();
  return { encoding, period: { from: dates[0], to: dates.at(-1)! }, rows };
}

// ---------- Importing ----------

export interface CsvImportResult extends CoreResult {
  dryRun: boolean;
  source: "csv";
  filename: string;
  period: { from: string; to: string } | null;
  accountId: number;
}

/** A row's identity: the account, the day, the text and the amount. Identical rows on one day are told apart by their order. */
export function csvFingerprint(accountId: number, r: Pick<CsvRow, "bookingDate" | "descriptionClean" | "amount">): string {
  return fingerprint([accountId, "csv", r.bookingDate, r.descriptionClean, r.amount]);
}

const KEY = (accountId: number) => `csv_mapping_${accountId}`;

/** The mapping kept for an account, or null. */
export function savedMapping(db: Db, accountId: number): CsvMapping | null {
  const m = getSetting<Partial<CsvMapping> | null>(db, KEY(accountId), null);
  return m ? { ...DEFAULT_MAPPING, ...m } : null;
}

/**
 * Reads a file with a mapping and imports it onto an account (an account that
 * is fed by CSV files, or by nothing yet). A dry run is the exact preview. On
 * a real import the mapping is kept for the account.
 */
export function importCsv(db: Db, bytes: Uint8Array, filename: string, accountId: number, mapping: CsvMapping, opts: { dryRun?: boolean } = {}): CsvImportResult {
  const dryRun = opts.dryRun ?? false;
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new ImportError("Kontot finns inte.");
  if (account.source !== null && account.source !== "csv") {
    throw new ImportError(`Kontot "${account.name}" läses in från ${account.source === "swedbank" ? "Swedbanks" : account.source === "norwegian" ? "Bank Norwegians" : "Mastercards"} egna filer, inte som CSV. Skapa ett eget konto för CSV-filer.`);
  }
  const parsed = parseCsv(bytes, mapping);
  const rows = assignOccurrenceIndexes(parsed.rows.map((r) => ({ ...r, fingerprint: csvFingerprint(accountId, r) })));
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const core = runImport(tx, {
      source: "csv",
      filename,
      period: parsed.period,
      dryRun,
      rows: rows.map((r) => ({
        accountId,
        bookingDate: r.bookingDate,
        transactionDate: null,
        descriptionRaw: r.descriptionRaw,
        descriptionClean: r.descriptionClean,
        counterparty: extractCounterparty(r.descriptionClean),
        amount: r.amount,
        currency: "SEK",
        cardMasked: null,
        fingerprint: r.fingerprint,
        occurrenceIndex: r.occurrenceIndex,
        defaultShared: false,
      })),
    });
    if (!dryRun) {
      if (account.source === null) tx.update(accounts).set({ source: "csv" }).where(eq(accounts.id, accountId)).run();
      setSetting(tx, KEY(accountId), mapping);
    }
    return { dryRun, source: "csv" as const, filename, period: parsed.period, accountId, ...core };
  });
}

// ---------- The preview ----------

export interface CsvPreview {
  filename: string;
  encoding: CsvTable["encoding"];
  /** The mapping used: the one sent, else the one kept for the account, else the guess. */
  mapping: CsvMapping;
  origin: "sent" | "saved" | "guessed";
  /** The table as the mapping cuts it: the number of columns, the column names if there are any, and the first lines. */
  table: { columns: number; header: string[] | null; sample: string[][]; lines: number };
  /** What the mapping makes of the file: transactions, or why it can't. */
  read: { count: number; period: { from: string; to: string } | null; sample: { date: string; text: string; amountOre: number }[] } | { error: string; details: string[] };
  /** With an account: exactly what importing would do (nothing is written). */
  dryRun: CsvImportResult | null;
}

/** What a file looks like and what a mapping makes of it, for the mapping form. Nothing is written. */
export function previewCsv(db: Db, bytes: Uint8Array, filename: string, opts: { accountId?: number | null; mapping?: Partial<CsvMapping> | null }): CsvPreview {
  const kept = opts.accountId ? savedMapping(db, opts.accountId) : null;
  const guessed = guessMapping(bytes);
  const attempt = (mapping: CsvMapping, origin: CsvPreview["origin"]): CsvPreview => {
    const { encoding, rows } = readTable(bytes, mapping);
    const header = mapping.hasHeader ? (rows[0] ?? []) : null;
    const body = mapping.hasHeader ? rows.slice(1) : rows;
    const table = { columns: Math.max(0, ...rows.slice(0, 30).map((r) => r.length)), header, sample: body.slice(0, 8), lines: body.length };
    let read: CsvPreview["read"];
    let dryRun: CsvImportResult | null = null;
    try {
      const parsed = parseCsv(bytes, mapping);
      read = { count: parsed.rows.length, period: parsed.period, sample: parsed.rows.slice(0, 8).map((r) => ({ date: r.bookingDate, text: r.descriptionClean, amountOre: r.amount })) };
      if (opts.accountId) dryRun = importCsv(db, bytes, filename, opts.accountId, mapping, { dryRun: true });
    } catch (e) {
      if (e instanceof ImportParseError) read = { error: e.message, details: e.details };
      else if (e instanceof ImportError) read = { error: e.message, details: e.details };
      else throw e;
    }
    return { filename, encoding, mapping, origin, table, read, dryRun };
  };
  if (opts.mapping) return attempt({ ...(kept ?? guessed), ...opts.mapping }, "sent");
  if (kept) {
    const fromKept = attempt(kept, "saved");
    // A kept mapping that can't read this file (another export from the same bank, or another bank's file) gives way to a guess.
    if (!("error" in fromKept.read)) return fromKept;
    const fromGuess = attempt(guessed, "guessed");
    return "error" in fromGuess.read ? fromKept : fromGuess;
  }
  return attempt(guessed, "guessed");
}
