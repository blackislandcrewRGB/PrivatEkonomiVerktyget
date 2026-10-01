import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, plannedItems } from "../db/schema.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";
import { cashflow, getBuffer, getFoodOnly, plannedPayment, setBuffer, setFoodOnly } from "../cashflow/cashflow.js";

/** Kassaflöde: the 90-day forecast, planned items and the buffer (Inställningar). */
export function cashflowRoutes(db: Db) {
  const app = new Hono();

  // ?today=YYYY-MM-DD is for testing and looking back; default is the local date. ?partner=0 leaves Mio's payments out.
  app.get("/", (c) => {
    const q = c.req.query("today");
    return c.json(cashflow(db, q && isIsoDate(q) ? q : todayLocal(), { partner: c.req.query("partner") !== "0" }));
  });

  /** The buffer, and 'räkna bara med mat' ({buffer?, foodOnly?}: either or both). */
  app.get("/settings", (c) => c.json({ buffer: getBuffer(db), foodOnly: getFoodOnly(db) }));
  app.put("/settings", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { buffer?: number; foodOnly?: boolean };
    try {
      if (b.buffer === undefined && b.foodOnly === undefined) throw new Error("Ange buffer eller foodOnly.");
      if (b.foodOnly !== undefined && typeof b.foodOnly !== "boolean") throw new Error("foodOnly ska vara sant/falskt.");
      if (b.buffer !== undefined) setBuffer(db, b.buffer);
      if (b.foodOnly !== undefined) setFoodOnly(db, b.foodOnly);
      return c.json({ buffer: getBuffer(db), foodOnly: getFoodOnly(db) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  /** Paid with (null: the bank on the day) and shared: an expense only, on an account that exists. */
  const payment = (b: { amount?: number; accountId?: unknown; shared?: unknown }): { accountId: number | null; shared: boolean } | string => {
    const accountId = b.accountId === undefined || b.accountId === null ? null : Number(b.accountId);
    if (accountId !== null && !(Number.isInteger(accountId) && db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get())) return "Kontot finns inte.";
    if (b.shared !== undefined && typeof b.shared !== "boolean") return "shared ska vara sant/falskt.";
    const shared = b.shared === true;
    if ((b.amount ?? 0) > 0 && (shared || (accountId !== null && db.select().from(accounts).where(eq(accounts.id, accountId)).get()!.kind === "credit_card"))) {
      return "En inkomst kan inte vara delad eller komma på ett kort.";
    }
    return { accountId, shared };
  };

  /** A scenario saved as a planned expense (amount negative) or income, paid with an account (a card: on its invoice's pay day), maybe shared. */
  app.post("/planned", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { date?: string; amount?: number; description?: string; accountId?: unknown; shared?: unknown };
    const description = b.description?.trim();
    if (!b.date || !isIsoDate(b.date)) return c.json({ error: "Datum ska vara ÅÅÅÅ-MM-DD." }, 400);
    if (!Number.isInteger(b.amount) || b.amount === 0) return c.json({ error: "Beloppet ska vara ett antal öre (negativt för en utgift)." }, 400);
    if (!description) return c.json({ error: "Beskrivning krävs." }, 400);
    const pay = payment(b);
    if (typeof pay === "string") return c.json({ error: pay }, 400);
    return c.json(db.insert(plannedItems).values({ date: b.date, amount: b.amount!, description, ...pay }).returning().get());
  });

  /** When a purchase leaves the bank and a shared one's half comes back: ?date=&amount=&accountId=&shared=1 (the scenario before it is saved). */
  app.get("/pay-day", (c) => {
    const q = c.req.query();
    if (!q.date || !isIsoDate(q.date)) return c.json({ error: "Datum ska vara ÅÅÅÅ-MM-DD." }, 400);
    const amount = Number(q.amount ?? -1);
    const pay = payment({ amount, accountId: q.accountId || null, shared: q.shared === "1" });
    if (typeof pay === "string") return c.json({ error: pay }, 400);
    const today = q.today && isIsoDate(q.today) ? q.today : todayLocal();
    return c.json(plannedPayment(db, { date: q.date, amount: Number.isInteger(amount) && amount !== 0 ? amount : -1, ...pay }, today));
  });

  app.delete("/planned/:id", (c) => {
    const row = db.delete(plannedItems).where(eq(plannedItems.id, Number(c.req.param("id")))).returning().get();
    return row ? c.json(row) : c.json({ error: "Hittades inte." }, 404);
  });

  return app;
}
