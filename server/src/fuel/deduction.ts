import type { Db } from "../db/client.js";
import { taxReturnsByYear } from "../taxReturns/taxReturns.js";
import { workShiftDays } from "../db/schema.js";
import { getSetting, setSetting } from "../settings.js";
import { FuelError, getFuelSettings, shiftsByMonth } from "./fuel.js";

/**
 * Reseavdrag (travel to and from work in my own car): per income year
 * shifts × the distance of a shift in Swedish miles (Bil's km per shift / 10,
 * e.g. 4,0 mil) × the flat rate per mil (25 kr for my own car), less the year's
 * threshold (11 000 kr for 2025, 15 000 kr for 2026). The tax it saves is the
 * deduction × my marginal tax. The shifts per month (and the days, where
 * marked) are what the tax return is based on.
 */

export interface DeductionSettings {
  /** Öre per Swedish mil (10 km). */
  ratePerMil: number;
  /** Per income year ('2026'), öre. */
  thresholds: Record<string, number>;
  /** 0–1. */
  marginalTax: number;
}

export const DEDUCTION_DEFAULTS: DeductionSettings = {
  ratePerMil: 2500,
  thresholds: { "2025": 1_100_000, "2026": 1_500_000 },
  marginalTax: 0.32,
};

/** The conditions: the deduction is allowed only when both hold. */
export const MIN_ONE_WAY_KM = 5;
export const MIN_TIME_SAVED_HOURS = 2;

const KEY = "commute_deduction";

export function getDeductionSettings(db: Db): DeductionSettings {
  const s = getSetting<Partial<DeductionSettings>>(db, KEY, {});
  return { ...DEDUCTION_DEFAULTS, ...s, thresholds: { ...DEDUCTION_DEFAULTS.thresholds, ...(s.thresholds ?? {}) } };
}

export function setDeductionSettings(db: Db, patch: Record<string, unknown>): DeductionSettings {
  const next = getDeductionSettings(db);
  if (patch.ratePerMil !== undefined) {
    if (!Number.isInteger(patch.ratePerMil) || (patch.ratePerMil as number) <= 0) throw new FuelError("Schablonen ska vara ett antal öre per mil.");
    next.ratePerMil = patch.ratePerMil as number;
  }
  if (patch.marginalTax !== undefined) {
    const v = patch.marginalTax as number;
    if (typeof v !== "number" || !(v >= 0 && v < 1)) throw new FuelError("Marginalskatten ska vara mellan 0 och 100 %.");
    next.marginalTax = v;
  }
  if (patch.thresholds !== undefined) {
    if (!patch.thresholds || typeof patch.thresholds !== "object") throw new FuelError("Trösklarna ska vara per år.");
    for (const [year, ore] of Object.entries(patch.thresholds as Record<string, unknown>)) {
      if (!/^\d{4}$/.test(year)) throw new FuelError(`Ogiltigt år: ${year}`);
      if (!Number.isInteger(ore) || (ore as number) < 0) throw new FuelError(`Tröskeln för ${year} ska vara ett antal öre.`);
      next.thresholds[year] = ore as number;
    }
  }
  setSetting(db, KEY, next);
  return next;
}

/** A year's threshold: its own, else the latest earlier year's (the amount holds until changed), else the earliest known. */
export function thresholdFor(s: DeductionSettings, year: string): { amount: number; from: string } | null {
  const years = Object.keys(s.thresholds).sort();
  const y = years.filter((x) => x <= year).at(-1) ?? years[0];
  return y ? { amount: s.thresholds[y], from: y } : null;
}

export interface DeductionYear {
  year: string;
  shifts: number;
  /** One shift, both ways, in Swedish mil. */
  milPerShift: number;
  /** shifts × mil × rate, öre. */
  gross: number;
  threshold: number;
  /** The year whose threshold applies (the same year, unless it has none of its own). */
  thresholdYear: string | null;
  deductible: number;
  taxEffect: number;
  /** Shifts needed before anything is deductible. */
  shiftsToThreshold: number;
  months: { month: string; shifts: number; days: string[] }[];
}

export function deductionYears(db: Db, today: string) {
  const s = getDeductionSettings(db);
  const car = getFuelSettings(db);
  const milPerShift = car.kmPerShift / 10;
  const perShift = milPerShift * s.ratePerMil;
  const shifts = shiftsByMonth(db);
  const days = db.select().from(workShiftDays).all().map((d) => d.date);
  const years = [...new Set([...[...shifts.keys()].map((m) => m.slice(0, 4)), today.slice(0, 4)])].sort().reverse();
  const out: DeductionYear[] = years.map((year) => {
    const months = [...shifts.entries()]
      .filter(([m]) => m.startsWith(year))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, n]) => ({ month, shifts: n, days: days.filter((d) => d.startsWith(month)).sort() }));
    const total = months.reduce((a, m) => a + m.shifts, 0);
    const t = thresholdFor(s, year);
    const gross = Math.round(total * perShift);
    const deductible = Math.max(0, gross - (t?.amount ?? 0));
    return {
      year,
      shifts: total,
      milPerShift,
      gross,
      threshold: t?.amount ?? 0,
      thresholdYear: t?.from ?? null,
      deductible,
      taxEffect: Math.round(deductible * s.marginalTax),
      shiftsToThreshold: perShift > 0 ? Math.ceil((t?.amount ?? 0) / perShift) : 0,
      months,
    };
  });
  const returns = taxReturnsByYear(db);
  const declared = [...returns.values()]
    .filter((r) => r.boxes.commuteDeduction !== null)
    .map((r) => ({ year: String(r.incomeYear), amount: r.boxes.commuteDeduction! }));
  return {
    settings: s,
    oneWayKm: car.kmPerShift / 2,
    conditions: { minOneWayKm: MIN_ONE_WAY_KM, minTimeSavedHours: MIN_TIME_SAVED_HOURS },
    years: out,
    declared,
    backtest: backtest(out, returns, String(Number(today.slice(0, 4)) - 1)),
    forecast: forecast(out.find((y) => y.year === today.slice(0, 4)), today, perShift, s.marginalTax),
  };
}

/**
 * Last year as declared (2.1) against what the same model makes of that
 * year's shifts. Either may be missing: the return not read in yet, or the
 * shifts not filled in (a year begun mid-way has fewer months).
 */
export function backtest(years: DeductionYear[], returns: Map<number, { boxes: { commuteDeduction: number | null } }>, year: string) {
  const y = years.find((x) => x.year === year);
  const declared = returns.get(Number(year))?.boxes.commuteDeduction ?? null;
  const computed = y && y.shifts > 0 ? y.deductible : null;
  return {
    year,
    declared,
    computed,
    shifts: y?.shifts ?? 0,
    months: y?.months.length ?? 0,
    diff: declared !== null && computed !== null ? computed - declared : null,
  };
}

/**
 * This year's likely deduction for the return next spring: the shifts filled
 * in, and each month after this one with nothing yet at the average of the
 * whole months so far. Null before a whole month has any.
 */
export function forecast(y: DeductionYear | undefined, today: string, perShift: number, marginalTax: number) {
  const thisMonth = today.slice(0, 7);
  const whole = (y?.months ?? []).filter((m) => m.month < thisMonth);
  if (!y || whole.length === 0) return null;
  const perMonth = whole.reduce((a, m) => a + m.shifts, 0) / whole.length;
  const filled = new Set(y.months.map((m) => m.month));
  let later = 0;
  for (let m = Number(thisMonth.slice(5)) + 1; m <= 12; m++) if (!filled.has(`${y.year}-${String(m).padStart(2, "0")}`)) later++;
  const shifts = Math.round(y.shifts + perMonth * later);
  const gross = Math.round(shifts * perShift);
  const deductible = Math.max(0, gross - y.threshold);
  return {
    year: y.year,
    /** When it is declared: the spring after. */
    declareYear: String(Number(y.year) + 1),
    shifts,
    perMonth: Math.round(perMonth * 10) / 10,
    monthsEstimated: later,
    gross,
    deductible,
    taxEffect: Math.round(deductible * marginalTax),
  };
}
