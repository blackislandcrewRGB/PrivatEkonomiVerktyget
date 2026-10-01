import type { Db } from "../db/client.js";
import { addMonths, monthOf } from "../overview/dates.js";
import { getSetting, setSetting } from "../settings.js";
import { scheduleDeadline } from "./agreement.js";
import { getSalarySettings } from "./salary.js";

/**
 * Schemadeadline: the day each month's work schedule is due at the latest
 * (the settings' notice in days, see scheduleDeadline), shown in the calendars as a 'Jobb' event, and
 * whether it has been received. A rule, not data: nothing is stored but the
 * months ticked off as received.
 */

const RECEIVED = "work_schedule_received";
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

export interface ScheduleDeadline {
  /** The day it is due at the latest. */
  date: string;
  /** The month the schedule covers (YYYY-MM). */
  month: string;
  name: string;
  received: boolean;
}

export const receivedSchedules = (db: Db): string[] => getSetting<string[]>(db, RECEIVED, []);

/** The deadlines falling from `from` to `to` (dates), in order. */
export function scheduleDeadlines(db: Db, from: string, to: string): ScheduleDeadline[] {
  const notice = getSalarySettings(db).scheduleNoticeDays;
  if (notice === null) return [];
  const received = new Set(receivedSchedules(db));
  const out: ScheduleDeadline[] = [];
  // A month's deadline is in the month before it.
  for (let month = addMonths(monthOf(from), 1); month <= addMonths(monthOf(to), 1); month = addMonths(month, 1)) {
    const date = scheduleDeadline(month, notice);
    if (date < from || date > to) continue;
    out.push({ date, month, name: `Schemadeadline: schema för ${MONTHS[Number(month.slice(5, 7)) - 1]} ska vara mottaget`, received: received.has(month) });
  }
  return out;
}

/** Ticks a month's schedule off as received (or undoes it). Returns the months received. */
export function setScheduleReceived(db: Db, month: string, received: boolean): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Månaden ska vara ÅÅÅÅ-MM.");
  const months = new Set(receivedSchedules(db));
  if (received) months.add(month);
  else months.delete(month);
  const list = [...months].sort();
  setSetting(db, RECEIVED, list);
  return list;
}
