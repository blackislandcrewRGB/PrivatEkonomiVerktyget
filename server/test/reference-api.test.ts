import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { transactions } from "../src/db/schema.js";
import { getCategoryPathMap, seed } from "../src/db/seed.js";
import { setHousehold } from "../src/referenceBudget/household.js";
import { referenceBudgetAdjustments, referenceBudgetAmounts, referenceBudgetItems, referenceBudgetYears } from "../src/db/schema.js";
import { freshDb } from "./helpers.js";

/**
 * GET /api/reference-budget/comparison: the comparison as the view gets it,
 * the defaults it takes, and what it says when it cannot compare yet.
 */

const HOUSEHOLD = {
  persons: [
    { role: "me", ageGroup: "25-50", food: "food_home" },
    { role: "partner", ageGroup: "25-50", food: "food_home" },
  ],
  excluded: ["water_sewage", "household_electricity"],
};

function app(opts: { household?: boolean } = {}) {
  const db = freshDb();
  seed(db);
  if (opts.household !== false) setHousehold(db, HOUSEHOLD);
  db.insert(transactions)
    .values({ source: "manual", bookingDate: "2026-08-10", descriptionRaw: "ICA", descriptionClean: "ICA", amount: -90_000, categoryId: getCategoryPathMap(db).get("Mat/Livsmedel")!, shared: true, fingerprint: "a", occurrenceIndex: 1 })
    .run();
  return { db, app: createApp(db, { databasePath: ":memory:" }) };
}
const get = async (a: ReturnType<typeof createApp>, query: string) => {
  const res = await a.request(`/api/reference-budget/comparison${query}`);
  return { status: res.status, body: await res.json() };
};

describe("GET /api/reference-budget/comparison", () => {
  it("compares my part through the last whole month by default", async () => {
    const { body, status } = await get(app().app, "?today=2026-09-21");
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ready", through: "2026-08", share: "mine" });
    expect(body.comparison.year).toBe(2026);
    expect(body.comparison.months3).toEqual({ from: "2026-06", to: "2026-08", counted: 1 });
    const food = body.comparison.items.find((i: { target: string }) => i.target === "food");
    expect(food).toMatchObject({ referenceOre: 273_000, actual3Ore: 45_000 });
  });

  it("counts the whole household when asked, and an earlier month", async () => {
    const { body } = await get(app().app, "?today=2026-09-21&share=household&through=2026-07");
    expect(body).toMatchObject({ status: "ready", through: "2026-07", share: "household" });
    const food = body.comparison.items.find((i: { target: string }) => i.target === "food");
    expect(food).toMatchObject({ referenceOre: 546_000, actual3Ore: null });
  });

  it("refuses a month still running, a malformed month and an unknown share", async () => {
    const a = app().app;
    expect(await get(a, "?today=2026-09-21&through=2026-09")).toEqual({ status: 400, body: { error: "Den sista hela månaden är 2026-08." } });
    expect((await get(a, "?through=2026-9")).status).toBe(400);
    expect(await get(a, "?share=both")).toEqual({ status: 400, body: { error: "share ska vara mine eller household." } });
  });

  it("says why it cannot compare yet, without failing", async () => {
    const noHousehold = await get(app({ household: false }).app, "?today=2026-09-21");
    expect(noHousehold).toEqual({
      status: 200,
      body: { status: "no_household", message: "Hushållet är inte inställt: ange personerna under Inställningar › Referensbudget.", through: "2026-08", share: "mine" },
    });
    const { db, app: a } = app();
    for (const t of [referenceBudgetAdjustments, referenceBudgetAmounts, referenceBudgetItems, referenceBudgetYears]) db.delete(t).run();
    expect((await get(a, "?today=2026-09-21")).body).toMatchObject({ status: "no_year", message: "Ingen referensbudget är inläst." });
  });

  it("says which year it used when the period's own is missing", async () => {
    const { body } = await get(app().app, "?today=2027-02-10");
    expect(body.comparison).toMatchObject({ year: 2026, fallback: { wanted: 2027, direction: "earlier" } });
  });
});
