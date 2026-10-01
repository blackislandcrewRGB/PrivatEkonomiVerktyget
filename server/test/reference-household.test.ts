import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { referenceBudgetAdjustments, referenceBudgetAmounts, referenceBudgetItems, referenceBudgetYears } from "../src/db/schema.js";
import { HouseholdError, getHousehold, householdOptions, personName, setHousehold, type ReferenceHousehold } from "../src/referenceBudget/household.js";
import { freshDb } from "./helpers.js";

/**
 * Hushållet som referensbudgeten räknas för. What matters is what is
 * refused: a household the reference year cannot price, rather than a
 * figure quietly worked out from a guess.
 */

const OURS: ReferenceHousehold = {
  persons: [
    { role: "me", ageGroup: "25-50", food: "food_home", age: null },
    { role: "partner", ageGroup: "25-50", food: "food_home", age: null },
  ],
  excluded: ["water_sewage", "household_electricity", "child_insurance", "child_equipment"],
};

const refused = (input: unknown) => {
  const db = freshDb();
  try {
    setHousehold(db, input);
  } catch (e) {
    expect(e).toBeInstanceOf(HouseholdError);
    expect(getHousehold(db)).toBeNull();
    return (e as Error).message;
  }
  throw new Error("was not refused");
};

describe("the reference household", () => {
  it("is not set up until it is saved", () => {
    expect(getHousehold(freshDb())).toBeNull();
  });

  it("offers the latest year's age groups, food variants and items", () => {
    const o = householdOptions(freshDb())!;
    expect(o.year).toBe(2026);
    expect(o.ageGroups.map((g) => g.key)).toContain("25-50");
    expect(o.food).toEqual([
      { key: "food_home", name: "Livsmedel, all mat lagas hemma" },
      { key: "food_home_no_weekday_lunch", name: "Livsmedel, utom lunch på vardagar" },
    ]);
    expect(o.items).toHaveLength(15);
  });

  it("saves a household and reads it back", () => {
    const db = freshDb();
    expect(setHousehold(db, OURS)).toEqual(OURS);
    expect(getHousehold(db)).toEqual(OURS);
  });

  it("keeps a name only for someone who is neither me nor the partner", () => {
    const db = freshDb();
    const saved = setHousehold(db, {
      persons: [
        { role: "me", name: "ignored", ageGroup: "25-50", food: "food_home" },
        { role: "other", name: " Kim ", ageGroup: "7-10", food: "food_home_no_weekday_lunch", age: 7 },
      ],
      excluded: [],
    });
    expect(saved.persons).toEqual([
      { role: "me", ageGroup: "25-50", food: "food_home", age: null },
      { role: "other", name: "Kim", ageGroup: "7-10", food: "food_home_no_weekday_lunch", age: 7 },
    ]);
    expect(personName(db, saved.persons[0])).toBe("Jag");
    expect(personName(db, saved.persons[1])).toBe("Kim");
    expect(personName(db, { role: "partner", ageGroup: "25-50", food: "food_home" })).toBe("partnern");
  });

  it("refuses what the reference year cannot price", () => {
    expect(refused({ ...OURS, persons: [{ ...OURS.persons[0], ageGroup: "26-50" }] })).toBe("Person 1: välj en åldersgrupp från 2026.");
    expect(refused({ ...OURS, persons: [{ ...OURS.persons[0], food: "clothing" }] })).toBe("Person 1: välj en matvariant.");
    expect(refused({ ...OURS, excluded: ["rent"] })).toBe("rent är ingen post i referensbudgeten.");
    expect(refused({ ...OURS, excluded: ["food_home"] })).toBe("Matvarianten en person räknas med kan inte exkluderas.");
  });

  it("refuses a household without exactly one me, or with two partners", () => {
    expect(refused({ persons: [], excluded: [] })).toBe("Hushållet behöver minst en person.");
    expect(refused({ ...OURS, persons: [OURS.persons[1]] })).toBe("Hushållet ska ha exakt en person som är du.");
    expect(refused({ ...OURS, persons: [OURS.persons[0], OURS.persons[0]] })).toBe("Hushållet ska ha exakt en person som är du.");
    expect(refused({ ...OURS, persons: [...OURS.persons, OURS.persons[1]] })).toBe("Hushållet kan bara ha en partner.");
    expect(refused({ ...OURS, persons: [...OURS.persons, { role: "other", ageGroup: "0", food: "food_home" }] })).toBe("Person 3 behöver ett namn.");
    expect(refused({ ...OURS, persons: [{ ...OURS.persons[0], age: 25.5 }] })).toBe("Person 1: åldern ska vara ett helt antal år.");
  });

  it("refuses a household when no reference year is loaded", () => {
    const db = freshDb();
    for (const t of [referenceBudgetAdjustments, referenceBudgetAmounts, referenceBudgetItems, referenceBudgetYears]) db.delete(t).run();
    expect(() => setHousehold(db, OURS)).toThrow("Ingen referensbudget är inläst än.");
  });

  it("is read and saved at /api/reference-budget/household", async () => {
    const app = createApp(freshDb(), { databasePath: ":memory:" });
    const before = await (await app.request("/api/reference-budget/household")).json();
    expect(before).toMatchObject({ household: null, options: { year: 2026 }, partnerName: "partnern" });
    const put = (body: unknown) => app.request("/api/reference-budget/household", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    const ok = await put(OURS);
    expect(ok.status).toBe(200);
    expect((await ok.json()).household).toEqual(OURS);
    const bad = await put({ ...OURS, excluded: ["rent"] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "rent är ingen post i referensbudgeten." });
  });
});
