/**
 * Receipts: what the money actually bought.
 *
 * A receipt is copied from the shop's own page or app (Lidl and ICA on the
 * web, Willys and Rusta as PDFs from Kivra) and pasted in. Every shop writes
 * its own dialect, so there is one profile per shop, and all of them come out
 * as the same rows.
 *
 * Every receipt states its total, and that is what makes this safe: the parsed
 * rows are added up and compared with it. `balances` false means the tool got
 * something wrong and has to say so instead of saving a quiet lie. Nothing here
 * is money — the transaction is still the truth about what was paid.
 */

import { RECEIPT_LINE_KINDS, RECEIPT_STORES } from "../db/schema.js";

export type ReceiptStore = (typeof RECEIPT_STORES)[number];
/**
 * `discount` is a row that belongs to the purchase above it (a member's price,
 * '3 för 25:-'); `deposit` is the bottle deposit and `bag` the carrier bag.
 * They are all money spent, but only `item` rows are groceries to follow over
 * time.
 */
export type ReceiptLineKind = (typeof RECEIPT_LINE_KINDS)[number];

export class ReceiptError extends Error {}

export interface ParsedLine {
  kind: ReceiptLineKind;
  name: string;
  /** Thousandths, so 2 pieces is 2000 and 0,124 kg is 124 — exact, like öre. */
  quantityMilli: number | null;
  unit: "st" | "kg" | null;
  unitPriceOre: number | null;
  /** What the row changed the bill by: negative for a discount. */
  totalOre: number;
}

export interface ParsedReceipt {
  store: ReceiptStore;
  /** The shop and where it is, as the receipt writes it ('Willys Exempelstad Centrum'). */
  storeArea: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  lines: ParsedLine[];
  /** The total the receipt itself states, null when it doesn't. */
  totalOre: number | null;
  /** What the rows add up to. */
  sumOre: number;
  /** The rows add up to the stated total: nothing was missed or read twice. */
  balances: boolean;
  /** 'Totalt 27 varor' when the receipt counts them, for a second check. */
  statedItemCount: number | null;
}

const MINUS = /[−–—]/g;
const SPACES = /[\s  ]+/g;

/** '−1 234,56' -> -123456. Handles the real minus sign the shops' pages use. */
function ore(text: string): number {
  const clean = text.replace(MINUS, "-").replace(SPACES, "").replace("kr", "");
  const m = /^(-?)(\d+),(\d{2})$/.exec(clean);
  if (!m) throw new ReceiptError(`Kunde inte läsa beloppet "${text}".`);
  const value = Number(m[2]) * 100 + Number(m[3]);
  return m[1] ? -value : value;
}

/** '0,124' -> 124, '3' -> 3000. */
function milli(text: string): number {
  const [whole, fraction = ""] = text.replace(MINUS, "-").replace(SPACES, "").split(",");
  return Number(whole) * 1000 + Number((fraction + "000").slice(0, 3));
}

const clean = (s: string) => s.replace(SPACES, " ").trim();

/** Leading bullets and ICA's campaign asterisk are punctuation, not the name. */
const cleanName = (s: string) => clean(s).replace(/^[*•\s]+/, "").replace(/\s*[:.]$/, "").trim();

/** What a row is, from what it is called. */
function kindOf(name: string, totalOre: number): ReceiptLineKind {
  const n = name.toLocaleLowerCase("sv");
  if (totalOre < 0 || /rabatt|^\d+\s*för\s|erhållen/.test(n)) return "discount";
  // Willys writes '+PANT ENG PET', Lidl 'Pantburk 1,00 SE'.
  if (/^\+?pant/.test(n)) return "deposit";
  if (/kasse\b|påse\b/.test(n)) return "bag";
  return "item";
}

function line(name: string, totalOre: number, qty?: { quantityMilli: number; unit: "st" | "kg"; unitPriceOre: number }): ParsedLine {
  const clean = cleanName(name);
  return {
    kind: kindOf(clean, totalOre),
    name: clean,
    quantityMilli: qty?.quantityMilli ?? null,
    unit: qty?.unit ?? null,
    unitPriceOre: qty?.unitPriceOre ?? null,
    totalOre,
  };
}

/** '2st*26,90', '3 st * 9,90 kr/st', '0,180kg*89,90kr/kg', '15,61 x 2', '0,124 kg x 10,90 SEK/kg'. */
function quantity(text: string): { quantityMilli: number; unit: "st" | "kg"; unitPriceOre: number } | null {
  const t = clean(text);
  // count first, then the price: '2st*26,90', '5 st * 9,90 kr/st'
  let m = /^(\d+(?:,\d+)?)\s*(st|kg)\s*[*x×]\s*(\d+,\d{2})/i.exec(t);
  if (m) return { quantityMilli: milli(m[1]), unit: m[2].toLowerCase() as "st" | "kg", unitPriceOre: ore(m[3]) };
  // price first, then the count: '15,61 x 2' (Lidl)
  m = /^(\d+,\d{2})\s*[*x×]\s*(\d+)$/i.exec(t);
  if (m) return { quantityMilli: milli(m[2]), unit: "st", unitPriceOre: ore(m[1]) };
  return null;
}

/** Which profile reads this text. */
export function storeOf(text: string): ReceiptStore | null {
  const t = text.toLocaleLowerCase("sv");
  if (/lidl\.se|lidl plus/.test(t)) return "lidl";
  if (/rusta\.com|\brusta\b/.test(t)) return "rusta";
  if (/\bwillys\b/.test(t)) return "willys";
  if (/\bica\b|stammisrabatt|poänggrundande/.test(t)) return "ica";
  return null;
}

/**
 * ICA's and Rusta's pages copy as a list: a bullet with the name, the price on
 * the next line, and a bullet under it that is either empty or the count
 * ('3 st * 9,90 kr/st'). The total is the first amount, above the date.
 */
function parseList(store: "ica" | "rusta", text: string): ParsedReceipt {
  const rows = text.split("\n").map(clean).filter((r) => r !== "" && r !== "*");
  const head = rows.findIndex((r) => /^produkter$/i.test(r));
  const header = head === -1 ? rows : rows.slice(0, head);
  const body = head === -1 ? [] : rows.slice(head + 1);

  const isAmount = (r: string) => /^[−–—-]?\d[\d\s  ]*,\d{2}(\s*kr)?$/.test(r);
  const totalOre = header.find(isAmount) ? ore(header.find(isAmount)!) : null;
  const when = header.map((r) => /^(\d{4}-\d{2}-\d{2})(?:,\s*(\d{2}:\d{2}))?/.exec(r)).find(Boolean);
  // ICA names the shop on the line after the date; Rusta only gives an address.
  const afterDate = when ? header[header.indexOf(when.input) + 1] : undefined;
  const storeArea = store === "ica" ? (afterDate ?? null) : (header.find((r) => /^\d{3}\s?\d{2}\s+\S/.test(r)) ?? null);

  const lines: ParsedLine[] = [];
  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    if (isAmount(row)) continue; // taken with its name below
    const rest = cleanName(row);
    if (rest === "") continue;
    const qty = quantity(rest);
    if (qty) {
      // A count belongs to the row above it, never to itself.
      const previous = lines.at(-1);
      if (previous) Object.assign(previous, qty);
      continue;
    }
    const price = body[i + 1];
    if (price === undefined || !isAmount(price)) continue;
    lines.push(line(rest, ore(price)));
    i++;
  }
  return finish(store, storeArea, when?.[1] ?? null, when?.[2] ?? null, lines, totalOre, null);
}

/**
 * Willys's PDF is the printed receipt: the name to the left and the amount to
 * the right, a count in between ('2st*26,90'), and a weight on its own line
 * under the name. Discounts are indented under what they belong to.
 */
function parseWillys(text: string): ParsedReceipt {
  const rows = text.split("\n").filter((r) => r.trim() !== "");
  const lines: ParsedLine[] = [];
  let storeArea: string | null = null;
  let purchaseDate: string | null = null;
  let purchaseTime: string | null = null;
  let totalOre: number | null = null;
  let statedItemCount: number | null = null;
  /** A name whose amount is on the next line, because the goods were weighed. */
  let waiting: string | null = null;
  /** The purchase begins under the first dashed rule, the shop's name above it. */
  let started = false;
  let done = false;

  for (const row of rows) {
    // Only trimmed, never collapsed: the gap between the columns is what tells
    // the name from the amount.
    const r = row.trim();
    if (storeArea === null && /^willys\b/i.test(r)) storeArea = r;
    const when = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/.exec(r);
    if (when) {
      purchaseDate ??= when[1];
      purchaseTime ??= when[2];
    }
    const total = /^totalt\s+(\d[\d\s  ]*,\d{2})\s*(?:SEK)?$/i.exec(r);
    if (total) {
      totalOre ??= ore(total[1]);
      done = true; // everything below is the card and the VAT table
      continue;
    }
    const counted = /^totalt\s+(\d+)\s+varor/i.exec(r);
    if (counted) {
      statedItemCount ??= Number(counted[1]);
      continue;
    }
    if (/^[-=]{5,}$/.test(r)) {
      started = true;
      continue;
    }
    if (done || !started) continue;

    const amount = /^(.*?)\s{2,}(-?\d[\d\s  ]*,\d{2})$/.exec(r);
    if (!amount) {
      // 'GODIS LV' with its weight and price on the line below.
      if (/^[A-ZÅÄÖ0-9]/.test(r)) waiting = r;
      continue;
    }
    const [, left, value] = amount;
    const qty = quantity(left);
    if (qty && waiting !== null) {
      lines.push(line(waiting, ore(value), qty));
      waiting = null;
      continue;
    }
    // 'BELUGA LINSER 500G   2st*26,90   53,80': the count sits between the two.
    const split = /^(.*?)\s{2,}(\d+(?:,\d+)?\s*(?:st|kg)\s*[*x×]\s*\d+,\d{2}.*)$/i.exec(left);
    lines.push(split ? line(split[1], ore(value), quantity(split[2]) ?? undefined) : line(left, ore(value)));
  }
  return finish("willys", storeArea, purchaseDate, purchaseTime, lines, totalOre, statedItemCount);
}

/**
 * Lidl's page copies as one long line — the line breaks are gone — so the
 * amounts are what the rows are found by. An amount ends a row when it carries
 * a VAT letter ('29,90 B') or is negative (a discount); a positive amount
 * without a letter is part of a count ('15,61 x 2') or a weight, not a row.
 */
function parseLidl(text: string): ParsedReceipt {
  const body = clean(text);
  const head = body.slice(0, body.search(/\bSEK\b/) + 1);
  const storeArea = /^\s*([^,]+,[^O]+?)\s+Org\.nr/.exec(head)?.[1]?.trim() ?? null;

  const lines: ParsedLine[] = [];
  const re = /(-?\d+,\d{2})(?!\d)(?:\s+([A-D])\b)?/g;
  let from = body.search(/\bSEK\b/) + 3;
  let stop = body.search(/-{5,}|\bATT BETALA\b/);
  if (stop === -1) stop = body.length;
  let m: RegExpExecArray | null;
  re.lastIndex = from;
  while ((m = re.exec(body)) && m.index < stop) {
    const value = ore(m[1]);
    // A price with no VAT letter that isn't a discount is a count or a weight,
    // and belongs to the text of the row it stands in.
    if (!m[2] && value >= 0) continue;
    let name = clean(body.slice(from, m.index));
    from = re.lastIndex;

    // A weight stands after the amount it belongs to, so it opens the next name.
    const weight = /^(\d+(?:,\d+)?)\s*(kg|st)\s*[*x×]\s*(\d+,\d{2})\s*(?:SEK\/(?:kg|st))?\s*/i.exec(name);
    if (weight && lines.length > 0) {
      Object.assign(lines.at(-1)!, { quantityMilli: milli(weight[1]), unit: weight[2].toLowerCase(), unitPriceOre: ore(weight[3]) });
      name = name.slice(weight[0].length);
    }
    // A count stands before its amount, at the end of the name.
    const count = /\s(\d+,\d{2}\s*[*x×]\s*\d+)$/i.exec(name);
    lines.push(count ? line(name.slice(0, count.index), value, quantity(count[1]) ?? undefined) : line(name, value));
  }

  const total = /\bATT BETALA\s+(\d[\d\s  ]*,\d{2})/i.exec(body);
  const when = /\b(\d{4})[-/](\d{2})[-/](\d{2})[, ]+(\d{2}:\d{2})/.exec(body);
  return finish(
    "lidl",
    storeArea,
    when ? `${when[1]}-${when[2]}-${when[3]}` : null,
    when?.[4] ?? null,
    lines,
    total ? ore(total[1]) : null,
    null,
  );
}

function finish(
  store: ReceiptStore,
  storeArea: string | null,
  purchaseDate: string | null,
  purchaseTime: string | null,
  lines: ParsedLine[],
  totalOre: number | null,
  statedItemCount: number | null,
): ParsedReceipt {
  const sumOre = lines.reduce((s, l) => s + l.totalOre, 0);
  return { store, storeArea, purchaseDate, purchaseTime, lines, totalOre, sumOre, balances: totalOre !== null && sumOre === totalOre, statedItemCount };
}

/**
 * Reads a pasted receipt. Throws ReceiptError when it can't tell which shop it
 * came from; a receipt whose rows don't add up to its total comes back with
 * `balances` false, for the user to look at rather than for the tool to hide.
 */
export function parseReceipt(text: string): ParsedReceipt {
  if (clean(text) === "") throw new ReceiptError("Klistra in texten från kvittot.");
  const store = storeOf(text);
  if (!store) throw new ReceiptError("Kvittot känns inte igen. Lidl, ICA, Willys och Rusta går att läsa.");
  if (store === "lidl") return parseLidl(text);
  if (store === "willys") return parseWillys(text);
  return parseList(store, text);
}

/**
 * What is safe to keep of the pasted text: the card number, the membership
 * number and the terminal's reference numbers say nothing about what was
 * bought. Dates, times, prices and organisation numbers are left alone —
 * only a masked card and a run of eight digits or more go.
 */
export function scrubReceiptText(text: string): string {
  return text.replace(/\*{2,}\d{3,}/g, "…").replace(/\b\d{8,}\b/g, "…");
}

/**
 * The name folded for comparison, which is what a view of one grocery over
 * time groups by. Deliberately literal: case and spacing only. 'HAVREDRYCK
 * NATURELL' and 'Havredryck Barista' are different things, and deciding that
 * two names are the same product is a judgement for the user to make, not for
 * a regular expression.
 */
export function receiptNameKey(name: string): string {
  return name.toLocaleLowerCase("sv").replace(/\s+/g, " ").trim();
}
