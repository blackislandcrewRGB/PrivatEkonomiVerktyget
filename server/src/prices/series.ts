import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { pricePoints, priceSeries, PRICE_SERIES_FREQUENCIES, PRICE_SERIES_UNITS, type PricePoint, type PriceSeries } from "../db/schema.js";

/**
 * Priser: officiella index och rikssnitt.
 *
 * Someone else measures these — SCB the consumer price index, the Commission
 * the weekly diesel price — and the tool keeps a copy so that my own figures
 * can be held up against them. A series is the thing measured; a point is one
 * reading of it, dated by the first day of the period it covers.
 *
 * Two rules run through all of it:
 *
 * A period has exactly one value. Asking again for a month that has been
 * revised replaces it, because that is what a revision is; it does not add a
 * second opinion next to the first.
 *
 * A value never travels without its unit. An index lives in hundredths
 * (114,25 = 11425) and a fuel price in öre per litre; the same integer means
 * two entirely different things, so the series says which and nothing reads a
 * point without it.
 */

export class PriceSeriesError extends Error {}

export interface PriceSeriesDef {
  key: string;
  name: string;
  unit: (typeof PRICE_SERIES_UNITS)[number];
  source: string;
  frequency: (typeof PRICE_SERIES_FREQUENCIES)[number];
}

export interface PointInput {
  /** The first day of the period: a month's 1st, a week's Monday. */
  date: string;
  value: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The Monday of the week a date falls in. Weeks are dated by their Monday. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // getUTCDay() is 0 on Sunday, which belongs to the week that started six
  // days earlier — the one place an off-by-one silently shifts a whole series.
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The first day of the month a date falls in. */
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

/**
 * The day a period starts, for the frequency it is measured at. Anything a
 * source hands over is put through this rather than trusted: a weekly figure
 * dated on its Friday would line up against nothing.
 */
export function periodStart(frequency: PriceSeriesDef["frequency"], iso: string): string {
  if (!DATE.test(iso)) throw new PriceSeriesError(`Datumet ska vara ÅÅÅÅ-MM-DD, inte "${iso}".`);
  return frequency === "monthly" ? monthStart(iso) : mondayOf(iso);
}

// ---------- Series ----------

export function listPriceSeries(db: Db): PriceSeries[] {
  return db.select().from(priceSeries).orderBy(asc(priceSeries.id)).all();
}

export function seriesByKey(db: Db, key: string): PriceSeries | undefined {
  return db.select().from(priceSeries).where(eq(priceSeries.key, key)).get();
}

/**
 * The series with this key, created if it isn't there yet.
 *
 * Name and source are kept up to date on a series that already exists — those
 * are what the interface shows, and a better wording should reach an old
 * series too. The unit and the frequency are not: changing either would leave
 * every stored point meaning something else than when it was written, so a
 * source that starts publishing something else belongs under a new key.
 */
export function ensureSeries(db: Db, def: PriceSeriesDef): PriceSeries {
  if (!def.key.trim()) throw new PriceSeriesError("En serie behöver en nyckel.");
  if (!def.name.trim()) throw new PriceSeriesError("En serie behöver ett namn.");

  const existing = seriesByKey(db, def.key);
  if (!existing) return db.insert(priceSeries).values(def).returning().get();

  if (existing.unit !== def.unit || existing.frequency !== def.frequency) {
    throw new PriceSeriesError(
      `Serien ${def.key} finns redan som ${existing.unit}/${existing.frequency} och kan inte bli ${def.unit}/${def.frequency}. Lagrade värden skulle byta betydelse — använd en ny nyckel.`,
    );
  }
  if (existing.name === def.name && existing.source === def.source) return existing;
  return db.update(priceSeries).set({ name: def.name, source: def.source }).where(eq(priceSeries.id, existing.id)).returning().get();
}

// ---------- Points ----------

export interface PutResult {
  /** Periods that had no value before. */
  added: number;
  /** Periods whose value changed — a revision at the source. */
  revised: number;
  /** Periods that came back with the value they already had. */
  unchanged: number;
}

/**
 * Writes readings for a series. The newest fetch wins, per period.
 *
 * Every row gets the same `fetchedAt`, because they came from one answer: it
 * says when we last asked, not when the figure was published. That is the
 * date the interface shows, and the reason a series that has stopped
 * answering can be told apart from one that simply has nothing new.
 */
export function putPoints(db: Db, series: PriceSeries, points: PointInput[], fetchedAt = new Date().toISOString()): PutResult {
  const rows = points.map((p) => {
    if (!Number.isInteger(p.value)) {
      throw new PriceSeriesError(`Värdet för ${series.key} ${p.date} ska vara ett heltal (${series.unit === "index" ? "hundradelar" : "öre"}), inte ${p.value}.`);
    }
    return { date: periodStart(series.frequency, p.date), value: p.value };
  });

  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.date)) throw new PriceSeriesError(`${series.key} har två värden för perioden ${r.date}. En period har ett värde.`);
    seen.add(r.date);
  }
  if (rows.length === 0) return { added: 0, revised: 0, unchanged: 0 };

  const before = new Map(
    db
      .select()
      .from(pricePoints)
      .where(and(eq(pricePoints.seriesId, series.id), inArray(pricePoints.date, rows.map((r) => r.date))))
      .all()
      .map((p) => [p.date, p.value] as const),
  );

  const result: PutResult = { added: 0, revised: 0, unchanged: 0 };
  db.transaction((tx) => {
    for (const r of rows) {
      const old = before.get(r.date);
      if (old === undefined) result.added++;
      else if (old !== r.value) result.revised++;
      else result.unchanged++;
      tx.insert(pricePoints)
        .values({ seriesId: series.id, date: r.date, value: r.value, fetchedAt })
        .onConflictDoUpdate({ target: [pricePoints.seriesId, pricePoints.date], set: { value: r.value, fetchedAt } })
        .run();
    }
  });
  return result;
}

/** The readings of a series, oldest first. `from`/`to` are inclusive. */
export function pointsOf(db: Db, series: PriceSeries, range: { from?: string; to?: string } = {}): PricePoint[] {
  const where = [eq(pricePoints.seriesId, series.id)];
  if (range.from) where.push(gte(pricePoints.date, range.from));
  if (range.to) where.push(lte(pricePoints.date, range.to));
  return db
    .select()
    .from(pricePoints)
    .where(and(...where))
    .orderBy(asc(pricePoints.date))
    .all();
}

/** The newest reading, whatever period it belongs to. Undefined when there is none. */
export function latestPoint(db: Db, series: PriceSeries): PricePoint | undefined {
  return db.select().from(pricePoints).where(eq(pricePoints.seriesId, series.id)).orderBy(desc(pricePoints.date)).limit(1).get();
}

/**
 * The reading that covers a day: the newest period starting on or before it.
 * Null when the series doesn't reach back that far — never the nearest
 * reading from the other direction, which would be a figure from the future.
 */
export function pointOn(db: Db, series: PriceSeries, on: string): PricePoint | null {
  return db.select().from(pricePoints).where(and(eq(pricePoints.seriesId, series.id), lte(pricePoints.date, on))).orderBy(desc(pricePoints.date)).limit(1).get() ?? null;
}

export interface SeriesStatus {
  series: PriceSeries;
  /** The newest period held, and its value. Null when the series is empty. */
  latest: { date: string; value: number } | null;
  /** When we last got an answer for this series. Null when we never have. */
  fetchedAt: string | null;
  count: number;
}

/**
 * What a series can say about itself: how far it reaches and when it was last
 * fetched. Both are shown, because they answer different questions — a weekly
 * price fetched an hour ago can still be last week's, and that is fine, while
 * a figure from last week fetched last week is not.
 */
export function seriesStatus(db: Db, series: PriceSeries): SeriesStatus {
  const latest = latestPoint(db, series);
  const agg = db
    .select({
      count: sql<number>`count(*)`,
      fetchedAt: sql<string | null>`max(${pricePoints.fetchedAt})`,
    })
    .from(pricePoints)
    .where(eq(pricePoints.seriesId, series.id))
    .get();
  return {
    series,
    latest: latest ? { date: latest.date, value: latest.value } : null,
    fetchedAt: agg?.fetchedAt ?? null,
    count: agg?.count ?? 0,
  };
}
