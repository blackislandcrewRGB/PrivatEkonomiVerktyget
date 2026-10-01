import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import { manualData } from "../src/manualData/manualData.js";
import { buildOverview } from "../src/overview/overview.js";
import { expectedReferenceYear, referenceYearDue } from "../src/referenceBudget/due.js";
import { setHousehold } from "../src/referenceBudget/household.js";
import { freshDb } from "./helpers.js";

/**
 * Konsumentverket's new figures come in the middle of November. From the
 * 15th the tool asks for next year's, in Att göra and in Att fylla i — but
 * only once the comparison is in use.
 */

const inUse = () => {
  const db = freshDb();
  seed(db);
  setHousehold(db, { persons: [{ role: "me", ageGroup: "25-50", food: "food_home" }], excluded: [] });
  return db;
};
const task = (db: ReturnType<typeof freshDb>, today: string) => buildOverview(db, today).tasks.find((t) => t.kind === "reference_budget");

describe("the reference year that ought to be in", () => {
  it("is next year from 15 November, this year before", () => {
    expect(expectedReferenceYear("2026-11-14")).toBe(2026);
    expect(expectedReferenceYear("2026-11-15")).toBe(2027);
    expect(expectedReferenceYear("2026-12-31")).toBe(2027);
    expect(expectedReferenceYear("2027-01-01")).toBe(2027);
  });

  it("is only asked for once a household is set up", () => {
    const db = freshDb();
    seed(db);
    expect(referenceYearDue(db, "2026-11-20")).toBeNull();
    setHousehold(db, { persons: [{ role: "me", ageGroup: "25-50", food: "food_home" }], excluded: [] });
    expect(referenceYearDue(db, "2026-11-20")).toEqual({ year: 2027, latest: 2026 });
    expect(referenceYearDue(db, "2026-11-14")).toBeNull();
  });
});

describe("Att göra", () => {
  it("asks for next year's figures from 15 November, until they are added", () => {
    const db = inUse();
    expect(task(db, "2026-11-14")).toBeUndefined();
    expect(task(db, "2026-11-15")).toEqual({ id: "reference_budget:2027", kind: "reference_budget", text: "Nya referensvärden från Konsumentverket – lägg in 2027" });
    // Still asking in the new year, with the same id, so a dismissal is per day as for every task.
    expect(task(db, "2027-02-01")?.id).toBe("reference_budget:2027");
  });

  it("asks nothing when the comparison isn't used", () => {
    const db = freshDb();
    seed(db);
    expect(task(db, "2026-11-20")).toBeUndefined();
  });
});

describe("Att fylla i", () => {
  it("lists the reference budget as a yearly file, soon from November and late in the new year", () => {
    const db = inUse();
    const row = (today: string) => manualData(db, today).find((i) => i.key === "reference_budget");
    expect(row("2026-09-21")).toMatchObject({ status: "ok", asOf: "2026", input: "file", group: "Analys", link: { view: "analysis", search: "?flik=konsumentverket" } });
    expect(row("2026-11-20")).toMatchObject({ status: "soon", note: "2027 års siffror publiceras i mitten av november." });
    expect(row("2027-01-10")).toMatchObject({ status: "overdue", note: "2027 saknas — 2026 års används." });
  });

  it("has no row while the comparison isn't used", () => {
    const db = freshDb();
    seed(db);
    expect(manualData(db, "2026-11-20").find((i) => i.key === "reference_budget")).toBeUndefined();
  });
});

describe("the comparison's answer", () => {
  it("carries the year that is due, for the view to say how to add it", async () => {
    const app = createApp(inUse(), { databasePath: ":memory:" });
    const before = await (await app.request("/api/reference-budget/comparison?today=2026-09-21")).json();
    expect(before.due).toBeNull();
    const after = await (await app.request("/api/reference-budget/comparison?today=2026-11-20")).json();
    expect(after.due).toEqual({ year: 2027, latest: 2026 });
  });
});
