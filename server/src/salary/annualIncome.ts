import type { Db } from "../db/client.js";
import { payslips } from "../db/schema.js";
import { seriesByKey, pointsOf } from "../prices/series.js";
import { usualSalary } from "../recurring/estimates.js";
import { taxReturnsByYear } from "../taxReturns/taxReturns.js";
import { salaryForecasts } from "./salary.js";

/** The whole consumer price index (SCB, 2020=100), for the change in real terms. */
export const KPI_TOTAL = "kpi_total";

export interface AnnualIncomeYear {
  year: number;
  /** The bar: the declared salary (1.1), else twelve payslips' gross, else (this year) paid + forecast; null when the year has none. */
  amount: number | null;
  source: "declared" | "payslips" | "forecast" | null;
  /** 1.1 from the tax return. */
  declared: number | null;
  /** The gross of the payslips paid in the year, when all twelve are in. */
  payslips: number | null;
  /** Change from the year before: nominal, and in real terms when KPI is there for both (fractions). */
  change: { nominal: number; real: number | null } | null;
  /** KPI's average over the year (over the months published, this year), hundredths; null without it. */
  kpi: number | null;
}

export interface AnnualIncomeCurrent {
  year: number;
  /** Gross on the payslips paid so far this year. */
  paid: number;
  paidMonths: number;
  /** Months entered in Lön but not paid yet: their forecasts' gross. */
  forecast: number;
  forecastMonths: number;
  /** The months left with neither: each at the 12-month average gross. */
  estimated: number;
  remainingMonths: number;
  average: number | null;
  /** The monthly gross's standard deviation over the last twelve payslips. */
  deviation: number;
  /** paid + forecast + estimated, and the span of ± a standard deviation on each month left. */
  expected: number;
  low: number;
  high: number;
}

const round = (n: number) => Math.round(n);

/** A sample standard deviation (0 below two values). */
export function deviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

/** KPI's yearly averages from the whole index, by year (the months there are). */
function kpiByYear(db: Db): Map<number, number> {
  const series = seriesByKey(db, KPI_TOTAL);
  if (!series) return new Map();
  const sums = new Map<number, { s: number; n: number }>();
  for (const p of pointsOf(db, series)) {
    const y = Number(p.date.slice(0, 4));
    const a = sums.get(y) ?? { s: 0, n: 0 };
    sums.set(y, { s: a.s + p.value, n: a.n + 1 });
  }
  return new Map([...sums].map(([y, a]) => [y, round(a.s / a.n)]));
}

/**
 * Lön › Årsinkomst: a bar per income year from the tax returns (1.1), and
 * this year's in two parts: the payslips paid so far, and a forecast of the
 * rest (the months entered in Lön at their forecasts, the months left at the
 * 12-month average gross). The span is ± a standard deviation of the monthly
 * gross on each month left. A year with twelve payslips and no return shows
 * the payslips; with both, the difference is there to be seen.
 */
export function annualIncome(db: Db, today: string): { years: AnnualIncomeYear[]; current: AnnualIncomeCurrent } {
  const thisYear = Number(today.slice(0, 4));
  const returns = taxReturnsByYear(db);
  const slips = db
    .select({ payDate: payslips.payDate, gross: payslips.gross })
    .from(payslips)
    .all()
    .filter((p) => p.payDate <= today);
  const byYear = new Map<number, Map<string, number>>();
  for (const p of slips) {
    const y = Number(p.payDate.slice(0, 4));
    const months = byYear.get(y) ?? new Map<string, number>();
    months.set(p.payDate.slice(0, 7), (months.get(p.payDate.slice(0, 7)) ?? 0) + p.gross);
    byYear.set(y, months);
  }

  // This year, month by month.
  const forecasts = salaryForecasts(db);
  const paidMonths = byYear.get(thisYear) ?? new Map<string, number>();
  const recent = slips
    .sort((a, b) => a.payDate.localeCompare(b.payDate))
    .slice(-12)
    .map((p) => p.gross);
  const average = usualSalary(db, today, 12)?.gross ?? (recent.length ? round(recent.reduce((s, g) => s + g, 0) / recent.length) : null);
  let paid = 0;
  let forecast = 0;
  let forecastMonths = 0;
  let remainingMonths = 0;
  for (let m = 1; m <= 12; m++) {
    const month = `${thisYear}-${String(m).padStart(2, "0")}`;
    const slip = paidMonths.get(month);
    const f = forecasts.get(month);
    if (slip !== undefined) paid += slip;
    else if (f) {
      forecast += f.gross;
      forecastMonths++;
    } else remainingMonths++;
  }
  const sd = round(deviation(recent));
  const estimated = remainingMonths * (average ?? 0);
  const expected = paid + forecast + estimated;
  const current: AnnualIncomeCurrent = {
    year: thisYear,
    paid,
    paidMonths: paidMonths.size,
    forecast,
    forecastMonths,
    estimated,
    remainingMonths,
    average,
    deviation: sd,
    expected,
    low: expected - remainingMonths * sd,
    high: expected + remainingMonths * sd,
  };

  const kpi = kpiByYear(db);
  const first = Math.min(thisYear, ...returns.keys(), ...[...byYear].filter(([, m]) => m.size === 12).map(([y]) => y));
  const years: AnnualIncomeYear[] = [];
  for (let year = first; year <= thisYear; year++) {
    const declared = returns.get(year)?.boxes.employmentIncome ?? null;
    const months = byYear.get(year);
    const fromSlips = year < thisYear && months?.size === 12 ? [...months.values()].reduce((s, g) => s + g, 0) : null;
    const amount = declared ?? fromSlips ?? (year === thisYear ? expected : null);
    const before = years.at(-1);
    const k0 = kpi.get(year - 1);
    const k1 = kpi.get(year);
    const nominal = before?.amount && amount !== null ? amount / before.amount - 1 : null;
    years.push({
      year,
      amount,
      source: declared !== null ? "declared" : fromSlips !== null ? "payslips" : year === thisYear ? "forecast" : null,
      declared,
      payslips: fromSlips,
      change: nominal === null ? null : { nominal, real: k0 && k1 ? (1 + nominal) / (k1 / k0) - 1 : null },
      kpi: k1 ?? null,
    });
  }
  return { years, current };
}
