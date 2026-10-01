import type { Db } from "../db/client.js";
import { food } from "../analysis/analysis.js";
import { addMonths, daysInMonth, monthOf } from "../overview/dates.js";
import { calibration, fuelPurchases, getFuelSettings, listPrices, monthKm, shiftsByMonth, type Price } from "../fuel/fuel.js";
import { discountPerLitre, fillsByTransaction, litresOf, paidPerLitre } from "../fuel/fills.js";
import { getSetting, setSetting } from "../settings.js";
import { OIL_BULLETIN } from "./oilBulletin.js";
import { SCB_KPI } from "./scb.js";
import { mondayOf, pointOn, pointsOf, seriesByKey, seriesStatus, type SeriesStatus } from "./series.js";

/**
 * Mina siffror mot de officiella.
 *
 * The point of this whole module is the comparison, not the published number:
 * every chart holds my own series next to someone else's, and nothing here
 * watches a price or raises an alarm about one.
 *
 * Two things it refuses to do, because both would flatter a chart into
 * saying something untrue:
 *
 * It never compares a month of mine against a month of theirs that isn't the
 * same month. Statistics are published weeks late, so my September against
 * their August would look like a price jump that is really a calendar.
 *
 * It never treats a missing figure as a zero. A month with no groceries
 * recorded is a hole in my data, not a month the food was free.
 */

const SETTINGS_KEY = "price_compare";

export interface PriceCompareSettings {
  /** The month everything is indexed to. Null means twelve months back. */
  baseMonth: string | null;
}

export const PRICE_COMPARE_DEFAULTS: PriceCompareSettings = { baseMonth: null };

const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function getPriceCompareSettings(db: Db): PriceCompareSettings {
  const stored = getSetting<Partial<PriceCompareSettings>>(db, SETTINGS_KEY, {});
  return { baseMonth: isMonth(stored.baseMonth) ? stored.baseMonth : null };
}

export function setPriceCompareSettings(db: Db, patch: Record<string, unknown>): PriceCompareSettings {
  const current = getPriceCompareSettings(db);
  const raw = patch.baseMonth;
  const baseMonth = raw === null || raw === "" ? null : isMonth(raw) ? raw : undefined;
  if (baseMonth === undefined && raw !== undefined) throw new Error("Startmånaden ska skrivas ÅÅÅÅ-MM.");
  const next = { baseMonth: raw === undefined ? current.baseMonth : baseMonth! };
  setSetting(db, SETTINGS_KEY, next);
  return next;
}

/** The month the lines are indexed to: the setting, else twelve months back. */
export const baseMonthFor = (db: Db, today: string): string => getPriceCompareSettings(db).baseMonth ?? addMonths(monthOf(today), -12);

// ---------- Indexing ----------

/**
 * A value against the base, in hundredths of an index point: the base month
 * itself is 10000, a tenth more expensive is 11000.
 *
 * Null when either end is missing, which is the whole reason this is a
 * function and not a division: an index worked out from a month that has no
 * figure is a number with nothing behind it.
 */
export function indexed(value: number | null, base: number | null): number | null {
  if (value === null || base === null || base <= 0) return null;
  return Math.round((value / base) * 10_000);
}

/** The change between two indexed values, in hundredths of a percent: +2,34 % is 234. */
export function changePctE2(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from <= 0) return null;
  return Math.round((to / from - 1) * 10_000);
}

const monthEnd = (month: string) => `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, "0")}`;

const monthsFromTo = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};

// ---------- Food ----------

export interface FoodMonth {
  month: string;
  /** What I spent on groceries, whole household. Null for a month with none recorded. */
  mineOre: number | null;
  mineIndex: number | null;
  kpiIndex: number | null;
}

export interface SubgroupLine {
  key: string;
  name: string;
  months: { month: string; index: number | null }[];
  changePctE2: number | null;
}

export interface FoodComparison {
  base: { month: string; mineOre: number | null; kpi: number | null };
  months: FoodMonth[];
  /** The newest month both sides have. Everything said in words is measured to it. */
  through: string | null;
  change: { mine: number | null; kpi: number | null };
  subgroups: SubgroupLine[];
  source: { name: string; fetchedAt: string | null; latest: string | null } | null;
  /** Why a figure is missing, when one is. */
  missing: string | null;
}

/** Groceries per month for the whole household, with a month of nothing left as nothing. */
function groceriesByMonth(db: Db, from: string, to: string): Map<string, number | null> {
  const rows = food(db, `${from}-01`, monthEnd(to), "household").months;
  return new Map(rows.map((m) => [m.month, m.groceries > 0 ? m.groceries : null]));
}

/**
 * My grocery spending against SCB's index, both indexed to the base month.
 *
 * The two lines answer different questions and the view has to say so: theirs
 * is what things cost, mine is what I spent. A month where I stocked up moves
 * my line and not theirs, and that is information about me rather than about
 * prices.
 */
export function foodComparison(db: Db, opts: { from: string; to: string; today: string }): FoodComparison {
  const base = baseMonthFor(db, opts.today);
  // Whole months only: a running month would drag my line down for no reason
  // other than the calendar.
  const lastWhole = addMonths(monthOf(opts.today), -1);
  const first = [monthOf(opts.from), base].sort()[0];
  const last = [monthOf(opts.to), lastWhole].sort()[0];

  const headline = seriesByKey(db, SCB_KPI.headline);
  const mine = groceriesByMonth(db, first, last > first ? last : first);
  const kpiValues = new Map<string, number>(headline ? pointsOf(db, headline).map((p) => [p.date.slice(0, 7), p.value]) : []);

  const baseMine = mine.get(base) ?? null;
  const baseKpi = kpiValues.get(base) ?? null;

  // The chart shows the period asked for; the base month is looked up
  // whether or not it falls inside it.
  const months = monthsFromTo(monthOf(opts.from), last).map((month) => {
    const mineOre = mine.get(month) ?? null;
    return { month, mineOre, mineIndex: indexed(mineOre, baseMine), kpiIndex: indexed(kpiValues.get(month) ?? null, baseKpi) };
  });

  // Words are only ever said about a month both sides have: my September
  // against their August would be a calendar drawn as a price rise.
  const through = months.filter((m) => m.mineIndex !== null && m.kpiIndex !== null).at(-1)?.month ?? null;
  const at = through ? months.find((m) => m.month === through)! : null;

  const subgroups: SubgroupLine[] = SCB_KPI.series
    // The reference budget's and Årsinkomst's series are fetched alongside, but they are not about food.
    .filter((s) => s.key !== SCB_KPI.headline && !s.use)
    .flatMap((s) => {
      const series = seriesByKey(db, s.key);
      if (!series) return [];
      const values = new Map(pointsOf(db, series).map((p) => [p.date.slice(0, 7), p.value]));
      const subBase = values.get(base) ?? null;
      const line = months.map((m) => ({ month: m.month, index: indexed(values.get(m.month) ?? null, subBase) }));
      return [{ key: s.key, name: series.name, months: line, changePctE2: changePctE2(10_000, through ? line.find((l) => l.month === through)?.index ?? null : null) }];
    });

  const status = headline ? seriesStatus(db, headline) : null;
  return {
    base: { month: base, mineOre: baseMine, kpi: baseKpi },
    months,
    through,
    change: { mine: changePctE2(10_000, at?.mineIndex ?? null), kpi: changePctE2(10_000, at?.kpiIndex ?? null) },
    subgroups,
    source: status ? { name: status.series.source, fetchedAt: status.fetchedAt, latest: status.latest?.date ?? null } : null,
    missing: missingFood(headline !== undefined, baseMine, baseKpi, base),
  };
}

function missingFood(hasSeries: boolean, baseMine: number | null, baseKpi: number | null, base: string): string | null {
  if (!hasSeries || baseKpi === null) return `KPI för ${base} är inte hämtat, så ingenting går att indexera mot den månaden.`;
  if (baseMine === null) return `Inga matinköp finns registrerade för ${base}, så min egen linje kan inte börja där. Välj en annan startmånad i Inställningar.`;
  return null;
}

// ---------- Diesel ----------

export interface FillUp {
  id: number;
  date: string;
  description: string;
  /** The week the national average is read for: the Monday of the fill-up's week. */
  week: string;
  /** What a litre actually cost me, in öre. Off the receipt where there is one. */
  mineOre: number;
  /** Where that came from: the receipt itself, or a price entered by hand. */
  source: "receipt" | "entered";
  /** The day the figure belongs to: the receipt's, or the day the price was entered for. */
  priceDate: string;
  /** The pump's list price and the discount per litre — only a receipt knows these. */
  listOre: number | null;
  discountOre: number | null;
  litres: number | null;
  avgOre: number | null;
  diffOre: number | null;
}

export interface FuelComparison {
  fills: FillUp[];
  /** The national average, one point per week, for the same period. */
  weeks: { week: string; ore: number }[];
  /**
   * Mean deviation over the fill-ups that have both figures.
   *
   * Two of them, and they answer different questions: `diffOre` is what I pay
   * against the average, `listDiffOre` is what my station *asks* against it.
   * The difference between the two is the discount, which is mine and not the
   * station's.
   */
  average: {
    diffOre: number | null;
    count: number;
    skipped: number;
    listDiffOre: number | null;
    listCount: number;
    /** Öre per litre off the pump price, averaged over the receipts. */
    discountOre: number | null;
    receipts: number;
  };
  /** What that deviation is worth in a month at the current rate of shifts. */
  monthly: { shifts: number; month: string; litres: number; ore: number } | null;
  source: { name: string; fetchedAt: string | null; latest: string | null } | null;
  missing: string | null;
}

/** The litre price entered on or before a day. Never a later one: that would be a guess. */
export function priceBefore(prices: readonly Price[], date: string): Price | null {
  let best: Price | null = null;
  for (const p of prices) if (p.date <= date) best = p;
  return best;
}

/**
 * What I paid per litre against the national average for the same week.
 *
 * 'My price' is the receipt's when there is one: the total over the litres,
 * which is what the card was actually charged. Failing that it is the litre
 * price recorded in Pendling & bränsle for the day — an estimate, and one
 * that reads the pump's list price rather than what was paid. A fill-up with
 * neither is counted as skipped rather than reckoned at a price from
 * afterwards.
 *
 * Where a receipt exists the pump price and the discount are carried along
 * beside the paid price, because they answer a different question: what my
 * station asks compared with the country, and what the discount is worth.
 */
export function fuelComparison(db: Db, opts: { from: string; to: string; today: string }): FuelComparison {
  const settings = getFuelSettings(db);
  const prices = listPrices(db);
  const series = seriesByKey(db, OIL_BULLETIN.series.key);
  const status = series ? seriesStatus(db, series) : null;

  const receipts = fillsByTransaction(db);
  const fills: FillUp[] = [];
  let skipped = 0;
  for (const p of fuelPurchases(db, settings.fuelCategoryId, opts.from, opts.to)) {
    if (p.trip) continue;
    const receipt = receipts.get(p.id);
    const entered = priceBefore(prices, p.date);
    if (!receipt && !entered) {
      skipped++;
      continue;
    }
    const mineOre = receipt ? paidPerLitre(receipt) : entered!.price;
    const avg = series ? (pointOn(db, series, p.date)?.value ?? null) : null;
    fills.push({
      id: p.id,
      date: p.date,
      description: p.description,
      week: mondayOf(p.date),
      mineOre,
      source: receipt ? "receipt" : "entered",
      priceDate: receipt ? receipt.date : entered!.date,
      listOre: receipt ? receipt.listPriceOre : null,
      discountOre: receipt ? discountPerLitre(receipt) : null,
      litres: receipt ? litresOf(receipt) : null,
      avgOre: avg,
      diffOre: avg === null ? null : mineOre - avg,
    });
  }

  const matched = fills.filter((f) => f.diffOre !== null);
  const diffOre = matched.length ? Math.round(matched.reduce((s, f) => s + f.diffOre!, 0) / matched.length) : null;
  const listed = matched.filter((f) => f.listOre !== null);
  const withReceipt = fills.filter((f) => f.source === "receipt");
  const weeks = series ? pointsOf(db, series, { from: mondayOf(opts.from), to: opts.to }).map((p) => ({ week: p.date, ore: p.value })) : [];

  return {
    fills,
    weeks,
    average: {
      diffOre,
      count: matched.length,
      skipped,
      listDiffOre: listed.length ? Math.round(listed.reduce((s, f) => s + (f.listOre! - f.avgOre!), 0) / listed.length) : null,
      listCount: listed.length,
      discountOre: withReceipt.length ? Math.round(withReceipt.reduce((s, f) => s + f.discountOre!, 0) / withReceipt.length) : null,
      receipts: withReceipt.length,
    },
    monthly: monthlyEffect(db, opts.today, diffOre),
    source: status ? { name: status.series.source, fetchedAt: status.fetchedAt, latest: status.latest?.date ?? null } : null,
    missing: !series ? "Rikssnittet är inte hämtat ännu." : weeks.length === 0 ? "Rikssnittet saknar veckor i den här perioden." : null,
  };
}

/**
 * What the deviation is worth over a month: the litres the model says this
 * month's shifts need, times the öre per litre. Null without shifts — a
 * month nobody has said anything about is not a month of no driving.
 */
function monthlyEffect(db: Db, today: string, diffOre: number | null): FuelComparison["monthly"] {
  if (diffOre === null) return null;
  const month = monthOf(today);
  const shifts = shiftsByMonth(db).get(month);
  if (shifts === undefined) return null;
  const settings = getFuelSettings(db);
  const consumption = (settings.useCalibrated ? calibration(db, today)?.l100 : null) ?? settings.baseConsumption;
  const litres = (monthKm(settings, shifts) * consumption) / 100;
  return { shifts, month, litres: Math.round(litres * 10) / 10, ore: Math.round(litres * diffOre) };
}

// ---------- Both, for the view ----------

export interface PricesView {
  food: FoodComparison;
  fuel: FuelComparison;
  /** Every series held, for 'hämtat' under the charts. */
  series: { key: string; name: string; unit: string; source: string; fetchedAt: string | null; latest: string | null; count: number }[];
}

const brief = (s: SeriesStatus) => ({
  key: s.series.key,
  name: s.series.name,
  unit: s.series.unit,
  source: s.series.source,
  fetchedAt: s.fetchedAt,
  latest: s.latest?.date ?? null,
  count: s.count,
});

export function pricesView(db: Db, opts: { from: string; to: string; today: string }): PricesView {
  const keys = [...SCB_KPI.series.map((s) => s.key), OIL_BULLETIN.series.key];
  const series = keys.flatMap((key) => {
    const s = seriesByKey(db, key);
    return s ? [brief(seriesStatus(db, s))] : [];
  });
  return { food: foodComparison(db, opts), fuel: fuelComparison(db, opts), series };
}
