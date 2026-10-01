import { readSheet } from "read-excel-file/node";
import { ImportParseError } from "./swedbank.js";
import { isIsoDate, maskLongNumbers, normalizeWhitespace, parseAmountToOre } from "./text.js";
import { norwegianFingerprint } from "./norwegianKey.js";

export interface NorwegianXlsxRow {
  line: number;
  transactionDate: string;
  bookDate: string | null;
  type: string;
  descriptionRaw: string;
  descriptionClean: string;
  merchantArea: string | null;
  merchantCategory: string | null;
  /** Signed öre, as in the file: purchases negative, payments positive. */
  amount: number;
  isPayment: boolean;
  fingerprint: string;
}

export interface NorwegianXlsxFile {
  /** Range of BookDate (the export's calendar month), else of transaction dates. */
  period: { from: string; to: string } | null;
  rows: NorwegianXlsxRow[];
  /** 'Reserverat' rows are not imported: counted and summed for the summary. */
  reserved: { count: number; amount: number };
  /** Types other than Köp / Betalning / Reserverat (imported as ordinary rows). */
  otherTypes: string[];
}

const COLUMNS = {
  transactionDate: "TransactionDate",
  text: "Text",
  type: "Type",
  amount: "Amount",
  merchantArea: "Merchant Area",
  merchantCategory: "Merchant Category",
  bookDate: "BookDate",
} as const;
const REQUIRED: (keyof typeof COLUMNS)[] = ["transactionDate", "text", "type", "amount"];

type Cell = string | number | boolean | Date | null | undefined | unknown;

export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Excel serial day number (1900 system) or a date cell -> 'YYYY-MM-DD'. */
export function excelDate(cell: Cell): string | null {
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? null : cell.toISOString().slice(0, 10);
  }
  const s = typeof cell === "number" ? String(cell) : typeof cell === "string" ? cell.trim() : "";
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    // 25569 = 1970-01-01. Serials below 61 hit Excel's 1900 leap-year bug; not real data.
    if (serial < 61) return null;
    return new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
  }
  return isIsoDate(s) ? s : null;
}

const text = (cell: Cell): string => (cell === null || cell === undefined ? "" : String(cell));

export async function parseNorwegianXlsx(bytes: Uint8Array): Promise<NorwegianXlsxFile> {
  let data: Cell[][];
  try {
    // Numbers as the raw strings from the file: amounts never pass through floats.
    const options = { parseNumber: (s: string) => s, trim: false };
    try {
      data = (await readSheet(Buffer.from(bytes), "transactions", options)) as Cell[][];
    } catch {
      data = (await readSheet(Buffer.from(bytes), 1, options)) as Cell[][];
    }
  } catch (e) {
    throw new ImportParseError("Kunde inte läsa Excel-filen.", [String((e as Error).message)]);
  }

  const header = (data[0] ?? []).map((h) => normalizeWhitespace(text(h)).toLowerCase());
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, name]) => [k, header.indexOf(name.toLowerCase())]),
  ) as Record<keyof typeof COLUMNS, number>;
  const missing = REQUIRED.filter((k) => col[k] === -1).map((k) => COLUMNS[k]);
  if (missing.length) {
    throw new ImportParseError(
      `Filen ser inte ut som en transaktionsexport från Bank Norwegian (kolumner saknas: ${missing.join(", ")}).`,
    );
  }
  const get = (row: Cell[], k: keyof typeof COLUMNS): Cell => (col[k] === -1 ? null : row[col[k]]);

  const rows: NorwegianXlsxRow[] = [];
  const errors: string[] = [];
  const reserved = { count: 0, amount: 0 };
  const otherTypes = new Set<string>();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every((c) => text(c).trim() === "")) continue;
    const line = i + 1;
    const type = normalizeWhitespace(text(get(row, "type")));
    const typeKey = type.toLowerCase();
    const amount = parseAmountToOre(text(get(row, "amount")));
    const transactionDate = excelDate(get(row, "transactionDate"));

    const rowErrors: string[] = [];
    if (amount === null) rowErrors.push(`ogiltigt belopp "${text(get(row, "amount"))}"`);
    if (!transactionDate) rowErrors.push(`ogiltigt datum "${text(get(row, "transactionDate"))}"`);
    if (!type) rowErrors.push("typ saknas");

    if (typeKey === "reserverat") {
      if (rowErrors.length) errors.push(`Rad ${line}: ${rowErrors.join(", ")}`);
      else {
        reserved.count++;
        reserved.amount += amount!;
      }
      continue;
    }

    const descriptionRaw = text(get(row, "text"));
    const isPayment = typeKey === "betalning";
    const merchant = normalizeWhitespace(descriptionRaw);
    if (!merchant && !isPayment) rowErrors.push("text saknas");
    const bookCell = get(row, "bookDate");
    const bookDate = text(bookCell).trim() === "" ? null : excelDate(bookCell);
    if (text(bookCell).trim() !== "" && !bookDate) rowErrors.push(`ogiltigt bokföringsdatum "${text(bookCell)}"`);
    if (rowErrors.length) {
      errors.push(`Rad ${line}: ${rowErrors.join(", ")}`);
      continue;
    }
    if (!["köp", "betalning"].includes(typeKey)) otherTypes.add(type);

    const optional = (k: keyof typeof COLUMNS) => normalizeWhitespace(text(get(row, k))) || null;
    rows.push({
      line,
      transactionDate: transactionDate!,
      bookDate,
      type,
      descriptionRaw: isPayment ? maskLongNumbers(descriptionRaw) : descriptionRaw,
      descriptionClean: isPayment ? maskLongNumbers(merchant || "Inbetalning") : merchant,
      merchantArea: optional("merchantArea"),
      merchantCategory: optional("merchantCategory"),
      amount: amount!,
      isPayment,
      fingerprint: norwegianFingerprint({ transactionDate: transactionDate!, merchantText: merchant, isPayment, amount: amount! }),
    });
  }

  if (errors.length) {
    throw new ImportParseError(`${errors.length} rad(er) kunde inte läsas. Inget har importerats.`, errors.slice(0, 20));
  }

  const dates = rows.map((r) => r.bookDate ?? r.transactionDate).sort();
  return {
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    rows,
    reserved,
    otherTypes: [...otherTypes],
  };
}
