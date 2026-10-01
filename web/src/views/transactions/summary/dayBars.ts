import { lastDay } from "../filters";

export interface DayBar {
  date: string;
  day: number;
  /** Ut that day, öre, positive; 0 for a day without any. */
  ore: number;
  /** Of the month's largest day, 0–1. */
  share: number;
  today: boolean;
  /** Labelled under the bar: the 1st, every fifth day after it, and the last when it isn't crowded. */
  label: boolean;
}

/**
 * One bar per day of the month, from Ut per day (öre, negative, as the list's
 * totals give it). Scaled against the month's largest day, so the tallest bar
 * is full height; a day without Ut has share 0 (a grey stub).
 */
export function dayBars(month: string, outByDay: Record<string, number>, today: string): DayBar[] {
  const last = Number(lastDay(month).slice(8));
  const days = Array.from({ length: last }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { date, day: i + 1, ore: Math.max(0, -(outByDay[date] ?? 0)) };
  });
  const max = Math.max(0, ...days.map((d) => d.ore));
  return days.map((d) => ({
    ...d,
    share: max ? d.ore / max : 0,
    today: d.date === today,
    label: (d.day - 1) % 5 === 0 || (d.day === last && last - 26 >= 3),
  }));
}
