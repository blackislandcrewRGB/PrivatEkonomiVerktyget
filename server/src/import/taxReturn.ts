import type { PdfLine } from "./pdfText.js";
import { ImportParseError } from "./swedbank.js";
import { isIsoDate, normalizeWhitespace } from "./text.js";

/**
 * Skatteverket's receipt for a filed income tax return ('Kvittens –
 * Inkomstdeklaration 1'): the income year, the day it was sent, and one line
 * per box filled in ('1.1 | Lön, förmåner, sjukpenning m.m. | 312 400').
 *
 * The boxes are read by their numbers, not their texts, so a rewording
 * between years doesn't break it; boxes not asked for are skipped. The
 * receipt's name, personnummer and receipt number are never read out of it.
 */

/** The boxes kept, by their numbers on the form. */
export const TAX_RETURN_BOXES = {
  "1.1": "employmentIncome",
  "2.1": "commuteDeduction",
  "7.1": "iskStandardIncome",
  "7.2": "capitalIncome",
  "8.1": "capitalExpenses",
} as const;

export type TaxReturnBox = (typeof TAX_RETURN_BOXES)[keyof typeof TAX_RETURN_BOXES];
/** Öre per box; null when the receipt doesn't have it. */
export type TaxReturnBoxes = Record<TaxReturnBox, number | null>;

export interface TaxReturnReceipt {
  incomeYear: number;
  /** 'Datum' on the receipt: when the return was sent. */
  submittedAt: string | null;
  boxes: TaxReturnBoxes;
}

export const emptyBoxes = (): TaxReturnBoxes => ({
  employmentIncome: null,
  commuteDeduction: null,
  iskStandardIncome: null,
  capitalIncome: null,
  capitalExpenses: null,
});

const lineText = (l: PdfLine) => normalizeWhitespace(l.items.map((i) => i.text).join(" "));

export function looksLikeTaxReturn(lines: PdfLine[]): boolean {
  const head = lines.slice(0, 20).map(lineText).join("\n");
  return /Skatteverket/.test(head) && /\bKvittens\b/.test(head) && /Inkomstdeklaration/.test(head);
}

const BOX_NUMBER = /^\d{1,2}\.\d{1,2}$/;
// A value or a part of one: '312 400', or '312' and '400' as items of their own.
const VALUE_PART = /^\d{1,3}(?:[  ]\d{3})*$|^\d+$/;

/** A box line's value: the digit groups at its right end, after the number and the text (kronor → öre). */
function boxValue(l: PdfLine): number | null {
  const parts: string[] = [];
  for (let i = l.items.length - 1; i >= 2 && VALUE_PART.test(l.items[i].text); i--) parts.unshift(l.items[i].text);
  if (!parts.length) return null;
  return Number(parts.join("").replace(/\D/g, "")) * 100;
}

export function parseTaxReturn(lines: PdfLine[]): TaxReturnReceipt {
  const text = lines.map(lineText).join("\n");
  const submittedAt = lines.flatMap((l) => l.items).find((i) => isIsoDate(i.text))?.text ?? null;
  // The oldest receipts have no 'Inkomståret': a return is filed the year after.
  const year = /Inkomståret\s+(\d{4})/.exec(text)?.[1];
  const incomeYear = year ? Number(year) : submittedAt ? Number(submittedAt.slice(0, 4)) - 1 : null;
  if (incomeYear === null) throw new ImportParseError("Hittar inte inkomståret i deklarationskvittensen.");

  const boxes = emptyBoxes();
  for (const l of lines) {
    const number = l.items[0]?.text;
    if (!number || !BOX_NUMBER.test(number) || !(number in TAX_RETURN_BOXES)) continue;
    const value = boxValue(l);
    if (value !== null) boxes[TAX_RETURN_BOXES[number as keyof typeof TAX_RETURN_BOXES]] = value;
  }
  if (Object.values(boxes).every((v) => v === null)) {
    throw new ImportParseError("Deklarationskvittensen har inga av raderna 1.1, 2.1, 7.1, 7.2 eller 8.1.");
  }
  return { incomeYear, submittedAt, boxes };
}
