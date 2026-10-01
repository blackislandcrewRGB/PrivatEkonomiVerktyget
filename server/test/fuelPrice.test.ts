import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { addPrice, calibration, forecastPrice, getFuelSettings, monthForecast, RECENT_FILL_DAYS, setShifts } from "../src/fuel/fuel.js";
import { DIESEL_SERIES_KEY } from "../src/prices/diesel.js";
import { ensureSeries, putPoints } from "../src/prices/series.js";
import { freshDb } from "./helpers.js";

/**
 * Vilket pris "Kvar att tanka" räknar med.
 *
 * The entered price is the pump actually used, and it is the right answer for
 * as long as it is recent. What makes it stale is never age alone: it is that
 * nobody has filled up, so nobody has updated it. When there is no fill-up of
 * one's own within a fortnight, the week's national average takes over — and
 * the tool says so.
 *
 * The consumption's calibration is deliberately untouched by any of this, and
 * one test holds that line.
 */

type Db = ReturnType<typeof freshDb>;

const TODAY = "2026-09-19";

let seq = 0;
function fill(db: Db, date: string, ore: number, opts: { note?: string } = {}) {
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Mastercard Guld")).get()!.id,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "CIRCLE K EXEMPELSTAD",
      descriptionClean: "CIRCLE K EXEMPELSTAD",
      amount: -ore,
      categoryId: getCategoryPathMap(db).get("Bil/Drivmedel")!,
      note: opts.note ?? null,
      fingerprint: `fp${++seq}`,
    })
    .run();
}

/** The national average, as the Oil Bulletin leaves it: one value per Monday. */
function national(db: Db, weeks: Record<string, number>) {
  const series = ensureSeries(db, { key: DIESEL_SERIES_KEY, name: "Diesel, rikssnitt Sverige", unit: "ore_per_liter", source: "Weekly Oil Bulletin", frequency: "weekly" });
  putPoints(db, series, Object.entries(weeks).map(([date, value]) => ({ date, value })));
}

const category = (db: Db) => getFuelSettings(db).fuelCategoryId;

describe("priset prognosen står på", () => {
  it("is my own while I am still filling up", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-09-01", 1_950);
    national(db, { "2026-09-14": 2_235 });
    fill(db, "2026-09-10", 94_350);

    const p = forecastPrice(db, TODAY, category(db))!;
    expect(p).toMatchObject({ source: "own", price: 1_950, date: "2026-09-01" });
    expect(p.why).toBe("Ditt eget pris, angivet 1 sep. Du tankade 10 sep.");
  });

  it("hands over to the national average after a fortnight without a fill-up", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-08-18", 1_950);
    national(db, { "2026-09-07": 2_125, "2026-09-14": 2_235 });
    // The last fill-up was fifteen days ago: the entered price has had no
    // reason to be updated since.
    fill(db, "2026-09-04", 94_350);

    const p = forecastPrice(db, TODAY, category(db))!;
    expect(p).toMatchObject({ source: "national", price: 2_235, date: "2026-09-14" });
    expect(p.why).toMatch(/Rikssnittet för veckan från 14 sep: ingen egen tankning på 14 dagar/);
    expect(p.why).toMatch(/ditt pris från 18 aug/);
  });

  it("counts the fortnight from the day itself", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-08-18", 1_950);
    national(db, { "2026-09-14": 2_235 });
    // Exactly fourteen days back still counts as a fill-up of my own.
    fill(db, "2026-09-05", 100_000);
    expect(forecastPrice(db, TODAY, category(db))!.source).toBe("own");
    expect(RECENT_FILL_DAYS).toBe(14);
  });

  it("does not count a trip as a fill-up", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-08-18", 1_950);
    national(db, { "2026-09-14": 2_235 });
    // Driving to Exempelstad says nothing about the price of commuting.
    fill(db, "2026-09-15", 90_000, { note: "Resa Exempelstad" });
    expect(forecastPrice(db, TODAY, category(db))!.source).toBe("national");
  });

  it("keeps my own price when there is no average to fall back on", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-06-01", 1_899);
    // Nothing fetched: an old price of mine is still better than none.
    const p = forecastPrice(db, TODAY, category(db))!;
    expect(p).toMatchObject({ source: "own", price: 1_899 });
    expect(p.why).toBe("Ditt eget pris, angivet 1 juni.");
  });

  it("uses the average when no price has ever been entered", () => {
    const db = freshDb({ seeded: true });
    national(db, { "2026-09-14": 2_235 });
    const p = forecastPrice(db, TODAY, category(db))!;
    expect(p).toMatchObject({ source: "national", price: 2_235 });
    expect(p.why).toMatch(/inget eget literpris är inlagt/);
    // And with neither, there is no price at all — which is what the view
    // already knows how to say.
    expect(forecastPrice(freshDb({ seeded: true }), TODAY, 1)).toBeNull();
  });

  it("never reaches for a week that has not happened yet", () => {
    const db = freshDb({ seeded: true });
    national(db, { "2026-09-21": 2_400 });
    expect(forecastPrice(db, TODAY, category(db))).toBeNull();
  });
});

describe("Kvar att tanka", () => {
  it("reckons the month at the price it chose, and says which", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-08-18", 1_950);
    national(db, { "2026-09-14": 2_235 });
    setShifts(db, "2026-09", 14);
    fill(db, "2026-09-02", 100_000);

    const { forecast } = monthForecast(db, "2026-09", TODAY);
    expect(forecast!.price).toMatchObject({ source: "national", price: 2_235 });
    // 760 km at 6,5 l/100 km at 22,35 kr/l.
    expect(forecast!.expectedFuel).toBe(Math.round((760 * 6.5 * 2_235) / 100));
    expect(forecast!.remaining).toBe(forecast!.expectedFuel - 100_000);
  });

  it("leaves the calibration of the consumption alone", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-06-01", 1_899);
    setShifts(db, "2026-06", 16);
    setShifts(db, "2026-07", 10);
    setShifts(db, "2026-08", 15);
    fill(db, "2026-06-12", 95_710);
    fill(db, "2026-07-08", 79_758);
    fill(db, "2026-08-15", 98_748);
    setShifts(db, "2026-09", 14);
    const before = calibration(db, TODAY)!;

    // The national average arrives, and the forecast starts using it.
    national(db, { "2026-09-14": 2_235 });
    expect(forecastPrice(db, TODAY, category(db))!.source).toBe("national");
    // The litres per 100 km are worked out from fuel actually bought at
    // prices actually entered. A national average has no business in them.
    expect(calibration(db, TODAY)).toEqual(before);
    expect(monthForecast(db, "2026-09", TODAY).forecast!.consumption).toBe(before.l100);
  });
});
