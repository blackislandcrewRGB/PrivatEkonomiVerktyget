import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { referenceBudgetItems, referenceBudgetYears } from "../db/schema.js";
import { getPartnerName, getSetting, setSetting } from "../settings.js";

/**
 * Vilka referensbudgeten räknas för: personerna i hushållet, var och en med
 * sin åldersgrupp och matvariant, och poster som inte gäller hushållet (vatten
 * och el som ingår i hyran, barnposter i ett hushåll utan barn).
 *
 * Kept in `settings`, like the other things the user decides. The age group
 * is chosen, not worked out from a birth date: no date of birth is stored.
 * An exact age is optional and only there for the footnotes (18–19, over 65).
 */

export type PersonRole = "me" | "partner" | "other";

export interface HouseholdPerson {
  role: PersonRole;
  /** Only for 'other'; 'me' is Jag and 'partner' takes the partner's name. */
  name?: string;
  /** An age-group key of the reference year ('25-50'). */
  ageGroup: string;
  /** The food item this person counts with, one of the items with choice 'food'. */
  food: string;
  /** Optional, only for the footnotes that go by exact age. */
  age?: number | null;
}

export interface ReferenceHousehold {
  persons: HouseholdPerson[];
  /** Item keys that do not apply to this household. */
  excluded: string[];
}

export class HouseholdError extends Error {}

const KEY = "reference_budget_household";

/** What a household may be set to: the latest loaded year's age groups, food variants and items. */
export interface HouseholdOptions {
  year: number;
  ageGroups: { key: string; label: string }[];
  food: { key: string; name: string }[];
  items: { key: string; name: string; scope: "individual" | "household" }[];
}

export function householdOptions(db: Db): HouseholdOptions | null {
  const latest = db.select().from(referenceBudgetYears).orderBy(desc(referenceBudgetYears.year)).get();
  if (!latest) return null;
  const items = db.select().from(referenceBudgetItems).where(eq(referenceBudgetItems.year, latest.year)).orderBy(asc(referenceBudgetItems.sortOrder)).all();
  return {
    year: latest.year,
    ageGroups: JSON.parse(latest.ageGroups) as { key: string; label: string }[],
    food: items.filter((i) => i.choice === "food").map((i) => ({ key: i.key, name: i.name })),
    items: items.map((i) => ({ key: i.key, name: i.name, scope: i.scope })),
  };
}

/** The household as saved, or null when it has not been set up. */
export function getHousehold(db: Db): ReferenceHousehold | null {
  return getSetting<ReferenceHousehold | null>(db, KEY, null);
}

/**
 * Checks a household against the latest reference year and saves it. Refused
 * rather than guessed: an age group or food variant the year doesn't have, an
 * excluded item that isn't an item, no 'me' or two, two partners.
 */
export function setHousehold(db: Db, input: unknown): ReferenceHousehold {
  const options = householdOptions(db);
  if (!options) throw new HouseholdError("Ingen referensbudget är inläst än.");
  const fail = (why: string): never => {
    throw new HouseholdError(why);
  };
  if (typeof input !== "object" || input === null) fail("Hushållet saknas.");
  const raw = input as { persons?: unknown; excluded?: unknown };
  if (!Array.isArray(raw.persons) || raw.persons.length === 0) fail("Hushållet behöver minst en person.");

  const ageKeys = new Set(options.ageGroups.map((g) => g.key));
  const foodKeys = new Set(options.food.map((f) => f.key));
  const persons: HouseholdPerson[] = (raw.persons as unknown[]).map((p, i) => {
    if (typeof p !== "object" || p === null) return fail(`Person ${i + 1} saknas.`);
    const x = p as Record<string, unknown>;
    if (x.role !== "me" && x.role !== "partner" && x.role !== "other") fail(`Person ${i + 1}: okänd roll.`);
    const role = x.role as PersonRole;
    const name = typeof x.name === "string" ? x.name.trim() : "";
    if (role === "other" && !name) fail(`Person ${i + 1} behöver ett namn.`);
    if (typeof x.ageGroup !== "string" || !ageKeys.has(x.ageGroup)) fail(`Person ${i + 1}: välj en åldersgrupp från ${options.year}.`);
    if (typeof x.food !== "string" || !foodKeys.has(x.food)) fail(`Person ${i + 1}: välj en matvariant.`);
    const age = x.age === undefined || x.age === null || x.age === "" ? null : x.age;
    if (age !== null && (!Number.isInteger(age) || (age as number) < 0 || (age as number) > 120)) fail(`Person ${i + 1}: åldern ska vara ett helt antal år.`);
    return { role, ...(role === "other" ? { name } : {}), ageGroup: x.ageGroup as string, food: x.food as string, age: age as number | null };
  });
  const count = (role: PersonRole) => persons.filter((p) => p.role === role).length;
  if (count("me") !== 1) fail("Hushållet ska ha exakt en person som är du.");
  if (count("partner") > 1) fail("Hushållet kan bara ha en partner.");

  const itemKeys = new Set(options.items.map((i) => i.key));
  if (raw.excluded !== undefined && !Array.isArray(raw.excluded)) fail("Exkluderade poster ska vara en lista.");
  const excluded = [...new Set((raw.excluded ?? []) as unknown[])].map((k) => {
    if (typeof k !== "string" || !itemKeys.has(k)) fail(`${String(k)} är ingen post i referensbudgeten.`);
    return k as string;
  });
  for (const p of persons) if (excluded.includes(p.food)) fail("Matvarianten en person räknas med kan inte exkluderas.");

  const household = { persons, excluded };
  setSetting(db, KEY, household);
  return household;
}

/** A person's name as shown: Jag, the partner's name, or their own. */
export function personName(db: Db, p: HouseholdPerson): string {
  return p.role === "me" ? "Jag" : p.role === "partner" ? getPartnerName(db) : (p.name ?? "");
}
