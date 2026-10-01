import { fingerprint } from "./fingerprint.js";
import { normalizeWhitespace } from "./text.js";
import { MERCHANT_CATEGORY_ALIASES } from "./merchantCategoryAliases.js";

/**
 * Identity of a Bank Norwegian transaction, shared by the PDF invoice and the
 * XLSX export so the same purchase gets the same fingerprint whichever file it
 * arrives in:
 *
 *   sha256('norwegian' | transaktionsdag | normaliserad beskrivning | belopp i öre)
 *
 * - 'norwegian' identifies the (single, shared) card account. The card number is
 *   not part of it: the XLSX export doesn't have it.
 * - The description is the merchant text only (XLSX 'Text'; in the PDF the part
 *   before ',<Merchant Area>'), whitespace collapsed, upper case. Payments
 *   ('Inbetalning' in XLSX, 'Inbetalning från <nr>' in the PDF) all normalize to
 *   'INBETALNING'.
 * - The amount is the stored signed amount (purchases negative).
 *
 * Changing this changes every Norwegian fingerprint: it needs a data migration.
 */
export function norwegianFingerprint(r: { transactionDate: string; merchantText: string; isPayment: boolean; amount: number }): string {
  return fingerprint(["norwegian", r.transactionDate, normalizeNorwegianDescription(r.merchantText, r.isPayment), r.amount]);
}

export function normalizeNorwegianDescription(merchantText: string, isPayment: boolean): string {
  return isPayment ? "INBETALNING" : normalizeWhitespace(merchantText).toUpperCase();
}

/**
 * The PDF prints the merchant text padded to 25 characters followed by
 * ',<Merchant Area>' (e.g. 'LIDLSVERIGEKB ,STOCKHOLM', 'PIZZERIA ROMA CENTRUM,EXEMPELSTAD').
 * Split on the last comma so a comma inside the merchant name ('GITHUB, INC.') survives.
 */
export function splitPdfDescription(description: string): { merchant: string; area: string | null } {
  const i = description.lastIndexOf(",");
  if (i <= 0) return { merchant: normalizeWhitespace(description), area: null };
  return { merchant: normalizeWhitespace(description.slice(0, i)), area: normalizeWhitespace(description.slice(i + 1)) || null };
}

/** Upper case, anything but letters and digits as one space. */
const normalizeLabel = (label: string) =>
  label
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The Visa wordings, normalised, and the key of the short name each stands for. */
const ALIASES = Object.entries(MERCHANT_CATEGORY_ALIASES).map(([visa, short]) => ({ visa: normalizeLabel(visa), key: normalizeLabel(short) }));

/** The bank cuts its text at 36 characters: a shorter start than this is too little to go on. */
const MIN_PREFIX = 16;

/**
 * The merchant category's identity: 'Grocery Stores, Supermarkets ' and
 * 'GROCERY STORES/SUPERMARKETS' -> 'GROCERY STORES SUPERMARKETS'. Visa's
 * wording for a category the export names differently, whole or cut short,
 * gets the export's key ('Package Stores – Beer, Wine, and Liq' ->
 * 'PKG STORES BEER WINE LIQUOR'; see merchantCategoryAliases.ts).
 */
export function merchantCategoryKey(label: string): string {
  const key = normalizeLabel(label);
  const alias = ALIASES.find((a) => a.visa === key || (key.length >= MIN_PREFIX && a.visa.startsWith(key)));
  return alias?.key ?? key;
}

export function isNorwegianPaymentText(text: string): boolean {
  return /^Inbetalning\b/i.test(normalizeWhitespace(text));
}
