import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { referenceBudgetAdjustments, referenceBudgetAmounts, referenceBudgetItems, referenceBudgetYears } from "../src/db/schema.js";
import { REFERENCE_BUDGET_DIR, parseReferenceBudget, syncReferenceBudgets, type ReferenceBudgetFile } from "../src/referenceBudget/load.js";
import { freshDb } from "./helpers.js";

/**
 * Konsumentverkets referensbudget: the year files and how they reach the
 * database. Every year file is checked against the publication's own totals
 * — which are deliberately not stored — so a misread cell fails here rather
 * than in a comparison months later.
 */

type Db = ReturnType<typeof freshDb>;

const FILE_2026 = fs.readFileSync(path.join(REFERENCE_BUDGET_DIR, "2026.json"), "utf8");
const AGE_GROUPS = ["0", "1-3", "4-6", "7-10", "11-14", "15-17", "18-24", "25-50", "51-70", "71+"];

/**
 * The publication's own 'summa kostnader', kr/month, per year: the other
 * individual costs (everything but food) per age group in the file's order,
 * and the household's shared costs per household size. Kept here, never in
 * the database — they are the check that every cell was read right. A new
 * year file needs its line here, or the test says so.
 */
const PUBLISHED_TOTALS: Record<number, { individual: number[]; household: number[] }> = {
  2026: { individual: [2920, 2730, 2000, 2090, 2070, 2390, 2200, 2140, 2070, 1940], household: [3530, 4390, 5500, 6530, 7510, 8410, 9330] },
};
const YEAR_FILES = fs.readdirSync(REFERENCE_BUDGET_DIR).filter((f) => /^\d{4}\.json$/.test(f));

const amount = (db: Db, year: number, itemKey: string, bracket: string) =>
  db
    .select()
    .from(referenceBudgetAmounts)
    .where(and(eq(referenceBudgetAmounts.year, year), eq(referenceBudgetAmounts.itemKey, itemKey), eq(referenceBudgetAmounts.bracket, bracket)))
    .get()?.amountOre;

/** A clean database with nothing loaded yet, and a folder of year files to load from. */
const dirs: string[] = [];
function folder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "referensbudget-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const emptyDb = () => {
  const db = freshDb();
  db.delete(referenceBudgetAdjustments).run();
  db.delete(referenceBudgetAmounts).run();
  db.delete(referenceBudgetItems).run();
  db.delete(referenceBudgetYears).run();
  return db;
};

const edited = (patch: (f: ReferenceBudgetFile) => void) => {
  const f = JSON.parse(FILE_2026) as ReferenceBudgetFile;
  patch(f);
  return JSON.stringify(f, null, 2);
};

describe("the year files", () => {
  it.each(YEAR_FILES)("%s adds up to the publication's own totals, item by item", (name) => {
    const file = parseReferenceBudget(fs.readFileSync(path.join(REFERENCE_BUDGET_DIR, name), "utf8"), name);
    const published = PUBLISHED_TOTALS[file.year];
    if (!published) throw new Error(`Lägg till summaraderna för ${file.year} i PUBLISHED_TOTALS, så kontrolleras ${name} mot PDF:en.`);
    // The food variants are their own table in the publication, outside this total.
    const individual = file.items.filter((i) => i.scope === "individual" && !i.choice);
    file.ageGroups.forEach((group, i) => {
      const sum = individual.reduce((s, it) => s + (it.amounts[group.key] ?? 0), 0);
      expect({ group: group.key, sum }).toEqual({ group: group.key, sum: published.individual[i] });
    });
    const household = file.items.filter((i) => i.scope === "household");
    file.householdSizes.forEach((size, i) => {
      const sum = household.reduce((s, it) => s + (it.amounts[String(size)] ?? 0), 0);
      expect({ size, sum }).toEqual({ size, sum: published.household[i] });
    });
  });

  it("has the mobile phone from 8 years, where the PDF puts it", () => {
    const phone = parseReferenceBudget(FILE_2026).items.find((i) => i.key === "mobile_phone")!;
    expect(phone.amounts).toEqual({ "7-10": 80, "11-14": 80, "15-17": 130, "18-24": 130, "25-50": 130, "51-70": 110, "71+": 110 });
  });

  it("is loaded into a new database, in öre, with empty cells left out", () => {
    const db = freshDb();
    // Every file in the folder is loaded; later years join 2026 as they are added.
    expect(db.select().from(referenceBudgetYears).all().map((y) => y.year)).toContain(2026);
    expect(db.select().from(referenceBudgetItems).where(eq(referenceBudgetItems.year, 2026)).all()).toHaveLength(15);
    expect(amount(db, 2026, "food_home", "25-50")).toBe(273_000);
    expect(amount(db, 2026, "food_home_no_weekday_lunch", "25-50")).toBe(212_000);
    expect(amount(db, 2026, "internet_mobile_subscription", "2")).toBe(123_000);
    // An empty cell is no row, not a zero.
    expect(amount(db, 2026, "mobile_phone", "0")).toBeUndefined();
    expect(amount(db, 2026, "child_equipment", "25-50")).toBeUndefined();
    const food = db.select().from(referenceBudgetItems).where(eq(referenceBudgetItems.choice, "food")).all();
    expect(food.map((f) => f.key).sort()).toEqual(["food_home", "food_home_no_weekday_lunch"]);
    expect(db.select().from(referenceBudgetAdjustments).all().map((a) => [a.itemKey, a.condition, a.amountOre])).toEqual([
      ["internet_mobile_subscription", "child_under_8", -22_900],
      ["hygiene", "age_18_19", -3_500],
      ["hygiene", "age_over_65", -2_500],
    ]);
    const year = db.select().from(referenceBudgetYears).get()!;
    expect(JSON.parse(year.ageGroups).map((g: { key: string }) => g.key)).toEqual(AGE_GROUPS);
    expect(JSON.parse(year.householdSizes)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(year.sourceUrl).toContain("kostnadsberakningar-hushallskostnader-2026");
  });
});

describe("syncReferenceBudgets", () => {
  it("adds a new year, and leaves an unchanged one alone", () => {
    const db = emptyDb();
    const dir = folder({ "2026.json": FILE_2026 });
    expect(syncReferenceBudgets(db, dir)).toEqual({ loaded: [{ year: 2026, replaced: false }], unchanged: [], errors: [], withoutFile: [] });
    const loadedAt = db.select().from(referenceBudgetYears).get()!.loadedAt;
    expect(syncReferenceBudgets(db, dir)).toEqual({ loaded: [], unchanged: [2026], errors: [], withoutFile: [] });
    expect(db.select().from(referenceBudgetYears).get()!.loadedAt).toBe(loadedAt);
  });

  it("lets a changed file win, and replaces the year whole", () => {
    const db = emptyDb();
    syncReferenceBudgets(db, folder({ "2026.json": FILE_2026 }));
    const fixed = edited((f) => {
      f.items.find((i) => i.key === "clothing")!.amounts["25-50"] = 830;
      // An item taken out goes, amounts and all.
      f.items = f.items.filter((i) => i.key !== "child_equipment");
    });
    expect(syncReferenceBudgets(db, folder({ "2026.json": fixed })).loaded).toEqual([{ year: 2026, replaced: true }]);
    expect(amount(db, 2026, "clothing", "25-50")).toBe(83_000);
    expect(amount(db, 2026, "child_equipment", "0")).toBeUndefined();
    expect(db.select().from(referenceBudgetItems).all()).toHaveLength(14);
  });

  it("keeps the year as it was when its new file is broken, and loads the others", () => {
    const db = emptyDb();
    syncReferenceBudgets(db, folder({ "2026.json": FILE_2026 }));
    const broken = edited((f) => {
      f.items.find((i) => i.key === "clothing")!.amounts["25-50"] = 820.5;
    });
    const next = edited((f) => {
      f.year = 2027;
    });
    const r = syncReferenceBudgets(db, folder({ "2026.json": broken, "2027.json": next }));
    expect(r.errors).toEqual(["2026.json: clothing 25-50: beloppet ska vara hela kronor, 0 eller mer"]);
    expect(r.loaded).toEqual([{ year: 2027, replaced: false }]);
    expect(r.withoutFile).toEqual([]);
    expect(amount(db, 2026, "clothing", "25-50")).toBe(82_000);
  });

  it("refuses a file whose name and year disagree", () => {
    const db = emptyDb();
    const r = syncReferenceBudgets(db, folder({ "2027.json": FILE_2026 }));
    expect(r.errors).toEqual(["2027.json: filen säger år 2026"]);
    expect(db.select().from(referenceBudgetYears).all()).toEqual([]);
  });

  it("never deletes a year that has lost its file, only says so", () => {
    const db = emptyDb();
    syncReferenceBudgets(db, folder({ "2026.json": FILE_2026 }));
    expect(syncReferenceBudgets(db, folder({ "notes.txt": "x" })).withoutFile).toEqual([2026]);
    expect(amount(db, 2026, "food_home", "25-50")).toBe(273_000);
  });
});

describe("parseReferenceBudget", () => {
  const refused = (patch: (f: ReferenceBudgetFile) => void) => () => parseReferenceBudget(edited(patch), "x.json");

  it("refuses an age group or household size the file does not declare", () => {
    expect(refused((f) => void (f.items[0].amounts["26-50"] = 1))).toThrow("x.json: food_home: 26-50 är ingen åldersgrupp i filen");
    expect(refused((f) => void (f.items.find((i) => i.key === "consumables")!.amounts["8"] = 1))).toThrow("consumables: 8 är ingen hushållsstorlek i filen");
  });

  it("refuses the same item twice, an unknown scope, and a negative amount", () => {
    expect(refused((f) => void f.items.push({ ...f.items[0] }))).toThrow("posten food_home finns två gånger");
    expect(refused((f) => void (f.items[0].scope = "person" as never))).toThrow("food_home: scope ska vara individual eller household");
    expect(refused((f) => void (f.items[0].amounts["0"] = -1))).toThrow("food_home 0: beloppet ska vara hela kronor, 0 eller mer");
  });

  it("refuses a footnote the calculation would not understand, or one on an item that isn't there", () => {
    expect(refused((f) => void (f.adjustments![0].condition = "student" as never))).toThrow("villkoret student känns inte igen");
    expect(refused((f) => void (f.adjustments![0].item = "rent"))).toThrow("justeringen gäller rent, som inte är en post i filen");
  });

  it("refuses what isn't JSON", () => {
    expect(() => parseReferenceBudget("{", "2026.json")).toThrow(/^2026\.json: inte giltig JSON/);
  });
});
