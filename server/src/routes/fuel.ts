import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { fuelPrices, odometerReadings } from "../db/schema.js";
import { addMonths, daysBetween, todayLocal } from "../overview/dates.js";
import {
  FuelError,
  addPrice,
  addReading,
  calibration,
  fuelPurchases,
  getFuelSettings,
  listPrices,
  listReadings,
  monthActuals,
  monthForecast,
  odometerCheck,
  setFuelSettings,
  setShiftDay,
  setShifts,
  shiftDays,
} from "../fuel/fuel.js";
import { deductionYears, setDeductionSettings } from "../fuel/deduction.js";
import { deleteFill, fillsMissing, listFills, saveFill } from "../fuel/fills.js";

const today = (q: string | undefined) => (q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayLocal());

/** Pendling & bränsle (/api/fuel). */
/**
 * How far ahead shifts can be entered: as far as Kassaflöde reaches (90 days
 * end at most three months on). A month without shifts borrows this month's.
 */
export const MONTHS_AHEAD = 3;

export function fuelRoutes(db: Db) {
  const app = new Hono();
  const guard = async (run: () => unknown) => {
    try {
      return Response.json(await run());
    } catch (e) {
      if (e instanceof FuelError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
  };

  /**
   * Everything the view needs: settings, this month's forecast (and next
   * month's), the months from a year back to MONTHS_AHEAD ahead, the
   * calibration, the prices and the odometer check.
   */
  app.get("/", (c) => {
    const t = today(c.req.query("today"));
    const month = t.slice(0, 7);
    const s = getFuelSettings(db);
    const prices = listPrices(db);
    const latest = prices.filter((p) => p.date <= t).at(-1) ?? null;
    const current = monthForecast(db, month, t);
    return c.json({
      today: t,
      settings: s,
      latestPrice: latest ? { ...latest, ageDays: daysBetween(latest.date, t) } : null,
      prices: prices.slice(-12).reverse(),
      current: current.forecast ?? null,
      missing: current.forecast ? null : current.missing,
      next: monthForecast(db, addMonths(month, 1), t).forecast ?? null,
      purchases: fuelPurchases(db, s.fuelCategoryId, `${month}-01`, t),
      months: monthActuals(db, addMonths(month, -12), addMonths(month, MONTHS_AHEAD)).reverse(),
      calibration: calibration(db, t),
      readings: listReadings(db).reverse(),
      odometer: odometerCheck(db),
    });
  });

  /** Months for Analys: shifts, km, fuel, kr per shift and l/100 km (?from=YYYY-MM&to=YYYY-MM); none yet for this month. */
  app.get("/history", (c) => {
    const to = c.req.query("to")?.slice(0, 7) ?? todayLocal().slice(0, 7);
    const from = c.req.query("from")?.slice(0, 7) ?? addMonths(to, -11);
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to) return c.json({ error: "Ogiltig period." }, 400);
    // A month still going says nothing about consumption yet.
    const current = today(c.req.query("today")).slice(0, 7);
    const months = monthActuals(db, from, to).map((m) => (m.month >= current ? { ...m, orePerKm: null, l100: null, perShift: null } : m));
    return c.json({ settings: getFuelSettings(db), months });
  });

  /** Reseavdrag per income year, and its settings (rate, thresholds, marginal tax). */
  app.get("/deduction", (c) => c.json(deductionYears(db, today(c.req.query("today")))));
  app.put("/deduction/settings", async (c) => guard(async () => setDeductionSettings(db, (await c.req.json().catch(() => ({}))) as Record<string, unknown>)));

  app.put("/settings", async (c) => guard(async () => setFuelSettings(db, (await c.req.json().catch(() => ({}))) as Record<string, unknown>)));

  /** { shifts: n } or { shifts: null } to clear. */
  app.put("/shifts/:month", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { shifts?: number | null };
      setShifts(db, c.req.param("month"), b.shifts ?? null);
      return { month: c.req.param("month"), shifts: b.shifts ?? null };
    }),
  );

  app.get("/shift-days/:month", (c) => c.json({ days: shiftDays(db, c.req.param("month")) }));

  /** { on: true | false }: marks a day worked; the month's count follows. */
  app.put("/shift-days/:date", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { on?: boolean };
      return setShiftDay(db, c.req.param("date"), b.on !== false);
    }),
  );

  /**
   * Kvittona: liter och pris per tankning, plus tankningarna som saknar ett.
   * A year back by default, which is as far as the months table reaches.
   */
  app.get("/fills", (c) => {
    const t = today(c.req.query("today"));
    const from = `${addMonths(t.slice(0, 7), -12)}-01`;
    return c.json({ fills: listFills(db, { from, to: t }).reverse(), missing: fillsMissing(db, getFuelSettings(db).fuelCategoryId, from, t) });
  });

  /** Whole numbers at the door: litres in hundredths, prices and the discount in öre. */
  app.post("/fills", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return saveFill(db, {
        date: String(b.date ?? ""),
        litresE2: Number(b.litresE2),
        listPriceOre: Number(b.listPriceOre),
        discountOre: Number(b.discountOre ?? 0),
        amountOre: Number(b.amountOre),
        transactionId: b.transactionId == null ? null : Number(b.transactionId),
        station: b.station == null ? null : String(b.station),
        note: b.note == null ? null : String(b.note),
      });
    }),
  );

  app.delete("/fills/:id", (c) => {
    deleteFill(db, Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  /** { date, price } with price in öre per litre. */
  app.post("/prices", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { date?: string; price?: number };
      return addPrice(db, String(b.date ?? ""), Number(b.price));
    }),
  );
  app.delete("/prices/:id", (c) => {
    const r = db.delete(fuelPrices).where(eq(fuelPrices.id, Number(c.req.param("id")))).returning().get();
    return r ? c.json(r) : c.json({ error: "Hittades inte." }, 404);
  });

  /** { date, km } */
  app.post("/odometer", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { date?: string; km?: number };
      return addReading(db, String(b.date ?? ""), Number(b.km));
    }),
  );
  app.delete("/odometer/:id", (c) => {
    const r = db.delete(odometerReadings).where(eq(odometerReadings.id, Number(c.req.param("id")))).returning().get();
    return r ? c.json(r) : c.json({ error: "Hittades inte." }, 404);
  });

  return app;
}
