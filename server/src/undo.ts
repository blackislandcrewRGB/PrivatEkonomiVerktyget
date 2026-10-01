import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { transactionSplits, transactions } from "./db/schema.js";
import { loadSplits, type SplitPart } from "./splits.js";

/**
 * The editable state of a row before a bulk change, so 'Ångra' can put it
 * back exactly (category, where it came from, shared/whose, private, note,
 * name, deleted, and the split across categories).
 */
export interface RowSnapshot {
  id: number;
  categoryId: number | null;
  categorySource: (typeof transactions.$inferSelect)["categorySource"];
  isTransfer: boolean;
  shared: boolean;
  forOther: boolean;
  private: boolean;
  /** Missing in snapshots taken before notes could be changed in bulk. */
  note?: string | null;
  /** The name shown instead of the bank's text; a manual row's text is its name too. */
  label?: string | null;
  descriptionRaw?: string;
  descriptionClean?: string;
  counterAccountId: number | null;
  manuallyEditedAt: string | null;
  deletedAt: string | null;
  /** The parts of a split purchase; an empty list means it wasn't split. Missing in older snapshots. */
  splits?: SplitPart[];
}

const FIELDS = {
  id: transactions.id,
  categoryId: transactions.categoryId,
  categorySource: transactions.categorySource,
  isTransfer: transactions.isTransfer,
  shared: transactions.shared,
  forOther: transactions.forOther,
  private: transactions.private,
  note: transactions.note,
  label: transactions.label,
  descriptionRaw: transactions.descriptionRaw,
  descriptionClean: transactions.descriptionClean,
  counterAccountId: transactions.counterAccountId,
  manuallyEditedAt: transactions.manuallyEditedAt,
  deletedAt: transactions.deletedAt,
};

export function snapshotRows(db: Db, ids: number[]): RowSnapshot[] {
  const splits = loadSplits(db, ids);
  const out: RowSnapshot[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...db.select(FIELDS).from(transactions).where(inArray(transactions.id, ids.slice(i, i + 500))).all().map((r) => ({ ...r, splits: splits.get(r.id) ?? [] })));
  }
  return out;
}

const isParts = (parts: unknown): parts is SplitPart[] =>
  Array.isArray(parts) && parts.every((p) => !!p && Number.isInteger((p as SplitPart).categoryId) && Number.isInteger((p as SplitPart).amount));

const SOURCES = new Set(["rule", "merchant_category", "llm", "manual", "none"]);

function isSnapshot(s: unknown): s is RowSnapshot {
  const r = s as RowSnapshot;
  return (
    !!r &&
    Number.isInteger(r.id) &&
    (r.categoryId === null || Number.isInteger(r.categoryId)) &&
    SOURCES.has(r.categorySource) &&
    [r.isTransfer, r.shared, r.forOther, r.private].every((b) => typeof b === "boolean") &&
    (r.counterAccountId === null || Number.isInteger(r.counterAccountId)) &&
    (r.note === undefined || r.note === null || typeof r.note === "string") &&
    (r.label === undefined || r.label === null || typeof r.label === "string") &&
    [r.descriptionRaw, r.descriptionClean].every((d) => d === undefined || (typeof d === "string" && d !== "")) &&
    (r.manuallyEditedAt === null || typeof r.manuallyEditedAt === "string") &&
    (r.deletedAt === null || typeof r.deletedAt === "string") &&
    (r.splits === undefined || isParts(r.splits))
  );
}

/** Writes snapshots back. Returns how many rows were restored; throws on a malformed snapshot. */
export function restoreRows(db: Db, snapshots: unknown): number {
  if (!Array.isArray(snapshots) || !snapshots.every(isSnapshot)) throw new Error("Ogiltig ögonblicksbild.");
  return db.transaction((txn) => {
    let n = 0;
    for (const { id, splits, ...fields } of snapshots) {
      n += txn.update(transactions).set(fields).where(eq(transactions.id, id)).run().changes;
      // An older snapshot knows nothing about splits and leaves them alone.
      if (splits === undefined) continue;
      txn.delete(transactionSplits).where(eq(transactionSplits.transactionId, id)).run();
      if (splits.length) {
        txn.insert(transactionSplits).values(splits.map((p, i) => ({ transactionId: id, categoryId: p.categoryId, amount: p.amount, sort: i }))).run();
      }
    }
    return n;
  });
}
