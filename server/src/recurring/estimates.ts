import type { Db } from "../db/client.js";
import { categories } from "../db/schema.js";
import { categoryIdByKey } from "../db/seed.js";
import { salaryActuals, variableRows } from "../overview/overview.js";
import { addDays, addMonths, monthOf } from "../overview/dates.js";
import { getFuelSettings, monthForecast } from "../fuel/fuel.js";
import { getSetting, setSetting } from "../settings.js";
import { listPayslips, salaryForecasts } from "../salary/salary.js";

/**
 * Fasta utgifter › Uppskattat: what food and fuel cost a month, next to the
 * fixed expenses as if they were fixed too. Food is the household's average
 * for Livsmedel, Restaurang & café and Hämtmat over the last three whole
 * months, unless an amount is entered; fuel is
 * Pendling & bränsle's forecast for this month, else its average. My part is
 * the share that has been mine of each the last three months (food is part
 * shared groceries, part my own lunches), so it follows how we actually pay.
 * Shown only: the forecasts count food and fuel their own way.
 */

const MONTHS = 3;
const KEY = "expense_estimates";

export function setFoodEstimate(db: Db, amount: unknown): void {
  if (amount !== null && (!Number.isInteger(amount) || (amount as number) < 0)) throw new Error("Beloppet ska vara ett antal öre, eller tomt.");
  setSetting(db, KEY, { ...getSetting<Record<string, unknown>>(db, KEY, {}), food: amount });
}

/** The last three whole months' spending in some categories: household and my part, per month. */
function average(db: Db, today: string, match: (r: { categoryId: number | null; topId: number | null }) => boolean) {
  const from = `${addMonths(monthOf(today), -MONTHS)}-01`;
  const to = addDays(`${monthOf(today)}-01`, -1);
  // Per part, so half an Amazon order in Mat counts as food and the rest doesn't.
  const sum = (share: "mine" | "household") =>
    -variableRows(db, from, to, share).reduce((s, r) => s + r.parts.reduce((x, p) => (match(p) ? x + p.amount : x), 0), 0);
  const household = sum("household");
  const mine = sum("mine");
  return {
    from: monthOf(from),
    to: monthOf(to),
    household: Math.round(household / MONTHS),
    mine: Math.round(mine / MONTHS),
    // Rounded to whole per cent; all mine when there is nothing to go by.
    mineShare: household > 0 ? Math.round((mine / household) * 100) / 100 : 1,
  };
}

/** How many of the latest salaries the usual one is the average of. */
export const SALARY_MONTHS = 6;

/**
 * The salary I usually get: the average of the last six that came in (by the
 * month they were paid in), for 'kvar av lönen' next to the fixed expenses;
 * Lön's 'Snitt 12 mån' is the same over twelve. The gross beside it is the
 * payslip's for the same pay month, else the forecast's, averaged over the
 * months that have one (null when none has).
 */
export function usualSalary(db: Db, today: string, months = SALARY_MONTHS) {
  const got = [...salaryActuals(db)].filter(([m]) => m <= monthOf(today)).sort(([a], [b]) => a.localeCompare(b)).slice(-months);
  if (got.length === 0) return null;
  const slips = new Map(listPayslips(db).map((p) => [p.payDate.slice(0, 7), p.gross]));
  const forecasts = salaryForecasts(db);
  const grosses = got.map(([m]) => slips.get(m) ?? forecasts.get(m)?.gross).filter((g): g is number => g !== undefined);
  return {
    average: Math.round(got.reduce((s, [, r]) => s + r.amount, 0) / got.length),
    gross: grosses.length ? Math.round(grosses.reduce((s, g) => s + g, 0) / grosses.length) : null,
    count: got.length,
    from: got[0][0],
    to: got.at(-1)![0],
  };
}

export function expenseEstimates(db: Db, today: string) {
  // Mat: Livsmedel, Restaurang & café and Hämtmat (and anything under them); not Alkohol.
  const keys = (["groceries", "restaurants", "takeaway"] as const).map((k) => categoryIdByKey(db, k)).filter((id): id is number => id !== undefined);
  const foodIds = new Set([...keys, ...db.select({ id: categories.id, parentId: categories.parentId }).from(categories).all().filter((c) => c.parentId !== null && keys.includes(c.parentId)).map((c) => c.id)]);
  const food = average(db, today, (r) => r.categoryId !== null && foodIds.has(r.categoryId));
  // What is entered wins; without it, the average.
  const entered = getSetting<{ food?: number | null }>(db, KEY, {}).food ?? null;
  const foodAmount = entered ?? (food.household > 0 ? food.household : null);

  const fuelCategory = getFuelSettings(db).fuelCategoryId;
  const fuelAvg = average(db, today, (r) => fuelCategory !== null && r.categoryId === fuelCategory);
  const forecast = monthForecast(db, monthOf(today), today).forecast;
  const fuelAmount = forecast ? forecast.expectedFuel + forecast.expectedCongestion : fuelAvg.household || null;

  return {
    salary: usualSalary(db, today),
    food: {
      amount: foodAmount,
      mine: entered !== null ? Math.round(entered * food.mineShare) : foodAmount === null ? null : food.mine,
      source: entered !== null ? ("entered" as const) : foodAmount !== null ? ("average" as const) : null,
      average: food,
    },
    fuel: {
      amount: fuelAmount,
      mine: fuelAmount === null ? null : Math.round(fuelAmount * fuelAvg.mineShare),
      source: forecast ? ("forecast" as const) : fuelAmount ? ("average" as const) : null,
      shifts: forecast?.shifts ?? null,
      average: fuelAvg,
    },
  };
}
