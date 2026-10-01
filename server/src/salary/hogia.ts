import { createHash } from "node:crypto";
import { maskAccountNumber } from "../import/text.js";
import { extractPdfLines, type PdfItem, type PdfLine } from "../import/pdfText.js";

/**
 * The employer's payslips (Hogia's web payslip, saved as .htm, or the same as a
 * PDF): a table per box.
 * Read here: the pay day and the payroll month ('Grundlön avser'), every line
 * (löneart, text, period, the info column, quantity, unit price, amount),
 * gross, tax (and what it was computed on), net, the period and year values,
 * the vacation figures and the tax table. Never read: the name, address,
 * employee number or personal identity number; the bank account only masked.
 */

export interface PayslipLine {
  code: string;
  name: string;
  dateFrom: string | null;
  dateTo: string | null;
  info: string | null;
  quantity: number | null;
  /** Öre. */
  unitPrice: number | null;
  /** Öre, signed ('6093,00-' is −609300). */
  amount: number | null;
}

export interface ParsedPayslip {
  payDate: string;
  labelMonth: string | null;
  workMonth: string | null;
  gross: number;
  tax: number;
  net: number;
  taxBasis: number | null;
  taxTable: number | null;
  taxColumn: number | null;
  category: string | null;
  salaryGroup: string | null;
  hoursWorked: number | null;
  ytdGross: number | null;
  ytdTax: number | null;
  ytdNet: number | null;
  ytdHours: number | null;
  vacationIncomeYtd: number | null;
  vacationHourlyRate: number | null;
  vacationEarned: number | null;
  /** 'Semestersaldon': this vacation year's hours taken and left, and the saved hours left. */
  vacationTaken: number | null;
  vacationRemaining: number | null;
  vacationSaved: number | null;
  atfBalance: number | null;
  wellnessYtd: number | null;
  accountMasked: string | null;
  sha256: string;
  lines: PayslipLine[];
}

export class PayslipError extends Error {}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", auml: "ä", Auml: "Ä", aring: "å", Aring: "Å", ouml: "ö", Ouml: "Ö", eacute: "é" };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/[\s ]+/g, " ").trim();

/** The table rows as cell texts, empty rows left out. */
export function rows(html: string): string[][] {
  const clean = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  const out: string[][] = [];
  for (const [, tr] of clean.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(([, td]) => text(td));
    if (cells.some(Boolean)) out.push(cells);
  }
  return out;
}

/** '27353,00' → 2735300, '6093,00-' → −609300, '' → null. */
export function ore(s: string | undefined): number | null {
  const v = decimal(s);
  return v === null ? null : Math.round(v * 100);
}

/** '17,50' → 17.5, '14,00-' → −14. */
export function decimal(s: string | undefined): number | null {
  const t = (s ?? "").replace(/\s/g, "");
  const m = /^(-?)(\d+(?:,\d+)?)(-?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[2].replace(",", "."));
  return m[1] || m[3] ? -v : v;
}

/** '260724' → '2026-07-24'; '2607' → '2026-07'. */
const yymmdd = (s: string) => (/^\d{6}$/.test(s) ? `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}` : null);
const yymm = (s: string) => (/^\d{4}$/.test(s) ? `20${s.slice(0, 2)}-${s.slice(2, 4)}` : null);

export function parsePayslip(html: string): ParsedPayslip {
  return parseRows(rows(html), createHash("sha256").update(html).digest("hex"));
}

/**
 * The same payslip as a PDF (the one the employer mails; first seen for the
 * September 2026 pay day). Its text comes as lines with an x position, and
 * the columns are fixed, so each line is laid out as the row the HTML would
 * have given — and read by the same code.
 */
export async function parsePayslipPdf(bytes: Uint8Array): Promise<ParsedPayslip> {
  const lines = await extractPdfLines(bytes);
  return parseRows(rowsFromPdf(lines), createHash("sha256").update(bytes).digest("hex"));
}

/** Where each column starts on Hogia's PDF, in points: the pay lines, and the two halves below them. */
const LINE_COLUMNS = [0, 85, 195, 280, 395, 440, 490];
const LEFT_COLUMNS = [0, 170, 230, 260];
/** The right half: label, then the period value, then the year value from x 490. */
const RIGHT_HALF = 300;
const RIGHT_VALUES = 440;
const RIGHT_YEAR = 490;

function cells(items: PdfItem[], starts: number[]): string[] {
  const out = starts.map(() => [] as string[]);
  for (const it of items) {
    let i = starts.length - 1;
    while (i > 0 && it.x < starts[i]) i--;
    out[i].push(it.text);
  }
  return out.map((c) => c.join(" "));
}

/** The PDF's lines as the rows `parseRows` reads. */
export function rowsFromPdf(lines: PdfLine[]): string[][] {
  const out: string[][] = [];
  let section: "head" | "lines" | "pay" | "foot" = "head";
  for (const l of lines) {
    const first = l.items[0]?.text ?? "";
    if (first === "Löneart") {
      section = "lines";
      out.push(["Löne-art"]);
      continue;
    }
    if (first.startsWith("Lönen insatt")) {
      section = "pay";
      out.push([first]);
      continue;
    }
    if (section === "lines") out.push(cells(l.items, LINE_COLUMNS));
    else if (section === "pay") {
      out.push(l.items.map((i) => i.text));
      section = "foot";
    } else {
      const left = l.items.filter((i) => i.x < RIGHT_HALF);
      const right = l.items.filter((i) => i.x >= RIGHT_HALF);
      if (section === "head") {
        if (left.length) out.push([left[0].text, left.slice(1).map((i) => i.text).join(" ")]);
        continue;
      }
      if (left.length) out.push(cells(left, LEFT_COLUMNS));
      if (right.length) out.push(rightRow(right));
    }
  }
  return out;
}

/** A row of the right half: its label, the period value and the year value. */
function rightRow(items: PdfItem[]): string[] {
  const text = (list: PdfItem[]) => list.map((i) => i.text).join(" ");
  const label = text(items.filter((i) => i.x < RIGHT_VALUES));
  const period = text(items.filter((i) => i.x >= RIGHT_VALUES && i.x < RIGHT_YEAR));
  const year = text(items.filter((i) => i.x >= RIGHT_YEAR));
  return [label, period, year];
}

export function parseRows(all: string[][], sha256: string): ParsedPayslip {
  const value = (...labels: string[]) => all.find((r) => labels.includes(r[0]));
  const header = (label: string) => value(label)?.[1] || null;

  const start = all.findIndex((r) => r[0] === "Löne-art");
  const payRowAt = all.findIndex((r) => r[0].startsWith("Lönen insatt"));
  if (start < 0 || payRowAt < 0) throw new PayslipError("Känner inte igen lönespecen (Hogia-formatet: 'Löne-art' och 'Lönen insatt på bankkonto').");
  const [account, label, payDay, netText] = all[payRowAt + 1] ?? [];
  const payDate = yymmdd(payDay ?? "");
  if (!payDate) throw new PayslipError("Utbetalningsdagen saknas.");

  const lines: PayslipLine[] = [];
  let gross: number | null = null;
  let taxBasis: number | null = null;
  for (const r of all.slice(start + 1, payRowAt)) {
    if (r[0] === "Fr o m") continue;
    if (r[0] === "" && r[1] === "Summa bruttolön") {
      gross = ore(r.at(-1));
      continue;
    }
    if (!r[0] || r.length < 7) continue;
    const [code, name, dates, info, qty, price, amount] = r;
    const [from, to] = dates.split("-");
    lines.push({
      code,
      name,
      dateFrom: from ? yymmdd(from) : null,
      dateTo: to ? yymmdd(to) : null,
      info: info || null,
      quantity: decimal(qty),
      unitPrice: ore(price),
      amount: ore(amount),
    });
    const basis = /Beräknad på:\s*(\d+)/.exec(info);
    if (code === "900" && basis) taxBasis = Number(basis[1]) * 100;
  }
  const taxLine = lines.find((l) => l.code === "900");
  const period = (label: string) => value(label);
  const brutto = period("Bruttolön");
  const skatt = period("Skatt");
  const netto = period("Nettolön");
  const hours = period("Tjänstgjorda tim");

  // The work month: the month most of the dated lines are for (the salary's period).
  const counts = new Map<string, number>();
  for (const l of lines) if (l.dateFrom) counts.set(l.dateFrom.slice(0, 7), (counts.get(l.dateFrom.slice(0, 7)) ?? 0) + 1);
  const salaryLine = lines.find((l) => l.code === "011" && l.dateFrom);
  const workMonth = salaryLine?.dateFrom?.slice(0, 7) ?? [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const net = ore(netText) ?? ore(netto?.[1]);
  if (gross === null || net === null) throw new PayslipError("Bruttolön eller nettolön saknas.");
  const digits = (account ?? "").replace(/\D/g, "");
  return {
    payDate,
    labelMonth: yymm(label ?? ""),
    workMonth,
    gross,
    tax: -(taxLine?.amount ?? ore(skatt?.[1]) ?? 0),
    net,
    taxBasis,
    taxTable: Number(header("Skattetabell")) || null,
    taxColumn: Number(header("Skattekolumn")) || null,
    category: header("Kategori"),
    salaryGroup: header("Lönegrupp"),
    hoursWorked: decimal(hours?.[1]),
    ytdGross: ore(brutto?.[2]),
    ytdTax: skatt?.[2] ? -(ore(skatt[2]) ?? 0) : null,
    ytdNet: ore(netto?.[2]),
    ytdHours: decimal(hours?.[2]),
    vacationIncomeYtd: ore(value("*Sem.gr inkomst", "Sem.gr inkomst")?.[2]),
    // In the period column on the HTML, in the year column on the PDF.
    vacationHourlyRate: ore(value("Semestertimlön")?.[1] || value("Semestertimlön")?.[2]),
    // Antal, Uttag, Kvarv.
    vacationEarned: decimal(value("Intjänad semester")?.[1]),
    vacationTaken: decimal(value("Intjänad semester")?.[2]),
    vacationRemaining: decimal(value("Intjänad semester")?.[3]),
    vacationSaved: decimal(value("Sparad semester")?.[3]),
    atfBalance: decimal(value("ATF saldo")?.[1]),
    wellnessYtd: ore(value("Friskvård använt")?.[2]),
    accountMasked: digits.length >= 6 ? maskAccountNumber(digits) : null,
    sha256,
    lines,
  };
}

/** The lönearter the model knows (what it reads the constants and hours from). */
export const KNOWN_CODES: Record<string, string> = {
  "011": "Månadslön",
  "01d": "Fast tillägg",
  "02f": "Lönetillägg",
  "160": "Mertid",
  "03b": "Timlön",
  "21a": "Avdrag semester",
  "205": "Semestertimlön",
  bfr: "Frånvaro övertidsgräns",
  "424": "Uttag ATF",
  atb: "Utbetalning ATF",
  "900": "Prel.skatt",
  "676": "Utlägg friskvård",
  "677": "Moms på utlägg friskvård",
  "700": "Moms",
};
