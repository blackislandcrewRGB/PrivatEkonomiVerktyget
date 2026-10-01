import type { AnnualIncome, AnnualIncomeYear } from "../../api";
import { formatKr } from "../../lib/format";

/** To the nearest thousand kronor, as a forecast is said: '~360 000 kr'. */
export const approx = (ore: number) => formatKr(Math.round(ore / 100_000) * 100_000, { whole: true });

/** A change as a signed percent: '+27,9 %' (one decimal), '+28 %' (none). */
export function pct(fraction: number, digits = 1): string {
  const f = 10 ** digits;
  const v = Math.round(fraction * 100 * f) / f;
  const text = Math.abs(v).toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? "−" : v > 0 ? "+" : "±"}${text} %`;
}

/** A bar's amount as short as it reads under a column: '365k', '8,8k'. */
export function shortKr(ore: number): string {
  const k = Math.round(ore / 100 / 100) / 10;
  return `${k.toLocaleString("sv-SE", { maximumFractionDigits: k >= 100 ? 0 : 1 })}k`;
}

/** What this year is compared with: last year when it has a figure, else null (with the year missing). */
export function thisYearChange(data: AnnualIncome): { vs: number; year: AnnualIncomeYear } | { missing: number } | null {
  const current = data.years.at(-1);
  const before = data.years.at(-2);
  if (!current || !before) return null;
  if (before.amount === null) return { missing: before.year };
  return { vs: before.year, year: current };
}
