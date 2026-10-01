import { createHash } from "node:crypto";

/**
 * sha256 over the identifying fields joined with '|'.
 * The exact input format is part of the dedupe contract: changing it makes
 * every previously imported row look new. Don't.
 */
export function fingerprint(parts: readonly (string | number)[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

/**
 * Numbers rows sharing a fingerprint 1, 2, 3… in file order. Two genuinely
 * identical transactions (e.g. two 43 kr SL tickets the same day) thus get
 * distinct keys (fp, 1) and (fp, 2).
 */
export function assignOccurrenceIndexes<T extends { fingerprint: string }>(
  rows: readonly T[],
): (T & { occurrenceIndex: number })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const index = (seen.get(row.fingerprint) ?? 0) + 1;
    seen.set(row.fingerprint, index);
    return { ...row, occurrenceIndex: index };
  });
}
