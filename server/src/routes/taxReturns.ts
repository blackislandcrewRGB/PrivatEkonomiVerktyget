import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { todayLocal } from "../overview/dates.js";
import { deleteTaxReturn, listTaxReturns, saveTaxReturn, TaxReturnError } from "../taxReturns/taxReturns.js";

/** Deklarationer (/api/tax-returns): the income years' returns, read from receipts or entered by hand. */
export function taxReturnRoutes(db: Db) {
  const app = new Hono();

  app.get("/", (c) => c.json(listTaxReturns(db)));

  app.put("/:year", async (c) => {
    try {
      return c.json(saveTaxReturn(db, Number(c.req.param("year")), await c.req.json(), todayLocal()));
    } catch (e) {
      if (e instanceof TaxReturnError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  app.delete("/:year", (c) => {
    if (!deleteTaxReturn(db, Number(c.req.param("year")))) return c.json({ error: "Hittades inte." }, 404);
    return c.json({ ok: true });
  });

  return app;
}
