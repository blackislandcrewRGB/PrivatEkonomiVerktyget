import { Hono } from "hono";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { nextTopColor } from "../db/palette.js";
import { todayLocal, twelveMonthsBack } from "../overview/dates.js";
import { categories, merchantCategoryMap, merchantRules, recurringExpenses, transactionSplits, transactions, type Category } from "../db/schema.js";

export class CategoryError extends Error {}

const COLOR = /^#[0-9a-f]{6}$/i;

/** What refers to a category: everything a delete would have to move. */
export function categoryUsage(db: Db, id: number) {
  const n = (q: { get(): { n: number } | undefined }) => q.get()?.n ?? 0;
  const count = sql<number>`count(*)`;
  return {
    transactions: n(db.select({ n: count }).from(transactions).where(and(eq(transactions.categoryId, id), isNull(transactions.deletedAt)))),
    deletedTransactions: n(db.select({ n: count }).from(transactions).where(and(eq(transactions.categoryId, id), sql`${transactions.deletedAt} is not null`))),
    rules: n(db.select({ n: count }).from(merchantRules).where(eq(merchantRules.categoryId, id))),
    recurringExpenses: n(db.select({ n: count }).from(recurringExpenses).where(eq(recurringExpenses.categoryId, id))),
    merchantCategories: n(db.select({ n: count }).from(merchantCategoryMap).where(eq(merchantCategoryMap.categoryId, id))),
    splits: n(db.select({ n: count }).from(transactionSplits).where(eq(transactionSplits.categoryId, id))),
    children: n(db.select({ n: count }).from(categories).where(eq(categories.parentId, id))),
  };
}

const isEmpty = (u: ReturnType<typeof categoryUsage>) =>
  u.transactions + u.deletedTransactions + u.rules + u.recurringExpenses + u.merchantCategories + u.splits + u.children === 0;

function get(db: Db, id: number): Category {
  const c = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!c) throw new CategoryError("Kategorin finns inte.");
  return c;
}

/**
 * Transfer-ness follows the category: rows (and rules) in it get the category's
 * flag, and transfers or partner money are never shared.
 */
function syncFlags(db: Db, categoryId: number): void {
  const c = get(db, categoryId);
  db.update(transactions)
    .set({ isTransfer: c.isTransfer, ...(c.isTransfer || c.isSettlement ? { shared: false } : {}) })
    .where(eq(transactions.categoryId, categoryId))
    .run();
  db.update(merchantRules).set({ isTransfer: c.isTransfer }).where(eq(merchantRules.categoryId, categoryId)).run();
}

/**
 * Moves every reference from one category to another (rows, rules, fixed
 * expenses, bank categories). Moved rows take the target's transfer flag when
 * the two differ.
 */
function reassign(db: Db, fromId: number, toId: number): void {
  const from = get(db, fromId);
  const to = get(db, toId);
  const flags = from.isTransfer !== to.isTransfer ? { isTransfer: to.isTransfer } : {};
  db.update(transactions)
    .set({ categoryId: toId, ...flags, ...(to.isTransfer || to.isSettlement ? { shared: false } : {}) })
    .where(eq(transactions.categoryId, fromId))
    .run();
  db.update(merchantRules).set({ categoryId: toId, ...flags }).where(eq(merchantRules.categoryId, fromId)).run();
  db.update(recurringExpenses).set({ categoryId: toId }).where(eq(recurringExpenses.categoryId, fromId)).run();
  db.update(merchantCategoryMap).set({ categoryId: toId }).where(eq(merchantCategoryMap.categoryId, fromId)).run();
  moveSplits(db, fromId, toId);
}

/**
 * Moves the parts of split purchases too. A purchase that would end up with
 * two parts in the same category gets them merged, so the parts stay one per
 * category and still sum to the row.
 */
function moveSplits(db: Db, fromId: number, toId: number): void {
  const moving = db.select().from(transactionSplits).where(eq(transactionSplits.categoryId, fromId)).all();
  if (moving.length === 0) return;
  const targets = db
    .select()
    .from(transactionSplits)
    .where(eq(transactionSplits.categoryId, toId))
    .all();
  db.transaction((txn) => {
    for (const part of moving) {
      const twin = targets.find((t) => t.transactionId === part.transactionId);
      if (twin) {
        txn.update(transactionSplits).set({ amount: twin.amount + part.amount }).where(eq(transactionSplits.id, twin.id)).run();
        txn.delete(transactionSplits).where(eq(transactionSplits.id, part.id)).run();
      } else {
        txn.update(transactionSplits).set({ categoryId: toId }).where(eq(transactionSplits.id, part.id)).run();
      }
    }
  });
}

function checkName(db: Db, name: string | undefined, parentId: number | null, exceptId?: number): string {
  const trimmed = name?.trim();
  if (!trimmed) throw new CategoryError("Namn krävs.");
  const clash = db
    .select()
    .from(categories)
    .where(and(sql`lower(${categories.name}) = lower(${trimmed})`, parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId)))
    .all()
    .find((c) => c.id !== exceptId);
  if (clash) throw new CategoryError(`Det finns redan en kategori som heter "${clash.name}" där.`);
  return trimmed;
}

export function createCategory(db: Db, b: { name?: string; parentId?: number | null; color?: string | null }): Category {
  const parent = b.parentId ? get(db, b.parentId) : null;
  if (parent?.parentId) throw new CategoryError("Underkategorier kan bara ligga under en huvudkategori.");
  const name = checkName(db, b.name, parent?.id ?? null);
  if (b.color && !COLOR.test(b.color)) throw new CategoryError("Färgen ska vara #rrggbb.");
  return db
    .insert(categories)
    .values({
      name,
      parentId: parent?.id ?? null,
      // A new main category takes a palette colour no other main category has; a subcategory follows its main category.
      color: b.color || parent?.color || nextTopColor(db.select({ color: categories.color }).from(categories).where(isNull(categories.parentId)).all().map((c) => c.color)),
      isTransfer: parent?.isTransfer ?? false,
    })
    .returning()
    .get();
}

/** Rename, recolour, or move a subcategory to another main category. */
export function updateCategory(db: Db, id: number, b: { name?: string; color?: string; parentId?: number }): Category {
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const current = get(tx, id);
    const set: Partial<Category> = {};
    let parentId = current.parentId;
    if (b.parentId !== undefined && b.parentId !== current.parentId) {
      if (current.parentId === null) throw new CategoryError("Bara underkategorier kan flyttas.");
      if (current.systemKey) throw new CategoryError(`"${current.name}" används av verktyget och kan inte flyttas.`);
      const parent = get(tx, b.parentId);
      if (parent.parentId !== null) throw new CategoryError("Välj en huvudkategori att flytta till.");
      parentId = parent.id;
      set.parentId = parent.id;
      set.isTransfer = parent.isTransfer;
      if (current.color === get(tx, current.parentId).color) set.color = parent.color;
    }
    if (b.name !== undefined || set.parentId !== undefined) set.name = checkName(tx, b.name ?? current.name, parentId, id);
    if (b.color !== undefined) {
      if (!COLOR.test(b.color)) throw new CategoryError("Färgen ska vara #rrggbb.");
      set.color = b.color;
      // Subcategories that simply followed the main category's colour keep following it.
      if (current.parentId === null && current.color) {
        tx.update(categories).set({ color: b.color }).where(and(eq(categories.parentId, id), eq(categories.color, current.color))).run();
      }
    }
    const updated = tx.update(categories).set(set).where(eq(categories.id, id)).returning().get();
    if (set.isTransfer !== undefined && set.isTransfer !== current.isTransfer) syncFlags(tx, id);
    return updated;
  });
}

/**
 * Deletes an empty category. One with rows or rules needs `moveTo`: they are
 * moved there first. Main categories with subcategories and the categories the
 * tool relies on can't be deleted.
 */
export function deleteCategory(db: Db, id: number, moveTo?: number): { moved: ReturnType<typeof categoryUsage> } | { needsMove: ReturnType<typeof categoryUsage> } {
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const current = get(tx, id);
    if (current.systemKey) throw new CategoryError(`"${current.name}" används av verktyget och kan inte tas bort (men byta namn går).`);
    const usage = categoryUsage(tx, id);
    if (usage.children > 0) throw new CategoryError("Ta bort, flytta eller slå ihop underkategorierna först.");
    if (!isEmpty(usage)) {
      if (moveTo === undefined) return { needsMove: usage };
      if (moveTo === id) throw new CategoryError("Välj en annan kategori.");
      get(tx, moveTo);
      reassign(tx, id, moveTo);
    }
    tx.delete(categories).where(eq(categories.id, id)).run();
    return { moved: usage };
  });
}

/**
 * Merges `id` into `into`: its rows, rules and fixed expenses move there and it
 * is deleted. A main category's subcategories move along under `into` (merged
 * with a same-named subcategory there).
 */
export function mergeCategory(db: Db, id: number, into: number): { moved: ReturnType<typeof categoryUsage> } {
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    if (id === into) throw new CategoryError("Välj en annan kategori.");
    const source = get(tx, id);
    const target = get(tx, into);
    if (source.systemKey) throw new CategoryError(`"${source.name}" används av verktyget och kan inte slås ihop bort. Slå ihop åt andra hållet.`);
    if (target.parentId === id) throw new CategoryError("Kan inte slå ihop med en egen underkategori.");
    const usage = categoryUsage(tx, id);
    const children = tx.select().from(categories).where(eq(categories.parentId, id)).orderBy(asc(categories.id)).all();
    if (children.length > 0) {
      if (target.parentId !== null) throw new CategoryError("En huvudkategori med underkategorier kan bara slås ihop med en annan huvudkategori.");
      for (const child of children) {
        const twin = tx
          .select()
          .from(categories)
          .where(and(eq(categories.parentId, target.id), sql`lower(${categories.name}) = lower(${child.name})`))
          .get();
        if (twin) {
          reassign(tx, child.id, twin.id);
          tx.delete(categories).where(eq(categories.id, child.id)).run();
        } else {
          tx.update(categories)
            .set({ parentId: target.id, isTransfer: target.isTransfer, ...(child.color === source.color ? { color: target.color } : {}) })
            .where(eq(categories.id, child.id))
            .run();
          if (child.isTransfer !== target.isTransfer) syncFlags(tx, child.id);
        }
      }
    }
    reassign(tx, id, into);
    tx.delete(categories).where(eq(categories.id, id)).run();
    return { moved: usage };
  });
}

export function categoryRoutes(db: Db) {
  const app = new Hono();
  const handle = (fn: () => unknown) => {
    try {
      return { ok: true as const, body: fn() };
    } catch (e) {
      if (e instanceof CategoryError) return { ok: false as const, error: e.message };
      if (e instanceof Error && /UNIQUE/.test(e.message)) return { ok: false as const, error: "Namnet finns redan där." };
      throw e;
    }
  };

  app.get("/", (c) => c.json(db.select().from(categories).orderBy(asc(categories.id)).all()));

  /**
   * Rows and rules per category, and rows and their sum (öre, signed) in the
   * last 12 months and this year, for the management view. Per category, not
   * rolled up.
   */
  app.get("/usage", (c) => {
    const today = todayLocal();
    const since = twelveMonthsBack(today);
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const counts = (amount: typeof transactions.amount | typeof transactionSplits.amount) => ({
      n: sql<number>`count(*)`,
      n12: sql<number>`sum(case when ${transactions.bookingDate} >= ${since} then 1 else 0 end)`,
      sum12: sql<number>`sum(case when ${transactions.bookingDate} >= ${since} then ${amount} else 0 end)`,
      nYtd: sql<number>`sum(case when ${transactions.bookingDate} >= ${yearStart} then 1 else 0 end)`,
      sumYtd: sql<number>`sum(case when ${transactions.bookingDate} >= ${yearStart} then ${amount} else 0 end)`,
    });
    const tx = db
      .select({ id: transactions.categoryId, ...counts(transactions.amount) })
      .from(transactions)
      .where(isNull(transactions.deletedAt))
      .groupBy(transactions.categoryId)
      .all();
    // A split purchase counts in each of its categories, with that part's amount.
    const parts = db
      .select({ id: transactionSplits.categoryId, ...counts(transactionSplits.amount) })
      .from(transactionSplits)
      .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
      .where(isNull(transactions.deletedAt))
      .groupBy(transactionSplits.categoryId)
      .all();
    // The row's own category is the largest part: its whole amount is counted
    // above, so the parts replace it rather than adding to it.
    const split = db
      .select({ id: transactions.categoryId, ...counts(transactions.amount) })
      .from(transactions)
      .where(and(isNull(transactions.deletedAt), sql`exists (select 1 from transaction_splits ts where ts.transaction_id = transactions.id)`))
      .groupBy(transactions.categoryId)
      .all();
    const rules = db.select({ id: merchantRules.categoryId, n: sql<number>`count(*)` }).from(merchantRules).groupBy(merchantRules.categoryId).all();
    type Usage = { transactions: number; rules: number; count12: number; sum12: number; countYtd: number; sumYtd: number };
    const out: Record<number, Usage> = {};
    const empty: Usage = { transactions: 0, rules: 0, count12: 0, sum12: 0, countYtd: 0, sumYtd: 0 };
    type Row = { n: number; n12: number | null; sum12: number | null; nYtd: number | null; sumYtd: number | null };
    const add = (cur: Usage, r: Row, sign: 1 | -1): Usage => ({
      ...cur,
      transactions: cur.transactions + sign * r.n,
      count12: cur.count12 + sign * (r.n12 ?? 0),
      sum12: cur.sum12 + sign * (r.sum12 ?? 0),
      countYtd: cur.countYtd + sign * (r.nYtd ?? 0),
      sumYtd: cur.sumYtd + sign * (r.sumYtd ?? 0),
    });
    for (const r of tx) if (r.id !== null) out[r.id] = add(empty, r, 1);
    for (const r of split) if (r.id !== null && out[r.id]) out[r.id] = add(out[r.id], r, -1);
    for (const r of parts) out[r.id] = add(out[r.id] ?? empty, r, 1);
    for (const r of rules) out[r.id] = { ...(out[r.id] ?? empty), rules: r.n };
    return c.json(out);
  });

  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; parentId?: number | null; color?: string | null };
    const r = handle(() => createCategory(db, b));
    return r.ok ? c.json(r.body) : c.json({ error: r.error }, 400);
  });

  app.patch("/:id", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; color?: string; parentId?: number };
    const r = handle(() => updateCategory(db, Number(c.req.param("id")), b));
    return r.ok ? c.json(r.body) : c.json({ error: r.error }, 400);
  });

  /** ?moveTo=<id> moves rows and rules there first. Without it a non-empty category answers 409 with its usage. */
  app.delete("/:id", (c) => {
    const moveTo = c.req.query("moveTo");
    const r = handle(() => deleteCategory(db, Number(c.req.param("id")), moveTo ? Number(moveTo) : undefined));
    if (!r.ok) return c.json({ error: r.error }, 400);
    const body = r.body as ReturnType<typeof deleteCategory>;
    return "needsMove" in body ? c.json(body, 409) : c.json(body);
  });

  app.post("/:id/merge", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { into?: number };
    if (!Number.isInteger(b.into)) return c.json({ error: "Välj kategori att slå ihop med." }, 400);
    const r = handle(() => mergeCategory(db, Number(c.req.param("id")), b.into!));
    return r.ok ? c.json(r.body) : c.json({ error: r.error }, 400);
  });

  return app;
}

