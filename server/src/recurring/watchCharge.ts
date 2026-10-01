import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, recurringExpenses, transactions } from "../db/schema.js";
import { merchantText } from "../categorize/counterparty.js";
import { linkRecurring } from "./link.js";

type RecurringExpense = typeof recurringExpenses.$inferSelect;

/**
 * 'Remind me before this draws again', from a charge.
 *
 * A subscription started for a while — one month of a podcast app — is a
 * fixed expense like any other for as long as it runs; what is different is
 * that it is meant to end. So the tool makes the expense (that is where
 * pausing, the price watch and 'hasn't been drawn since' already live) and
 * marks it as one to ask about before every charge.
 *
 * Nothing is guessed that the charge doesn't say: the day, the amount, the
 * account and the merchant text all come from the row. The name and the
 * pattern are a first draft, to be corrected in Fasta utgifter.
 */

export class WatchChargeError extends Error {}

/**
 * The part of a merchant's text that stays the same between charges:
 * 'Podme 4F8-2A61C9' → 'Podme', 'GOOGLE*CLOUD KLM' → 'GOOGLE'. The reference
 * a shop puts after its name is different every month, so matching on it
 * would find exactly one charge — this one.
 */
export function chargePattern(text: string): string {
  const full = merchantText(text).trim();
  const stable = full.split(/[*\d]/)[0].trim().replace(/[-–—,./]+$/, "").trim();
  return stable.length >= 3 ? stable : full;
}

/** 'podme 3d7' → 'Podme 3d7': a name to read, not a bank's shouting. */
const asName = (text: string) => {
  const t = text.trim().replace(/\s+/g, " ");
  if (/\p{Ll}/u.test(t)) return t;
  return t.toLocaleLowerCase("sv").replace(/\p{L}/u, (c) => c.toLocaleUpperCase("sv"));
};

/**
 * Watches the charge's subscription: the expense it already belongs to, or a
 * new one drawn from the row. Returns the expense, watched.
 */
export function watchCharge(db: Db, transactionId: number): RecurringExpense {
  const row = db.select().from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!row || row.deletedAt) throw new WatchChargeError("Transaktionen finns inte.");

  // Already a fixed expense: it only needs to be watched.
  if (row.recurringExpenseId !== null) {
    const watched = db
      .update(recurringExpenses)
      .set({ remindBeforeCharge: true, paused: false })
      .where(eq(recurringExpenses.id, row.recurringExpenseId))
      .returning()
      .get();
    if (watched) return watched;
  }

  if (row.amount >= 0) throw new WatchChargeError("Bara ett köp kan bevakas.");
  if (row.isTransfer) throw new WatchChargeError("En överföring dras inte om.");
  if (row.accountId === null) throw new WatchChargeError("Raden saknar konto.");

  const account = db.select().from(accounts).where(eq(accounts.id, row.accountId)).get();
  const card = account?.kind === "credit_card";
  // A card charge is dated the day it was made; an autogiro the day it was booked.
  const date = row.transactionDate ?? row.bookingDate;
  // The merchant without the reference that changes every month, so the name
  // and what it is matched on say the same thing.
  const merchant = chargePattern(row.counterparty ?? row.descriptionClean);

  const created = db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const expense = tx
      .insert(recurringExpenses)
      .values({
        name: asName(row.label ?? merchant),
        amount: Math.abs(row.amount),
        anchorDay: Number(date.slice(8, 10)),
        accountId: row.accountId,
        categoryId: row.categoryId,
        matchPattern: merchant,
        paymentMethod: card ? "credit_card" : "card",
        dateBasis: "transaction",
        shared: row.shared,
        remindBeforeCharge: true,
      })
      .returning()
      .get();
    // Links this charge and any earlier ones, so the expense knows its history
    // and the reminder isn't given for a charge that already happened.
    linkRecurring(tx);
    return tx.select().from(recurringExpenses).where(eq(recurringExpenses.id, expense.id)).get()!;
  });
  return created as RecurringExpense;
}

/**
 * 'Gör till fast utgift…', from a purchase: what the new expense would be,
 * for the form to start from. The name and the bank's text can be changed;
 * the amount, the account and the day come from the row.
 */
export function recurringDraft(db: Db, transactionId: number) {
  const row = chargeRow(db, transactionId);
  const account = db.select().from(accounts).where(eq(accounts.id, row.accountId!)).get();
  const merchant = chargePattern(row.counterparty ?? row.descriptionClean);
  return {
    name: asName(row.label ?? merchant),
    pattern: merchant,
    amount: Math.abs(row.amount),
    date: row.transactionDate ?? row.bookingDate,
    accountName: account?.name ?? null,
  };
}

/** A purchase that can become a fixed expense: not a refund, a transfer or one that already is. */
function chargeRow(db: Db, transactionId: number) {
  const row = db.select().from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!row || row.deletedAt) throw new WatchChargeError("Transaktionen finns inte.");
  if (row.recurringExpenseId !== null) throw new WatchChargeError("Köpet hör redan till en fast utgift.");
  if (row.amount >= 0) throw new WatchChargeError("Bara ett köp kan bli en fast utgift.");
  if (row.isTransfer) throw new WatchChargeError("En överföring är ingen fast utgift.");
  if (row.accountId === null) throw new WatchChargeError("Raden saknar konto.");
  return row;
}

/**
 * Makes a purchase a fixed expense, monthly or yearly: the amount, account,
 * day (and for a yearly one the month) from the row, the name and the bank's
 * text as given. The row and any earlier charges are linked to it.
 */
export function makeRecurring(db: Db, transactionId: number, input: { name: string; cycle: "monthly" | "yearly"; pattern: string }): RecurringExpense {
  const row = chargeRow(db, transactionId);
  const name = input.name.trim();
  const pattern = input.pattern.trim();
  if (!name) throw new WatchChargeError("Ge utgiften ett namn.");
  if (pattern.length < 3) throw new WatchChargeError("Bankens text behöver minst tre tecken.");
  if (!row.descriptionClean.toLocaleUpperCase("sv").includes(pattern.toLocaleUpperCase("sv")) && !(row.counterparty ?? "").toLocaleUpperCase("sv").includes(pattern.toLocaleUpperCase("sv"))) {
    throw new WatchChargeError(`Bankens text "${pattern}" finns inte i köpets text.`);
  }
  const account = db.select().from(accounts).where(eq(accounts.id, row.accountId!)).get();
  const date = row.transactionDate ?? row.bookingDate;
  const created = db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const expense = tx
      .insert(recurringExpenses)
      .values({
        name,
        amount: Math.abs(row.amount),
        billingCycle: input.cycle,
        anchorDay: Number(date.slice(8, 10)),
        anchorMonth: input.cycle === "yearly" ? Number(date.slice(5, 7)) : null,
        accountId: row.accountId,
        categoryId: row.categoryId,
        matchPattern: pattern,
        paymentMethod: account?.kind === "credit_card" ? "credit_card" : "card",
        dateBasis: "transaction",
        shared: row.shared,
      })
      .returning()
      .get();
    linkRecurring(tx);
    // This purchase belongs to it whatever else the linking found.
    tx.update(transactions).set({ recurringExpenseId: expense.id }).where(and(eq(transactions.id, row.id), isNull(transactions.recurringExpenseId))).run();
    return tx.select().from(recurringExpenses).where(eq(recurringExpenses.id, expense.id)).get()!;
  });
  return created as RecurringExpense;
}
