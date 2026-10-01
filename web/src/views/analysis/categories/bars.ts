import type { CategoryData, Series } from "./types";

/** A bar's total above it: '32,1k' from 1 000 kr, whole kronor below; nothing for none. */
export function totalLabel(ore: number): string {
  const kr = Math.round(ore / 100);
  if (kr === 0) return "";
  if (Math.abs(kr) < 1000) return String(kr);
  return `${(kr / 1000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
}

/**
 * Each category's share of a month's spending, 0–1, for the 'Andelar' bars
 * and the tooltip. A month's refunds (a category below zero) take no part:
 * the shares are of what was spent, so they add up to 1 whenever anything was.
 */
export function monthShares(row: CategoryData["data"][number], series: Series[]): Record<string, number> {
  const spent = series.map((s) => Math.max(0, row[s.key] ?? 0));
  const sum = spent.reduce((a, v) => a + v, 0);
  return Object.fromEntries(series.map((s, i) => [s.key, sum > 0 ? spent[i] / sum : 0]));
}

/** The data for the 'Andelar' bars: each category as its share of the month (refunds as nothing). */
export const shareRows = (data: CategoryData) =>
  data.data.map((row) => ({ ...monthShares(row, data.series), month: row.month, total: row.total }));

/** The series drawn on top in a month: its segment gets the rounded corners. */
export function topSeries(row: Record<string, number>, series: Series[]): string | null {
  for (let i = series.length - 1; i >= 0; i--) if ((row[series[i].key] ?? 0) > 0) return series[i].key;
  return null;
}
