/**
 * Decodes a bank export to a string.
 *
 * Swedbank exports Windows-1252. If the file has been re-saved as UTF-8 (e.g. by
 * Excel) we must still get the exact same characters, otherwise descriptions and
 * therefore fingerprints change and every row would be imported again. A
 * Windows-1252 file with Swedish characters is practically never valid UTF-8,
 * so: BOM or strictly valid UTF-8 containing non-ASCII bytes => UTF-8, otherwise
 * Windows-1252.
 */
export function decodeBankText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  if (bytes.some((b) => b >= 0x80)) {
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
    } catch {
      // Not UTF-8, fall through.
    }
  }
  return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
}

/** Collapses all whitespace (incl. NBSP) to single spaces and trims. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim();
}

/**
 * Parses a decimal amount with '.' (or ',' when there is no '.') as decimal
 * separator into integer öre, without going through floating point.
 * Returns null for anything that isn't a plain amount.
 */
export function parseAmountToOre(input: string): number | null {
  const s = input.trim().replace(/−/g, "-").replace(/[\s ]/g, "");
  const m = /^([+-])?(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const ore = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  if (!Number.isSafeInteger(ore)) return null;
  return m[1] === "-" ? -ore : ore;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** '1234561234' -> '••1234'. The only form of an account number we store. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  return `••${digits.slice(-4)}`;
}

/** Masks long digit runs (account/reference numbers) in stored text: '1237085' -> '••7085'. */
export function maskLongNumbers(s: string): string {
  return s.replace(/\d{5,}/g, (m) => `••${m.slice(-4)}`);
}
