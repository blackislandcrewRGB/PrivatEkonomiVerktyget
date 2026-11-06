import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sickDays } from "../db/schema.js";
import { isIsoDate } from "../import/text.js";

/**
 * Sick leave (Sjuklönelagen, what the employer's text says): the hours are
 * deducted at the hourly salary and paid back as sick pay at 80 % of it, and a
 * karensavdrag of 20 % of an average week's sick pay is made once per sick
 * period. A new sick day within five days of the last one continues the
 * period (it was Wednesday to Friday, then Monday afternoon: one period).
 * The sick pay ends after 14 days; that is not modelled.
 */

/** 80 % of the hourly salary is paid as sick pay. */
export const SICK_PAY_SHARE = 0.8;
/** The karensavdrag is 20 % of a week's sick pay. */
export const KARENS_SHARE = 0.2;
/** A sick day this many days or fewer after the last one is the same period. */
export const SAME_PERIOD_DAYS = 5;

export interface SickDay {
  date: string;
  hours: number;
}

export interface SickPeriod {
  from: string;
  to: string;
  days: SickDay[];
  hours: number;
}

export class SickError extends Error {}

export function listSickDays(db: Db): SickDay[] {
  return db.select().from(sickDays).orderBy(asc(sickDays.date)).all();
}

/** Sets the hours sick on a date (quarters of an hour, up to 24); null takes the day away. */
export function setSickDay(db: Db, date: string, hours: number | null): void {
  if (!isIsoDate(date)) throw new SickError("Datum ska vara ÅÅÅÅ-MM-DD.");
  if (hours === null) {
    db.delete(sickDays).where(eq(sickDays.date, date)).run();
    return;
  }
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0 || hours > 24 || Math.round(hours * 4) !== hours * 4) {
    throw new SickError("Sjuktimmarna ska vara mellan 0,25 och 24, i kvartar.");
  }
  db.insert(sickDays).values({ date, hours }).onConflictDoUpdate({ target: sickDays.date, set: { hours } }).run();
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The sick days grouped into periods: a day within five days of the last one continues it. */
export function sickPeriods(days: SickDay[]): SickPeriod[] {
  const out: SickPeriod[] = [];
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = out.at(-1);
    if (last && daysBetween(last.to, d.date) <= SAME_PERIOD_DAYS) {
      last.days.push(d);
      last.to = d.date;
      last.hours += d.hours;
    } else out.push({ from: d.date, to: d.date, days: [d], hours: d.hours });
  }
  return out;
}

export interface SickMonth {
  /** The month's sick hours. */
  hours: number;
  /** How many sick periods start in the month. */
  karens: number;
  days: SickDay[];
  /**
   * The periods with days in the month: their sick hours before it and in it.
   * The karensavdrag is made from a period's sick pay in date order, so a
   * period that began the month before takes what its days then didn't cover.
   */
  periods: { from: string; hoursBefore: number; hours: number }[];
}

/** What a work month has of sick leave: the hours, and the periods the karensavdrag is made from. */
export function sickOf(db: Db, month: string): SickMonth {
  const all = listSickDays(db);
  const days = all.filter((d) => d.date.startsWith(month));
  const periods = sickPeriods(all)
    .filter((p) => p.days.some((d) => d.date.startsWith(month)))
    .map((p) => ({
      from: p.from,
      hoursBefore: p.days.filter((d) => d.date < `${month}-01`).reduce((s, d) => s + d.hours, 0),
      hours: p.days.filter((d) => d.date.startsWith(month)).reduce((s, d) => s + d.hours, 0),
    }));
  return { hours: days.reduce((s, d) => s + d.hours, 0), karens: periods.filter((p) => p.from.startsWith(month)).length, days, periods };
}

/**
 * The sick hours added to the hours a month's shifts give. The shifts in
 * Pendling are the days driven, so a sick day is not among them, except a
 * day with a few hours off that was driven. With days marked there: the sick
 * days not marked are added. Without: a whole day (a shift's hours or more)
 * is added, a part day is in its shift.
 */
export function sickShiftExtra(days: SickDay[], marked: string[], shiftHours: number): number {
  const off = marked.length ? days.filter((d) => !marked.includes(d.date)) : days.filter((d) => d.hours >= shiftHours);
  return off.reduce((a, d) => a + d.hours, 0);
}
