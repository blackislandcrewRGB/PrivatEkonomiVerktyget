import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pricePoints, priceSeries } from "../src/db/schema.js";
import {
  ensureSeries,
  latestPoint,
  listPriceSeries,
  mondayOf,
  periodStart,
  pointOn,
  pointsOf,
  PriceSeriesError,
  putPoints,
  seriesByKey,
  seriesStatus,
} from "../src/prices/series.js";
import { freshDb } from "./helpers.js";

/**
 * Priser: serierna och deras värden.
 *
 * The two rules the tests are here to hold: a period has exactly one value,
 * and a value never means anything without the unit its series carries.
 */

const KPI = {
  key: "kpi_food_total",
  name: "Livsmedel, KPI",
  unit: "index",
  source: "SCB",
  frequency: "monthly",
} as const;

const DIESEL = {
  key: "diesel_se_avg",
  name: "Diesel, rikssnitt",
  unit: "ore_per_liter",
  source: "EU Weekly Oil Bulletin",
  frequency: "weekly",
} as const;

describe("perioden en siffra hör till", () => {
  it("dates a month by its first day and a week by its Monday", () => {
    expect(periodStart("monthly", "2026-08-15")).toBe("2026-08-01");
    expect(periodStart("weekly", "2026-09-17")).toBe("2026-09-14");
    // A Monday is its own week's start.
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    // Sunday belongs to the week that started six days earlier, not to the
    // one starting tomorrow.
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
    // Across a month, and across a year.
    expect(mondayOf("2026-09-01")).toBe("2026-08-31");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("refuses a date it cannot read", () => {
    expect(() => periodStart("monthly", "aug 2026")).toThrow(PriceSeriesError);
  });
});

describe("serien", () => {
  it("is created once and then found again", () => {
    const db = freshDb();
    const first = ensureSeries(db, KPI);
    const again = ensureSeries(db, KPI);
    expect(again.id).toBe(first.id);
    expect(listPriceSeries(db)).toHaveLength(1);
    expect(seriesByKey(db, KPI.key)?.name).toBe("Livsmedel, KPI");
    expect(seriesByKey(db, "finns_inte")).toBeUndefined();
  });

  it("takes a better name and a changed source", () => {
    const db = freshDb();
    const before = ensureSeries(db, KPI);
    const after = ensureSeries(db, { ...KPI, name: "Livsmedel och alkoholfria drycker", source: "SCB, KPI efter COICOP" });
    expect(after.id).toBe(before.id);
    expect(after.name).toBe("Livsmedel och alkoholfria drycker");
    expect(after.source).toBe("SCB, KPI efter COICOP");
  });

  it("will not let a key change what its stored numbers mean", () => {
    const db = freshDb();
    ensureSeries(db, KPI);
    // Every point written so far is in hundredths of an index. Calling the
    // same key öre per litre would rewrite history without touching a row.
    expect(() => ensureSeries(db, { ...KPI, unit: "ore_per_liter" })).toThrow(/kan inte bli/);
    expect(() => ensureSeries(db, { ...KPI, frequency: "weekly" })).toThrow(PriceSeriesError);
  });

  it("wants a key and a name", () => {
    const db = freshDb();
    expect(() => ensureSeries(db, { ...KPI, key: " " })).toThrow(PriceSeriesError);
    expect(() => ensureSeries(db, { ...KPI, name: "" })).toThrow(PriceSeriesError);
  });
});

describe("värdena", () => {
  it("counts what was new, what was revised and what stood still", () => {
    const db = freshDb();
    const s = ensureSeries(db, KPI);
    expect(putPoints(db, s, [{ date: "2026-07-01", value: 11_425 }, { date: "2026-08-01", value: 11_502 }])).toEqual({ added: 2, revised: 0, unchanged: 0 });

    // SCB revises July and repeats August.
    expect(putPoints(db, s, [{ date: "2026-07-01", value: 11_430 }, { date: "2026-08-01", value: 11_502 }])).toEqual({ added: 0, revised: 1, unchanged: 1 });
    expect(pointsOf(db, s).map((p) => p.value)).toEqual([11_430, 11_502]);
    expect(db.select().from(pricePoints).all()).toHaveLength(2);
  });

  it("dates every reading by the start of its period", () => {
    const db = freshDb();
    const kpi = ensureSeries(db, KPI);
    const diesel = ensureSeries(db, DIESEL);
    // A source that dates a month mid-month, and a week on its Friday.
    putPoints(db, kpi, [{ date: "2026-08-15", value: 11_502 }]);
    putPoints(db, diesel, [{ date: "2026-09-18", value: 2_299 }]);
    expect(pointsOf(db, kpi)[0].date).toBe("2026-08-01");
    expect(pointsOf(db, diesel)[0].date).toBe("2026-09-14");
  });

  it("refuses two readings for one period", () => {
    const db = freshDb();
    const diesel = ensureSeries(db, DIESEL);
    // Two days of the same week are not two weeks, and quietly keeping the
    // last of them would hide that the answer was malformed.
    expect(() => putPoints(db, diesel, [{ date: "2026-09-14", value: 2_299 }, { date: "2026-09-16", value: 2_280 }])).toThrow(/ett värde/);
    expect(pointsOf(db, diesel)).toEqual([]);
  });

  it("refuses a value that is not a whole number", () => {
    const db = freshDb();
    const s = ensureSeries(db, KPI);
    expect(() => putPoints(db, s, [{ date: "2026-08-01", value: 114.25 }])).toThrow(/heltal/);
  });

  it("writes nothing at all when asked for nothing", () => {
    const db = freshDb();
    const s = ensureSeries(db, KPI);
    expect(putPoints(db, s, [])).toEqual({ added: 0, revised: 0, unchanged: 0 });
    expect(pointsOf(db, s)).toEqual([]);
  });

  it("keeps two series apart", () => {
    const db = freshDb();
    const kpi = ensureSeries(db, KPI);
    const diesel = ensureSeries(db, DIESEL);
    putPoints(db, kpi, [{ date: "2026-08-01", value: 11_502 }]);
    putPoints(db, diesel, [{ date: "2026-08-03", value: 2_310 }]);
    expect(pointsOf(db, kpi)).toHaveLength(1);
    expect(pointsOf(db, diesel)).toHaveLength(1);
    expect(latestPoint(db, diesel)?.value).toBe(2_310);
  });

  it("gives back a stretch of it, ends included", () => {
    const db = freshDb();
    const s = ensureSeries(db, KPI);
    putPoints(db, s, ["2026-06", "2026-07", "2026-08", "2026-09"].map((m, i) => ({ date: `${m}-01`, value: 11_000 + i })));
    expect(pointsOf(db, s, { from: "2026-07-01", to: "2026-08-01" }).map((p) => p.date)).toEqual(["2026-07-01", "2026-08-01"]);
    expect(pointsOf(db, s, { from: "2026-08-01" })).toHaveLength(2);
  });
});

describe("att läsa en serie vid ett datum", () => {
  it("uses the period the day falls in, and never one from ahead of it", () => {
    const db = freshDb();
    const diesel = ensureSeries(db, DIESEL);
    putPoints(db, diesel, [{ date: "2026-09-07", value: 2_260 }, { date: "2026-09-14", value: 2_299 }]);

    expect(pointOn(db, diesel, "2026-09-18")?.value).toBe(2_299);
    expect(pointOn(db, diesel, "2026-09-13")?.value).toBe(2_260);
    // Before the series starts there is no figure. The week after is not an
    // answer to what a litre cost in August.
    expect(pointOn(db, diesel, "2026-08-31")).toBeNull();
    // After it ends the newest week stands — a weekly price is the price
    // until the next one is published.
    expect(pointOn(db, diesel, "2026-10-01")?.value).toBe(2_299);
  });
});

describe("vad serien säger om sig själv", () => {
  it("separates how far it reaches from when it was last fetched", () => {
    const db = freshDb();
    const s = ensureSeries(db, DIESEL);
    expect(seriesStatus(db, s)).toEqual({ series: s, latest: null, fetchedAt: null, count: 0 });

    putPoints(db, s, [{ date: "2026-09-07", value: 2_260 }], "2026-09-08T06:00:00.000Z");
    // Asked again today: nothing new was published, but we did ask.
    putPoints(db, s, [{ date: "2026-09-07", value: 2_260 }], "2026-09-20T06:00:00.000Z");

    const status = seriesStatus(db, s);
    expect(status.latest).toEqual({ date: "2026-09-07", value: 2_260 });
    expect(status.fetchedAt).toBe("2026-09-20T06:00:00.000Z");
    expect(status.count).toBe(1);
  });
});

describe("att ta bort en serie", () => {
  it("takes its readings with it", () => {
    const db = freshDb();
    const s = ensureSeries(db, KPI);
    putPoints(db, s, [{ date: "2026-08-01", value: 11_502 }]);
    db.delete(priceSeries).where(eq(priceSeries.id, s.id)).run();
    expect(db.select().from(pricePoints).all()).toEqual([]);
  });
});
