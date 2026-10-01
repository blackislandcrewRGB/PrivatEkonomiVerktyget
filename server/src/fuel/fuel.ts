import { and, asc, eq, isNull, like, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { loadSplits } from "../splits.js";
import { fuelPrices, odometerReadings, settings, transactions, workShiftDays, workShifts } from "../db/schema.js";
import { getCategoryPathMap } from "../db/seed.js";
import { addDays, addMonths, daysBetween, daysInMonth } from "../overview/dates.js";
import { nationalDieselPrice } from "../prices/diesel.js";
import { fillsByTransaction, litresOf } from "./fills.js";

// Pendling & bränsle: this month's fuel from the number of work shifts.
//   expected = (shifts × km per shift + other km) × l/100 km / 100 × price per litre
// The l/100 km is calibrated from past months' actual fuel purchases.
// Money in öre, prices in öre per litre, distances in km.

export interface FuelSettings {
  /** Both ways, one shift. */
  kmPerShift: number;
  otherKmPerMonth: number;
  /** The table value, used until there is a calibrated one (or always, with useCalibrated off). */
  baseConsumption: number;
  /** Öre per shift, added to the cost of a shift. */
  congestionPerShift: number;
  useCalibrated: boolean;
  /** The category that is fuel; null = Bil › Drivmedel. */
  categoryId: number | null;
}

const KEY = "fuel_settings";
// Only a starting point: set the real distances and consumption under Inställningar › Bil.
export const FUEL_DEFAULTS: FuelSettings = {
  kmPerShift: 40,
  otherKmPerMonth: 200,
  baseConsumption: 6.5,
  congestionPerShift: 0,
  useCalibrated: true,
  categoryId: null,
};
/** Months of history the calibration averages. */
export const CALIBRATION_MONTHS = 3;
/** 'Övrig körning' is worth adjusting when the model is this far from the odometer. */
export const ODOMETER_TOLERANCE = 0.1;

export class FuelError extends Error {}

const monthOf = (date: string) => date.slice(0, 7);
const monthStart = (month: string) => `${month}-01`;
const monthEnd = (month: string) => `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, "0")}`;
const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function getFuelSettings(db: Db): FuelSettings & { fuelCategoryId: number | null } {
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
  let stored: Partial<FuelSettings> = {};
  try {
    stored = row ? (JSON.parse(row.value) as Partial<FuelSettings>) : {};
  } catch {
    stored = {};
  }
  const s = { ...FUEL_DEFAULTS, ...stored };
  return { ...s, fuelCategoryId: s.categoryId ?? getCategoryPathMap(db).get("Bil/Drivmedel") ?? null };
}

export function setFuelSettings(db: Db, patch: Record<string, unknown>): FuelSettings {
  const current = getFuelSettings(db);
  const next: FuelSettings = {
    kmPerShift: current.kmPerShift,
    otherKmPerMonth: current.otherKmPerMonth,
    baseConsumption: current.baseConsumption,
    congestionPerShift: current.congestionPerShift,
    useCalibrated: current.useCalibrated,
    categoryId: current.categoryId,
  };
  const num = (k: keyof FuelSettings, min: number, max: number, integer: boolean) => {
    if (!(k in patch)) return;
    const v = patch[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      throw new FuelError(`Ogiltigt värde för ${k}.`);
    }
    (next as unknown as Record<string, number>)[k] = v;
  };
  num("kmPerShift", 0, 2000, false);
  num("otherKmPerMonth", 0, 20000, false);
  num("baseConsumption", 1, 40, false);
  num("congestionPerShift", 0, 100000, true);
  if ("useCalibrated" in patch) {
    if (typeof patch.useCalibrated !== "boolean") throw new FuelError("useCalibrated ska vara sant/falskt.");
    next.useCalibrated = patch.useCalibrated;
  }
  if ("categoryId" in patch) {
    if (patch.categoryId !== null && !Number.isInteger(patch.categoryId)) throw new FuelError("Ogiltig kategori.");
    next.categoryId = patch.categoryId as number | null;
  }
  const json = JSON.stringify(next);
  db.insert(settings).values({ key: KEY, value: json }).onConflictDoUpdate({ target: settings.key, set: { value: json } }).run();
  return next;
}

// ---------- shifts ----------

export function shiftsByMonth(db: Db): Map<string, number> {
  return new Map(db.select().from(workShifts).all().map((r) => [r.month, r.shifts]));
}

/** Sets a month's number of shifts; null removes it. */
export function setShifts(db: Db, month: string, shifts: number | null): void {
  if (!isMonth(month)) throw new FuelError("Månaden ska vara ÅÅÅÅ-MM.");
  if (shifts === null) {
    db.delete(workShifts).where(eq(workShifts.month, month)).run();
    return;
  }
  if (!Number.isInteger(shifts) || shifts < 0 || shifts > 31) throw new FuelError("Antal pass ska vara 0–31.");
  const at = new Date().toISOString();
  db.insert(workShifts).values({ month, shifts, updatedAt: at }).onConflictDoUpdate({ target: workShifts.month, set: { shifts, updatedAt: at } }).run();
}

export function shiftDays(db: Db, month: string): string[] {
  return db
    .select()
    .from(workShiftDays)
    .where(like(workShiftDays.date, `${month}-%`))
    .orderBy(asc(workShiftDays.date))
    .all()
    .map((r) => r.date);
}

/** Marks a day worked or not; the month's count becomes the number of marked days. */
export function setShiftDay(db: Db, date: string, on: boolean): { month: string; days: string[]; shifts: number } {
  if (!isDate(date)) throw new FuelError("Datum ska vara ÅÅÅÅ-MM-DD.");
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    if (on) tx.insert(workShiftDays).values({ date }).onConflictDoNothing().run();
    else tx.delete(workShiftDays).where(eq(workShiftDays.date, date)).run();
    const month = monthOf(date);
    const days = shiftDays(tx, month);
    setShifts(tx, month, days.length);
    return { month, days, shifts: days.length };
  });
}

// ---------- prices ----------

export type Price = { id: number; date: string; price: number };

export function listPrices(db: Db): Price[] {
  return db.select({ id: fuelPrices.id, date: fuelPrices.date, price: fuelPrices.price }).from(fuelPrices).orderBy(asc(fuelPrices.date)).all();
}

export function addPrice(db: Db, date: string, price: number): Price {
  if (!isDate(date)) throw new FuelError("Datum ska vara ÅÅÅÅ-MM-DD.");
  if (!Number.isInteger(price) || price < 100 || price > 10000) throw new FuelError("Literpriset ska vara mellan 1 och 100 kr.");
  return db
    .insert(fuelPrices)
    .values({ date, price })
    .onConflictDoUpdate({ target: fuelPrices.date, set: { price } })
    .returning({ id: fuelPrices.id, date: fuelPrices.date, price: fuelPrices.price })
    .get();
}

/** The price that applied on a day: the latest entered on or before it, else the earliest after it. */
export function priceOn(prices: readonly Price[], date: string): Price | null {
  let best: Price | null = null;
  for (const p of prices) if (p.date <= date) best = p;
  return best ?? prices[0] ?? null;
}

// ---------- odometer ----------

export type Reading = { id: number; date: string; km: number };

export function listReadings(db: Db): Reading[] {
  return db.select({ id: odometerReadings.id, date: odometerReadings.date, km: odometerReadings.km }).from(odometerReadings).orderBy(asc(odometerReadings.date)).all();
}

export function addReading(db: Db, date: string, km: number): Reading {
  if (!isDate(date)) throw new FuelError("Datum ska vara ÅÅÅÅ-MM-DD.");
  if (!Number.isInteger(km) || km < 0 || km > 5_000_000) throw new FuelError("Mätarställningen ska vara hela km.");
  return db
    .insert(odometerReadings)
    .values({ date, km })
    .onConflictDoUpdate({ target: odometerReadings.date, set: { km } })
    .returning({ id: odometerReadings.id, date: odometerReadings.date, km: odometerReadings.km })
    .get();
}

// ---------- fuel purchases ----------

/** 'resa' as a word in the name or note: a trip, not commuting. */
const TRIP = /(^|[^\p{L}])resa([^\p{L}]|$)/iu;

export interface FuelPurchase {
  id: number;
  date: string;
  description: string;
  amount: number;
  /** Left out: marked as a trip. */
  trip: boolean;
}

/**
 * Fuel bought between two days (purchase day), in the fuel category; refunds
 * count against it. A purchase split across categories counts with its fuel
 * part only, so the hot dog at the petrol station isn't fuel.
 */
export function fuelPurchases(db: Db, categoryId: number | null, from: string, to: string): FuelPurchase[] {
  if (categoryId === null) return [];
  const splits = loadSplits(db);
  const rows = db
    .select({
      id: transactions.id,
      date: transactions.transactionDate,
      bookingDate: transactions.bookingDate,
      label: transactions.label,
      description: transactions.descriptionClean,
      note: transactions.note,
      amount: transactions.amount,
      returnGroupId: transactions.returnGroupId,
    })
    .from(transactions)
    .where(
      and(
        // The row's own category, or one part of a split purchase.
        sql`(${transactions.categoryId} = ${categoryId} or exists (select 1 from transaction_splits ts where ts.transaction_id = transactions.id and ts.category_id = ${categoryId}))`,
        isNull(transactions.deletedAt),
        eq(transactions.isTransfer, false),
        sql`coalesce(${transactions.transactionDate}, ${transactions.bookingDate}) between ${from} and ${to}`,
      ),
    )
    .all()
    .filter((r) => r.returnGroupId === null);
  return rows
    .map((r) => {
      const parts = splits.get(r.id);
      const amount = parts ? parts.reduce((s, p) => (p.categoryId === categoryId ? s + p.amount : s), 0) : r.amount;
      return {
        id: r.id,
        date: r.date ?? r.bookingDate,
        description: r.label ?? r.description,
        amount: -amount,
        trip: TRIP.test(r.label ?? "") || TRIP.test(r.note ?? ""),
      };
    })
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const spent = (rows: FuelPurchase[]) => rows.filter((r) => !r.trip).reduce((s, r) => s + r.amount, 0);

// ---------- the model ----------

export function monthKm(s: FuelSettings, shifts: number): number {
  return shifts * s.kmPerShift + s.otherKmPerMonth;
}

export interface MonthActual {
  month: string;
  shifts: number | null;
  km: number | null;
  /** Fuel bought in the month, trips left out. */
  spent: number;
  trips: number;
  /** The price the month is reckoned at: paid on average (by litres), else the price at month end. */
  price: Price | null;
  /** Litres bought: off the receipts where there are any, else the amount at the price of the day. */
  litres: number | null;
  /** How many of the month's counted fill-ups have a receipt with litres on it. */
  receipts: number;
  /** Every counted fill-up has one, so the litres are read rather than reckoned. */
  litresExact: boolean;
  /** Some purchase without a receipt only had a price entered later: its litres are a guess. */
  priceLater: boolean;
  /** Kronor per km driven, in öre (only with shifts and fuel). */
  orePerKm: number | null;
  /** Litres per 100 km from what was bought (with a price). */
  l100: number | null;
  /** What a shift actually cost: öre per km × km per shift + congestion tax. */
  perShift: number | null;
}

/**
 * Each month from `from` to `to` (YYYY-MM): shifts, km, fuel bought and what
 * that says about consumption.
 *
 * Litres come off the receipt when there is one — that is a reading, not a
 * reckoning, and it is what the consumption should be worked out from. For a
 * fill-up without one they are the amount at the price that applied on its
 * day, as before; a purchase before the first price entered gets that first
 * price, and the month is marked priceLater.
 *
 * The two can live in the same month, so `receipts` says how many of its
 * fill-ups were read and `litresExact` whether all of them were.
 */
export function monthActuals(db: Db, from: string, to: string): MonthActual[] {
  const s = getFuelSettings(db);
  const shifts = shiftsByMonth(db);
  const prices = listPrices(db);
  const fills = fillsByTransaction(db);
  const purchases = fuelPurchases(db, s.fuelCategoryId, monthStart(from), monthEnd(to));
  const out: MonthActual[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    const rows = purchases.filter((p) => monthOf(p.date) === m);
    const counted = rows.filter((r) => !r.trip);
    const n = shifts.get(m) ?? null;
    const km = n === null ? null : monthKm(s, n);
    const cost = spent(rows);
    const atEnd = priceOn(prices, monthEnd(m));
    let litres: number | null = null;
    let later = atEnd !== null && atEnd.date > monthEnd(m);
    let receipts = 0;
    if (counted.length && (prices.length || counted.every((r) => fills.has(r.id)))) {
      litres = 0;
      later = false;
      for (const r of counted) {
        const fill = fills.get(r.id);
        if (fill) {
          // Read off the receipt. No price of ours is involved, so nothing
          // about it can be a guess made later.
          receipts++;
          litres += litresOf(fill);
          continue;
        }
        const p = priceOn(prices, r.date)!;
        if (p.date > r.date) later = true;
        litres += r.amount / p.price;
      }
    }
    const paid = litres && litres > 0 ? Math.round(cost / litres) : null;
    const orePerKm = km && cost > 0 ? cost / km : null;
    out.push({
      month: m,
      shifts: n,
      km,
      spent: cost,
      trips: rows.filter((r) => r.trip).reduce((a, r) => a + r.amount, 0),
      price: paid !== null && atEnd ? { ...atEnd, price: paid } : atEnd,
      litres,
      receipts,
      litresExact: counted.length > 0 && receipts === counted.length,
      priceLater: later,
      orePerKm,
      l100: km && litres !== null && cost > 0 ? (litres / km) * 100 : null,
      perShift: orePerKm !== null ? Math.round(orePerKm * s.kmPerShift) + s.congestionPerShift : null,
    });
  }
  return out;
}

export interface Calibration {
  /** Litres per 100 km over the months: all litres bought / all km driven. */
  l100: number;
  months: string[];
  min: number;
  max: number;
  /** How many of those months had their litres read off receipts rather than reckoned. */
  exactMonths: number;
}

/**
 * The last CALIBRATION_MONTHS finished months (within half a year) with both
 * shifts and fuel bought, every purchase with a price entered on or before its
 * day: litres bought over the km the model says were driven. A month that
 * only has a later price is left out, since its litres would be a guess. Min
 * and max are the months' own values, to show how much it varies (a full tank
 * lands in one month).
 */
export function calibration(db: Db, today: string): Calibration | null {
  const current = monthOf(today);
  const used = monthActuals(db, addMonths(current, -6), addMonths(current, -1))
    .filter((m) => m.km && m.l100 !== null && m.litres && !m.priceLater)
    .slice(-CALIBRATION_MONTHS);
  if (!used.length) return null;
  const litres = used.reduce((s, m) => s + m.litres!, 0);
  const km = used.reduce((s, m) => s + m.km!, 0);
  const values = used.map((m) => m.l100!);
  return {
    l100: (litres / km) * 100,
    months: used.map((m) => m.month),
    min: Math.min(...values),
    max: Math.max(...values),
    exactMonths: used.filter((m) => m.litresExact).length,
  };
}

/**
 * Priset en prognos räknar med, och varför det och inte det andra.
 *
 * Two prices can answer 'what does a litre cost today': the one entered here
 * by hand, and the national weekly average. The entered one is the better
 * answer while it is fresh, because it is the pump actually used — and a
 * stale one is the worse answer, because it is a price from a month nobody
 * drove in. The view says which of the two it is standing on.
 */
export interface ForecastPrice {
  /** Öre per litre. */
  price: number;
  /** The day the price is for: an entry's own day, or a week's Monday. */
  date: string;
  source: "own" | "national";
  /** One sentence, in Swedish, for the view to repeat. */
  why: string;
}

export interface MonthForecast {
  month: string;
  shifts: number;
  km: number;
  consumption: number;
  consumptionSource: "calibrated" | "base";
  price: ForecastPrice;
  expectedFuel: number;
  expectedCongestion: number;
  /** Fuel bought so far this month (trips left out). */
  spent: number;
  /** Still to buy: at least 0. */
  remaining: number;
  perShift: number;
}

export type ForecastResult = { forecast: MonthForecast } | { forecast: null; missing: "shifts" | "price" | "category" };

/** A fill-up this recent means the entered price is still the price paid. */
export const RECENT_FILL_DAYS = 14;

/** '2026-09-01' -> '1 sep'. The abbreviation's own full stop would end up doubled in a sentence. */
const dm = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("sv-SE", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/\.$/, "");

/**
 * The price a forecast should reckon with.
 *
 * The entered price is the one paid at the pump, and it is right for as long
 * as it is recent. What makes it go wrong is not age by itself but the reason
 * for the age: nobody has filled up, so nobody has updated it, and a litre in
 * the forecast is still costing what it did a month ago. So when there is no
 * fill-up of one's own within a fortnight, the week's national average takes
 * over — a figure that keeps itself up to date — and the view says that it
 * has, and why.
 *
 * The calibration of the consumption is untouched by this: that is worked out
 * from litres actually bought at prices actually entered, and a national
 * average has no business in it.
 */
export function forecastPrice(db: Db, today: string, categoryId: number | null): ForecastPrice | null {
  const own = priceOn(listPrices(db), today);
  const national = nationalDieselPrice(db, today);
  const since = addDays(today, -RECENT_FILL_DAYS);
  const lastFill = fuelPurchases(db, categoryId, since, today).filter((p) => !p.trip).at(-1);

  if (own && (lastFill || !national)) {
    return {
      price: own.price,
      date: own.date,
      source: "own",
      why: lastFill ? `Ditt eget pris, angivet ${dm(own.date)}. Du tankade ${dm(lastFill.date)}.` : `Ditt eget pris, angivet ${dm(own.date)}.`,
    };
  }
  if (!national) return null;
  return {
    price: national.ore,
    date: national.week,
    source: "national",
    why: own
      ? `Rikssnittet för veckan från ${dm(national.week)}: ingen egen tankning på ${RECENT_FILL_DAYS} dagar, så ditt pris från ${dm(own.date)} har ingen tankning bakom sig.`
      : `Rikssnittet för veckan från ${dm(national.week)}: inget eget literpris är inlagt.`,
  };
}

/** The cost of a month from its shifts, at today's consumption and price. */
export function monthForecast(db: Db, month: string, today: string, shiftsOverride?: number): ForecastResult {
  const s = getFuelSettings(db);
  if (s.fuelCategoryId === null) return { forecast: null, missing: "category" };
  const shifts = shiftsOverride ?? shiftsByMonth(db).get(month);
  if (shifts === undefined) return { forecast: null, missing: "shifts" };
  const price = forecastPrice(db, today, s.fuelCategoryId);
  if (!price) return { forecast: null, missing: "price" };
  const cal = s.useCalibrated ? calibration(db, today) : null;
  const consumption = cal?.l100 ?? s.baseConsumption;
  const km = monthKm(s, shifts);
  const expectedFuel = Math.round((km * consumption * price.price) / 100);
  const bought = month <= monthOf(today) ? spent(fuelPurchases(db, s.fuelCategoryId, monthStart(month), month === monthOf(today) ? today : monthEnd(month))) : 0;
  return {
    forecast: {
      month,
      shifts,
      km,
      consumption,
      consumptionSource: cal ? "calibrated" : "base",
      price,
      expectedFuel,
      expectedCongestion: shifts * s.congestionPerShift,
      spent: bought,
      remaining: Math.max(0, expectedFuel - bought),
      perShift: Math.round((s.kmPerShift * consumption * price.price) / 100) + s.congestionPerShift,
    },
  };
}

/**
 * The fuel to set aside until payday, for 'kvar att leva på': what is left to
 * buy this month (and its congestion tax), plus, when payday is in a later
 * month, that month's cost up to payday (by days; its shifts, or this month's
 * if not entered yet). Null when this month can't be forecast.
 */
export function fuelUntilPayday(db: Db, today: string, payday: string | null) {
  const month = monthOf(today);
  const now = monthForecast(db, month, today);
  if (!now.forecast) return null;
  const f = now.forecast;
  let next: { month: string; amount: number; estimated: boolean } | null = null;
  if (payday && monthOf(payday) > month) {
    const m = addMonths(month, 1);
    const own = shiftsByMonth(db).get(m);
    const nf = monthForecast(db, m, today, own ?? f.shifts).forecast!;
    const days = daysBetween(monthStart(m), payday);
    const share = Math.min(1, Math.max(0, days / daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)))));
    next = { month: m, amount: Math.round((nf.expectedFuel + nf.expectedCongestion) * share), estimated: own === undefined };
  }
  const thisMonth = f.remaining + f.expectedCongestion;
  return { month, thisMonth, next, amount: thisMonth + (next?.amount ?? 0) };
}

// ---------- odometer check ----------

export interface OdometerCheck {
  from: Reading;
  to: Reading;
  actualKm: number;
  /** Km the model gives for the stretch (shifts × km + other driving, by days in partial months). */
  modelKm: number | null;
  /** Months in the stretch without a number of shifts. */
  missing: string[];
  deviation: number | null;
  /** The other driving per month that would make the model match. */
  suggestedOtherKm: number | null;
}

/** The model against the odometer between the first and the last reading. */
export function odometerCheck(db: Db): OdometerCheck | null {
  const readings = listReadings(db);
  if (readings.length < 2) return null;
  const from = readings[0];
  const to = readings[readings.length - 1];
  const s = getFuelSettings(db);
  const shifts = shiftsByMonth(db);
  const missing: string[] = [];
  let shiftKm = 0;
  let monthsWorth = 0;
  // Each day of the stretch is a share of its month.
  for (let m = monthOf(from.date); m <= monthOf(to.date); m = addMonths(m, 1)) {
    const start = m === monthOf(from.date) ? from.date : monthStart(m);
    const end = m === monthOf(to.date) ? to.date : addDays(monthEnd(m), 1);
    const share = daysBetween(start, end) / daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
    if (share <= 0) continue;
    const n = shifts.get(m);
    if (n === undefined) missing.push(m);
    else shiftKm += n * s.kmPerShift * share;
    monthsWorth += share;
  }
  const actualKm = to.km - from.km;
  if (missing.length) return { from, to, actualKm, modelKm: null, missing, deviation: null, suggestedOtherKm: null };
  const modelKm = Math.round(shiftKm + s.otherKmPerMonth * monthsWorth);
  const deviation = actualKm > 0 ? (modelKm - actualKm) / actualKm : null;
  const suggested = Math.max(0, Math.round((actualKm - shiftKm) / monthsWorth / 10) * 10);
  return {
    from,
    to,
    actualKm,
    modelKm,
    missing,
    deviation,
    suggestedOtherKm: deviation !== null && Math.abs(deviation) > ODOMETER_TOLERANCE ? suggested : null,
  };
}
