import type { FuelMonth, FuelOverview } from "../../api";

/** The consumption the estimates reckon with: this month's forecast's, else the calibrated or the table value as set. */
export function consumptionOf(data: FuelOverview): number {
  const s = data.settings;
  return data.current?.consumption ?? (s.useCalibrated && data.calibration ? data.calibration.l100 : s.baseConsumption);
}

/**
 * A month's 'Beräknat', öre: this month the forecast itself (today's price),
 * earlier months km × consumption × the price they were bought at, plus
 * congestion tax per shift. Null without km or a price.
 */
export function monthEstimate(m: FuelMonth, data: FuelOverview): number | null {
  if (m.month === data.today.slice(0, 7) && data.current) return data.current.expectedFuel + data.current.expectedCongestion;
  const price = m.price?.price ?? data.latestPrice?.price ?? null;
  if (m.km === null || !price) return null;
  return (m.km * consumptionOf(data) * price) / 100 + (m.shifts ?? 0) * data.settings.congestionPerShift;
}

export interface MonthPoint {
  month: string;
  estimate: number | null;
  spent: number;
  current: boolean;
}

/**
 * The months the chart and the table show, oldest first: a year back to
 * this month. The months after it (shifts entered ahead) come apart.
 */
export function shownMonths(data: FuelOverview): { past: FuelMonth[]; ahead: FuelMonth[]; points: MonthPoint[] } {
  const now = data.today.slice(0, 7);
  const sorted = [...data.months].sort((a, b) => a.month.localeCompare(b.month));
  const past = sorted.filter((m) => m.month <= now).slice(-13);
  const ahead = sorted.filter((m) => m.month > now);
  return { past, ahead, points: past.map((m) => ({ month: m.month, estimate: monthEstimate(m, data), spent: m.spent, current: m.month === now })) };
}

/**
 * 'Snitt 12 mån': over the finished months with shifts entered, at most the
 * last 12, what was bought and what was reckoned a month. Null without any.
 */
export function yearAverage(data: FuelOverview): { spent: number; estimate: number | null; months: number } | null {
  const now = data.today.slice(0, 7);
  const done = [...data.months]
    .filter((m) => m.month < now && m.shifts !== null)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
  if (done.length === 0) return null;
  const estimates = done.map((m) => monthEstimate(m, data)).filter((e): e is number => e !== null);
  return {
    spent: done.reduce((s, m) => s + m.spent, 0) / done.length,
    estimate: estimates.length ? estimates.reduce((s, e) => s + e, 0) / estimates.length : null,
    months: done.length,
  };
}
