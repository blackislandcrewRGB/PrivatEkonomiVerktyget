/**
 * The same bank transaction from a file (Swedbank CSV, Norwegian XLSX/PDF) and
 * from the bank's API (Enable Banking) has different fields, so the file
 * fingerprint can't find it. The match key can: booking date (the app's
 * booking_date, i.e. the purchase day for card rows), amount in öre and the
 * description reduced to letters and digits (case, accents, spaces and
 * punctuation vary between the two).
 */
export function normalizeForMatch(description: string): string {
  return description
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("sv")
    .replace(/[^a-z0-9]/g, "");
}

export function matchKey(r: { bookingDate: string; amount: number; descriptionClean: string }): string {
  return `${r.bookingDate}|${r.amount}|${normalizeForMatch(r.descriptionClean)}`;
}

/** The key without the description: the fallback when the texts differ (see pairByMatch). */
export const dayAmountKey = (r: { bookingDate: string; amount: number }) => `${r.bookingDate}|${r.amount}`;

/**
 * Pairs incoming rows with existing ones, in order: first on the full match key
 * (two identical rows on one day pair one to one), then, for what is left,
 * on day and amount when exactly one row on each side has them (the texts
 * differ, e.g. 'PIZZA± M@R' in Swedbank's CSV against the API's text).
 * Returns incoming index -> existing id.
 */
export function pairByMatch<I extends { bookingDate: string; amount: number; descriptionClean: string }, E extends { id: number; matchKey: string | null; bookingDate: string; amount: number }>(
  incoming: readonly I[],
  existing: readonly E[],
): Map<number, number> {
  const out = new Map<number, number>();
  const free = new Map<string, E[]>();
  for (const e of [...existing].sort((a, b) => a.id - b.id)) {
    if (!e.matchKey) continue;
    free.set(e.matchKey, [...(free.get(e.matchKey) ?? []), e]);
  }
  const taken = new Set<number>();
  incoming.forEach((r, i) => {
    const e = free.get(matchKey(r))?.find((x) => !taken.has(x.id));
    if (!e) return;
    out.set(i, e.id);
    taken.add(e.id);
  });

  const count = <T,>(items: T[], key: (t: T) => string) => {
    const m = new Map<string, T[]>();
    for (const t of items) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
    return m;
  };
  const leftIn = count(
    incoming.map((r, i) => ({ r, i })).filter(({ i }) => !out.has(i)),
    ({ r }) => dayAmountKey(r),
  );
  const leftEx = count(
    existing.filter((e) => !taken.has(e.id)),
    (e) => dayAmountKey(e),
  );
  for (const [key, ins] of leftIn) {
    const exs = leftEx.get(key);
    if (ins.length === 1 && exs?.length === 1) {
      out.set(ins[0].i, exs[0].id);
      taken.add(exs[0].id);
    }
  }
  return out;
}
