import { Hono, type Context } from "hono";
import type { Db } from "../db/client.js";
import { getPartnerName } from "../settings.js";
import { HouseholdError, getHousehold, householdOptions, setHousehold } from "../referenceBudget/household.js";
import { todayLocal } from "../overview/dates.js";
import { compare, lastWholeMonth, type Share } from "../referenceBudget/compare.js";
import { referenceYearDue } from "../referenceBudget/due.js";
import { MappingError, categoryMappings, expenseMappings, mappingTargets, setCategoryTarget, setExpenseTarget } from "../referenceBudget/mapping.js";

/** Konsumentverkets referensbudget: the household it is counted for. */
export function referenceBudgetRoutes(db: Db) {
  const app = new Hono();

  const household = () => ({ household: getHousehold(db), options: householdOptions(db), partnerName: getPartnerName(db) });

  app.get("/household", (c) => c.json(household()));

  app.put("/household", async (c) => {
    const body = await c.req.json().catch(() => null);
    try {
      setHousehold(db, body);
    } catch (e) {
      if (e instanceof HouseholdError) return c.json({ error: e.message }, 400);
      throw e;
    }
    return c.json(household());
  });

  /**
   * Jämfört med Konsumentverket, per post.
   *
   * Query: share=mine|household (default mine); through=YYYY-MM, the last
   * month counted (default the last whole month); kpi=1 to move the
   * reference with SCB's KPI from the year's price base; today=YYYY-MM-DD
   * for testing. A comparison that cannot be made yet is not an error: it says
   * why ('no_year', 'no_household') for the view to explain.
   */
  app.get("/comparison", (c) => {
    const q = c.req.query();
    const today = q.today && /^\d{4}-\d{2}-\d{2}$/.test(q.today) ? q.today : todayLocal();
    if (q.share !== undefined && q.share !== "mine" && q.share !== "household") return c.json({ error: "share ska vara mine eller household." }, 400);
    const share: Share = q.share === "household" ? "household" : "mine";
    let through = lastWholeMonth(today);
    if (q.through !== undefined) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.through)) return c.json({ error: "through ska vara en månad, ÅÅÅÅ-MM." }, 400);
      // A month still running would be averaged as if it were over.
      if (q.through > through) return c.json({ error: `Den sista hela månaden är ${through}.` }, 400);
      through = q.through;
    }
    const r = compare(db, through, share, { kpi: q.kpi === "1" });
    if (!r.ok) {
      const message = r.reason === "no_year" ? "Ingen referensbudget är inläst." : "Hushållet är inte inställt: ange personerna under Inställningar › Referensbudget.";
      return c.json({ status: r.reason, message, through, share });
    }
    // A new year expected and not added: the view says how to add it.
    return c.json({ status: "ready", through, share, comparison: r.comparison, due: referenceYearDue(db, today) });
  });

  /** Which category (and fixed expense) is compared with which item. */
  const mapping = () => ({ categories: categoryMappings(db), expenses: expenseMappings(db), targets: mappingTargets(db) });
  app.get("/mapping", (c) => c.json(mapping()));

  const setTarget = (set: (id: number, target: string | null) => void) => async (c: Context) => {
    const body = (await c.req.json().catch(() => ({}))) as { target?: string | null };
    try {
      set(Number(c.req.param("id")), body.target ?? null);
    } catch (e) {
      if (e instanceof MappingError) return c.json({ error: e.message }, 400);
      throw e;
    }
    return c.json(mapping());
  };
  app.put("/mapping/categories/:id", setTarget((id, t) => setCategoryTarget(db, id, t)));
  app.put("/mapping/expenses/:id", setTarget((id, t) => setExpenseTarget(db, id, t)));

  return app;
}
