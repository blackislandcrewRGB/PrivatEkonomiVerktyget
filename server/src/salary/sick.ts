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
  /** How many sick periods start in the month: each has its karensavdrag in it. */
  karens: number;
  days: SickDay[];
}

/** What a work month has of sick leave: the hours, and the karensavdrag of the periods that start in it. */
export function sickOf(db: Db, month: string): SickMonth {
  const all = listSickDays(db);
  const days = all.filter((d) => d.date.startsWith(month));
  return { hours: days.reduce((s, d) => s + d.hours, 0), karens: sickPeriods(all).filter((p) => p.from.startsWith(month)).length, days };
}
