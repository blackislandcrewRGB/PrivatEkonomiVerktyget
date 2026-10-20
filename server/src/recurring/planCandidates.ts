import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringExpenses, transactions } from "../db/schema.js";
import { patternMatches } from "./link.js";
import { accountFor, counts } from "./changes.js";
import { chargeDate } from "./schedule.js";

/**
 * 'Byt plan för …', from a purchase: the fixed expenses the purchase looks
 * like a new plan of. Its text matches the expense's, it is on its account and
 * it isn't linked to anything yet (a charge on the usual day links by itself:
 * the one that starts a new plan, at a new price and day, doesn't).
 */
export function planCandidates(db: Db, transactionId: number) {
  const row = db.select().from(transactions).where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt))).get();
  if (!row || row.amount >= 0 || row.isTransfer || row.recurringExpenseId !== null || row.accountId === null) return [];
  const date = chargeDate({ dateBasis: "transaction" }, row);
  return db
    .select()
    .from(recurringExpenses)
    .all()
    .filter((e) => e.partOfId === null && counts(e) && e.matchPattern !== null && patternMatches(e.matchPattern, row.descriptionClean) && e.accountId !== null && accountFor(e, date.slice(0, 7)) === row.accountId)
    .map((e) => ({
      id: e.id,
      name: e.name,
      planName: e.planName,
      amount: e.amount,
      currency: e.currency,
      vatPercent: e.vatPercent,
      // The month and day of the purchase: where the new plan starts.
      from: date.slice(0, 7),
      day: Number(date.slice(8, 10)),
    }));
}
