import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, contacts, items, itemTransactions, transactions } from "../db/schema.js";
import { addDays, daysBetween } from "../overview/dates.js";
import { getSetting, setSetting } from "../settings.js";
import { warrantyEndsOn } from "./items.js";

/**
 * What Vakt watches about prylar:
 * - warranty_ending: the warranty on something I own runs out within 30 days,
 *   while there is still time to complain about it;
 * - return_deadline: the right to send something back runs out within 3 days;
 * - maybe_item: a purchase in a category I said is usually things (Prylar &
 *   hem › Elektronik by default), over a threshold (500 kr by default), that
 *   isn't the payment for any pryl — 'is this a thing? create one, or no'.
 *
 * 'No' is an ordinary dismissal, which is remembered by the transaction's id,
 * so the same purchase is never asked about twice.
 */

/** A warranty is worth saying something about this long before it runs out. */
export const WARRANTY_DAYS = 30;
/** The right to return something is short, so the warning is too. */
export const RETURN_DAYS = 3;
/** How far back a purchase is asked about; older ones have been seen. */
const SUGGEST_DAYS = 30;

export const DEFAULT_ITEM_MIN = 50_000;
/** The category a purchase is most likely a thing in, until Inställningar says otherwise. */
const DEFAULT_CATEGORY_PATH = ["Prylar & hem", "Elektronik"] as const;

const SETTING = "item_watch";

export interface ItemWatchSettings {
  /** Categories where a purchase over the threshold is asked about. */
  categoryIds: number[];
  /** Öre, positive. */
  minAmount: number;
}

/** The subcategory purchases are asked about by default, when it is still there. */
function defaultCategoryIds(db: Db): number[] {
  const [parentName, childName] = DEFAULT_CATEGORY_PATH;
  const parent = db.select().from(categories).where(and(eq(categories.name, parentName), isNull(categories.parentId))).get();
  if (!parent) return [];
  const child = db.select().from(categories).where(and(eq(categories.name, childName), eq(categories.parentId, parent.id))).get();
  return child ? [child.id] : [];
}

export function itemWatchSettings(db: Db): ItemWatchSettings {
  const stored = getSetting<Partial<ItemWatchSettings>>(db, SETTING, {});
  const ids = Array.isArray(stored.categoryIds) ? stored.categoryIds.filter((id) => Number.isInteger(id)) : null;
  return {
    categoryIds: ids ?? defaultCategoryIds(db),
    minAmount: Number.isInteger(stored.minAmount) && stored.minAmount! >= 0 ? stored.minAmount! : DEFAULT_ITEM_MIN,
  };
}

export function setItemWatchSettings(db: Db, patch: Partial<ItemWatchSettings>): ItemWatchSettings {
  const next = itemWatchSettings(db);
  if (Array.isArray(patch.categoryIds)) {
    const wanted = patch.categoryIds.filter((id) => Number.isInteger(id));
    const real = wanted.length ? db.select({ id: categories.id }).from(categories).where(inArray(categories.id, wanted)).all().map((c) => c.id) : [];
    next.categoryIds = wanted.filter((id) => real.includes(id));
  }
  if (Number.isInteger(patch.minAmount) && patch.minAmount! >= 0) next.minAmount = patch.minAmount!;
  setSetting(db, SETTING, next);
  return next;
}

// ---------- Findings ----------

/** The shape watch.ts builds its findings in; only the fields these three use. */
export interface ItemFinding {
  key: string;
  kind: "warranty_ending" | "return_deadline" | "maybe_item";
  text: string;
  date: string;
  itemId?: number;
  transactionId?: number;
  amount?: number;
  merchant?: string;
}

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const kr = (ore: number) => `${Math.round(Math.abs(ore) / 100).toLocaleString("sv-SE")} kr`;
const inDays = (n: number) => (n === 0 ? "i dag" : n === 1 ? "i morgon" : `om ${n} dagar`);

/** Things I still own; a sold or returned one is not mine to keep track of. */
const owned = (db: Db) =>
  db
    .select()
    .from(items)
    .where(and(isNull(items.deletedAt), eq(items.status, "owned")))
    .all();

export function warrantiesEnding(db: Db, today: string): ItemFinding[] {
  const out: ItemFinding[] = [];
  for (const item of owned(db)) {
    const ends = warrantyEndsOn(item);
    if (!ends) continue;
    const left = daysBetween(today, ends);
    if (left < 0 || left > WARRANTY_DAYS) continue;
    out.push({
      key: `warranty_ending:${item.id}`,
      kind: "warranty_ending",
      text: `Garantin på ${item.name} går ut ${dm(ends)}, ${inDays(left)}`,
      date: ends,
      itemId: item.id,
    });
  }
  return out;
}

export function returnDeadlines(db: Db, today: string): ItemFinding[] {
  const out: ItemFinding[] = [];
  for (const item of owned(db)) {
    if (!item.returnDeadline) continue;
    const left = daysBetween(today, item.returnDeadline);
    if (left < 0 || left > RETURN_DAYS) continue;
    out.push({
      key: `return_deadline:${item.id}`,
      kind: "return_deadline",
      text: `Ångerrätten på ${item.name} går ut ${dm(item.returnDeadline)}, ${inDays(left)}`,
      date: item.returnDeadline,
      itemId: item.id,
    });
  }
  return out;
}

/**
 * Purchases that look like things but aren't one yet. Only money I paid
 * myself, only the categories that were chosen, and never a row that already
 * belongs to a pryl.
 */
export function maybeItems(db: Db, today: string): ItemFinding[] {
  const { categoryIds, minAmount } = itemWatchSettings(db);
  if (categoryIds.length === 0 || minAmount <= 0) return [];
  const since = addDays(today, -(SUGGEST_DAYS - 1));
  const linked = new Set(db.select({ id: itemTransactions.transactionId }).from(itemTransactions).all().map((r) => r.id));
  return db
    .select({
      id: transactions.id,
      date: transactions.bookingDate,
      amount: transactions.amount,
      label: transactions.label,
      descriptionClean: transactions.descriptionClean,
      contactName: contacts.name,
    })
    .from(transactions)
    .leftJoin(contacts, eq(contacts.counterparty, transactions.counterparty))
    .where(
      and(
        isNull(transactions.deletedAt),
        isNull(transactions.returnGroupId),
        eq(transactions.isTransfer, false),
        eq(transactions.paidBy, "me"),
        gte(transactions.bookingDate, since),
        inArray(transactions.categoryId, categoryIds),
        sql`${transactions.amount} <= ${-minAmount}`,
      ),
    )
    .all()
    .filter((r) => !linked.has(r.id))
    .map((r) => {
      const name = r.label ?? r.contactName ?? r.descriptionClean;
      return {
        key: `maybe_item:${r.id}`,
        kind: "maybe_item" as const,
        text: `${name} ${kr(r.amount)} ${dm(r.date)} – är det en pryl?`,
        date: r.date,
        transactionId: r.id,
        amount: Math.abs(r.amount),
        merchant: name,
      };
    });
}
