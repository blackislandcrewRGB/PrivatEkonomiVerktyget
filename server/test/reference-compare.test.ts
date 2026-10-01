import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories, recurringExpenses, transactionSplits, transactions } from "../src/db/schema.js";
import { getCategoryPathMap, seed, seedContacts } from "../src/db/seed.js";
import { EXAMPLE_CONTACTS } from "../src/db/exampleHousehold.js";
import { average, compare, difference, loadYear, pickYear, referenceLines, windowOf, type Comparison } from "../src/referenceBudget/compare.js";
import { setHousehold, type ReferenceHousehold } from "../src/referenceBudget/household.js";
import { applyDefaultMapping } from "../src/referenceBudget/mapping.js";
import { freshDb } from "./helpers.js";

/**
 * Jämfört med Konsumentverket: the reference for a household, the rolling
 * averages, and the actual spending sorted onto the items. Figures are the
 * 2026 publication's, in öre.
 */

type Db = ReturnType<typeof freshDb>;

const OURS: ReferenceHousehold = {
  persons: [
    { role: "me", ageGroup: "25-50", food: "food_home", age: null },
    { role: "partner", ageGroup: "25-50", food: "food_home", age: null },
  ],
  excluded: ["water_sewage", "household_electricity", "child_insurance", "child_equipment"],
};

const year2026 = () => loadYear(freshDb(), 2026)!;
const lines = (household: ReferenceHousehold, share: "mine" | "household") => Object.fromEntries(referenceLines(year2026(), household, share).map((l) => [l.target, l.referenceOre]));

describe("the reference for a household", () => {
  it("is my own items and half the household's for Min del", () => {
    expect(lines(OURS, "mine")).toEqual({
      food: 273_000,
      clothing: 82_000,
      leisure: 60_000,
      mobile_phone: 13_000,
      hygiene: 59_000,
      child_insurance: 0,
      child_equipment: 0,
      consumables: 15_000,
      home_equipment: 51_500,
      internet_mobile_subscription: 61_500,
      other_media: 34_500,
      household_electricity: 0,
      water_sewage: 0,
      home_insurance: 8_500,
    });
  });

  it("is both persons' items and the whole household's for Hela hushållet", () => {
    expect(lines(OURS, "household")).toMatchObject({
      food: 546_000,
      clothing: 164_000,
      mobile_phone: 26_000,
      hygiene: 118_000,
      consumables: 30_000,
      home_equipment: 103_000,
      internet_mobile_subscription: 123_000,
      home_insurance: 17_000,
    });
  });

  it("keeps an excluded item as a line at 0, marked", () => {
    const water = referenceLines(year2026(), OURS, "household").find((l) => l.target === "water_sewage")!;
    expect(water).toMatchObject({ referenceOre: 0, excluded: true, scope: "household" });
    const all = referenceLines(year2026(), { ...OURS, excluded: [] }, "household").find((l) => l.target === "water_sewage")!;
    expect(all).toMatchObject({ referenceOre: 44_000, excluded: false });
  });

  it("counts each person's own food variant, as one line", () => {
    const mixed = { ...OURS, persons: [OURS.persons[0], { ...OURS.persons[1], food: "food_home_no_weekday_lunch" }] };
    const food = referenceLines(year2026(), mixed, "household", (p) => (p.role === "me" ? "Jag" : "Mio")).filter((l) => l.target === "food");
    expect(food).toEqual([
      { target: "food", name: "Livsmedel", scope: "individual", referenceOre: 273_000 + 212_000, excluded: false, basis: "Jag all mat lagas hemma · Mio utom lunch på vardagar", kpi: "01" },
    ]);
  });

  it("gives a household of one its household items whole", () => {
    const alone = { persons: [OURS.persons[0]], excluded: [] };
    expect(lines(alone, "mine")).toMatchObject({ consumables: 20_000, home_equipment: 92_000, home_insurance: 15_000 });
  });

  it("counts a child in the household's size and in Hela hushållet only", () => {
    const withChild: ReferenceHousehold = { persons: [...OURS.persons, { role: "other", name: "Kim", ageGroup: "4-6", food: "food_home", age: null }], excluded: [] };
    const mine = lines(withChild, "mine");
    const all = lines(withChild, "household");
    expect(mine.food).toBe(273_000);
    expect(all.food).toBe(273_000 * 2 + 171_000);
    expect(all.child_insurance).toBe(23_000);
    // Three persons, and a child under 8: 1 460 − 229 kr, my half of it for Min del.
    expect(all.internet_mobile_subscription).toBe(146_000 - 22_900);
    expect(mine.internet_mobile_subscription).toBe((146_000 - 22_900) / 2);
    // A mobile phone only from 8 years: no cell for 4–6, so nothing for the child.
    expect(all.mobile_phone).toBe(26_000);
  });

  it("applies the footnotes that go by age only when the age is given", () => {
    const at = (age: number | null, ageGroup = "18-24") => lines({ persons: [{ role: "me", ageGroup, food: "food_home", age }], excluded: [] }, "mine").hygiene;
    expect(at(null)).toBe(57_000);
    expect(at(19)).toBe(57_000 - 3_500);
    expect(at(20)).toBe(57_000);
    expect(at(65, "51-70")).toBe(58_000);
    expect(at(66, "51-70")).toBe(58_000 - 2_500);
    // A child of 7–10 is under 8 only with an age that says so.
    const child = (age: number | null): ReferenceHousehold => ({ persons: [OURS.persons[0], { role: "other", name: "Kim", ageGroup: "7-10", food: "food_home", age }], excluded: [] });
    expect(lines(child(null), "household").internet_mobile_subscription).toBe(123_000);
    expect(lines(child(7), "household").internet_mobile_subscription).toBe(123_000 - 22_900);
  });
});

describe("the reference year", () => {
  it("is the period's year, else the latest before it, else the earliest there is", () => {
    expect(pickYear([2026], "2026-08")).toEqual({ year: 2026, wanted: 2026, fallback: null });
    expect(pickYear([2025, 2026], "2027-03")).toEqual({ year: 2026, wanted: 2027, fallback: "earlier" });
    expect(pickYear([2026, 2027], "2025-12")).toEqual({ year: 2026, wanted: 2025, fallback: "later" });
    expect(pickYear([], "2026-08")).toBeNull();
  });
});

describe("rolling averages", () => {
  const monthly = new Map([
    ["2026-06", 90_000],
    ["2026-07", 0],
    ["2026-08", 10_001],
  ]);

  it("divide by the months the data reaches, rounded to the öre once", () => {
    const w3 = windowOf("2026-08", 3, "2024-08");
    expect(w3).toEqual({ from: "2026-06", to: "2026-08", counted: 3 });
    expect(average(monthly, w3)).toBe(33_334);
    // Twelve months back from August, with data only from June: three months count.
    const w12 = windowOf("2026-08", 12, "2026-06");
    expect(w12).toEqual({ from: "2025-09", to: "2026-08", counted: 3 });
    expect(average(monthly, w12)).toBe(33_334);
    expect(average(monthly, windowOf("2026-08", 12, "2026-09"))).toBeNull();
  });

  it("say the difference in kronor and per cent, and no per cent against nothing", () => {
    expect(difference(60_000, 50_000)).toEqual({ ore: 10_000, pct: 20 });
    expect(difference(33_334, 100_000)).toEqual({ ore: -66_666, pct: -66.7 });
    expect(difference(5_000, 0)).toEqual({ ore: 5_000, pct: null });
    expect(difference(null, 5_000)).toEqual({ ore: null, pct: null });
  });
});

describe("compare", () => {
  let seq = 0;
  const row = (db: Db, date: string, amount: number, category: string | null, extra: Partial<typeof transactions.$inferInsert> = {}) => {
    const id = category === null ? null : getCategoryPathMap(db).get(category)!;
    return db
      .insert(transactions)
      .values({ source: "manual", bookingDate: date, descriptionRaw: "x", descriptionClean: "x", amount, categoryId: id, fingerprint: `f${++seq}`, occurrenceIndex: 1, ...extra })
      .returning()
      .get().id;
  };
  const setup = () => {
    const db = freshDb();
    seed(db);
    // The partner is a contact, so she is named after it.
    seedContacts(db, EXAMPLE_CONTACTS);
    setHousehold(db, OURS);
    return db;
  };
  const item = (c: Comparison, target: string) => c.items.find((i) => i.target === target)!;
  const run = (db: Db, share: "mine" | "household", through = "2026-08") => {
    const r = compare(db, through, share);
    if (!r.ok) throw new Error(r.reason);
    return r.comparison;
  };

  it("says what is missing before it can compare", () => {
    const db = freshDb();
    seed(db);
    expect(compare(db, "2026-08", "mine")).toEqual({ ok: false, reason: "no_household" });
  });

  it("counts my part as Översikten does, including what the partner paid", () => {
    const db = setup();
    row(db, "2026-08-02", -100_000, "Mat/Livsmedel", { shared: true });
    row(db, "2026-08-03", -60_000, "Mat/Livsmedel", { shared: true, paidBy: "partner", accountId: null });
    row(db, "2026-08-04", -30_000, "Prylar & hem/Kläder", { forOther: true });
    row(db, "2026-08-05", -12_000, "Prylar & hem/Kläder", { forOther: true, paidBy: "partner", accountId: null });
    row(db, "2026-08-06", 2_000, "Mat/Livsmedel"); // a refund
    const mine = run(db, "mine");
    expect(mine.months3).toEqual({ from: "2026-06", to: "2026-08", counted: 1 });
    // (1 000 + 600) / 2 − 20 kr refund.
    expect(item(mine, "food").actual3Ore).toBe(78_000);
    // Hers that I paid: not mine. Mine that she paid: all mine.
    expect(item(mine, "clothing").actual3Ore).toBe(12_000);
    const all = run(db, "household");
    expect(item(all, "food").actual3Ore).toBe(158_000);
    expect(item(all, "clothing").actual3Ore).toBe(42_000);
  });

  it("sends each part of a split purchase to its own item", () => {
    const db = setup();
    const id = row(db, "2026-08-10", -50_000, "Mat/Livsmedel");
    const cat = (p: string) => getCategoryPathMap(db).get(p)!;
    db.insert(transactionSplits).values([
      { transactionId: id, categoryId: cat("Mat/Livsmedel"), amount: -35_000, sort: 0 },
      { transactionId: id, categoryId: cat("Boende/Hem & hushåll"), amount: -15_000, sort: 1 },
    ]).run();
    const c = run(db, "household");
    expect(item(c, "food").actual3Ore).toBe(35_000);
    expect(item(c, "home_equipment").actual3Ore).toBe(15_000);
  });

  it("lets a fixed expense decide over its rows' category", () => {
    const db = setup();
    const expense = (name: string) => db.insert(recurringExpenses).values({ name, amount: 24_200, paymentMethod: "autogiro" }).returning().get().id;
    const home = expense("Hemförsäkring");
    const car = expense("Bilförsäkringen");
    applyDefaultMapping(db);
    row(db, "2026-08-28", -24_200, "Försäkring", { recurringExpenseId: home });
    row(db, "2026-08-28", -47_600, "Försäkring", { recurringExpenseId: car });
    row(db, "2026-08-15", -10_000, "Försäkring");
    const c = run(db, "household");
    expect(item(c, "home_insurance").actual3Ore).toBe(24_200);
    expect(item(c, "home_insurance").sources).toEqual(["Hemförsäkring (fast utgift)"]);
    expect(c.notIncluded.actual3Ore).toBe(47_600 + 10_000);
  });

  it("keeps income, transfers and settlement out, and lists what has no mapping", () => {
    const db = setup();
    row(db, "2026-08-25", 2_500_000, "Inkomst/Lön");
    row(db, "2026-08-25", -500_000, "Överföringar & sparande/Sparande", { isTransfer: true });
    row(db, "2026-08-26", -400_000, "Till partner");
    row(db, "2026-08-27", -1_000, null);
    const pets = db.insert(categories).values({ name: "Husdjur" }).returning().get().id;
    db.insert(transactions).values({ source: "manual", bookingDate: "2026-08-20", descriptionRaw: "x", descriptionClean: "x", amount: -36_000, categoryId: pets, fingerprint: "pets", occurrenceIndex: 1 }).run();
    const c = run(db, "household");
    expect(c.total.actual12Ore).toBe(0);
    expect(c.notIncluded.actual12Ore).toBe(0);
    expect(c.unmapped).toEqual([
      { path: "Husdjur", actual12Ore: 36_000 },
      { path: "Utan kategori", actual12Ore: 1_000 },
    ]);
  });

  it("averages the last 12 and 3 whole months, from the first month there is data", () => {
    const db = setup();
    row(db, "2025-11-15", -120_000, "Prylar & hem/Kläder");
    row(db, "2026-08-15", -30_000, "Prylar & hem/Kläder");
    const c = run(db, "mine");
    expect(c.months12).toEqual({ from: "2025-09", to: "2026-08", counted: 10 });
    expect(item(c, "clothing").actual12Ore).toBe(15_000);
    expect(item(c, "clothing").actual3Ore).toBe(10_000);
    expect(item(c, "clothing").diff12).toEqual({ ore: 15_000 - 82_000, pct: -81.7 });
    // The series ends at the month compared through, and a month before any data has no average.
    expect(c.series.at(-1)).toMatchObject({ month: "2026-08", rolling12: { clothing: 15_000 }, rolling3: { clothing: 10_000 } });
    expect(c.series[0]).toMatchObject({ month: "2025-09", rolling12: { clothing: null } });
  });

  it("shows food, consumables and hygiene together, and a total over what is included", () => {
    const db = setup();
    row(db, "2026-08-02", -300_000, "Mat/Livsmedel");
    row(db, "2026-08-03", -20_000, "Nöje/Streaming");
    const c = run(db, "mine");
    expect(c.groceries).toMatchObject({ targets: ["food", "consumables", "hygiene"], referenceOre: 273_000 + 15_000 + 59_000, actual3Ore: 300_000 });
    const included = c.items.filter((i) => !i.excluded).reduce((s, i) => s + i.referenceOre, 0);
    expect(c.total).toMatchObject({ referenceOre: included, actual3Ore: 320_000 });
  });

  it("uses the latest earlier year when the period's own is missing, and says so", () => {
    const db = setup();
    const c = run(db, "mine", "2027-03");
    expect(c.year).toBe(2026);
    expect(c.fallback).toEqual({ wanted: 2027, direction: "earlier" });
    expect(run(db, "mine").fallback).toBeNull();
  });

  it("names the persons and what is left out", () => {
    const c = run(setup(), "household");
    expect(c.persons).toEqual([
      { name: "Jag", ageGroup: "25–50 år", food: "Livsmedel, all mat lagas hemma", age: null },
      { name: "Mio", ageGroup: "25–50 år", food: "Livsmedel, all mat lagas hemma", age: null },
    ]);
    expect(c.excluded.map((e) => e.name)).toEqual(["Vatten och avlopp", "Hushållsel", "Barn- och ungdomsförsäkring", "Övrig barnutrustning"]);
    expect(item(c, "clothing").sources).toEqual(["Prylar & hem › Kläder"]);
  });

  it("follows a category's mapping by id, whatever it is called", () => {
    const db = setup();
    const id = getCategoryPathMap(db).get("Prylar & hem/Kläder")!;
    db.update(categories).set({ name: "Kläder & skor" }).where(eq(categories.id, id)).run();
    row(db, "2026-08-04", -50_000, "Prylar & hem/Kläder & skor");
    expect(item(run(db, "mine"), "clothing").actual3Ore).toBe(50_000);
  });
});
