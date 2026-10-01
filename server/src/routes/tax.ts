import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";
import { IskError, iskOverview, iskRules, listQuarterValues, setIskRule, setQuarterValue } from "../tax/isk.js";
import { TAX_CONSTANTS, TaxRuleError, setTaxRules, taxRules } from "../tax/rules.js";
import { MissingRatesError } from "../tax/finalTax.js";
import { estimateTaxRefund, refundSettings, setRefundSettings } from "../tax/refund.js";

/** Skatt (/api/tax): the ISK tax and what it rests on. */
export function taxRoutes(db: Db) {
  const app = new Hono();
  const on = (q: string | undefined) => (q && isIsoDate(q) ? q : todayLocal());
  const held = async (run: () => unknown) => {
    try {
      return Response.json(run());
    } catch (e) {
      if (e instanceof IskError || e instanceof TaxRuleError || e instanceof MissingRatesError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
  };

  /** This year's ISK tax, the declared years' capital bases, and the ISK today against the allowance. */
  app.get("/isk", (c) => c.json(iskOverview(db, on(c.req.query("today")))));

  /** Inställningar › Deklaration: the rules per year and the quarter values entered. */
  const settings = () => ({ rules: iskRules(db), quarters: listQuarterValues(db) });
  app.get("/isk/settings", (c) => c.json(settings()));
  app.put("/isk/rules", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return held(() => (setIskRule(db, body), settings()));
  });
  /** { valueOre } for the quarter starting on the date; null removes it. */
  app.put("/isk/quarters/:date", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { valueOre?: number | null };
    return held(() => (setQuarterValue(db, c.req.param("date"), body.valueOre ?? null), settings()));
  });

  /** Inställningar › Lön: the tax rules per year (amounts, coefficients, rates and their sources). */
  const rules = () => ({ years: taxRules(db), constants: TAX_CONSTANTS });
  app.get("/rules", (c) => c.json(rules()));
  app.put("/rules/:year", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return held(() => (setTaxRules(db, Number(c.req.param("year")), body), rules()));
  });

  /** The refund (or kvarskatt) for last year and this year, with the arithmetic. */
  app.get("/refund", (c) => {
    const today = on(c.req.query("today"));
    const year = Number(today.slice(0, 4));
    return c.json({ settings: refundSettings(db), years: [year - 1, year].map((y) => estimateTaxRefund(db, y, today)) });
  });
  /** One income year: the model's final tax on its return (or forecast), and the refund when the preliminary tax is known. */
  app.get("/refund/:year", (c) => c.json(estimateTaxRefund(db, Number(c.req.param("year")), on(c.req.query("today")))));
  app.put("/refund/settings", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return held(() => setRefundSettings(db, body));
  });

  return app;
}
