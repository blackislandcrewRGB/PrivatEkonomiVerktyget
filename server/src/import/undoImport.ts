import { and, eq, gt, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { imports, statements, transactions } from "../db/schema.js";
import { pairTransfers } from "../transfers/transfers.js";
import { linkRecurring } from "../recurring/link.js";
import { undoRentNotices } from "./importRentNotice.js";
import { taxReturnUndoStatus, undoTaxReturns } from "./importTaxReturn.js";

export type UndoStatus = { ok: true; rows: number; statement: boolean } | { ok: false; reason: string };

/** The accounts an import put rows or an invoice on. */
function accountsOf(db: Db, id: number): Set<number> {
  const rows = db.selectDistinct({ a: transactions.accountId }).from(transactions).where(eq(transactions.importId, id)).all();
  const invoices = db.selectDistinct({ a: statements.accountId }).from(statements).where(eq(statements.importId, id)).all();
  return new Set([...rows, ...invoices].map((r) => r.a).filter((a): a is number => a !== null));
}

/**
 * Whether an import can be undone: no later import from the same bank has
 * touched the same account (it may have skipped this one's rows as already
 * there, or matched them), and none of its rows has been changed by hand,
 * deleted or marked as returned since.
 */
export function importUndoStatus(db: Db, id: number): UndoStatus {
  const imp = db.select().from(imports).where(eq(imports.id, id)).get();
  if (!imp) return { ok: false, reason: "Importen finns inte." };
  // The next sync would fetch the rows again; a wrong row is deleted in Transaktioner instead (it then stays away).
  if (imp.via === "enable_banking") return { ok: false, reason: "Hämtat från banken: ta bort fel rader i Transaktioner (de hämtas inte igen)." };
  if (imp.source === "tax_return") {
    const s = taxReturnUndoStatus(db, id);
    return s.ok ? { ok: true, rows: 0, statement: false } : s;
  }
  const mine = accountsOf(db, id);
  const later = db.select().from(imports).where(and(eq(imports.source, imp.source), gt(imports.id, id))).all();
  // A later import without rows of its own may still have skipped ours: count it as touching.
  const blocked = later.some((l) => {
    const theirs = accountsOf(db, l.id);
    return (theirs.size === 0 && l.rowsSkipped > 0) || [...theirs].some((a) => mine.has(a));
  });
  if (blocked) return { ok: false, reason: "En senare import från samma bank har rört samma konto." };
  const rows = db
    .select({ id: transactions.id, edited: transactions.manuallyEditedAt, deleted: transactions.deletedAt, returned: transactions.returnGroupId })
    .from(transactions)
    .where(eq(transactions.importId, id))
    .all();
  const touched = rows.filter((r) => r.edited || r.deleted || r.returned !== null).length;
  if (touched) return { ok: false, reason: `${touched} ${touched === 1 ? "rad har" : "rader har"} ändrats för hand sedan importen.` };
  const statement = !!db.select({ id: statements.id }).from(statements).where(eq(statements.importId, id)).get();
  return { ok: true, rows: rows.length, statement };
}

/**
 * Undoes an import: its rows and the invoice it registered are removed for
 * real (so the file can be imported again) and the import leaves the
 * history. Transfers paired with its rows are unpaired and paired again,
 * fixed expenses relinked. The account balance an invoice set stays.
 */
export function undoImport(db: Db, id: number): { removed: number } {
  const status = importUndoStatus(db, id);
  if (!status.ok) throw new Error(status.reason);
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const ids = tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.importId, id)).all().map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      // Their transfer partners in other imports lose the pair (and get a new one if there is one).
      tx.update(transactions)
        .set({ transferPairId: null })
        .where(and(inArray(transactions.transferPairId, chunk), notInArray(transactions.id, chunk)))
        .run();
      tx.delete(transactions).where(inArray(transactions.id, chunk)).run();
    }
    tx.delete(statements).where(eq(statements.importId, id)).run();
    // A rent notice: the period's amount goes back to what it was.
    undoRentNotices(tx, id);
    // A tax return receipt: its year goes back to what it replaced.
    undoTaxReturns(tx, id);
    tx.delete(imports).where(eq(imports.id, id)).run();
    pairTransfers(tx);
    linkRecurring(tx);
    return { removed: ids.length };
  });
}
