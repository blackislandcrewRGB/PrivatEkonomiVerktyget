import { referenceBudgetYears } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { getHousehold } from "./household.js";

/**
 * Konsumentverket publishes next year's figures in the middle of November.
 * From the 15th, the year after is expected; before it, this year. The day
 * is a setting of the calendar, not of the data, and it lives here only.
 */
export const PUBLISH_DAY = "11-15";

/** The year that ought to be loaded on `today`. */
export function expectedReferenceYear(today: string): number {
  const year = Number(today.slice(0, 4));
  return today.slice(5) >= PUBLISH_DAY ? year + 1 : year;
}

/**
 * The year to add, when one is due and missing — or null. Only once the
 * comparison is in use (a household set up and a year loaded): a tool
 * nobody compares with has nothing to ask for.
 */
export function referenceYearDue(db: Db, today: string): { year: number; latest: number } | null {
  if (!getHousehold(db)) return null;
  const years = db.select({ year: referenceBudgetYears.year }).from(referenceBudgetYears).all().map((r) => r.year);
  if (years.length === 0) return null;
  const wanted = expectedReferenceYear(today);
  if (years.includes(wanted)) return null;
  return { year: wanted, latest: Math.max(...years) };
}
