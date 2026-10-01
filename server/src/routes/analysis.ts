import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { averages, byCategoryAndMonth, comparePeriods, fixedVariable, food, topMerchants, type Share } from "../analysis/analysis.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";
import { getPriceCompareSettings, pricesView, setPriceCompareSettings } from "../prices/compare.js";
import { indexProviders } from "../prices/providers.js";
import { syncIndexes } from "../prices/sync.js";

/**
 * Query: from, to (YYYY-MM-DD, default the last 12 months), share=mine|household,
 * today (for tests), showPrivate=1 (merchants).
 */
export function analysisRoutes(db: Db) {
  const app = new Hono();
  const params = (q: Record<string, string>) => {
    const today = q.today && isIsoDate(q.today) ? q.today : todayLocal();
    const share: Share = q.share === "household" ? "household" : "mine";
    const to = q.to && isIsoDate(q.to) ? q.to : today;
    const from = q.from && isIsoDate(q.from) ? q.from : `${today.slice(0, 4)}-01-01`;
    return { today, share, from: from <= to ? from : to, to };
  };

  app.get("/categories", (c) => {
    const q = c.req.query();
    const p = params(q);
    const months = Math.min(36, Math.max(1, Number(q.months) || 12));
    // ?to= ends the months at that date (a custom period); default today.
    return c.json(byCategoryAndMonth(db, q.to ? p.to : p.today, months, p.share, q.parent ? Number(q.parent) : null));
  });
  app.get("/averages", (c) => {
    const p = params(c.req.query());
    return c.json(averages(db, p.from, p.to, p.today, p.share));
  });
  app.get("/food", (c) => {
    const p = params(c.req.query());
    return c.json(food(db, p.from, p.to, p.share));
  });
  app.get("/fixed-variable", (c) => {
    const p = params(c.req.query());
    return c.json(fixedVariable(db, p.from, p.to, p.share));
  });
  app.get("/merchants", (c) => {
    const q = c.req.query();
    const p = params(q);
    return c.json(topMerchants(db, p.from, p.to, p.share, q.showPrivate === "1"));
  });
  // Priser: mina siffror mot SCB:s index och kommissionens rikssnitt. The
  // period selector governs the charts; the month everything is indexed to is
  // a setting of its own.
  app.get("/prices", (c) => {
    const p = params(c.req.query());
    return c.json({ ...pricesView(db, { from: p.from, to: p.to, today: p.today }), settings: getPriceCompareSettings(db) });
  });
  app.put("/prices/settings", async (c) => {
    try {
      return c.json(setPriceCompareSettings(db, await c.req.json()));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  // Hämta nu: the same run the clock makes, on demand.
  app.post("/prices/sync", async (c) => {
    const p = params(c.req.query());
    return c.json(await syncIndexes(db, indexProviders(), { today: p.today, force: true }));
  });
  app.get("/compare", (c) => {
    const q = c.req.query();
    const p = params(q);
    const ok = [q.aFrom, q.aTo, q.bFrom, q.bTo].every((d) => d && isIsoDate(d));
    if (!ok) return c.json({ error: "Ange aFrom, aTo, bFrom och bTo (ÅÅÅÅ-MM-DD)." }, 400);
    // ?bScale=: B's sums times this (0–1), for B as an average ('Snitt 12 mån').
    const scale = q.bScale === undefined ? 1 : Number(q.bScale);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) return c.json({ error: "bScale ska vara ett tal mellan 0 och 1." }, 400);
    return c.json(comparePeriods(db, { from: q.aFrom, to: q.aTo }, { from: q.bFrom, to: q.bTo }, p.share, scale));
  });
  return app;
}
