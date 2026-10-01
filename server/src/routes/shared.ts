import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { cardInvoicePeriods, sharedMonth, settleMonth, unsettleMonth } from "../shared/settlement.js";
import { setSettlementStart } from "../settings.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function sharedRoutes(db: Db) {
  const app = new Hono();
  // ?today=YYYY-MM-DD is for testing; default is the local date.
  const today = (q: string | undefined) => (q && isIsoDate(q) ? q : todayLocal());

  /** Bank Norwegian invoice periods (by posting day), newest first: for filtering the transaction list. */
  app.get("/invoices", (c) => c.json(cardInvoicePeriods(db, today(c.req.query("today")), Math.min(36, Number(c.req.query("count")) || 12))));

  app.put("/start", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { month?: string };
    try {
      return c.json({ startMonth: setSettlementStart(db, b.month ?? "") });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get("/:month", (c) => {
    const month = c.req.param("month");
    if (!MONTH.test(month)) return c.json({ error: "Månaden ska vara ÅÅÅÅ-MM." }, 400);
    return c.json(sharedMonth(db, month, today(c.req.query("today"))));
  });

  /** 'Stäm av': lock the month with its current figures and a note. */
  app.put("/:month/settlement", async (c) => {
    const month = c.req.param("month");
    if (!MONTH.test(month)) return c.json({ error: "Månaden ska vara ÅÅÅÅ-MM." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { note?: string | null; carryForward?: boolean };
    settleMonth(db, month, today(c.req.query("today")), b.note ?? null, b.carryForward !== false);
    return c.json(sharedMonth(db, month, today(c.req.query("today"))));
  });

  app.delete("/:month/settlement", (c) => {
    const month = c.req.param("month");
    if (!MONTH.test(month)) return c.json({ error: "Månaden ska vara ÅÅÅÅ-MM." }, 400);
    unsettleMonth(db, month);
    return c.json(sharedMonth(db, month, today(c.req.query("today"))));
  });

  return app;
}
