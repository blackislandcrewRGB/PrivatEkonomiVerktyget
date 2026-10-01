import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  REFERENCE_NOT_INCLUDED,
  categories,
  recurringExpenses,
  referenceBudgetCategoryMap,
  referenceBudgetExpenseMap,
  referenceBudgetItems,
  referenceBudgetYears,
} from "../db/schema.js";
import { getCategoryPathMap } from "../db/seed.js";

/**
 * Vilka kategorier som jämförs med vilken post i referensbudgeten.
 *
 * A target is one of three things: an item key ('clothing'), a choice
 * ('food', which becomes each person's own food variant), or 'not_included'
 * for spending the reference leaves out. Several categories may share a
 * target. A category with no row is *unmapped* and shown as such — nothing is
 * guessed, so a new category never quietly lands somewhere. Income, transfers
 * and the settlement categories are not spending and need no row.
 *
 * A fixed expense can carry its own target, which wins over its rows'
 * category: that is how the home insurance is told apart from the car
 * insurance when Tre Kronor draws both under Försäkring.
 */

export { REFERENCE_NOT_INCLUDED };

/** The mapping approved 2026-09-21, by category path. Categories that don't exist are skipped. */
export const DEFAULT_CATEGORY_MAP: Record<string, string> = {
  "Mat › Livsmedel": "food",
  "Prylar & hem › Kläder": "clothing",
  "Hälsa › Träning": "leisure",
  "Nöje › Aktiviteter": "leisure",
  Nöje: "leisure",
  Hälsa: "leisure",
  "Prylar & hem › Elektronik": "home_equipment",
  "Prylar & hem": "home_equipment",
  "Boende › Hem & hushåll": "home_equipment",
  "Prylar & hem › Frakt": "home_equipment",
  "Prylar & hem › Inredning & verktyg": "home_equipment",
  "IT & tele › Bredband & mobil": "internet_mobile_subscription",
  "IT & tele": "internet_mobile_subscription",
  "Nöje › Streaming": "other_media",
  "Nöje › Musik": "other_media",
  "Nöje › Film": "other_media",
  "Nöje › Spel": "other_media",
  // Both insurances are drawn here; the fixed expenses below tell them apart.
  Försäkring: REFERENCE_NOT_INCLUDED,
  Boende: REFERENCE_NOT_INCLUDED,
  "Boende › Hyra": REFERENCE_NOT_INCLUDED,
  Mat: REFERENCE_NOT_INCLUDED,
  "Mat › Restaurang & café": REFERENCE_NOT_INCLUDED,
  "Mat › Hämtmat": REFERENCE_NOT_INCLUDED,
  "Mat › Alkohol": REFERENCE_NOT_INCLUDED,
  "Hälsa › Kosttillskott": REFERENCE_NOT_INCLUDED,
  "Hälsa › Tandvård": REFERENCE_NOT_INCLUDED,
  "Hälsa › Vård & apotek": REFERENCE_NOT_INCLUDED,
  Bil: REFERENCE_NOT_INCLUDED,
  "Bil › Drivmedel": REFERENCE_NOT_INCLUDED,
  "Bil › Parkering": REFERENCE_NOT_INCLUDED,
  "Bil › Service & besiktning": REFERENCE_NOT_INCLUDED,
  "Bil › Trängselskatt": REFERENCE_NOT_INCLUDED,
  Resor: REFERENCE_NOT_INCLUDED,
  "Resor › SL": REFERENCE_NOT_INCLUDED,
  "Resor › Taxi": REFERENCE_NOT_INCLUDED,
  "Resor › Hotell": REFERENCE_NOT_INCLUDED,
  "Resor › Flyg": REFERENCE_NOT_INCLUDED,
  "Resor › Övriga resor": REFERENCE_NOT_INCLUDED,
  // The seed's name for it; the same decision under the name it may have been given since.
  "AI & utveckling": REFERENCE_NOT_INCLUDED,
  "AI & utveckling › AI-tjänster": REFERENCE_NOT_INCLUDED,
  "AI & utveckling › Mjukvara": REFERENCE_NOT_INCLUDED,
  "AI & utveckling › Moln & hosting": REFERENCE_NOT_INCLUDED,
  "Mjukvara & AI": REFERENCE_NOT_INCLUDED,
  "Mjukvara & AI › AI-tjänster": REFERENCE_NOT_INCLUDED,
  "Mjukvara & AI › API": REFERENCE_NOT_INCLUDED,
  "Mjukvara & AI › Mjukvara": REFERENCE_NOT_INCLUDED,
  "Mjukvara & AI › Moln & hosting": REFERENCE_NOT_INCLUDED,
  "Nöje › Mjukvara": REFERENCE_NOT_INCLUDED,
  "Lån & avbetalning": REFERENCE_NOT_INCLUDED,
  "Lån & avbetalning › CSN": REFERENCE_NOT_INCLUDED,
  "Försäkring › A-kassa": REFERENCE_NOT_INCLUDED,
  "Bank & avgifter": REFERENCE_NOT_INCLUDED,
  Vänner: REFERENCE_NOT_INCLUDED,
  "Vänner › Utlägg": REFERENCE_NOT_INCLUDED,
  Övrigt: REFERENCE_NOT_INCLUDED,
  "Övrigt › Okänt": REFERENCE_NOT_INCLUDED,
};

/** Fixed expenses with their own target, by name. Expenses that don't exist are skipped. */
export const DEFAULT_EXPENSE_MAP: Record<string, string> = {
  Hemförsäkring: "home_insurance",
  Bilförsäkringen: REFERENCE_NOT_INCLUDED,
};

export class MappingError extends Error {}

export interface MappingTarget {
  key: string;
  name: string;
}

/**
 * What a category or expense may be mapped to: the latest year's items (a
 * choice once, under the choice's name), and 'not_included'.
 */
export function mappingTargets(db: Db): MappingTarget[] {
  const latest = db.select().from(referenceBudgetYears).orderBy(desc(referenceBudgetYears.year)).get();
  if (!latest) return [{ key: REFERENCE_NOT_INCLUDED, name: "Ingår ej i referensen" }];
  const items = db.select().from(referenceBudgetItems).where(eq(referenceBudgetItems.year, latest.year)).orderBy(asc(referenceBudgetItems.sortOrder)).all();
  const out: MappingTarget[] = [];
  for (const it of items) {
    if (!it.choice) out.push({ key: it.key, name: it.name });
    else if (!out.some((t) => t.key === it.choice)) out.push({ key: it.choice, name: CHOICE_NAMES[it.choice] ?? it.choice });
  }
  out.push({ key: REFERENCE_NOT_INCLUDED, name: "Ingår ej i referensen" });
  return out;
}

const CHOICE_NAMES: Record<string, string> = { food: "Livsmedel (varje persons matvariant)" };

function checkTarget(db: Db, target: unknown): string {
  if (typeof target !== "string" || !mappingTargets(db).some((t) => t.key === target)) {
    throw new MappingError(`${String(target)} är ingen post i referensbudgeten.`);
  }
  return target;
}

export type CategoryMappingKind = "item" | "not_included" | "not_spending" | "unmapped";

export interface CategoryMapping {
  categoryId: number;
  path: string;
  parentId: number | null;
  target: string | null;
  kind: CategoryMappingKind;
}

/** Every category with its target, and whether it is spending at all. */
export function categoryMappings(db: Db): CategoryMapping[] {
  const all = db.select().from(categories).all();
  const byId = new Map(all.map((c) => [c.id, c]));
  const map = new Map(db.select().from(referenceBudgetCategoryMap).all().map((r) => [r.categoryId, r.target]));
  const out = all.map((c) => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    const path = parent ? `${parent.name} › ${c.name}` : c.name;
    // Not spending: income (and what sits under it), transfers and the settlement categories.
    const notSpending = c.isTransfer || c.isSettlement || c.systemKey === "income" || parent?.systemKey === "income";
    const target = map.get(c.id) ?? null;
    const kind: CategoryMappingKind = notSpending ? "not_spending" : target === null ? "unmapped" : target === REFERENCE_NOT_INCLUDED ? "not_included" : "item";
    return { categoryId: c.id, path, parentId: c.parentId, target: notSpending ? null : target, kind };
  });
  return out.sort((a, b) => a.path.localeCompare(b.path, "sv"));
}

/** Sets a category's target, or removes it (null) so the category is unmapped again. */
export function setCategoryTarget(db: Db, categoryId: number, target: string | null): void {
  if (!db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).get()) throw new MappingError("Kategorin finns inte.");
  if (target === null) {
    db.delete(referenceBudgetCategoryMap).where(eq(referenceBudgetCategoryMap.categoryId, categoryId)).run();
    return;
  }
  const t = checkTarget(db, target);
  db.insert(referenceBudgetCategoryMap)
    .values({ categoryId, target: t })
    .onConflictDoUpdate({ target: referenceBudgetCategoryMap.categoryId, set: { target: t, updatedAt: new Date().toISOString() } })
    .run();
}

export interface ExpenseMapping {
  recurringExpenseId: number;
  name: string;
  target: string;
}

export function expenseMappings(db: Db): ExpenseMapping[] {
  return db
    .select({ recurringExpenseId: referenceBudgetExpenseMap.recurringExpenseId, name: recurringExpenses.name, target: referenceBudgetExpenseMap.target })
    .from(referenceBudgetExpenseMap)
    .innerJoin(recurringExpenses, eq(recurringExpenses.id, referenceBudgetExpenseMap.recurringExpenseId))
    .orderBy(asc(recurringExpenses.name))
    .all();
}

/** Sets a fixed expense's own target, or removes it (null) so its rows follow their category. */
export function setExpenseTarget(db: Db, recurringExpenseId: number, target: string | null): void {
  if (!db.select({ id: recurringExpenses.id }).from(recurringExpenses).where(eq(recurringExpenses.id, recurringExpenseId)).get()) throw new MappingError("Den fasta utgiften finns inte.");
  if (target === null) {
    db.delete(referenceBudgetExpenseMap).where(eq(referenceBudgetExpenseMap.recurringExpenseId, recurringExpenseId)).run();
    return;
  }
  const t = checkTarget(db, target);
  db.insert(referenceBudgetExpenseMap)
    .values({ recurringExpenseId, target: t })
    .onConflictDoUpdate({ target: referenceBudgetExpenseMap.recurringExpenseId, set: { target: t, updatedAt: new Date().toISOString() } })
    .run();
}

/**
 * Puts the approved mapping on the categories and fixed expenses that exist,
 * by path and by name. Never changes one already mapped, so it can run again
 * (and on a database whose categories have been edited) without undoing a
 * choice made since.
 */
export function applyDefaultMapping(db: Db): { categories: number; expenses: number } {
  const paths = getCategoryPathMap(db);
  const mapped = new Set(db.select({ id: referenceBudgetCategoryMap.categoryId }).from(referenceBudgetCategoryMap).all().map((r) => r.id));
  let cats = 0;
  for (const [path, target] of Object.entries(DEFAULT_CATEGORY_MAP)) {
    // The path map writes 'Mat/Livsmedel'; the table here reads as the app shows it.
    const id = paths.get(path.replace(" › ", "/"));
    if (id === undefined || mapped.has(id)) continue;
    db.insert(referenceBudgetCategoryMap).values({ categoryId: id, target }).run();
    cats++;
  }
  const mappedExpenses = new Set(db.select({ id: referenceBudgetExpenseMap.recurringExpenseId }).from(referenceBudgetExpenseMap).all().map((r) => r.id));
  let exps = 0;
  for (const [name, target] of Object.entries(DEFAULT_EXPENSE_MAP)) {
    const e = db.select({ id: recurringExpenses.id }).from(recurringExpenses).where(eq(recurringExpenses.name, name)).get();
    if (!e || mappedExpenses.has(e.id)) continue;
    db.insert(referenceBudgetExpenseMap).values({ recurringExpenseId: e.id, target }).run();
    exps++;
  }
  return { categories: cats, expenses: exps };
}
