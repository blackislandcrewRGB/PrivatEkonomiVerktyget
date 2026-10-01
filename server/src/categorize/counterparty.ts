/**
 * The text rules and recurring patterns are matched against. Swedbank card
 * purchases from e-sparkonto are prefixed 'K*' with the merchant name cut to
 * ~12 characters ('K*ICA KVANTU', 'K*Systembola'); the prefix is dropped so the
 * same rules hit them.
 */
export function merchantText(descriptionClean: string): string {
  return descriptionClean.replace(/^K\*\s*/i, "");
}

/**
 * Extracts a stable "merchant" key from a cleaned description.
 * Swish to or from a phone number => the number, so one rule per number covers
 * both 'Swish skickad +46…' and 'Swish mottagen +46…'.
 */
export function extractCounterparty(descriptionClean: string): string {
  const text = merchantText(descriptionClean);
  const swishPhone = /^Swish (?:skickad|mottagen|betalning|inbetalning)?\s*(\+?\d[\d ]{6,})$/i.exec(text);
  if (swishPhone) return swishPhone[1].replace(/\s/g, "");
  const swishMerchant = /^Swish (?:utbetalning |betalning )?(?!skickad|mottagen)(.+)$/i.exec(text);
  if (swishMerchant) return swishMerchant[1];
  return text;
}

/**
 * Normalizes a Swedish phone number to +46 form so numbers typed in settings
 * ('070-123 45 67', '0701234567', '46701234567') compare equal to the bank's '+46701234567'.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^00\d{8,15}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^0\d{6,12}$/.test(digits)) return `+46${digits.slice(1)}`;
  if (/^46\d{7,12}$/.test(digits)) return `+${digits}`;
  return null;
}

/**
 * One merchant across rows, for 'same merchant' look-ups: the counterparty
 * (for Swish the number) or the text without the K* prefix, upper case.
 */
export function merchantKey(t: { counterparty: string | null; descriptionClean: string }): string {
  return merchantText(t.counterparty ?? t.descriptionClean).trim().toUpperCase();
}
