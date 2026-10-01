import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";
import { affordability, getRedBelowMonths, setRedBelowMonths, type AffordInput } from "../afford/afford.js";
import { snapshot } from "../afford/snapshot.js";

/**
 * Har jag råd? (/api/afford): ?amount= (öre, positive) &date= &accountId= (a
 * card, or none for the bank) &shared=1 &funding=savings &partner=0 (&today=
 * for testing). The limits under /settings. /snapshot: the position as
 * Markdown to paste into a Claude chat, with the purchase when one is given.
 */
export function affordRoutes(db: Db) {
  const app = new Hono();

  /** The purchase asked about, or why it can't be read. */
  const read = (q: Record<string, string>, today: string): AffordInput | string => {
    const amount = Number(q.amount);
    if (!Number.isInteger(amount) || amount <= 0) return "Beloppet ska vara ett antal öre, mer än noll.";
    const date = q.date || today;
    if (!isIsoDate(date) || date < today) return "Datum ska vara i dag eller senare (ÅÅÅÅ-MM-DD).";
    const accountId = q.accountId ? Number(q.accountId) : null;
    if (accountId !== null && !(Number.isInteger(accountId) && db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get())) {
      return "Kontot finns inte.";
    }
    if (q.funding && q.funding !== "cash" && q.funding !== "savings") return "funding ska vara cash eller savings.";
    return { amount, date, accountId, shared: q.shared === "1", funding: q.funding === "savings" ? "savings" : "cash", partner: q.partner !== "0" };
  };
  const todayOf = (q: Record<string, string>) => (q.today && isIsoDate(q.today) ? q.today : todayLocal());

  app.get("/", (c) => {
    const q = c.req.query();
    const input = read(q, todayOf(q));
    return typeof input === "string" ? c.json({ error: input }, 400) : c.json(affordability(db, todayOf(q), input));
  });

  app.get("/snapshot", (c) => {
    const q = c.req.query();
    if (!q.amount) return c.json({ markdown: snapshot(db, todayOf(q)) });
    const input = read(q, todayOf(q));
    return typeof input === "string" ? c.json({ error: input }, 400) : c.json({ markdown: snapshot(db, todayOf(q), affordability(db, todayOf(q), input)) });
  });

  app.get("/settings", (c) => c.json({ redBelowMonths: getRedBelowMonths(db) }));
  app.put("/settings", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { redBelowMonths?: number };
    try {
      return c.json({ redBelowMonths: setRedBelowMonths(db, b.redBelowMonths as number) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  return app;
}
