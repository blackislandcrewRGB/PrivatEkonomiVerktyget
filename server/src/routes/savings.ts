import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";
import {
  SavingsError,
  createHolding,
  deleteHolding,
  deleteHoldingValue,
  renameHolding,
  savingsOverview,
  setHoldingValue,
} from "../savings/savings.js";
import { latestPrices, syncPrices } from "../savings/prices/sync.js";
import { instrumentDetail, reconcile, setCash, valuePortfolio } from "../savings/portfolio.js";
import {
  InstrumentError,
  createInstrument,
  createOpening,
  createTrade,
  deleteInstrument,
  deleteTrade,
  listInstruments,
  updateInstrument,
  type InstrumentInput,
  type OpeningInput,
  type TradeInput,
} from "../savings/instruments.js";
import { savingsCategoryIds } from "../savings/savings.js";
import { realSavings } from "../savings/real.js";
import { AvanzaStatementError, deleteAvanzaStatement, listAvanzaStatements, readAvanzaStatement, saveAvanzaStatement } from "../savings/avanzaStatement.js";

const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
import { trades, transactions } from "../db/schema.js";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";

/** Sparande (/api/savings). Query for GET: from, to (YYYY-MM-DD, default this year), today (tests). */
export function savingsRoutes(db: Db) {
  const app = new Hono();
  const guard = async (run: () => unknown) => {
    try {
      return { ok: true as const, value: await run() };
    } catch (e) {
      if (e instanceof SavingsError) return { ok: false as const, error: e.message };
      throw e;
    }
  };
  const today = (q: string | undefined) => (q && isIsoDate(q) ? q : todayLocal());

  app.get("/", (c) => {
    const q = c.req.query();
    const t = today(q.today);
    const to = q.to && isIsoDate(q.to) ? q.to : t;
    const from = q.from && isIsoDate(q.from) ? q.from : `${t.slice(0, 4)}-01-01`;
    return c.json(savingsOverview(db, from <= to ? from : to, to));
  });

  /** Sparande efter inflation: the ISK's values, the money moved and KPI; the buffer's interest against prices. */
  app.get("/real", (c) => c.json(realSavings(db, today(c.req.query("today")))));

  /**
   * Avanza's kontobesked (PDF, one or more as `files`) for the ISK and its
   * credit account. Each is read, checked (its balances must add up) and
   * kept as its movements; the file is not. All or nothing: one that can't
   * be read keeps the others from being saved.
   */
  app.post("/avanza-statements", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = [body.files, body.file].flat().filter((f): f is File => f instanceof File);
    if (!files.length) return c.json({ error: "Inga filer skickades." }, 400);
    if (files.some((f) => f.size > MAX_STATEMENT_BYTES)) return c.json({ error: "En fil är för stor." }, 413);
    try {
      const parsed = [];
      for (const f of files) parsed.push(await readAvanzaStatement(new Uint8Array(await f.arrayBuffer())));
      return c.json(parsed.map((s) => saveAvanzaStatement(db, s)));
    } catch (e) {
      if (e instanceof AvanzaStatementError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
  app.get("/avanza-statements", (c) => c.json(listAvanzaStatements(db)));
  app.delete("/avanza-statements/:id", (c) =>
    deleteAvanzaStatement(db, Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Hittades inte." }, 404),
  );

  app.post("/holdings", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const r = await guard(() => createHolding(db, String(b.name ?? "")));
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, 400);
  });
  app.patch("/holdings/:id", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const r = await guard(() => renameHolding(db, Number(c.req.param("id")), String(b.name ?? "")));
    return r.ok ? c.json(r.value) : c.json({ error: r.error }, 400);
  });
  app.delete("/holdings/:id", async (c) => {
    const r = await guard(() => deleteHolding(db, Number(c.req.param("id"))));
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 404);
  });

  /** Body: { date, value } (öre). */
  app.put("/holdings/:id/values", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { date?: unknown; value?: unknown };
    const t = today(c.req.query("today"));
    const r = await guard(() => setHoldingValue(db, Number(c.req.param("id")), typeof b.date === "string" ? b.date : t, Number(b.value), t));
    return r.ok ? c.json(r.value) : c.json({ error: r.error }, 400);
  });
  app.delete("/holdings/:id/values/:date", async (c) => {
    const r = await guard(() => deleteHoldingValue(db, Number(c.req.param("id")), c.req.param("date")));
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 404);
  });
  /**
   * 'Hämta nu': the same run the clock does every six hours. Answers with
   * what worked and what didn't, per instrument and per currency pair — a
   * source that was quiet is something to be told about, not to hide.
   */
  app.post("/prices/sync", async (c) => c.json(await syncPrices(db, today(c.req.query("today")))));

  /** The newest price of each instrument, with the day it is from. */
  app.get("/prices", (c) => c.json([...latestPrices(db).values()]));

  /**
   * The portfolio valued: per holding, per account, per zone, what the policy
   * says about it, and how it stands against the value entered by hand.
   */
  app.get("/portfolio", (c) => {
    const on = today(c.req.query("on") ?? c.req.query("today"));
    return c.json({ ...valuePortfolio(db, on), reconciliation: reconcile(db, on) });
  });

  // ---------- Innehav: instrument, affärer och likvider ----------

  const held = async (run: () => unknown) => {
    try {
      return { ok: true as const, value: await run() };
    } catch (e) {
      if (e instanceof InstrumentError) return { ok: false as const, error: e.message };
      throw e;
    }
  };

  app.get("/instruments", (c) => c.json(listInstruments(db)));

  app.post("/instruments", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as InstrumentInput;
    const r = await held(() => createInstrument(db, body));
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, 400);
  });

  app.get("/instruments/:id", (c) => {
    const detail = instrumentDetail(db, Number(c.req.param("id")), today(c.req.query("on")));
    return detail ? c.json(detail) : c.json({ error: "Instrumentet finns inte." }, 404);
  });

  app.put("/instruments/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<InstrumentInput>;
    const r = await held(() => updateInstrument(db, Number(c.req.param("id")), body));
    return r.ok ? c.json(r.value) : c.json({ error: r.error }, 400);
  });

  app.delete("/instruments/:id", async (c) => {
    const r = await held(() => deleteInstrument(db, Number(c.req.param("id"))));
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 400);
  });

  app.post("/trades", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as TradeInput;
    const r = await held(() => createTrade(db, body));
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, 400);
  });

  app.delete("/trades/:id", async (c) => {
    const r = await held(() => deleteTrade(db, Number(c.req.param("id"))));
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 404);
  });

  /**
   * Startinnehav: what is already held, written down once — the instruments
   * and one 'opening' trade each, with the average price paid.
   */
  app.post("/opening", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as OpeningInput & { cashOre?: number | null };
    const r = await held(() => createOpening(db, body));
    if (!r.ok) return c.json({ error: r.error }, 400);
    // Cash is part of what the broker shows for the account, so it belongs to
    // the same moment as the holdings.
    if (Number.isInteger(body.cashOre)) setCash(db, body.account === "depot" ? "depot" : "isk", body.date, body.cashOre as number);
    return c.json(r.value, 201);
  });

  /** Likvider: money standing in an account, which the broker counts in its own total. */
  app.put("/cash", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { account?: string; date?: string; amountOre?: number };
    const account = b.account === "depot" ? "depot" : "isk";
    const date = typeof b.date === "string" && isIsoDate(b.date) ? b.date : today(undefined);
    if (!Number.isInteger(b.amountOre)) return c.json({ error: "Beloppet ska vara ett antal öre." }, 400);
    return c.json(setCash(db, account, date, b.amountOre as number));
  });

  /**
   * Transfers in Sparande a trade can be tied to, newest first: money moved
   * to the broker, and whether a trade already claims it.
   */
  app.get("/transfers", (c) => {
    const categoryIds = savingsCategoryIds(db);
    if (!categoryIds.length) return c.json([]);
    const t = today(c.req.query("today"));
    const since = `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`;
    const claimed = new Set(
      db
        .select({ id: trades.transactionId })
        .from(trades)
        .where(isNull(trades.deletedAt))
        .all()
        .map((row) => row.id)
        .filter((id): id is number => id !== null),
    );
    const rows = db
      .select({ id: transactions.id, date: transactions.bookingDate, amount: transactions.amount, text: transactions.descriptionClean, label: transactions.label })
      .from(transactions)
      .where(and(inArray(transactions.categoryId, categoryIds), gte(transactions.bookingDate, since), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .all()
      // Money into the savings, which is what pays for a purchase.
      .filter((row) => row.amount < 0)
      .map((row) => ({ id: row.id, date: row.date, amountOre: -row.amount, text: row.label ?? row.text, linked: claimed.has(row.id) }));
    return c.json(rows);
  });

  return app;
}
