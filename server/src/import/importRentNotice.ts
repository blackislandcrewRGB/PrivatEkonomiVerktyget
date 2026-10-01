import { and, eq, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, imports, recurringExpenseAmounts, recurringExpenses, rentNotices } from "../db/schema.js";
import { expectedAmounts } from "../recurring/amounts.js";
import { dueDateIn, monthOf } from "../overview/dates.js";
import { ImportError } from "./importCore.js";
import type { RentNotice, RentNoticeLine } from "./rentNotice.js";

type Expense = typeof recurringExpenses.$inferSelect;

/**
 * A rent notice in Importer. It has no rows of its own: it belongs to the
 * fixed expense that pays the rent, and its amount becomes that expense's
 * amount for the period it is paid in (the due date's month; the October
 * rent due 30/9 is September's charge). The fields shared with the bank
 * files' results are zero, so the preview table can list it with them.
 */
export interface RentNoticeImportResult {
  source: "rent_notice";
  dryRun: boolean;
  filename: string;
  importId: number | null;
  period: { from: string; to: string };
  account: { id: number; name: string } | null;
  notice: {
    issuer: string;
    number: string;
    noticeDate: string | null;
    dueDate: string;
    rentMonth: string;
    period: string;
    amount: number;
    lines: RentNoticeLine[];
    bankgiro: string | null;
    alreadyImported: boolean;
  };
  expense: { id: number; name: string; usualAmount: number; before: number };
  rowsTotal: 0;
  rowsNew: 0;
  rowsSkipped: 0;
  rowsUncategorized: 0;
  newRowsPreview: [];
  possibleDuplicates: [];
  unmappedMerchantCategories: [];
  internalTransfers: 0;
  transferPairs: 0;
  recurringLinked: 0;
  recategorized: 0;
}

/** The monthly fixed expense paying a landlord: its bank text in the issuer's name, else the one called Hyra. */
export function rentExpense(db: Db, issuer: string): Expense | null {
  const monthly = db
    .select()
    .from(recurringExpenses)
    .all()
    .filter((e) => !e.paused && e.billingCycle === "monthly");
  const name = issuer.toLocaleUpperCase("sv");
  return (
    monthly.find((e) => e.matchPattern && name.includes(e.matchPattern.toLocaleUpperCase("sv"))) ??
    monthly.find((e) => /\bhyra\b/i.test(e.name)) ??
    null
  );
}

/** A period's own amount: none when it is the usual one. */
export function setPeriodAmount(db: Db, e: Pick<Expense, "id" | "amount">, month: string, amount: number | null): void {
  const where = and(eq(recurringExpenseAmounts.recurringExpenseId, e.id), eq(recurringExpenseAmounts.month, month));
  if (amount === null || amount === e.amount) db.delete(recurringExpenseAmounts).where(where).run();
  else
    db.insert(recurringExpenseAmounts)
      .values({ recurringExpenseId: e.id, month, amount })
      .onConflictDoUpdate({ target: [recurringExpenseAmounts.recurringExpenseId, recurringExpenseAmounts.month], set: { amount } })
      .run();
}

export function importRentNotice(db: Db, n: RentNotice, bytes: Uint8Array, filename: string): RentNoticeImportResult {
  const e = rentExpense(db, n.issuer);
  if (!e) {
    throw new ImportError(`Hittar ingen fast utgift för hyran till ${n.issuer}.`, [
      "Lägg till bankens text (ett ord ur mottagarens namn) på hyran under Fasta utgifter, eller döp den till Hyra.",
    ]);
  }
  const period = monthOf(n.dueDate);
  const existing = db
    .select({ id: rentNotices.id })
    .from(rentNotices)
    .where(or(eq(rentNotices.sha256, n.sha256), and(eq(rentNotices.issuer, n.issuer), eq(rentNotices.number, n.number))))
    .get();
  const account = e.accountId !== null ? (db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, e.accountId)).get() ?? null) : null;
  const result: RentNoticeImportResult = {
    source: "rent_notice",
    dryRun: false,
    filename,
    importId: null,
    period: { from: `${n.rentMonth}-01`, to: dueDateIn(n.rentMonth, 31) },
    account,
    notice: { ...n, period, alreadyImported: !!existing },
    expense: { id: e.id, name: e.name, usualAmount: e.amount, before: expectedAmounts(db)(e, period) },
    rowsTotal: 0,
    rowsNew: 0,
    rowsSkipped: 0,
    rowsUncategorized: 0,
    newRowsPreview: [],
    possibleDuplicates: [],
    unmappedMerchantCategories: [],
    internalTransfers: 0,
    transferPairs: 0,
    recurringLinked: 0,
    recategorized: 0,
  };
  if (existing) return result;

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const imp = tx
      .insert(imports)
      .values({ source: "rent_notice", filename, periodFrom: result.period.from, periodTo: result.period.to })
      .returning({ id: imports.id })
      .get();
    const own = tx
      .select({ amount: recurringExpenseAmounts.amount })
      .from(recurringExpenseAmounts)
      .where(and(eq(recurringExpenseAmounts.recurringExpenseId, e.id), eq(recurringExpenseAmounts.month, period)))
      .get();
    tx.insert(rentNotices)
      .values({
        importId: imp.id,
        recurringExpenseId: e.id,
        issuer: n.issuer,
        number: n.number,
        noticeDate: n.noticeDate,
        dueDate: n.dueDate,
        rentMonth: n.rentMonth,
        period,
        amount: n.amount,
        lines: JSON.stringify(n.lines),
        bankgiro: n.bankgiro,
        previousAmount: own?.amount ?? null,
        pdf: Buffer.from(bytes),
        sha256: n.sha256,
      })
      .run();
    setPeriodAmount(tx, e, period, n.amount);
    return { ...result, importId: imp.id };
  });
}

/** Undoing a notice's import: the period's amount goes back to what it was, unless it has been changed since. */
export function undoRentNotices(db: Db, importId: number): number {
  const notices = db.select().from(rentNotices).where(eq(rentNotices.importId, importId)).all();
  for (const n of notices) {
    const e = n.recurringExpenseId !== null ? db.select().from(recurringExpenses).where(eq(recurringExpenses.id, n.recurringExpenseId)).get() : undefined;
    if (e && expectedAmounts(db)(e, n.period) === n.amount) setPeriodAmount(db, e, n.period, n.previousAmount);
  }
  db.delete(rentNotices).where(eq(rentNotices.importId, importId)).run();
  return notices.length;
}
