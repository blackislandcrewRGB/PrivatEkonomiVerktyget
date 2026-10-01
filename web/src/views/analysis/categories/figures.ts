import { lastDayOf } from "../common";
import type { CategoryData, Series } from "./types";

/**
 * The months that are whole: all but the last when the period ends before
 * that month does (the month so far, or a custom end in the middle of one).
 * The first month is always whole: the months are counted from its 1st.
 */
export function wholeMonths(months: string[], to: string): string[] {
  const last = months.at(-1);
  return last && to < lastDayOf(last) ? months.slice(0, -1) : months;
}

export const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export interface KeyFigures {
  /** The whole period, the month so far included (as the table). */
  total: number;
  /** Over the whole months only. */
  average: number;
  median: number;
  whole: number;
  /** The month left out of the average, if any. */
  partial: string | null;
  largest: { series: Series; sum: number; share: number } | null;
  /** The dearest whole month, and the category that made most of it. */
  dearest: { month: string; total: number; top: { series: Series; sum: number } | null } | null;
}

/** Per kategori's four key figures, from the same data as the table. */
export function keyFigures(data: CategoryData, to: string): KeyFigures {
  const whole = new Set(wholeMonths(data.months, to));
  const rows = data.data;
  const total = rows.reduce((s, d) => s + d.total, 0);
  const wholeRows = rows.filter((d) => whole.has(d.month));
  const totals = wholeRows.map((d) => d.total);
  const sums = data.series.map((series) => ({ series, sum: rows.reduce((s, d) => s + (d[series.key] ?? 0), 0) }));
  const largest = [...sums].sort((a, b) => b.sum - a.sum)[0];
  const dearestRow = [...wholeRows].sort((a, b) => b.total - a.total)[0];
  const top = dearestRow
    ? data.series.map((series) => ({ series, sum: dearestRow[series.key] ?? 0 })).sort((a, b) => b.sum - a.sum)[0]
    : undefined;
  return {
    total,
    average: totals.length ? Math.round(totals.reduce((s, v) => s + v, 0) / totals.length) : 0,
    median: median(totals),
    whole: totals.length,
    partial: rows.length > wholeRows.length ? (rows.at(-1)?.month ?? null) : null,
    largest: largest && largest.sum > 0 ? { ...largest, share: total > 0 ? largest.sum / total : 0 } : null,
    dearest: dearestRow ? { month: dearestRow.month, total: dearestRow.total, top: top && top.sum > 0 ? top : null } : null,
  };
}
