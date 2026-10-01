import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { imports, taxReturns } from "../db/schema.js";
import { TAX_RETURN_BOXES, type TaxReturnBoxes, type TaxReturnReceipt } from "./taxReturn.js";

type TaxReturnRow = typeof taxReturns.$inferSelect;

/** What a receipt replaces: the year as it was before. */
export interface TaxReturnBefore {
  submittedAt: string | null;
  source: "pdf" | "manual";
  boxes: TaxReturnBoxes;
}

/**
 * A tax return receipt in Importer. Like a rent notice it has no rows of its
 * own; it becomes its income year's row in tax_returns, replacing one that is
 * there (the preview says so, and importing is the confirmation). The fields
 * shared with the bank files' results are zero, so the preview table can list
 * it with them.
 */
export interface TaxReturnImportResult {
  source: "tax_return";
  dryRun: boolean;
  filename: string;
  importId: number | null;
  period: { from: string; to: string };
  taxReturn: TaxReturnReceipt & { alreadyImported: boolean; replaces: TaxReturnBefore | null };
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

/** What the history calls a receipt: never the file's own name, which has the personnummer in it. */
export const taxReturnFilename = (incomeYear: number) => `Deklarationskvittens ${incomeYear}.pdf`;

export function boxesOf(r: Pick<TaxReturnRow, keyof TaxReturnBoxes>): TaxReturnBoxes {
  return Object.fromEntries(Object.values(TAX_RETURN_BOXES).map((k) => [k, r[k]])) as TaxReturnBoxes;
}

const sameBoxes = (a: TaxReturnBoxes, b: TaxReturnBoxes) => Object.values(TAX_RETURN_BOXES).every((k) => a[k] === b[k]);

export function importTaxReturn(db: Db, r: TaxReturnReceipt, filename: string): TaxReturnImportResult {
  const existing = db.select().from(taxReturns).where(eq(taxReturns.incomeYear, r.incomeYear)).get();
  const same = !!existing && existing.submittedAt === r.submittedAt && sameBoxes(boxesOf(existing), r.boxes);
  const result: TaxReturnImportResult = {
    source: "tax_return",
    dryRun: false,
    filename,
    importId: null,
    period: { from: `${r.incomeYear}-01-01`, to: `${r.incomeYear}-12-31` },
    taxReturn: {
      ...r,
      alreadyImported: same,
      replaces: existing && !same ? { submittedAt: existing.submittedAt, source: existing.source, boxes: boxesOf(existing) } : null,
    },
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
  if (same) return result;

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const imp = tx
      .insert(imports)
      .values({ source: "tax_return", filename, periodFrom: result.period.from, periodTo: result.period.to })
      .returning({ id: imports.id })
      .get();
    const values = { submittedAt: r.submittedAt, ...r.boxes, source: "pdf" as const, importId: imp.id, updatedAt: new Date().toISOString() };
    if (existing) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...before } = existing;
      tx.update(taxReturns)
        .set({ ...values, previous: JSON.stringify(before) })
        .where(eq(taxReturns.id, existing.id))
        .run();
    } else {
      tx.insert(taxReturns)
        .values({ incomeYear: r.incomeYear, ...values })
        .run();
    }
    return { ...result, importId: imp.id };
  });
}

/** Whether a receipt's import can be undone: its year still holds what it read in. */
export function taxReturnUndoStatus(db: Db, importId: number): { ok: true } | { ok: false; reason: string } {
  const row = db.select({ id: taxReturns.id }).from(taxReturns).where(eq(taxReturns.importId, importId)).get();
  return row ? { ok: true } : { ok: false, reason: "Året har ändrats för hand eller ersatts av en senare kvittens sedan dess." };
}

/** Undoing a receipt's import: the year goes back to what it replaced, or away when it was new. */
export function undoTaxReturns(db: Db, importId: number): number {
  const row = db.select().from(taxReturns).where(eq(taxReturns.importId, importId)).get();
  if (!row) return 0;
  if (row.previous) {
    const before = JSON.parse(row.previous) as Omit<TaxReturnRow, "id" | "createdAt" | "updatedAt">;
    // The replaced import may itself be gone: its row then holds no import.
    const stillThere = before.importId !== null && !!db.select({ id: imports.id }).from(imports).where(eq(imports.id, before.importId)).get();
    db.update(taxReturns)
      .set({ ...before, importId: stillThere ? before.importId : null, updatedAt: new Date().toISOString() })
      .where(eq(taxReturns.id, row.id))
      .run();
  } else {
    db.delete(taxReturns).where(eq(taxReturns.id, row.id)).run();
  }
  return 1;
}
