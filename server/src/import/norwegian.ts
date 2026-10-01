import { extractPdfLines, type PdfLine } from "./pdfText.js";
import { norwegianFingerprint, splitPdfDescription } from "./norwegianKey.js";
import { ImportParseError } from "./swedbank.js";
import { maskLongNumbers, normalizeWhitespace } from "./text.js";

export { maskLongNumbers };

export interface NorwegianRow {
  page: number;
  date: string; // YYYY-MM-DD (transaction date)
  descriptionRaw: string; // as printed; for payments long digit runs are masked
  /** Merchant text without the city (same as XLSX 'Text'), or the payment text. */
  descriptionClean: string;
  merchantArea: string | null;
  cardMasked: string | null; // '479696******6699' (already masked by the bank)
  /** Signed öre as stored: purchases negative, payments positive. */
  amount: number;
  isPayment: boolean;
  fingerprint: string;
}

export interface NorwegianStatement {
  invoiceDate: string | null;
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  openingDebt: number | null; // öre
  paymentsTotal: number | null; // öre, as printed (negative)
  purchasesTotal: number | null; // öre, as printed (positive)
  totalDebt: number; // öre, positive
  minPayment: number | null; // öre
}

export interface NorwegianInvoice {
  statement: NorwegianStatement;
  rows: NorwegianRow[];
}

const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const MASKED_CARD = /^\d{4,6}\*{2,}\d{4}$/;

/** '8.847,47' / '-8.847,47' / 'Kr 300,00' -> öre. Swedish/Norwegian formatting only. */
export function parseNordicAmount(input: string): number | null {
  const s = input.replace(/^Kr\s*/i, "").replace(/[\s ]/g, "").replace(/−/g, "-");
  const m = /^(-)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(s);
  if (!m) return null;
  const ore = Number(m[2].replace(/\./g, "")) * 100 + Number(m[3]);
  return m[1] ? -ore : ore;
}

function isoDate(ddmmyyyy: string): string | null {
  const m = DATE.exec(ddmmyyyy);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** '16.08.26' or '16.08.2026' -> '2026-08-16'. */
function isoDateShortYear(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  return isoDate(`${m[1]}.${m[2]}.${m[3].length === 2 ? `20${m[3]}` : m[3]}`);
}


export function looksLikeNorwegianPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "%PDF";
}

export async function parseNorwegianPdf(bytes: Uint8Array): Promise<NorwegianInvoice> {
  let lines: PdfLine[];
  try {
    lines = await extractPdfLines(bytes);
  } catch (e) {
    throw new ImportParseError("Kunde inte läsa PDF-filen.", [String((e as Error).message)]);
  }
  return parseNorwegianLines(lines);
}

/** Parses already extracted lines. Separate from PDF reading so it can be tested with synthetic invoices. */
export function parseNorwegianLines(lines: PdfLine[]): NorwegianInvoice {
  if (!lines.some((l) => l.items.some((i) => /Bank Norwegian/i.test(i.text)))) {
    throw new ImportParseError("PDF:en ser inte ut som en faktura från Bank Norwegian.");
  }
  const statement = parseStatement(lines);
  const rows = parseTable(lines);
  validateTotals(statement, rows);
  return { statement, rows };
}

function parseStatement(lines: PdfLine[]): NorwegianStatement {
  const lineStartingWith = (re: RegExp) => lines.find((l) => re.test(l.items[0]?.text ?? ""));
  const lastAmount = (re: RegExp) => {
    const l = lineStartingWith(re);
    return l ? parseNordicAmount(l.items[l.items.length - 1].text) : null;
  };
  const valueAfterLabel = (re: RegExp) => {
    const l = lineStartingWith(re);
    // Only the cell right after the label: the address block on the right can
    // share the baseline (e.g. the name on the 'Period' line).
    return l && l.items.length > 1 ? l.items[1].text : null;
  };

  const invoiceDate = isoDate(valueAfterLabel(/^Fakturadatum$/) ?? "");
  const dueDate = isoDate(valueAfterLabel(/^Förfallodatum$/) ?? "");
  const periodText = valueAfterLabel(/^Period$/) ?? "";
  const periodMatch = /^(\S+)\s*-\s*(\S+)$/.exec(periodText);
  const periodFrom = periodMatch ? isoDateShortYear(periodMatch[1]) : null;
  const periodTo = periodMatch ? isoDateShortYear(periodMatch[2]) : null;
  const totalDebt = lastAmount(/^Total skuld per/);

  const missing = [
    !dueDate && "förfallodatum",
    !(periodFrom && periodTo) && "period",
    totalDebt === null && "total skuld",
  ].filter(Boolean);
  if (missing.length) {
    throw new ImportParseError(`Hittar inte ${missing.join(", ")} på fakturans första sida.`);
  }

  return {
    invoiceDate,
    dueDate: dueDate!,
    periodFrom: periodFrom!,
    periodTo: periodTo!,
    openingDebt: lastAmount(/^Ingående skuld/),
    paymentsTotal: lastAmount(/^Summa inbetalningar/),
    purchasesTotal: lastAmount(/^Summa transaktioner/),
    totalDebt: totalDebt!,
    minPayment: lastAmount(/^Lägsta belopp att betala/),
  };
}

function parseTable(lines: PdfLine[]): NorwegianRow[] {
  const rows: NorwegianRow[] = [];
  let columns: { description: number; card: number; amount: number } | null = null;

  for (const line of lines) {
    const texts = line.items.map((i) => i.text);
    if (texts[0] === "Datum" && texts.includes("Beskrivning") && texts.some((t) => /^Belopp/.test(t))) {
      const x = (re: RegExp) => line.items.find((i) => re.test(i.text))?.x;
      columns = { description: x(/^Beskrivning$/)!, card: x(/^Kortnr/) ?? Infinity, amount: x(/^Belopp/)! };
      continue;
    }
    if (!columns) continue;

    const first = line.items[0];
    const date = isoDate(first.text);
    if (!date || first.x >= columns.description) continue;

    const last = line.items[line.items.length - 1];
    const printed = line.items.length >= 3 && last.x >= columns.amount - 60 ? parseNordicAmount(last.text) : null;
    if (printed === null) {
      throw new ImportParseError("En rad i transaktionstabellen kunde inte tolkas. Inget har importerats.", [
        `Sida ${line.page}: ${texts.join(" | ")}`,
      ]);
    }

    // Description = cells after the date, up to the card number / card column.
    const rest = line.items.slice(1, -1);
    const descEnd = rest.findIndex((i) => MASKED_CARD.test(i.text) || i.x >= columns!.card - 20);
    const descItems = descEnd === -1 ? rest : rest.slice(0, descEnd);
    const card = rest.find((i) => MASKED_CARD.test(i.text))?.text ?? null;
    const printedText = descItems.map((i) => i.text).join(" ");
    const isPayment = /^Inbetalning\b/i.test(normalizeWhitespace(printedText));
    // Purchases are positive on the invoice; we store money out as negative.
    const amount = -printed;
    const { merchant, area } = isPayment ? { merchant: normalizeWhitespace(printedText), area: null } : splitPdfDescription(printedText);

    rows.push({
      page: line.page,
      date,
      // Payment texts contain the paying account number: mask it.
      descriptionRaw: isPayment ? maskLongNumbers(printedText) : printedText,
      descriptionClean: isPayment ? maskLongNumbers(merchant) : merchant,
      merchantArea: area,
      cardMasked: card,
      amount,
      isPayment,
      fingerprint: norwegianFingerprint({ transactionDate: date, merchantText: merchant, isPayment, amount }),
    });
  }

  if (!columns) throw new ImportParseError("Hittar inte transaktionstabellen i fakturan.");
  return rows;
}

/**
 * The invoice summary on page 1 must agree with the table, otherwise the table
 * was not read correctly and nothing is imported.
 */
function validateTotals(s: NorwegianStatement, rows: NorwegianRow[]): void {
  const sum = (rs: NorwegianRow[]) => rs.reduce((acc, r) => acc - r.amount, 0); // back to printed sign
  const problems: string[] = [];
  const fmt = (ore: number) => (ore / 100).toFixed(2);
  const purchases = sum(rows.filter((r) => !r.isPayment));
  const payments = sum(rows.filter((r) => r.isPayment));
  if (s.purchasesTotal !== null && purchases !== s.purchasesTotal) {
    problems.push(`Köp i tabellen: ${fmt(purchases)}, enligt fakturan: ${fmt(s.purchasesTotal)}`);
  }
  if (s.paymentsTotal !== null && payments !== s.paymentsTotal) {
    problems.push(`Inbetalningar i tabellen: ${fmt(payments)}, enligt fakturan: ${fmt(s.paymentsTotal)}`);
  }
  if (s.openingDebt !== null && s.paymentsTotal !== null && s.purchasesTotal !== null) {
    const computed = s.openingDebt + s.paymentsTotal + s.purchasesTotal;
    if (computed !== s.totalDebt) problems.push(`Ingående skuld + inbetalningar + köp = ${fmt(computed)}, men total skuld är ${fmt(s.totalDebt)}`);
  }
  if (problems.length) {
    throw new ImportParseError("Fakturans summor stämmer inte med tabellen. Inget har importerats.", problems);
  }
}
