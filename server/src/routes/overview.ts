import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ACCOUNT_KINDS, IMPORT_SOURCES, accounts, merchantRules, recurringExpenseMarks, recurringExpenses, statements, transactions } from "../db/schema.js";
import { categoryIdByKey } from "../db/seed.js";
import { recategorizeUncategorized } from "../categorize/categorize.js";
import { buildOverview } from "../overview/overview.js";
import { monthStart } from "../cashflow/cashflow.js";
import { apiCosts } from "../overview/apiCosts.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";

export function overviewRoutes(db: Db) {
  const app = new Hono();
  // ?today=YYYY-MM-DD is for testing and looking back; default is the local date.
  app.get("/", (c) => {
    const q = c.req.query("today");
    const today = q && isIsoDate(q) ? q : todayLocal();
    // Kvar vid månadsskiftet, from the cash flow.
    return c.json({ ...buildOverview(db, today), monthStart: monthStart(db, today) });
  });
  // API-kostnader: the category API per provider, the last 12 months.
  app.get("/api-costs", (c) => {
    const q = c.req.query("today");
    return c.json(apiCosts(db, q && isIsoDate(q) ? q : todayLocal()));
  });
  return app;
}

export function accountRoutes(db: Db) {
  const app = new Hono();

  /** Set the current balance (öre; debt negative) as of a date (default now). */
  app.put("/:id/balance", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as { balance?: number; date?: string };
    if (!Number.isInteger(b.balance)) return c.json({ error: "Saldot ska vara ett antal öre." }, 400);
    if (b.date !== undefined && !isIsoDate(b.date)) return c.json({ error: "Datum ska vara ÅÅÅÅ-MM-DD." }, 400);
    const row = db
      .update(accounts)
      .set({ balance: b.balance!, balanceUpdatedAt: b.date ?? new Date().toISOString(), manuallyEditedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .returning()
      .get();
    return row ? c.json(row) : c.json({ error: "Hittades inte." }, 404);
  });

  /**
   * A new account (Inställningar › Konton). `source` is how it is fed: 'csv' for a bank without an
   * importer of its own, a bank's own importer, or none (balance and rows by hand). A credit card can
   * come with the text its bill's payment has on the account that pays it (`paymentText`, e.g. the
   * card's name): a rule then makes that payment a transfer to the card instead of an expense.
   */
  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; kind?: unknown; source?: unknown; importHint?: unknown; note?: unknown; trackBalance?: unknown; paymentText?: unknown };
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return c.json({ error: "Namn krävs." }, 400);
    if (name.length > 60) return c.json({ error: "Namnet är för långt (högst 60 tecken)." }, 400);
    if (db.select({ name: accounts.name }).from(accounts).all().some((a) => a.name.toLocaleLowerCase("sv") === name.toLocaleLowerCase("sv"))) {
      return c.json({ error: `Det finns redan ett konto som heter "${name}".` }, 409);
    }
    const kind = (b.kind ?? "bank") as (typeof ACCOUNT_KINDS)[number];
    if (!ACCOUNT_KINDS.includes(kind)) return c.json({ error: "Kontot är ett bankkonto eller ett kreditkort." }, 400);
    const source = b.source === undefined || b.source === null || b.source === "" ? null : (b.source as (typeof IMPORT_SOURCES)[number]);
    if (source !== null && !IMPORT_SOURCES.includes(source)) return c.json({ error: "Okänd källa för kontot." }, 400);
    if (b.trackBalance !== undefined && typeof b.trackBalance !== "boolean") return c.json({ error: "trackBalance ska vara true eller false." }, 400);
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const paymentText = kind === "credit_card" ? text(b.paymentText) : null;
    const row = db.transaction((tx) => {
      const made = tx
        .insert(accounts)
        .values({ name, kind, source, importHint: text(b.importHint), note: text(b.note), trackBalance: (b.trackBalance as boolean | undefined) ?? true })
        .returning()
        .get();
      const cardPayments = categoryIdByKey(tx as unknown as Db, "card_payment");
      if (paymentText && cardPayments !== undefined) {
        tx.insert(merchantRules)
          .values({ pattern: paymentText, matchType: "contains", categoryId: cardPayments, isTransfer: true, counterAccountId: made.id, createdFrom: "manual" })
          .onConflictDoNothing()
          .run();
      }
      return made;
    });
    if (paymentText) recategorizeUncategorized(db);
    return c.json(row, 201);
  });

  /** Remove an account that has nothing on it: no transactions (a deleted one counts) and nothing else tied to it. */
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) return c.json({ error: "Hittades inte." }, 404);
    if (db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, id)).get()) {
      return c.json({ error: "Kontot har transaktioner. Ångra importerna först (Importer › Historik), eller behåll kontot." }, 409);
    }
    try {
      db.transaction((tx) => {
        tx.delete(merchantRules).where(eq(merchantRules.counterAccountId, id)).run();
        tx.delete(statements).where(eq(statements.accountId, id)).run();
        tx.delete(accounts).where(eq(accounts.id, id)).run();
      });
    } catch {
      return c.json({ error: "Kontot används av något annat (en bankkoppling eller en fast utgift). Ta bort kopplingen först." }, 409);
    }
    return c.json({ ok: true });
  });

  /** Rename an account, change its note or whether its balance is followed (Inställningar › Konton). */
  app.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; note?: string | null; trackBalance?: unknown };
    const set: { name?: string; note?: string | null; trackBalance?: boolean } = {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return c.json({ error: "Namn krävs." }, 400);
      set.name = name;
    }
    if (b.note !== undefined) set.note = b.note === null ? null : String(b.note).trim() || null;
    if (b.trackBalance !== undefined) {
      if (typeof b.trackBalance !== "boolean") return c.json({ error: "trackBalance ska vara true eller false." }, 400);
      set.trackBalance = b.trackBalance;
    }
    if (Object.keys(set).length === 0) return c.json({ error: "Inget att ändra." }, 400);
    const row = db.update(accounts).set(set).where(eq(accounts.id, id)).returning().get();
    return row ? c.json(row) : c.json({ error: "Hittades inte." }, 404);
  });

  return app;
}

export function statementRoutes(db: Db) {
  const app = new Hono();

  /**
   * A card bill entered by hand (Mastercard until its CSV is imported). Sets
   * the account's balance to minus the amount due.
   */
  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { accountId?: number; amountDue?: number; dueDate?: string; minPayment?: number | null };
    const account = b.accountId ? db.select().from(accounts).where(eq(accounts.id, b.accountId)).get() : undefined;
    if (!account || account.kind !== "credit_card") return c.json({ error: "Välj ett kreditkortskonto." }, 400);
    if (!Number.isInteger(b.amountDue) || b.amountDue! < 0) return c.json({ error: "Beloppet ska vara ett antal öre." }, 400);
    if (!b.dueDate || !isIsoDate(b.dueDate)) return c.json({ error: "Förfallodatum ska vara ÅÅÅÅ-MM-DD." }, 400);
    const now = new Date().toISOString();
    const row = db.transaction((tx) => {
      const s = tx
        .insert(statements)
        .values({ accountId: account.id, dueDate: b.dueDate!, amountDue: b.amountDue!, minPayment: b.minPayment ?? null, source: "manual" })
        .returning()
        .get();
      tx.update(accounts).set({ balance: -b.amountDue!, balanceUpdatedAt: now }).where(eq(accounts.id, account.id)).run();
      return s;
    });
    return c.json(row);
  });

  /** Tick an invoice off as paid (or undo). */
  app.put("/:id/paid", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as { paid?: boolean };
    if (typeof b.paid !== "boolean") return c.json({ error: "paid ska vara sant/falskt." }, 400);
    const row = db
      .update(statements)
      .set({ paidAt: b.paid ? new Date().toISOString() : null })
      .where(eq(statements.id, id))
      .returning()
      .get();
    return row ? c.json(row) : c.json({ error: "Hittades inte." }, 404);
  });

  return app;
}

/**
 * One period of a recurring expense ticked off by hand: 'Markera som betald'
 * (for charges on an account never imported) or 'Drogs inte' (paused that
 * period: {skipped}). A period has one mark; setting one replaces the other.
 */
export function expenseMarkRoutes(db: Db) {
  const app = new Hono();
  app.put("/:id/marks/:period", async (c) => {
    const id = Number(c.req.param("id"));
    const period = c.req.param("period");
    if (!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period)) return c.json({ error: "Period ska vara ÅÅÅÅ-MM." }, 400);
    if (!db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get()) return c.json({ error: "Hittades inte." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { paid?: boolean; skipped?: boolean };
    const kind = typeof b.paid === "boolean" ? "paid" : typeof b.skipped === "boolean" ? "skipped" : null;
    if (!kind || (typeof b.paid === "boolean" && typeof b.skipped === "boolean")) return c.json({ error: "Ange paid eller skipped som sant/falskt." }, 400);
    const on = kind === "paid" ? b.paid : b.skipped;
    const where = and(eq(recurringExpenseMarks.recurringExpenseId, id), eq(recurringExpenseMarks.period, period));
    if (on) {
      db.insert(recurringExpenseMarks)
        .values({ recurringExpenseId: id, period, kind })
        .onConflictDoUpdate({ target: [recurringExpenseMarks.recurringExpenseId, recurringExpenseMarks.period], set: { kind, markedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` } })
        .run();
    }
    // Undone: only a mark of that kind (undoing 'betald' never removes a 'drogs inte').
    else db.delete(recurringExpenseMarks).where(and(where, eq(recurringExpenseMarks.kind, kind))).run();
    return c.json(kind === "paid" ? { id, period, paid: b.paid } : { id, period, skipped: b.skipped });
  });
  return app;
}
