import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { transactions } from "./db/schema.js";
import { merchantKey } from "./categorize/counterparty.js";

/** At most this many suggestions are returned. */
const MAX_SUGGESTIONS = 50;

export interface NoteSuggestion {
  note: string;
  /** Rows the note is written on. */
  count: number;
}

/**
 * Notes written before, for the note field's autocomplete. Spelling variants
 * ('MATVAROR', 'Matvaror') count as one, shown as the most used spelling.
 * With `forId`, notes used on the same merchant come first, then the same
 * category, then the rest; within each by use, then how recently. Notes on
 * private rows are left out unless showPrivate.
 */
export function noteSuggestions(db: Db, opts: { forId?: number; showPrivate?: boolean } = {}): NoteSuggestion[] {
  const rows = db
    .select({
      note: transactions.note,
      private: transactions.private,
      categoryId: transactions.categoryId,
      counterparty: transactions.counterparty,
      descriptionClean: transactions.descriptionClean,
      bookingDate: transactions.bookingDate,
    })
    .from(transactions)
    .where(and(isNotNull(transactions.note), ne(transactions.note, ""), isNull(transactions.deletedAt)))
    .all()
    .filter((r) => opts.showPrivate || !r.private);

  const target = opts.forId
    ? db.select().from(transactions).where(eq(transactions.id, opts.forId)).get()
    : undefined;
  const targetMerchant = target ? merchantKey(target) : null;

  const groups = new Map<
    string,
    { spellings: Map<string, number>; count: number; merchant: number; category: number; last: string }
  >();
  for (const r of rows) {
    const note = r.note!.trim();
    if (!note) continue;
    const key = note.toLocaleLowerCase("sv-SE");
    const g = groups.get(key) ?? { spellings: new Map(), count: 0, merchant: 0, category: 0, last: "" };
    g.spellings.set(note, (g.spellings.get(note) ?? 0) + 1);
    g.count++;
    if (targetMerchant && merchantKey(r) === targetMerchant) g.merchant++;
    if (target?.categoryId != null && r.categoryId === target.categoryId) g.category++;
    if (r.bookingDate > g.last) g.last = r.bookingDate;
    groups.set(key, g);
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        b.merchant - a.merchant ||
        b.category - a.category ||
        b.count - a.count ||
        b.last.localeCompare(a.last),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((g) => ({
      note: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
      count: g.count,
    }));
}
