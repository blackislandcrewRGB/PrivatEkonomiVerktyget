import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";
import { balanceSheet } from "../networth/networth.js";
import { ahead } from "../networth/ahead.js";
import { flow } from "../networth/flow.js";
import { history } from "../networth/history.js";
import { PensionError, createPension, deletePension, deletePensionForecast, deletePensionStatement, savePensionForecast, type PensionForecastInput, getPensionSettings, savePensionStatement, type PensionStatementInput, pensionOverview, setIncomeBaseAmount, updatePension, type IncomeBaseAmount, type PensionEntryInput } from "../networth/pension.js";
import { endurance, getAkassaSettings, getBufferAccount, payslipTaxRate, setAkassaSettings, setBufferAccount, type AkassaSettings } from "../networth/endurance.js";
import { ManualBalanceError, createManualBalance, currentBalances, deleteManualBalance, updateManualBalance, type ManualBalanceInput } from "../networth/manualBalances.js";

/** Ekonomisk situation: the balance sheet and the figures kept by hand. */
export function networthRoutes(db: Db) {
  const app = new Hono();

  const on = (q: string | undefined) => (q && isIsoDate(q) ? q : todayLocal());

  /** The balance sheet, and Framåt: Pengar totalt over the coming salary cycle. */
  app.get("/", (c) => {
    const today = on(c.req.query("on") ?? c.req.query("today"));
    const sheet = balanceSheet(db, today);
    return c.json({ ...sheet, ahead: ahead(db, today, sheet.totals.moneyOre) });
  });

  /** Uthållighet: how long the money lasts, and the arithmetic behind it. */
  app.get("/endurance", (c) => c.json(endurance(db, on(c.req.query("on") ?? c.req.query("today")))));

  /** Flöde per månad: what came in, what went out, and where the rest went. */
  app.get("/flow", (c) => c.json(flow(db, on(c.req.query("on") ?? c.req.query("today")))));

  /**
   * What the endurance rests on and the user decides: which account is the
   * buffer, and the unemployment insurance's own numbers. They are settings
   * and not constants because they are a political decision.
   */
  const settings = () => ({ akassa: getAkassaSettings(db), bufferAccount: getBufferAccount(db), payslipTaxRate: payslipTaxRate(db), pension: getPensionSettings(db) });
  app.get("/settings", (c) => c.json(settings()));

  app.put("/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { akassa?: Partial<AkassaSettings>; bufferAccountId?: number | null; incomeBaseAmount?: IncomeBaseAmount };
    try {
      if (body.bufferAccountId !== undefined) setBufferAccount(db, body.bufferAccountId);
      if (body.akassa) setAkassaSettings(db, body.akassa);
      if (body.incomeBaseAmount) setIncomeBaseAmount(db, body.incomeBaseAmount);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    return c.json(settings());
  });

  /** Historik: the net worth month by month, and today to end the line on. */
  app.get("/history", (c) => c.json(history(db, on(c.req.query("on") ?? c.req.query("today")))));

  /** Långsiktigt: the pensions, what they add up to, and how old the figures are. */
  app.get("/pension", (c) => c.json(pensionOverview(db, on(c.req.query("on") ?? c.req.query("today")))));

  const heldPension = <T>(run: () => T) => {
    try {
      return { ok: true as const, value: run() };
    } catch (e) {
      if (e instanceof PensionError) return { ok: false as const, error: e.message };
      throw e;
    }
  };

  app.post("/pension", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as PensionEntryInput;
    const r = heldPension(() => createPension(db, body));
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, 400);
  });

  app.put("/pension/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<PensionEntryInput>;
    const r = heldPension(() => updatePension(db, Number(c.req.param("id")), body));
    return r.ok ? c.json(r.value) : c.json({ error: r.error }, 400);
  });

  /** Årsbesked: one per income year, entered again to correct it. */
  app.post("/pension/statements", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as PensionStatementInput;
    const r = heldPension(() => savePensionStatement(db, body));
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, 400);
  });
  /** Prognos från minPension: stored as shown, nothing computed from it. */
  app.post("/pension/forecasts", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as PensionForecastInput;
    const r = heldPension(() => savePensionForecast(db, body));
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, 400);
  });
  app.delete("/pension/forecasts/:id", (c) =>
    deletePensionForecast(db, Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Prognosen finns inte." }, 404),
  );
  app.delete("/pension/statements/:id", (c) =>
    deletePensionStatement(db, Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Årsbeskedet finns inte." }, 404),
  );
  app.delete("/pension/:id", (c) => (deletePension(db, Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Pensionsposten finns inte." }, 404)));

  /** The manual rows with what they are worth today, for the editing dialog. */
  app.get("/manual", (c) =>
    c.json(
      currentBalances(db, on(c.req.query("on"))).map((b) => ({
        ...b.row,
        currentOre: b.amountOre,
        paidOre: b.paidOre,
        charges: b.charges,
        lastChargeDate: b.lastChargeDate,
      })),
    ),
  );

  const held = <T>(run: () => T) => {
    try {
      return { ok: true as const, value: run() };
    } catch (e) {
      if (e instanceof ManualBalanceError) return { ok: false as const, error: e.message };
      throw e;
    }
  };

  app.post("/manual", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as ManualBalanceInput;
    const r = held(() => createManualBalance(db, body));
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, 400);
  });

  app.put("/manual/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<ManualBalanceInput>;
    const r = held(() => updateManualBalance(db, Number(c.req.param("id")), body));
    return r.ok ? c.json(r.value) : c.json({ error: r.error }, 400);
  });

  app.delete("/manual/:id", (c) => (deleteManualBalance(db, Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Posten finns inte." }, 404)));

  return app;
}
