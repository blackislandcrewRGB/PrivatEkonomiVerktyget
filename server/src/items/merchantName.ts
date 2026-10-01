/**
 * A pryl's merchant as a person would say it: 'Amazon' for 'AMAZON.SE* KP6TV'
 * and 'AmazonMktplc*KR7SN4821' alike. The name of the rule that knows the
 * merchant (the one that gives it its icon) when there is one, else the
 * bank's text; either way without the bank's noise (the same cleaning as the
 * web's monogram, `cleanName` in web/src/lib/monogram.ts, which a test keeps
 * in step), and a shouted name in ordinary case ('AMAZON' → 'Amazon').
 * Used for the gallery and the Handlare filter.
 */

/** Company forms and country codes: dropped when they end the name. */
const SUFFIXES = new Set(["AB", "INC", "LLC", "LTD", "GMBH", "OY", "AS", "ASA", "SWE", "SE", "NO", "DK", "FI", "COM", "BV"]);
/** Their own purchases: what follows the '*' is an order or product code. */
const CODE_AFTER_STAR = new Set(["GOOGLE", "AMAZON", "AMZN"]);
/** Payment intermediaries: the real merchant follows the '*'. */
const MERCHANT_AFTER_STAR = new Set(["PAYPAL", "KLARNA", "ZETTLE", "IZETTLE", "SUMUP"]);

const alnum = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "");
const withoutDomain = (w: string) => w.replace(/\.(?:com|se|no|dk|fi|net|io|nu)$/i, "");

/** An order or reference code, not a name: mostly digits, or capitals and digits without a vowel. */
function isCode(word: string): boolean {
  const w = alnum(word);
  if (!w) return false;
  const digits = w.replace(/\D/g, "").length;
  if (digits * 2 > w.length) return true;
  return digits > 0 && w === w.toUpperCase() && !/[AEIOUÅÄÖ]/i.test(w);
}

/** The name without the bank's noise; if nothing is left, the name as it was. */
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

/** 'AMAZON' → 'Amazon'; short capitals stay ('ICA', 'H&M'), as does anything in mixed case. */
const calm = (name: string) =>
  name
    .split(" ")
    .map((w) => (w.length >= 4 && w === w.toLocaleUpperCase("sv") && /\p{L}{4}/u.test(w) ? w.charAt(0) + w.slice(1).toLocaleLowerCase("sv") : w))
    .join(" ");

/** The merchant's name from its rule (not a regex, which is no name) or its own text. */
export function merchantName(text: string, rule?: { pattern: string; matchType: string } | null): string {
  return calm(cleanName(rule && rule.matchType !== "regex" ? rule.pattern : text));
}
