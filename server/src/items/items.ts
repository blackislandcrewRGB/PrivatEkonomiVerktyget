import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { itemAttachments, items, itemTransactions, transactions, type Item, type ItemAttachment } from "../db/schema.js";
import { ITEM_ATTACHMENT_KINDS, ITEM_OWNERS, ITEM_STATUSES } from "../db/schema.js";
import { addMonths, dueDateIn, monthOf } from "../overview/dates.js";

/**
 * 'Prylar': the things I bought and chose to write down — an Ovalring ring from
 * Amazon, a monitor — with the transaction they were paid with, a picture and
 * the receipt.
 *
 * A pryl is metadata, not money. Nothing here adds to a sum, changes a
 * category or reaches the settlement: linking a transaction writes a row in
 * `item_transactions` and touches nothing on the transaction itself, and
 * removing a pryl leaves the transaction exactly as it was. The price is kept
 * on the item as a positive number — what the thing cost — precisely because
 * it is never summed with anything.
 */

export class ItemError extends Error {}

export type ItemOwner = (typeof ITEM_OWNERS)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type AttachmentKind = (typeof ITEM_ATTACHMENT_KINDS)[number];

export interface ItemInput {
  name: string;
  category?: string | null;
  purchaseDate: string;
  priceOre: number;
  merchant?: string | null;
  purchaseUrl?: string | null;
  note?: string | null;
  owner?: ItemOwner;
  status?: ItemStatus;
  warrantyMonths?: number | null;
  returnDeadline?: string | null;
  soldPriceOre?: number | null;
  soldDate?: string | null;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const trimmed = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/** A link is only worth following if it opens a web page; javascript: and data: never get in. */
function cleanUrl(value: string | null | undefined): string | null {
  const url = trimmed(value);
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ItemError("Köplänken ska vara en webbadress som börjar med http:// eller https://.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ItemError("Köplänken ska vara en webbadress som börjar med http:// eller https://.");
  }
  return parsed.toString();
}

function checkDate(value: string | null | undefined, what: string, required: boolean): string | null {
  const date = trimmed(value);
  if (!date) {
    if (required) throw new ItemError(`${what} behövs.`);
    return null;
  }
  if (!isDate(date)) throw new ItemError(`${what} ska vara ÅÅÅÅ-MM-DD.`);
  return date;
}

function checkPrice(value: number | null | undefined, what: string, required: boolean): number | null {
  if (value === null || value === undefined) {
    if (required) throw new ItemError(`${what} behövs.`);
    return null;
  }
  if (!Number.isInteger(value) || value < 0) throw new ItemError(`${what} ska vara ett belopp i hela ören, noll eller mer.`);
  return value;
}

/** Turns what came in into the columns, with every value checked. Throws ItemError with a message for the user. */
function fields(input: ItemInput) {
  const name = trimmed(input.name);
  if (!name) throw new ItemError("Prylen behöver ett namn.");
  if (input.owner !== undefined && !ITEM_OWNERS.includes(input.owner)) throw new ItemError("Okänd ägare.");
  if (input.status !== undefined && !ITEM_STATUSES.includes(input.status)) throw new ItemError("Okänd status.");
  const warrantyMonths = input.warrantyMonths ?? null;
  if (warrantyMonths !== null && (!Number.isInteger(warrantyMonths) || warrantyMonths < 0 || warrantyMonths > 600)) {
    throw new ItemError("Garantin ska vara ett antal månader, 0 eller mer.");
  }
  return {
    name,
    category: trimmed(input.category),
    purchaseDate: checkDate(input.purchaseDate, "Inköpsdatum", true)!,
    priceOre: checkPrice(input.priceOre, "Priset", true)!,
    merchant: trimmed(input.merchant),
    purchaseUrl: cleanUrl(input.purchaseUrl),
    note: trimmed(input.note),
    owner: input.owner ?? ("me" as ItemOwner),
    status: input.status ?? ("owned" as ItemStatus),
    warrantyMonths,
    returnDeadline: checkDate(input.returnDeadline, "Sista dag att ångra köpet", false),
    soldPriceOre: checkPrice(input.soldPriceOre, "Vad prylen såldes för", false),
    soldDate: checkDate(input.soldDate, "Säljdatum", false),
  };
}

export function createItem(db: Db, input: ItemInput): Item {
  return db.insert(items).values(fields(input)).returning().get();
}

/** Only the fields that were sent are changed; the rest are left alone. */
export function updateItem(db: Db, id: number, patch: Partial<ItemInput>): Item {
  const current = getItem(db, id);
  if (!current) throw new ItemError("Prylen finns inte.");
  const next = fields({ ...current, ...patch });
  return db
    .update(items)
    .set({ ...next, updatedAt: new Date().toISOString() })
    .where(eq(items.id, id))
    .returning()
    .get();
}

/** The item, deleted or not: an undo has to be able to find it again. */
export function getItem(db: Db, id: number): Item | undefined {
  return db.select().from(items).where(eq(items.id, id)).get();
}

/**
 * Soft delete, as everywhere else in the tool. The linked transactions are not
 * touched — the money happened whatever I do with the note about the thing.
 */
export function deleteItem(db: Db, id: number): boolean {
  const gone = db
    .update(items)
    .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(and(eq(items.id, id), isNull(items.deletedAt)))
    .returning({ id: items.id })
    .all();
  return gone.length > 0;
}

export function restoreItem(db: Db, id: number): boolean {
  const back = db
    .update(items)
    .set({ deletedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(items.id, id))
    .returning({ id: items.id })
    .all();
  return back.length > 0;
}

/** Newest purchase first, deleted ones left out. Filters come with the API (step 2). */
export function listItems(db: Db): Item[] {
  return db.select().from(items).where(isNull(items.deletedAt)).orderBy(desc(items.purchaseDate), desc(items.id)).all();
}

/**
 * Ties a transaction to an item. Linking twice is not an error: the link
 * either exists or it doesn't.
 */
export function linkTransaction(db: Db, itemId: number, transactionId: number): void {
  const item = getItem(db, itemId);
  if (!item || item.deletedAt) throw new ItemError("Prylen finns inte.");
  const tx = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!tx) throw new ItemError("Transaktionen finns inte.");
  db.insert(itemTransactions).values({ itemId, transactionId }).onConflictDoNothing().run();
}

export function unlinkTransaction(db: Db, itemId: number, transactionId: number): boolean {
  const gone = db
    .delete(itemTransactions)
    .where(and(eq(itemTransactions.itemId, itemId), eq(itemTransactions.transactionId, transactionId)))
    .returning({ itemId: itemTransactions.itemId })
    .all();
  return gone.length > 0;
}

/** The transactions an item was paid with, oldest first. */
export function transactionIdsFor(db: Db, itemId: number): number[] {
  return db
    .select({ id: itemTransactions.transactionId })
    .from(itemTransactions)
    .where(eq(itemTransactions.itemId, itemId))
    .orderBy(asc(itemTransactions.transactionId))
    .all()
    .map((r) => r.id);
}

/**
 * Which of these transactions belong to a pryl, and to which one. Used by the
 * list's little marker, so it is one query for a whole page of rows.
 */
export function itemsByTransaction(db: Db, transactionIds: number[]): Map<number, { id: number; name: string }[]> {
  const out = new Map<number, { id: number; name: string }[]>();
  if (transactionIds.length === 0) return out;
  const rows = db
    .select({ transactionId: itemTransactions.transactionId, id: items.id, name: items.name })
    .from(itemTransactions)
    .innerJoin(items, eq(items.id, itemTransactions.itemId))
    .where(
      and(
        isNull(items.deletedAt),
        // A whole page of rows at a time; SQLite has a limit on variables.
        transactionIds.length <= 500 ? inArray(itemTransactions.transactionId, transactionIds) : undefined,
      ),
    )
    .orderBy(asc(items.name))
    .all();
  const wanted = transactionIds.length <= 500 ? null : new Set(transactionIds);
  for (const r of rows) {
    if (wanted && !wanted.has(r.transactionId)) continue;
    const list = out.get(r.transactionId);
    if (list) list.push({ id: r.id, name: r.name });
    else out.set(r.transactionId, [{ id: r.id, name: r.name }]);
  }
  return out;
}

/** How many items are linked to each of these transactions (one query, for lists). */
export function itemCountByTransaction(db: Db, transactionIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, list] of itemsByTransaction(db, transactionIds)) out.set(id, list.length);
  return out;
}

/** Records an uploaded file. The file itself is written by the upload code (step 2). */
export function addAttachment(
  db: Db,
  itemId: number,
  file: { kind: AttachmentKind; filePath: string; originalFilename?: string | null; thumbnailPath?: string | null },
): ItemAttachment {
  const item = getItem(db, itemId);
  if (!item || item.deletedAt) throw new ItemError("Prylen finns inte.");
  if (!ITEM_ATTACHMENT_KINDS.includes(file.kind)) throw new ItemError("Okänd typ av bilaga.");
  return db
    .insert(itemAttachments)
    .values({
      itemId,
      kind: file.kind,
      filePath: file.filePath,
      originalFilename: trimmed(file.originalFilename),
      thumbnailPath: trimmed(file.thumbnailPath),
    })
    .returning()
    .get();
}

export function attachmentsFor(db: Db, itemId: number): ItemAttachment[] {
  return db
    .select()
    .from(itemAttachments)
    .where(and(eq(itemAttachments.itemId, itemId), isNull(itemAttachments.deletedAt)))
    .orderBy(asc(itemAttachments.id))
    .all();
}

/** Soft delete: the file stays on disk, because a backup may point at it. */
export function deleteAttachment(db: Db, id: number): boolean {
  const gone = db
    .update(itemAttachments)
    .set({ deletedAt: new Date().toISOString() })
    .where(and(eq(itemAttachments.id, id), isNull(itemAttachments.deletedAt)))
    .returning({ id: itemAttachments.id })
    .all();
  return gone.length > 0;
}

/**
 * The last day of the warranty: the purchase date plus the months, clamped the
 * way a due date is (bought 31/1 with 6 months runs out 31/7, bought 31/8 with
 * 6 months runs out 28/2). NULL when no warranty is known.
 */
export function warrantyEndsOn(item: Pick<Item, "purchaseDate" | "warrantyMonths">): string | null {
  if (item.warrantyMonths === null || item.warrantyMonths <= 0) return null;
  return dueDateIn(addMonths(monthOf(item.purchaseDate), item.warrantyMonths), Number(item.purchaseDate.slice(8, 10)));
}

/** How many items there are, deleted ones left out. */
export function countItems(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(items).where(isNull(items.deletedAt)).get()!.n;
}
