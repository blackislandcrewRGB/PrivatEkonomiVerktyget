import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { categories, recurringExpenses, referenceBudgetCategoryMap } from "../src/db/schema.js";
import { getCategoryPathMap, seed } from "../src/db/seed.js";
import {
  DEFAULT_CATEGORY_MAP,
  MappingError,
  REFERENCE_NOT_INCLUDED,
  applyDefaultMapping,
  categoryMappings,
  expenseMappings,
  mappingTargets,
  setCategoryTarget,
  setExpenseTarget,
} from "../src/referenceBudget/mapping.js";
import { freshDb } from "./helpers.js";

/**
 * Kategorierna mot Konsumentverkets poster. The point is that nothing is
 * silent: every spending category is an item, 'not included', or openly
 * unmapped — and income, transfers and the settlement are not spending.
 */

const seeded = () => {
  const db = freshDb();
  seed(db);
  return db;
};
const byPath = (db: ReturnType<typeof freshDb>) => new Map(categoryMappings(db).map((m) => [m.path, m]));
const expense = (db: ReturnType<typeof freshDb>, name: string) =>
  db.insert(recurringExpenses).values({ name, amount: 24_200, paymentMethod: "autogiro" }).returning().get().id;

describe("the category mapping", () => {
  it("is put on a new database by the seed, as approved", () => {
    const m = byPath(seeded());
    expect(m.get("Mat › Livsmedel")).toMatchObject({ kind: "item", target: "food" });
    expect(m.get("Prylar & hem › Kläder")).toMatchObject({ kind: "item", target: "clothing" });
    expect(m.get("Hälsa › Träning")).toMatchObject({ kind: "item", target: "leisure" });
    expect(m.get("Nöje › Streaming")).toMatchObject({ kind: "item", target: "other_media" });
    expect(m.get("Boende › Hem & hushåll")).toMatchObject({ kind: "item", target: "home_equipment" });
    expect(m.get("Boende › Hyra")).toMatchObject({ kind: "not_included", target: REFERENCE_NOT_INCLUDED });
    expect(m.get("Mat › Restaurang & café")?.kind).toBe("not_included");
    expect(m.get("Hälsa › Tandvård")?.kind).toBe("not_included");
    expect(m.get("Hälsa › Vård & apotek")?.kind).toBe("not_included");
    expect(m.get("Bil › Drivmedel")?.kind).toBe("not_included");
    // Both insurances sit here: the category says nothing, the fixed expenses decide.
    expect(m.get("Försäkring")?.kind).toBe("not_included");
  });

  it("counts income, transfers and the settlement as not spending, whatever the map says", () => {
    const db = seeded();
    const m = byPath(db);
    for (const path of ["Inkomst", "Inkomst › Lön", "Inkomst › Från partner", "Överföringar & sparande › Sparande", "Till partner"]) {
      expect(m.get(path), path).toMatchObject({ kind: "not_spending", target: null });
    }
  });

  it("leaves a category it doesn't know unmapped, and says so", () => {
    const db = seeded();
    const id = db.insert(categories).values({ name: "Husdjur" }).returning().get().id;
    expect(byPath(db).get("Husdjur")).toEqual({ categoryId: id, path: "Husdjur", parentId: null, target: null, kind: "unmapped" });
    // Every seeded spending category has an answer; only the new one has none.
    const unmapped = categoryMappings(db).filter((c) => c.kind === "unmapped").map((c) => c.path);
    expect(unmapped).toEqual(["Husdjur"]);
  });

  it("never changes a category that is already mapped", () => {
    const db = seeded();
    const id = getCategoryPathMap(db).get("Mat/Livsmedel")!;
    setCategoryTarget(db, id, REFERENCE_NOT_INCLUDED);
    expect(applyDefaultMapping(db)).toEqual({ categories: 0, expenses: 0 });
    expect(byPath(db).get("Mat › Livsmedel")?.target).toBe(REFERENCE_NOT_INCLUDED);
  });

  it("uses only paths the seed can have, spelled as the app shows them", () => {
    for (const path of Object.keys(DEFAULT_CATEGORY_MAP)) expect(path.split(" › ").length, path).toBeLessThanOrEqual(2);
  });

  it("forgets a category that is deleted", () => {
    const db = seeded();
    const id = db.insert(categories).values({ name: "Husdjur" }).returning().get().id;
    setCategoryTarget(db, id, "leisure");
    db.delete(categories).where(eq(categories.id, id)).run();
    expect(db.select().from(referenceBudgetCategoryMap).where(eq(referenceBudgetCategoryMap.categoryId, id)).all()).toEqual([]);
  });
});

describe("targets", () => {
  it("are the items, the food choice once, and 'not included'", () => {
    const keys = mappingTargets(freshDb()).map((t) => t.key);
    expect(keys).toContain("food");
    expect(keys).not.toContain("food_home");
    expect(keys).toContain("home_insurance");
    expect(keys.at(-1)).toBe(REFERENCE_NOT_INCLUDED);
  });

  it("refuses what isn't a target, and removes a mapping with null", () => {
    const db = seeded();
    const id = db.insert(categories).values({ name: "Husdjur" }).returning().get().id;
    expect(() => setCategoryTarget(db, id, "food_home")).toThrow(MappingError);
    expect(() => setCategoryTarget(db, id, "rent")).toThrow("rent är ingen post i referensbudgeten.");
    expect(() => setCategoryTarget(db, 9999, "leisure")).toThrow("Kategorin finns inte.");
    setCategoryTarget(db, id, "leisure");
    expect(byPath(db).get("Husdjur")?.kind).toBe("item");
    setCategoryTarget(db, id, null);
    expect(byPath(db).get("Husdjur")?.kind).toBe("unmapped");
  });
});

describe("the fixed-expense mapping", () => {
  it("tells the home insurance from the car insurance by their fixed expenses", () => {
    const db = seeded();
    const home = expense(db, "Hemförsäkring");
    const car = expense(db, "Bilförsäkringen");
    expect(applyDefaultMapping(db)).toEqual({ categories: 0, expenses: 2 });
    expect(expenseMappings(db)).toEqual([
      { recurringExpenseId: car, name: "Bilförsäkringen", target: REFERENCE_NOT_INCLUDED },
      { recurringExpenseId: home, name: "Hemförsäkring", target: "home_insurance" },
    ]);
  });

  it("is set and removed like a category's", () => {
    const db = seeded();
    const id = expense(db, "Spotify");
    setExpenseTarget(db, id, "other_media");
    expect(expenseMappings(db)).toEqual([{ recurringExpenseId: id, name: "Spotify", target: "other_media" }]);
    expect(() => setExpenseTarget(db, id, "rent")).toThrow(MappingError);
    expect(() => setExpenseTarget(db, 9999, "other_media")).toThrow("Den fasta utgiften finns inte.");
    setExpenseTarget(db, id, null);
    expect(expenseMappings(db)).toEqual([]);
  });
});

describe("/api/reference-budget/mapping", () => {
  it("lists the mapping and changes one category at a time", async () => {
    const db = seeded();
    const app = createApp(db, { databasePath: ":memory:" });
    const id = db.insert(categories).values({ name: "Husdjur" }).returning().get().id;
    const before = await (await app.request("/api/reference-budget/mapping")).json();
    expect(before.categories.find((c: { categoryId: number }) => c.categoryId === id).kind).toBe("unmapped");
    const put = (target: unknown) =>
      app.request(`/api/reference-budget/mapping/categories/${id}`, { method: "PUT", body: JSON.stringify({ target }), headers: { "Content-Type": "application/json" } });
    const ok = await put("leisure");
    expect((await ok.json()).categories.find((c: { categoryId: number }) => c.categoryId === id).kind).toBe("item");
    const bad = await put("rent");
    expect(bad.status).toBe(400);
  });
});
