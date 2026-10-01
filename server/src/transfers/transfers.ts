import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, categories, transactions, type Account } from "../db/schema.js";
import { categoryIdByKey } from "../db/seed.js";


/**
 * Swedbank puts the counterpart's full account number (clearing + number) in
 * 'Referens' for transfers. Keep only a masked form: first five digits
 * (Swedbank's clearing is five digits) + last four, e.g. '80000-••5678'.
 */
export function counterRefFromReference(reference: string): string | null {
  const digits = reference.replace(/[\s-]/g, "");
  if (!/^\d{10,17}$/.test(digits)) return null;
  return `${digits.slice(0, 5)}-••${digits.slice(-4)}`;
}

/** The one account whose clearing + last four digits match, if any. */
export function accountForCounterRef(all: Pick<Account, "id" | "clearing" | "accountRef">[], counterRef: string): number | null {
  const [prefix, masked] = counterRef.split("-");
  const matches = all.filter(
    (a) => a.clearing && a.accountRef && prefix.startsWith(a.clearing) && masked.slice(-4) === a.accountRef.slice(-4),
  );
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Resolves counterpart accounts for transfer rows whose masked reference points
 * at one of my accounts (also rows imported before that account was bound).
 * Such rows become internal transfers. Rows edited by hand are only annotated
 * with the counter account; their flags and category are left alone.
 */
export function resolveCounterAccounts(db: Db): number {
  const all = db.select().from(accounts).all();
  const categoryById = new Map(db.select().from(categories).all().map((c) => [c.id, c]));
  const ownTransferId = categoryIdByKey(db, "own_transfer") ?? null;
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNotNull(transactions.counterRef), isNull(transactions.counterAccountId), isNull(transactions.deletedAt)))
    .all();

  let resolved = 0;
  for (const r of rows) {
    const counterAccountId = accountForCounterRef(all, r.counterRef!);
    if (counterAccountId === null || counterAccountId === r.accountId) continue;
    const edited = r.manuallyEditedAt !== null || r.categorySource === "manual";
    const hasTransferCategory = r.categoryId !== null && !!categoryById.get(r.categoryId)?.isTransfer;
    db.update(transactions)
      .set(
        edited
          ? { counterAccountId }
          : {
              counterAccountId,
              isTransfer: true,
              shared: false,
              ...(hasTransferCategory ? {} : { categoryId: ownTransferId, categorySource: "rule" as const }),
            },
      )
      .where(eq(transactions.id, r.id))
      .run();
    resolved++;
  }
  return resolved;
}

/**
 * Pairs the two sides of transfers between my accounts: a row with a counter
 * account, and a row on that account with the opposite amount that either
 * points back (its counter account is this row's account, within ±1 day) or is
 * already a transfer with no reference to go on (a card account's
 * 'Inbetalning', booked up to a week later).
 * An ordinary purchase with the same amount the same day (FORDONSSKATT 2 740 kr
 * next to a 3 153 kr transfer) is never taken. Both get transfer_pair_id = the
 * lower id. Rows pointing back first, then closest date, then oldest row, so
 * several identical transfers on one day pair up one to one.
 */
/** A card may book a payment this many days after the bank account sent it. */
export const CARD_PAYMENT_LAG_DAYS = 7;

export function pairTransfers(db: Db): number {
  const candidates = db
    .select()
    .from(transactions)
    .where(and(isNotNull(transactions.counterAccountId), isNull(transactions.transferPairId), isNull(transactions.deletedAt)))
    .orderBy(asc(transactions.bookingDate), asc(transactions.id))
    .all();

  let pairs = 0;
  const paired = new Set<number>();
  for (const a of candidates) {
    if (paired.has(a.id)) continue;
    const b = db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, a.counterAccountId!),
          eq(transactions.amount, -a.amount),
          isNull(transactions.transferPairId),
          isNull(transactions.deletedAt),
          sql`${transactions.id} != ${a.id}`,
          // A row pointing back: within ±1 day. A card's own 'Inbetalning' (no
          // reference): from the day before up to a week after the bank sent it
          // (the card books it after weekends and holidays: 23/12 -> 29/12).
          sql`((${transactions.counterAccountId} = ${a.accountId}
                and abs(julianday(${transactions.bookingDate}) - julianday(${a.bookingDate})) <= 1)
               or (${transactions.counterAccountId} is null and ${transactions.counterRef} is null and ${transactions.isTransfer} = 1
                and julianday(${transactions.bookingDate}) - julianday(${a.bookingDate}) between -1 and ${CARD_PAYMENT_LAG_DAYS}))`,
        ),
      )
      .orderBy(
        sql`${transactions.counterAccountId} is null`,
        sql`abs(julianday(${transactions.bookingDate}) - julianday(${a.bookingDate}))`,
        asc(transactions.id),
      )
      .get();
    if (!b || paired.has(b.id)) continue;

    const pairId = Math.min(a.id, b.id);
    db.update(transactions).set({ transferPairId: pairId }).where(eq(transactions.id, a.id)).run();
    db.update(transactions)
      .set({ transferPairId: pairId, ...(b.counterAccountId === null ? { counterAccountId: a.accountId } : {}) })
      .where(eq(transactions.id, b.id))
      .run();
    paired.add(a.id).add(b.id);
    pairs++;
  }
  return pairs;
}

/**
 * Transfers between my own bank accounts that carry no account number (the
 * bank's API may leave it out, where the file had it in 'Referens'): a new row
 * and a row on another of my bank accounts with the opposite amount, within a
 * day, the same text, neither linked to an account yet, and only one such
 * row. Both get each other's account and become own transfers (rows edited by
 * hand only get the account), then pair as usual.
 */
export function pairUnreferencedTransfers(db: Db, ids: readonly number[], normalize: (s: string) => string): number {
  if (!ids.length) return 0;
  const bankIds = new Set(db.select().from(accounts).where(eq(accounts.kind, "bank")).all().map((a) => a.id));
  const categoryById = new Map(db.select().from(categories).all().map((c) => [c.id, c]));
  const ownTransferId = categoryIdByKey(db, "own_transfer") ?? null;
  const loose = sql`${transactions.counterRef} is null and ${transactions.counterAccountId} is null and ${transactions.transferPairId} is null and ${transactions.deletedAt} is null`;
  const mark = (r: typeof transactions.$inferSelect, counterAccountId: number) => {
    const edited = r.manuallyEditedAt !== null || r.categorySource === "manual";
    const hasTransferCategory = r.categoryId !== null && !!categoryById.get(r.categoryId)?.isTransfer;
    db.update(transactions)
      .set(
        edited
          ? { counterAccountId }
          : { counterAccountId, isTransfer: true, shared: false, ...(hasTransferCategory ? {} : { categoryId: ownTransferId, categorySource: "rule" as const }) },
      )
      .where(eq(transactions.id, r.id))
      .run();
  };
  let marked = 0;
  for (const id of ids) {
    const r = db.select().from(transactions).where(and(eq(transactions.id, id), loose)).get();
    if (!r || r.accountId === null || !bankIds.has(r.accountId)) continue;
    const others = db
      .select()
      .from(transactions)
      .where(
        and(
          loose,
          eq(transactions.amount, -r.amount),
          sql`${transactions.accountId} != ${r.accountId}`,
          sql`abs(julianday(${transactions.bookingDate}) - julianday(${r.bookingDate})) <= 1`,
        ),
      )
      .all()
      .filter((o) => o.accountId !== null && bankIds.has(o.accountId) && normalize(o.descriptionClean) === normalize(r.descriptionClean));
    if (others.length !== 1) continue;
    mark(r, others[0].accountId!);
    mark(others[0], r.accountId);
    marked++;
  }
  if (marked) pairTransfers(db);
  return marked;
}
