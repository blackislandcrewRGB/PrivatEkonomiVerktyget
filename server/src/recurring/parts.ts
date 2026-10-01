import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringExpenses } from "../db/schema.js";

// Expenses drawn together: Mobilabonnemang is part of Tele2's charge for
// Bredband. A part has no charge of its own; the charge linked to the other
// expense (its owner) is split: each part its expected amount, the rest to
// the owner. So an odd charge in a changeover month lands on the owner.

type Expense = typeof recurringExpenses.$inferSelect;
type ExpectedFn = (e: Pick<Expense, "id" | "amount">, month: string) => number;

/** The expense whose linked charges are this one's: itself, or the one it is part of. */
export const chargeOwnerId = (e: Pick<Expense, "id" | "partOfId">) => e.partOfId ?? e.id;

/** The parts of each owner. */
export function partsByOwner(db: Db): Map<number, Expense[]> {
  const out = new Map<number, Expense[]>();
  for (const e of db.select().from(recurringExpenses).all()) {
    if (e.partOfId === null) continue;
    out.set(e.partOfId, [...(out.get(e.partOfId) ?? []), e]);
  }
  return out;
}

/** What the whole charge is expected to be in a month: the owner's amount and its parts'. */
export function groupExpected(e: Expense, parts: Map<number, Expense[]>, expected: ExpectedFn, month: string): number {
  return expected(e, month) + (parts.get(e.id) ?? []).reduce((s, p) => s + expected(p, month), 0);
}

/** An expense's share (öre, positive) of a charge of `charged` öre for its month. */
export function chargeShare(e: Expense, parts: Map<number, Expense[]>, expected: ExpectedFn, charged: number, month: string): number {
  if (e.partOfId !== null) return expected(e, month);
  return charged - (parts.get(e.id) ?? []).reduce((s, p) => s + expected(p, month), 0);
}

/** A part follows its owner's day, schedule and account (and the one before a move). */
export const FOLLOWED_FIELDS = ["scheduleType", "anchorDay", "bankDayRule", "dateBasis", "accountId", "previousAccountId", "accountFrom", "paymentMethod", "billingCycle"] as const;

export function followOwner(db: Db, ownerId: number): void {
  const owner = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, ownerId)).get();
  if (!owner) return;
  const set = Object.fromEntries(FOLLOWED_FIELDS.map((k) => [k, owner[k]]));
  db.update(recurringExpenses).set(set).where(eq(recurringExpenses.partOfId, ownerId)).run();
}

/** The charge is shared when the owner or any part is. */
export function groupShared(db: Db, ownerId: number): boolean {
  return db
    .select({ shared: recurringExpenses.shared, id: recurringExpenses.id, partOfId: recurringExpenses.partOfId })
    .from(recurringExpenses)
    .all()
    .some((e) => (e.id === ownerId || e.partOfId === ownerId) && e.shared);
}
