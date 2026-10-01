import { and, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { transactions } from "./db/schema.js";
import { merchantKey } from "./categorize/counterparty.js";
import { addDays } from "./overview/dates.js";

/** How long after a purchase a refund is looked for. */
const REFUND_WINDOW_DAYS = 120;

export class ReturnError extends Error {}

/**
 * Money back on the same account from the same merchant within 120 days of a
 * purchase, not already part of a return. `suggested` is a set of them that
 * adds up to the purchase exactly (a refund can come in parts), else the
 * single closest one.
 */
export function refundCandidates(db: Db, purchaseId: number) {
  const p = db.select().from(transactions).where(eq(transactions.id, purchaseId)).get();
  if (!p) throw new ReturnError("Hittades inte.");
  if (p.amount >= 0) throw new ReturnError("Bara ett köp (pengar ut) kan markeras som returnerat.");
  const key = merchantKey(p);
  const candidates = db
    .select()
    .from(transactions)
    .where(
      and(
        p.accountId === null ? isNull(transactions.accountId) : eq(transactions.accountId, p.accountId),
        gt(transactions.amount, 0),
        gte(transactions.bookingDate, p.bookingDate),
        lte(transactions.bookingDate, addDays(p.bookingDate, REFUND_WINDOW_DAYS)),
        isNull(transactions.deletedAt),
        isNull(transactions.returnGroupId),
        eq(transactions.isTransfer, false),
      ),
    )
    .orderBy(transactions.bookingDate, transactions.id)
    .all()
    .filter((t) => merchantKey(t) === key);

  const target = -p.amount;
  let suggested: number[] = [];
  // Exact sum first (the refund may come in parts); few candidates, so try the subsets.
  const pool = candidates.slice(0, 12);
  for (let mask = 1; mask < 1 << pool.length && suggested.length === 0; mask++) {
    const pick = pool.filter((_, i) => mask & (1 << i));
    if (pick.reduce((s, t) => s + t.amount, 0) === target) suggested = pick.map((t) => t.id);
  }
  if (suggested.length === 0 && candidates.length) {
    const closest = [...candidates].sort((a, b) => Math.abs(a.amount - target) - Math.abs(b.amount - target))[0];
    if (closest.amount <= target) suggested = [closest.id];
  }
  return {
    purchase: { id: p.id, bookingDate: p.bookingDate, amount: p.amount, description: p.label ?? p.descriptionClean },
    candidates: candidates.map((t) => ({ id: t.id, bookingDate: t.bookingDate, amount: t.amount, description: t.label ?? t.descriptionClean })),
    suggested,
  };
}

/**
 * Marks a purchase as returned, with the refunds that belong to it (may be
 * none yet). They are grouped under the purchase's id and left out of every
 * sum and statistic.
 */
export function markReturned(db: Db, purchaseId: number, refundIds: number[]) {
  const { candidates } = refundCandidates(db, purchaseId);
  const allowed = new Set(candidates.map((c) => c.id));
  const bad = refundIds.filter((id) => !allowed.has(id));
  if (bad.length) throw new ReturnError("En vald återbetalning hör inte till köpet (samma konto och handlare, inom 120 dagar).");
  const now = new Date().toISOString();
  db.update(transactions)
    .set({ returnGroupId: purchaseId, manuallyEditedAt: now })
    .where(inArray(transactions.id, [purchaseId, ...refundIds]))
    .run();
  return db.select().from(transactions).where(eq(transactions.returnGroupId, purchaseId)).all();
}

/** Undoes a return: every row in the group counts again. */
export function unmarkReturned(db: Db, anyId: number) {
  const row = db.select().from(transactions).where(eq(transactions.id, anyId)).get();
  if (!row?.returnGroupId) return 0;
  return db
    .update(transactions)
    .set({ returnGroupId: null, manuallyEditedAt: new Date().toISOString() })
    .where(or(eq(transactions.returnGroupId, row.returnGroupId), eq(transactions.id, anyId)))
    .returning({ id: transactions.id })
    .all().length;
}
