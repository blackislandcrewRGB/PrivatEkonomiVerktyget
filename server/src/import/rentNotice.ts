import crypto from "node:crypto";
import type { PdfLine } from "./pdfText.js";
import { ImportParseError } from "./swedbank.js";
import { isIsoDate, normalizeWhitespace, parseAmountToOre } from "./text.js";

/**
 * A rent notice ('HYRESFAKTURA', hyresavi) as a landlord's accounting system
 * prints it: a specification of the month's rent and additions, 'Att betala',
 * 'Förfallodatum', and a payment slip with the same numbers repeated
 * ('Avinr: 2792, Att betala: 7 500,00'). The landlord sends a few months at a
 * time, one PDF each.
 */

export interface RentNoticeLine {
  text: string;
  /** Öre, as on the notice (an addition positive). */
  amount: number;
}

export interface RentNotice {
  /** Betalningsmottagare. */
  issuer: string;
  /** Avinr. */
  number: string;
  noticeDate: string | null;
  dueDate: string;
  /** The month the rent is for ('Hyra för Oktober - 2026' → '2026-10'). */
  rentMonth: string;
  /** Att betala, öre. */
  amount: number;
  lines: RentNoticeLine[];
  bankgiro: string | null;
  sha256: string;
}

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

const lineText = (l: PdfLine) => normalizeWhitespace(l.items.map((i) => i.text).join(" "));

export function looksLikeRentNotice(lines: PdfLine[]): boolean {
  return lines.slice(0, 20).some((l) => /\bHYRES(FAKTURA|AVI)\b/i.test(lineText(l)));
}

/** The amount at the right end of a line: its items from the amount column on ('7' '330,99' → 733099). */
function rightAmount(l: PdfLine, from: number): number | null {
  const text = l.items
    .filter((i) => i.x >= from)
    .map((i) => i.text)
    .join("");
  return text ? parseAmountToOre(text) : null;
}

export function parseRentNotice(lines: PdfLine[], bytes: Uint8Array): RentNotice {
  const text = lines.map(lineText).join("\n");
  const find = (re: RegExp) => re.exec(text)?.[1] ?? null;

  const number = find(/Avinr:?\s*(\d+)/);
  const dueDate = find(/Förfallodatum:?\s*(\d{4}-\d{2}-\d{2})/);
  const noticeDate = find(/Avidatum:?\s*(\d{4}-\d{2}-\d{2})/);
  const toPay = find(/Att betala:\s*([\d\s ]+,\d{2})/);
  const bankgiro = find(/Bankgiro:?\s*(\d{3,4}-\d{4})/);
  const rent = /Hyra för\s+(\p{L}+)\s*-\s*(\d{4})/u.exec(text);
  const month = rent ? MONTHS.indexOf(rent[1].toLowerCase()) : -1;

  // Betalningsmottagare: the line under the label, from the label's column.
  const labelAt = lines.findIndex((l) => l.items.some((i) => i.text.trim() === "Betalningsmottagare"));
  const labelX = labelAt >= 0 ? lines[labelAt].items.find((i) => i.text.trim() === "Betalningsmottagare")!.x : null;
  const issuer =
    labelAt >= 0 && labelX !== null
      ? (lines[labelAt + 1]?.items.find((i) => Math.abs(i.x - labelX) < 10)?.text.trim() ?? null)
      : null;

  const missing = [
    !number && "Avinr",
    !(dueDate && isIsoDate(dueDate)) && "Förfallodatum",
    !toPay && "Att betala",
    month < 0 && "Hyra för (månad)",
    !issuer && "Betalningsmottagare",
  ].filter((m): m is string => !!m);
  if (missing.length) throw new ImportParseError("Kunde inte läsa hyresavin.", [`Saknas: ${missing.join(", ")}.`]);
  const amount = parseAmountToOre(toPay!)!;

  // The specification: the rows between its heading and 'Att betala', amounts in the heading's 'Radbelopp' column.
  const head = lines.findIndex((l) => l.items.some((i) => i.text.trim() === "Specifikation"));
  const amountX = head >= 0 ? (lines[head].items.find((i) => /Radbelopp/.test(i.text))?.x ?? null) : null;
  const end = lines.findIndex((l, i) => i > head && l.items.some((it) => it.text.trim() === "Att betala"));
  const specLines: RentNoticeLine[] = [];
  if (head >= 0 && amountX !== null && end > head) {
    for (const l of lines.slice(head + 1, end)) {
      const lineAmount = rightAmount(l, amountX - 20);
      const label = l.items.find((i) => i.x < 300)?.text.trim();
      if (lineAmount !== null && label) specLines.push({ text: label, amount: lineAmount });
    }
  }
  const sum = specLines.reduce((s, l) => s + l.amount, 0);
  if (specLines.length && sum !== amount) {
    throw new ImportParseError("Hyresavins rader går inte ihop med Att betala.", [`Raderna ${sum / 100} kr, Att betala ${amount / 100} kr.`]);
  }

  return {
    issuer: issuer!,
    number: number!,
    noticeDate: noticeDate && isIsoDate(noticeDate) ? noticeDate : null,
    dueDate: dueDate!,
    rentMonth: `${rent![2]}-${String(month + 1).padStart(2, "0")}`,
    amount,
    lines: specLines,
    bankgiro,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}
