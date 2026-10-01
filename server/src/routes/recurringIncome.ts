import { Hono } from "hono";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, recurringIncome, recurringIncomeOverrides, transactions } from "../db/schema.js";
import { linkRecurring } from "../recurring/link.js";
import { suggestRecurringIncome } from "../recurring/income.js";

type Income = typeof recurringIncome.$inferSelect;
const RECENT = 6;
const MATCH_FIELDS = ["accountId", "dayOfMonth", "matchPattern", "active"] as const;

function validate(db: Db, b: Record<string, unknown>, creating: boolean): Partial<Income> | string {
  const out: Partial<Income> = {};
  const has = (k: string) => creating || Object.prototype.hasOwnProperty.call(b, k);
  if (has("name")) {
    if (typeof b.name !== "string" || !b.name.trim()) return "Namn krävs.";
    out.name = b.name.trim();
  }
  if (has("amount")) {
    if (!Number.isInteger(b.amount) || (b.amount as number) <= 0) return "Beloppet ska vara ett positivt antal öre.";
    out.amount = b.amount as number;
  }
  if (has("dayOfMonth")) {
    if (!Number.isInteger(b.dayOfMonth) || (b.dayOfMonth as number) < 1 || (b.dayOfMonth as number) > 31) return "Dag ska vara 1–31.";
    out.dayOfMonth = b.dayOfMonth as number;
  }
  if (Object.prototype.hasOwnProperty.call(b, "accountId")) {
    if (b.accountId !== null && !db.select().from(accounts).where(eq(accounts.id, b.accountId as number)).get()) return "Kontot finns inte.";
    out.accountId = b.accountId as number | null;
  }
  if (Object.prototype.hasOwnProperty.call(b, "matchPattern")) {
    out.matchPattern = typeof b.matchPattern === "string" && b.matchPattern.trim() ? b.matchPattern.trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(b, "active")) {
    if (typeof b.active !== "boolean") return "Aktiv ska vara sant/falskt.";
    out.active = b.active;
  }
  return out;
}

/** Latest linked income rows (the actual salaries), newest first. */
export function recentIncomeRows(db: Db, incomeId: number, limit = RECENT) {
  return db
    .select({ id: transactions.id, bookingDate: transactions.bookingDate, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.recurringIncomeId, incomeId), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(limit)
    .all();
}

export function recurringIncomeRoutes(db: Db) {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = db.select().from(recurringIncome).orderBy(asc(recurringIncome.id)).all();
    return c.json(
      rows.map((r) => {
        const recent = recentIncomeRows(db, r.id);
        const amounts = recent.map((t) => t.amount);
        return {
          ...r,
          lastReceived: recent[0]?.bookingDate ?? null,
          recent,
          recentMin: amounts.length ? Math.min(...amounts) : null,
          recentAvg: amounts.length ? Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length) : null,
          overrides: db
            .select({ month: recurringIncomeOverrides.month, amount: recurringIncomeOverrides.amount })
            .from(recurringIncomeOverrides)
            .where(eq(recurringIncomeOverrides.recurringIncomeId, r.id))
            .orderBy(asc(recurringIncomeOverrides.month))
            .all(),
        };
      }),
    );
  });

  app.get("/suggestions", (c) => c.json(suggestRecurringIncome(db)));

  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validate(db, b, true);
    if (typeof v === "string") return c.json({ error: v }, 400);
    const created = db.insert(recurringIncome).values(v as typeof recurringIncome.$inferInsert).returning().get();
    // Link rows already imported (so the forecast knows if this month's has arrived).
    const linked = db.transaction((tx) => linkRecurring(tx as unknown as Db));
    return c.json({ ...created, linked: linked.income });
  });

  app.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validate(db, b, false);
    if (typeof v === "string") return c.json({ error: v }, 400);
    const updated = db.transaction((txn) => {
      const tx = txn as unknown as Db;
      const row = tx
        .update(recurringIncome)
        .set({ ...v, manuallyEditedAt: new Date().toISOString() })
        .where(eq(recurringIncome.id, id))
        .returning()
        .get();
      // Which rows belong to it may have changed: rebuild its links.
      if (row && MATCH_FIELDS.some((k) => k in v)) {
        tx.update(transactions).set({ recurringIncomeId: null }).where(eq(transactions.recurringIncomeId, id)).run();
        linkRecurring(tx);
      }
      return row;
    });
    return updated ? c.json(updated) : c.json({ error: "Hittades inte." }, 404);
  });

  /** Removes the income and its links; the transactions stay. */
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    db.transaction((tx) => {
      tx.update(transactions).set({ recurringIncomeId: null }).where(eq(transactions.recurringIncomeId, id)).run();
      tx.delete(recurringIncome).where(eq(recurringIncome.id, id)).run();
    });
    return c.json({ ok: true });
  });

  /** Expected amount for one month ('YYYY-MM'); amount null removes it. */
  app.put("/:id/overrides/:month", async (c) => {
    const id = Number(c.req.param("id"));
    const month = c.req.param("month");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: "Månad ska vara ÅÅÅÅ-MM." }, 400);
    if (!db.select().from(recurringIncome).where(eq(recurringIncome.id, id)).get()) return c.json({ error: "Hittades inte." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { amount?: number | null };
    const where = and(eq(recurringIncomeOverrides.recurringIncomeId, id), eq(recurringIncomeOverrides.month, month));
    if (b.amount === null || b.amount === undefined) {
      db.delete(recurringIncomeOverrides).where(where).run();
      return c.json({ month, amount: null });
    }
    if (!Number.isInteger(b.amount) || b.amount <= 0) return c.json({ error: "Beloppet ska vara ett positivt antal öre." }, 400);
    db.insert(recurringIncomeOverrides)
      .values({ recurringIncomeId: id, month, amount: b.amount })
      .onConflictDoUpdate({ target: [recurringIncomeOverrides.recurringIncomeId, recurringIncomeOverrides.month], set: { amount: b.amount } })
      .run();
    return c.json({ month, amount: b.amount });
  });

  return app;
}
