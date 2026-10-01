import { CATEGORY_PALETTE } from "./palette";

/**
 * A merchant's monogram: its initials on a round badge in one of the 16
 * palette colours. The colour comes from a stable hash of the cleaned,
 * normalised name, so the same merchant has the same colour everywhere, in both themes.
 * The text is white or near-black, whichever reads better (≥ 4,5:1 on all 16).
 */

/** Lower case, no accents or punctuation, single spaces: 'WILLYS  Exempelstad' and 'Willys exempelstad' are one merchant. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Company forms and country codes: dropped when they end the name ('HOSTBOX INC', 'PARKSTER SWE'). */
const SUFFIXES = new Set(["AB", "INC", "LLC", "LTD", "GMBH", "OY", "AS", "ASA", "SWE", "SE", "NO", "DK", "FI", "COM", "BV"]);
/** Their own purchases: what follows the '*' is an order or product code ('GOOGLE *Google Play Ap', 'AMAZON.SE* KP6TV'). */
const CODE_AFTER_STAR = new Set(["GOOGLE", "AMAZON", "AMZN"]);
/** Payment intermediaries: the real merchant follows the '*' ('PAYPAL *STEAM' is Steam). Same list as the server's brands.ts. */
export const MERCHANT_AFTER_STAR = new Set(["PAYPAL", "KLARNA", "ZETTLE", "IZETTLE", "SUMUP"]);

const alnum = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "");
const withoutDomain = (w: string) => w.replace(/\.(?:com|se|no|dk|fi|net|io|nu)$/i, "");

/** An order or reference code, not a name: mostly digits ('P45FCD9573'), or capitals and digits without a vowel ('KP6TV'). */
export function isCode(word: string): boolean {
  const w = alnum(word);
  if (!w) return false;
  const digits = w.replace(/\D/g, "").length;
  if (digits * 2 > w.length) return true;
  return digits > 0 && w === w.toUpperCase() && !/[AEIOUÅÄÖ]/i.test(w);
}

/**
 * The name without the bank's noise: the K* prefix of Swedbank card
 * purchases, a leading 'Swish'/'Swish betalning' before a merchant, all after
 * the '*' of Google's and Amazon's own purchases, a payment intermediary
 * before its '*' (PayPal, Klarna, Zettle, SumUp), code words, and company forms and
 * country codes at the end. Numbers that are part of the name stay ('Tele2').
 * If nothing is left, the name as it was.
 */
export function cleanName(name: string): string {
  let s = name.trim().replace(/^K\*\s*/i, "").replace(/^Swish\s+(?:(?:utbetalning|betalning|skickad|mottagen|inbetalning)\s+)?/i, "");
  const star = s.indexOf("*");
  if (star > 0) {
    const first = alnum(withoutDomain(s.slice(0, star).trim().split(/\s+/)[0])).toUpperCase();
    if (CODE_AFTER_STAR.has(first)) s = s.slice(0, star);
    else if (MERCHANT_AFTER_STAR.has(first) && alnum(s.slice(star + 1))) s = s.slice(star + 1);
  }
  const words = s
    .replace(/\*/g, " ")
    .split(/\s+/)
    .map(withoutDomain)
    .filter((w) => alnum(w) && !isCode(w));
  while (words.length > 0 && SUFFIXES.has(alnum(words.at(-1)!).toUpperCase())) words.pop();
  return words.length > 0 ? words.join(" ") : name.trim();
}

/**
 * Initials of the cleaned name. One word gives its first letter, or letter
 * and digit when the word is letters and one digit ('Tele2' → T2); several
 * words give the first two words' ('Exempel Gym' → EG). Punctuation is
 * skipped ('Kjell & Company' → KC); a leading digit counts ('7-Eleven' → 7).
 */
export function initials(name: string): string {
  const words = cleanName(name)
    .split(/\s+/)
    .map(alnum)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const w = words[0];
    return (/^\p{L}+\p{N}$/u.test(w) ? w[0] + w.at(-1) : w[0]).toLocaleUpperCase("sv-SE");
  }
  return (words[0][0] + words[1][0]).toLocaleUpperCase("sv-SE");
}

/** A Swish to or from a person: 'Swish skickad +4670…', 'Swish mottagen', or just the number. */
export function isPersonSwish(text: string): boolean {
  const t = text.trim().replace(/^K\*\s*/i, "");
  return /^\+?\d[\d \-]{6,}$/.test(t) || /^Swish(?:\s+(?:skickad|mottagen|inbetalning|betalning))?(?:\s+\+?\d[\d \-]*)?$/i.test(t);
}

export type IconIdentity = { kind: "monogram"; name: string } | { kind: "person" };

/**
 * What an icon stands for. The row's own name (label) wins, it is what the
 * list shows; then a Swish number's contact; a Swish with no contact is a
 * generic person; otherwise the bank's text.
 */
export function iconIdentity(who: { label?: string | null; contact?: string | null; text?: string | null }): IconIdentity {
  if (who.label?.trim()) return { kind: "monogram", name: who.label };
  if (who.contact?.trim()) return { kind: "monogram", name: who.contact };
  const text = who.text?.trim() ?? "";
  if (!text || isPersonSwish(text)) return { kind: "person" };
  return { kind: "monogram", name: text };
}

/** FNV-1a, 32 bits: the same string always gives the same number. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#111827";

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `a` laid over `b` at `amount` (0–1), as #rrggbb. */
export function mix(a: string, b: string, amount: number): string {
  const part = (i: number) => {
    const v = Math.round(parseInt(a.slice(i, i + 2), 16) * amount + parseInt(b.slice(i, i + 2), 16) * (1 - amount));
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  };
  return `#${part(1)}${part(3)}${part(5)}`;
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface Monogram {
  text: string;
  background: string;
  color: string;
}

const cache = new Map<string, Monogram>();

export function monogram(name: string): Monogram {
  let m = cache.get(name);
  if (!m) {
    const background = CATEGORY_PALETTE[hash(normalizeName(cleanName(name))) % CATEGORY_PALETTE.length];
    const color = contrast(background, LIGHT_TEXT) >= contrast(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
    m = { text: initials(name), background, color };
    cache.set(name, m);
  }
  return m;
}
