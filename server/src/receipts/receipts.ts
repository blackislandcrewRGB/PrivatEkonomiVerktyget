import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { receiptLines, receipts, transactions, type Receipt, type ReceiptLine } from "../db/schema.js";
import { RECEIPT_LINE_KINDS, RECEIPT_SOURCES, RECEIPT_STORES } from "../db/schema.js";
import { ReceiptError, receiptNameKey, scrubReceiptText, type ParsedLine, type ReceiptStore } from "./parse.js";
import { resolveProduct } from "./products.js";

// The folding of a name belongs with the parser now, but it is still
// exported from here, where the storing of a receipt lives.
export { receiptNameKey };

/**
 * Storing a receipt.
 *
 * A receipt is metadata, not money, exactly like a pryl: the transaction holds
 * the amount and nothing here is ever summed, categorised or settled. What is
 * enforced instead is that the rows tell the truth about the receipt — they
 * have to add up to the total the receipt states, to the öre, or nothing is
 * stored. That check is what makes it safe to read text written by four shops
 * in four dialects, and it holds for rows the user has corrected by hand too.
 */

export type ReceiptSource = (typeof RECEIPT_SOURCES)[number];

export interface ReceiptInput {
  transactionId?: number | null;
  store: ReceiptStore;
  storeArea?: string | null;
  purchaseDate: string;
  purchaseTime?: string | null;
  totalOre: number;
  statedItemCount?: number | null;
  source: ReceiptSource;
  rawText: string;
  lines: ParsedLine[];
}

export interface ReceiptWithLines extends Receipt {
  lines: ReceiptLine[];
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const trimmed = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

function checkLines(lines: ParsedLine[], totalOre: number): void {
  if (lines.length === 0) throw new ReceiptError("Kvittot har inga rader.");
  for (const l of lines) {
    if (!trimmed(l.name)) throw new ReceiptError("Varje rad behöver ett namn.");
    if (!Number.isInteger(l.totalOre)) throw new ReceiptError(`Beloppet för "${l.name}" ska vara hela ören.`);
    if (!RECEIPT_LINE_KINDS.includes(l.kind)) throw new ReceiptError(`Okänd sorts rad: "${l.kind}".`);
    if (l.quantityMilli !== null && (!Number.isInteger(l.quantityMilli) || l.quantityMilli <= 0)) {
      throw new ReceiptError(`Antalet för "${l.name}" ska vara större än noll.`);
    }
    if (l.unitPriceOre !== null && (!Number.isInteger(l.unitPriceOre) || l.unitPriceOre < 0)) {
      throw new ReceiptError(`Jämförpriset för "${l.name}" ska vara hela ören.`);
    }
  }
  const sum = lines.reduce((s, l) => s + l.totalOre, 0);
  if (sum !== totalOre) {
    const kr = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");
    throw new ReceiptError(`Raderna blir ${kr(sum)} kr men kvittot säger ${kr(totalOre)} kr. Rätta raderna först.`);
  }
}

/** The receipt of a transaction, deleted ones left out. */
export function receiptForTransaction(db: Db, transactionId: number): Receipt | undefined {
  return db
    .select()
    .from(receipts)
    .where(and(eq(receipts.transactionId, transactionId), isNull(receipts.deletedAt)))
    .get();
}

export function createReceipt(db: Db, input: ReceiptInput): ReceiptWithLines {
  if (!RECEIPT_STORES.includes(input.store)) throw new ReceiptError("Okänd butik.");
  if (!RECEIPT_SOURCES.includes(input.source)) throw new ReceiptError("Okänd källa.");
  if (!isDate(input.purchaseDate)) throw new ReceiptError("Inköpsdatum ska vara ÅÅÅÅ-MM-DD.");
  if (!Number.isInteger(input.totalOre)) throw new ReceiptError("Totalen ska vara hela ören.");
  checkLines(input.lines, input.totalOre);

  const transactionId = input.transactionId ?? null;
  if (transactionId !== null) {
    if (!db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, transactionId)).get()) {
      throw new ReceiptError("Transaktionen finns inte.");
    }
    if (receiptForTransaction(db, transactionId)) throw new ReceiptError("Köpet har redan ett kvitto.");
  }

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const receipt = tx
      .insert(receipts)
      .values({
        transactionId,
        store: input.store,
        storeArea: trimmed(input.storeArea),
        purchaseDate: input.purchaseDate,
        purchaseTime: trimmed(input.purchaseTime),
        totalOre: input.totalOre,
        statedItemCount: input.statedItemCount ?? null,
        source: input.source,
        // Card and membership numbers never reach the database.
        rawText: scrubReceiptText(input.rawText),
      })
      .returning()
      .get();
    const rows = tx
      .insert(receiptLines)
      .values(
        input.lines.map((l, i) => ({
          receiptId: receipt.id,
          position: i,
          kind: l.kind,
          name: l.name.trim(),
          nameKey: receiptNameKey(l.name),
          quantityMilli: l.quantityMilli,
          unit: trimmed(l.unit),
          unitPriceOre: l.unitPriceOre,
          totalOre: l.totalOre,
        })),
      )
      .returning()
      .all();
    // Every grocery gets its product, so it can be followed over time: a new
    // name makes a new one, a known name lands on what it already means.
    for (const l of rows) if (l.kind === "item") resolveProduct(tx, l.name);
    return { ...receipt, lines: rows };
  }) as ReceiptWithLines;
}

/** The receipt and its rows, deleted or not: an undo has to find it again. */
export function getReceipt(db: Db, id: number): ReceiptWithLines | undefined {
  const receipt = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!receipt) return undefined;
  return { ...receipt, lines: linesFor(db, id) };
}

export function linesFor(db: Db, receiptId: number): ReceiptLine[] {
  return db.select().from(receiptLines).where(eq(receiptLines.receiptId, receiptId)).orderBy(asc(receiptLines.position)).all();
}

/** Newest purchase first, deleted ones left out. */
export function listReceipts(db: Db, opts: { from?: string; to?: string; store?: ReceiptStore } = {}): Receipt[] {
  const where = [isNull(receipts.deletedAt)];
  if (opts.from && isDate(opts.from)) where.push(sql`${receipts.purchaseDate} >= ${opts.from}`);
  if (opts.to && isDate(opts.to)) where.push(sql`${receipts.purchaseDate} <= ${opts.to}`);
  if (opts.store) where.push(eq(receipts.store, opts.store));
  return db.select().from(receipts).where(and(...where)).orderBy(desc(receipts.purchaseDate), desc(receipts.id)).all();
}

/**
 * Soft delete, as everywhere else. The transaction is not touched: the money
 * happened whatever I do with the note about what it bought.
 */
export function deleteReceipt(db: Db, id: number): boolean {
  const gone = db
    .update(receipts)
    .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(and(eq(receipts.id, id), isNull(receipts.deletedAt)))
    .returning({ id: receipts.id })
    .all();
  return gone.length > 0;
}

export function restoreReceipt(db: Db, id: number): boolean {
  const receipt = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!receipt) return false;
  // The purchase may have been given another receipt in the meantime.
  if (receipt.transactionId !== null && receiptForTransaction(db, receipt.transactionId)) {
    throw new ReceiptError("Köpet har redan ett kvitto.");
  }
  db.update(receipts).set({ deletedAt: null, updatedAt: new Date().toISOString() }).where(eq(receipts.id, id)).run();
  return true;
}

/**
 * Which of these transactions have a receipt, and how many rows it holds. One
 * query for a whole page of rows, for the list's little marker.
 */
export function receiptsByTransaction(db: Db, transactionIds: number[]): Map<number, { id: number; lines: number }> {
  const out = new Map<number, { id: number; lines: number }>();
  if (transactionIds.length === 0) return out;
  const wanted = transactionIds.length <= 500 ? null : new Set(transactionIds);
  const rows = db
    .select({ id: receipts.id, transactionId: receipts.transactionId, lines: sql<number>`count(${receiptLines.id})` })
    .from(receipts)
    .leftJoin(receiptLines, eq(receiptLines.receiptId, receipts.id))
    .where(and(isNull(receipts.deletedAt), wanted ? undefined : inArray(receipts.transactionId, transactionIds)))
    .groupBy(receipts.id)
    .all();
  for (const r of rows) {
    if (r.transactionId === null) continue;
    if (wanted && !wanted.has(r.transactionId)) continue;
    out.set(r.transactionId, { id: r.id, lines: r.lines });
  }
  return out;
}

/** How many receipts there are, deleted ones left out. */
export function countReceipts(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(receipts).where(isNull(receipts.deletedAt)).get()!.n;
}
