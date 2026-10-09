import { fingerprint } from "./fingerprint.js";
import type { PdfLine } from "./pdfText.js";
import { ImportParseError } from "./swedbank.js";
import { isIsoDate, maskLongNumbers, normalizeWhitespace } from "./text.js";

/**
 * Swedbank Mastercard Guld (issued by Entercard): the monthly invoice PDF and
 * the internet bank's transaction list saved as PDF.
 *
 * Identity of a transaction, shared by both (and a future export):
 *
 *   sha256('mastercard' | transaktionsdag | normaliserad beskrivning | belopp i öre)
 *
 * The description is upper case with whitespace collapsed and the invoice's
 * second line 'INTERNET TRANSAKTION' removed; every payment ('INBETALNING',
 * 'INBETALNING BANKGIRO') is 'INBETALNING'. Changing this changes every
 * Mastercard fingerprint: it needs a data migration.
 */
export function mastercardFingerprint(r: { transactionDate: string; description: string; amount: number }): string {
  return fingerprint(["mastercard", r.transactionDate, normalizeMastercardDescription(r.description), r.amount]);
}

export function normalizeMastercardDescription(description: string): string {
  const d = normalizeWhitespace(description.replace(/INTERNET TRANSAKTION/gi, "")).toUpperCase();
  return /^INBETALNING\b/.test(d) ? "INBETALNING" : d;
}

export const isMastercardPayment = (description: string) => /^INBETALNING\b/i.test(description.trim());

export interface MastercardRow {
  transactionDate: string;
  /** The invoice's Bokföringsdatum; the transaction list doesn't have it. */
  postedDate: string | null;
  description: string;
  merchantArea: string | null;
  /** Signed öre as stored: purchases negative, refunds and payments positive. */
  amount: number;
  /** Paid in another currency: amount in hundredths (signed like amount), currency, rate. */
  foreignAmount: number | null;
  foreignCurrency: string | null;
  exchangeRate: number | null;
  cardMasked: string | null;
  isPayment: boolean;
  fingerprint: string;
}

export interface MastercardStatement {
  invoiceDate: string | null;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  openingDebt: number | null;
  paymentsTotal: number | null;
  purchasesTotal: number | null;
  totalDebt: number;
  minPayment: number | null;
  /** 'Vid nästa avisering … köp och uttag gjorda t o m 2026-10-07'. */
  nextPeriodTo: string | null;
}

export interface MastercardInvoice {
  kind: "invoice";
  statement: MastercardStatement;
  rows: MastercardRow[];
}

export interface MastercardList {
  kind: "list";
  /** When the page was saved (the browser's header). */
  printedAt: string;
  /** 'Utnyttjad kredit', positive öre of debt. */
  usedCredit: number;
  rows: MastercardRow[];
  /** Rows cut off (at the end of the document, or unreadable), not imported. */
  incomplete: { date: string; description: string; reason: string }[];
}

/** '8 215,40' / '-161,18' / '−13 149,58' -> öre (two decimals). */
export function parseSekAmount(input: string): number | null {
  const s = input.replace(/[\s  ]/g, "").replace(/−/g, "-");
  const m = /^(-)?(\d+),(\d{2})$/.exec(s);
  if (!m) return null;
  const ore = Number(m[2]) * 100 + Number(m[3]);
  return m[1] ? -ore : ore;
}

/** '5,990 EUR' / '-14,00 EUR' -> { amount in hundredths, currency }; three decimals are rounded. */
export function parseForeign(input: string): { amount: number; currency: string } | null {
  const m = /^([-−])?(\d[\d\s]*),(\d{2,3})\s*([A-Z]{3})$/.exec(input.trim());
  if (!m) return null;
  const whole = Number(m[2].replace(/\s/g, ""));
  const frac = m[3].length === 3 ? Math.round(Number(m[3]) / 10) : Number(m[3]);
  const amount = whole * 100 + frac;
  return { amount: m[1] ? -amount : amount, currency: m[4] };
}

const lineText = (l: PdfLine) => l.items.map((i) => i.text).join(" ");

export type MastercardPdfKind = "invoice" | "list";

/** Which Mastercard document the PDF text is, if any. */
export function detectMastercardPdf(lines: PdfLine[]): MastercardPdfKind | null {
  const text = lines.slice(0, 80).map(lineText).join("\n");
  if (/Mastercard Guld/.test(text) && /Faktura gäller för perioden/.test(text)) return "invoice";
  if (/Betal- och kreditkort Mastercard Guld/.test(text) && lines.some((l) => lineText(l).includes("Korttransaktioner"))) return "list";
  return null;
}

// ---------------------------------------------------------------- invoice

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function findAfter(text: string, re: RegExp): string | null {
  return re.exec(text)?.[1] ?? null;
}

/**
 * The invoice: statement (period, due date, debt, minimum payment, opening
 * debt, payments) from pages 1–2, and every row of the 'Specifikation'. The
 * rows must add up to the invoice's own totals (per card and 'TOTALT'), and
 * opening debt − payments + purchases must be the total debt; otherwise the
 * file is refused. The OCR number, account number, name and address are
 * never kept.
 */
export function parseMastercardInvoice(lines: PdfLine[]): MastercardInvoice {
  const all = lines.map(lineText).join("\n");
  const period = /Faktura gäller för perioden:\s*(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/.exec(all);
  const dueDate = findAfter(all, /Oss tillhanda:\s*(\d{4}-\d{2}-\d{2})/);
  const totalDebt = parseSekAmount(findAfter(all, /Total skuld vid sammanställning:\s*([-−]?[\d\s]+,\d{2})/) ?? "");
  if (!period || !dueDate || totalDebt === null) {
    throw new ImportParseError("PDF:en ser ut som en Mastercard-faktura men perioden, förfallodagen eller skulden gick inte att läsa.");
  }
  // 'Lägst att betala:' and 'Betala hela beloppet:' are headings; the amounts are on the next line, same columns.
  let minPayment: number | null = null;
  const minAt = lines.findIndex((l) => l.items.some((i) => i.text.startsWith("Lägst att betala")));
  if (minAt >= 0 && lines[minAt + 1]) {
    const x = lines[minAt].items.find((i) => i.text.startsWith("Lägst att betala"))!.x;
    const cell = lines[minAt + 1].items.find((i) => Math.abs(i.x - x) < 30);
    minPayment = cell ? parseSekAmount(cell.text) : null;
  }
  const statement: MastercardStatement = {
    invoiceDate: findAfter(all, /Datum vid sammanställning:\s*(\d{4}-\d{2}-\d{2})/),
    periodFrom: period[1],
    periodTo: period[2],
    dueDate,
    openingDebt: parseSekAmount(findAfter(all, /Skuld på föregående faktura:\s*([-−]?[\d\s]+,\d{2})/) ?? ""),
    paymentsTotal: parseSekAmount(findAfter(all, /Periodens inbetalningar:\s*([-−]?[\d\s]+,\d{2})/) ?? ""),
    purchasesTotal: parseSekAmount(findAfter(all, /Periodens köp och transaktioner[^:]*:\s*([-−]?[\d\s]+,\d{2})/) ?? ""),
    totalDebt,
    minPayment,
    nextPeriodTo: findAfter(all, /gjorda t o m (\d{4}-\d{2}-\d{2})/),
  };

  const { rows, paidColumn } = parseSpecification(lines);
  checkInvoiceTotals(lines, rows, paidColumn, statement);
  return { kind: "invoice", statement, rows };
}

interface Columns {
  date: number;
  posted: number;
  description: number;
  area: number | null;
  amount: number;
  paid: number;
}

/**
 * The rows of the specification, and those printed in the 'Inbetalt' column.
 * The invoice counts all of them as paid in: the payments, but also credits
 * such as 'BONUSUTBETALNING', which are not payments of the invoice.
 */
function parseSpecification(lines: PdfLine[]): { rows: MastercardRow[]; paidColumn: Set<MastercardRow> } {
  const start = lines.findIndex((l) => l.items.some((i) => i.text === "Specifikation"));
  if (start < 0) throw new ImportParseError("Hittade ingen specifikation i Mastercard-fakturan.");
  const rows: MastercardRow[] = [];
  const paidColumn = new Set<MastercardRow>();
  let cols: Columns | null = null;
  let card: string | null = null;
  let current: { date: string; posted: string; desc: string[]; area: string[]; amount: number | null; paid: number | null } | null = null;

  const flush = () => {
    if (!current) return;
    const c = current;
    current = null;
    if (c.amount === null && c.paid === null) throw new ImportParseError("En rad i specifikationen saknar belopp.", [`${c.date} ${c.desc.join(" ")}`]);
    const description = maskLongNumbers(normalizeWhitespace(c.desc.filter((d) => !/^INTERNET TRANSAKTION$/i.test(d)).join(" ")));
    // 'PLEX.TV 5,990 EUR Kurs 11,170': city, then the amount in the other currency and the rate.
    const areaText = normalizeWhitespace(c.area.join(" "));
    const foreign = /(-?\d[\d ]*,\d{2,3}\s*[A-Z]{3})/.exec(areaText);
    const rate = /Kurs\s*(\d+,\d+)/.exec(areaText);
    const area = normalizeWhitespace(areaText.replace(/-?\d[\d ]*,\d{2,3}\s*[A-Z]{3}/, "").replace(/Kurs\s*\d+,\d+/, "").replace(/\bKurs\b/, ""));
    const amount = c.amount !== null ? -c.amount : c.paid!;
    const f = foreign ? parseForeign(foreign[1]) : null;
    const row: MastercardRow = {
      transactionDate: c.date,
      postedDate: c.posted,
      description,
      merchantArea: area || null,
      amount,
      foreignAmount: f ? Math.sign(amount) * Math.abs(f.amount) : null,
      foreignCurrency: f?.currency ?? null,
      exchangeRate: rate ? Number(rate[1].replace(",", ".")) : null,
      cardMasked: card,
      isPayment: isMastercardPayment(description),
      fingerprint: mastercardFingerprint({ transactionDate: c.date, description, amount }),
    };
    rows.push(row);
    if (c.amount === null) paidColumn.add(row);
  };

  for (const l of lines.slice(start + 1)) {
    const text = lineText(l);
    if (/^PERIODENS TOTALA|^TOTALT:/.test(text)) {
      flush();
      if (text.startsWith("TOTALT")) break;
      continue;
    }
    const cardNo = /^Kortnr:\s*([\d*]{12,19})/.exec(text);
    if (cardNo || /^Kontonr:/.test(text)) {
      flush();
      // The card number is printed masked; the account number is never kept.
      card = cardNo ? cardNo[1] : null;
      continue;
    }
    if (l.items[0]?.text === "Transaktionsdatum") {
      flush();
      const x = (name: string) => l.items.find((i) => i.text === name)?.x ?? null;
      cols = { date: x("Transaktionsdatum")!, posted: x("Bokföringsdatum")!, description: x("Beskrivning")!, area: x("Ort"), amount: x("Belopp")!, paid: x("Inbetalt")! };
      continue;
    }
    if (!cols) continue;
    const first = l.items[0];
    const startsRow = first && DATE.test(first.text) && Math.abs(first.x - cols.date) < 15;
    if (startsRow) {
      flush();
      const posted = l.items.find((i) => DATE.test(i.text) && Math.abs(i.x - cols!.posted) < 15);
      current = { date: first.text, posted: posted?.text ?? first.text, desc: [], area: [], amount: null, paid: null };
    }
    if (!current) continue;
    for (const it of l.items) {
      if (startsRow && DATE.test(it.text) && it.x < cols.description - 5) continue;
      const money = parseSekAmount(it.text);
      if (money !== null && it.x >= cols.paid - 15) current.paid = money;
      else if (money !== null && it.x >= cols.amount - 25) current.amount = money;
      else if (cols.area !== null && it.x >= cols.area - 5) current.area.push(it.text);
      else if (it.x >= cols.description - 5) current.desc.push(it.text);
    }
  }
  flush();
  if (rows.length === 0) throw new ImportParseError("Specifikationen i Mastercard-fakturan har inga rader.");
  return { rows, paidColumn };
}

function checkInvoiceTotals(lines: PdfLine[], rows: MastercardRow[], paidColumn: Set<MastercardRow>, s: MastercardStatement) {
  const errors: string[] = [];
  const kr = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");
  for (const l of lines.map(lineText)) {
    const perCard = /^PERIODENS TOTALA TRANSAKTIONER KORTNR ([\d*]+):\s*([-−]?[\d\s]+,\d{2})/.exec(l);
    if (perCard) {
      const want = parseSekAmount(perCard[2])!;
      const got = -rows.filter((r) => r.cardMasked === perCard[1] && !r.isPayment).reduce((t, r) => t + r.amount, 0);
      if (got !== want) errors.push(`Kort ${perCard[1]}: raderna ger ${kr(got)}, fakturan säger ${kr(want)}.`);
    }
    const total = /^TOTALT:\s*([-−]?[\d\s]+,\d{2})\s+([-−]?[\d\s]+,\d{2})/.exec(l);
    if (total) {
      const [used, paid] = [parseSekAmount(total[1])!, parseSekAmount(total[2])!];
      // As the invoice counts: 'använt' is the Belopp column, 'inbetalt' the Inbetalt column (a bonus credit is in it too).
      const gotUsed = -rows.filter((r) => !paidColumn.has(r)).reduce((t, r) => t + r.amount, 0);
      const gotPaid = rows.filter((r) => paidColumn.has(r)).reduce((t, r) => t + r.amount, 0);
      if (gotUsed !== used) errors.push(`Totalt använt: raderna ger ${kr(gotUsed)}, fakturan säger ${kr(used)}.`);
      if (gotPaid !== paid) errors.push(`Totalt inbetalt: raderna ger ${kr(gotPaid)}, fakturan säger ${kr(paid)}.`);
    }
  }
  if (s.openingDebt !== null && s.paymentsTotal !== null && s.purchasesTotal !== null) {
    const computed = s.openingDebt - s.paymentsTotal + s.purchasesTotal;
    if (computed !== s.totalDebt) errors.push(`Ingående skuld − inbetalningar + köp = ${kr(computed)}, men total skuld är ${kr(s.totalDebt)}.`);
  }
  if (errors.length) throw new ImportParseError("Mastercard-fakturans rader stämmer inte med dess summor. Inget importerades.", errors);
}

// ---------------------------------------------------------------- transaction list

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const MONTH_HEADING = new RegExp(`^(${MONTHS.join("|")}) (\\d{4})$`);

interface Token {
  page: number;
  y: number;
  x: number;
  text: string;
  /** Top to bottom through the whole document. */
  g: number;
}

/**
 * The internet bank's card page saved as PDF ('Korttransaktioner'). Read by
 * position, not text order (the text layer puts month headings last and may
 * shuffle rows): each date in the date column anchors a row; the description
 * is beside it, the SEK amount on or just above its line, an amount in
 * another currency just below. A currency line cut to the top of the next
 * page belongs to the last row of the page before. Month headings are only
 * used to check the dates. Rows missing a part (the last one is usually cut
 * off) are skipped and reported.
 */
export function parseMastercardList(lines: PdfLine[]): MastercardList {
  const tokens: Token[] = lines.flatMap((l) => l.items.map((i) => ({ page: l.page, y: l.y, x: i.x, text: i.text, g: l.page * 10_000 + (1_000 - l.y) })));
  const all = lines.map(lineText).join("\n");

  const printedAt = /(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}/.exec(all)?.[1];
  const usedAt = lines.findIndex((l) => l.items.some((i) => i.text === "Utnyttjad kredit"));
  const usedX = usedAt >= 0 ? lines[usedAt].items.find((i) => i.text === "Utnyttjad kredit")!.x : 0;
  const usedCell = usedAt >= 0 ? lines[usedAt + 1]?.items.find((i) => Math.abs(i.x - usedX) < 30) : undefined;
  const used = usedCell ? parseSekAmount(usedCell.text) : null;
  if (!printedAt || used === null) {
    throw new ImportParseError("Hittade inte utskriftsdatum eller Utnyttjad kredit i Mastercard-utskriften.");
  }

  const header = tokens.find((t) => t.text === "Datum");
  const amountHeader = tokens.find((t) => t.text === "Belopp");
  if (!header || !amountHeader) throw new ImportParseError("Hittade inte kolumnerna Datum och Belopp i Mastercard-utskriften.");
  const dateX = header.x;
  const amountX = amountHeader.x;

  const isHeaderWord = (t: Token) => ["Transaktioner", "Datum", "Belopp"].includes(t.text);
  const anchors = tokens.filter((t) => isIsoDate(t.text) && Math.abs(t.x - dateX) < 15).sort((a, b) => a.g - b.g);
  const claimed = new Set<Token>(anchors);
  const inAmountColumn = (t: Token) => t.x >= amountX - 25;
  const isForeign = (t: Token) => /[A-Z]{3}$/.test(t.text) && inAmountColumn(t);

  interface Draft {
    anchor: Token;
    desc: Token[];
    amount: Token | null;
    foreign: Token | null;
  }
  const drafts: Draft[] = anchors.map((a) => ({ anchor: a, desc: [], amount: null, foreign: null }));

  // Descriptions: left of the date, on its line or just above/below (a second line like '(...5224)').
  for (const d of drafts) {
    d.desc = tokens.filter(
      (t) => !claimed.has(t) && t.page === d.anchor.page && t.x < dateX - 10 && Math.abs(t.g - d.anchor.g) <= 10 && !MONTH_HEADING.test(t.text) && !isHeaderWord(t),
    );
    d.desc.forEach((t) => claimed.add(t));
  }
  // SEK amount: on the date's line or up to ~8pt above (rows with a currency line centre it).
  for (const d of drafts) {
    const near = tokens
      .filter(
        (t) =>
          !claimed.has(t) && t.page === d.anchor.page && inAmountColumn(t) && parseSekAmount(t.text) !== null && Math.abs(t.g - d.anchor.g) <= 10,
      )
      .sort((a, b) => Math.abs(a.g - d.anchor.g) - Math.abs(b.g - d.anchor.g))[0];
    if (near) {
      d.amount = near;
      claimed.add(near);
    }
  }
  // Currency line: just below the date line.
  for (const d of drafts) {
    const below = tokens
      .filter((t) => !claimed.has(t) && t.page === d.anchor.page && isForeign(t) && t.g > d.anchor.g && t.g - d.anchor.g <= 14)
      .sort((a, b) => a.g - b.g)[0];
    if (below) {
      d.foreign = below;
      claimed.add(below);
    }
  }
  // A currency or amount line at the very top of a page, before its first row, belongs to the last row of the page before.
  for (const t of tokens.filter((x) => !claimed.has(x) && inAmountColumn(x) && !isHeaderWord(x))) {
    const firstOnPage = drafts.find((d) => d.anchor.page === t.page);
    if (firstOnPage && t.g > firstOnPage.anchor.g) continue;
    const previous = [...drafts].reverse().find((d) => d.anchor.page < t.page);
    if (!previous) continue;
    if (isForeign(t) && !previous.foreign) previous.foreign = t;
    else if (parseSekAmount(t.text) !== null && !previous.amount) previous.amount = t;
    else continue;
    claimed.add(t);
  }

  // Month headings, in position order, check the dates.
  const headings = tokens.filter((t) => MONTH_HEADING.test(t.text)).sort((a, b) => a.g - b.g);
  const monthErrors: string[] = [];
  const rows: MastercardRow[] = [];
  const incomplete: MastercardList["incomplete"] = [];
  for (const d of drafts) {
    const date = d.anchor.text;
    const description = maskLongNumbers(
      normalizeWhitespace(
        d.desc
          .sort((a, b) => a.g - b.g || a.x - b.x)
          .map((t) => t.text)
          // '(...5224)' is part of the account number: never kept.
          .filter((t) => !/^\(\.\.\.\d+\)$/.test(t))
          .join(" "),
      ),
    );
    const heading = [...headings].reverse().find((h) => h.g < d.anchor.g);
    if (heading) {
      const m = MONTH_HEADING.exec(heading.text)!;
      const want = `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
      if (date.slice(0, 7) !== want) monthErrors.push(`${date} ${description} står under ${heading.text}.`);
    }
    const amount = d.amount ? parseSekAmount(d.amount.text) : null;
    const foreign = d.foreign ? parseForeign(d.foreign.text) : null;
    const reason = !description ? "beskrivning saknas" : amount === null ? "belopp saknas" : d.foreign && !foreign ? `ofullständig valutarad "${d.foreign.text}"` : null;
    if (reason) {
      incomplete.push({ date, description: description || "?", reason });
      continue;
    }
    rows.push({
      transactionDate: date,
      postedDate: null,
      description,
      merchantArea: null,
      amount: amount!,
      foreignAmount: foreign ? foreign.amount : null,
      foreignCurrency: foreign?.currency ?? null,
      exchangeRate: null,
      cardMasked: null,
      isPayment: isMastercardPayment(description),
      fingerprint: mastercardFingerprint({ transactionDate: date, description, amount: amount! }),
    });
  }
  if (monthErrors.length) throw new ImportParseError("Datumen i Mastercard-utskriften stämmer inte med månadsrubrikerna. Inget importerades.", monthErrors);
  const leftovers = tokens.filter((t) => !claimed.has(t) && inAmountColumn(t) && !isHeaderWord(t) && t.g > anchors[0]?.g && (parseSekAmount(t.text) !== null || isForeign(t)));
  if (leftovers.length) {
    throw new ImportParseError(
      "Några belopp i Mastercard-utskriften gick inte att knyta till en rad. Inget importerades.",
      leftovers.map((t) => `sida ${t.page}: ${t.text}`),
    );
  }
  if (rows.length === 0) throw new ImportParseError("Mastercard-utskriften har inga transaktioner.");
  return { kind: "list", printedAt, usedCredit: -used, rows, incomplete };
}
