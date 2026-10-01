import { readSheet } from "read-excel-file/node";
import config from "./oil-bulletin.json" with { type: "json" };
import { PriceError, requestBytes, type BinaryFetcher, type IndexFetch, type IndexProvider, type IndexSchedule } from "./provider.js";
import type { PointInput, PriceSeriesDef } from "./series.js";

/**
 * Dieselns rikssnitt, ur kommissionens Weekly Oil Bulletin.
 *
 * Every member state reports the week's average pump price to the Commission,
 * which publishes the lot as one spreadsheet of open data: no key, no
 * account, and nothing scraped from a petrol company's own site. One row per
 * Monday, back to 2005.
 *
 * **The prices are in euro per 1 000 litres**, and each non-euro country has
 * its own exchange rate column in euro per unit of its currency (0,0886 euro
 * per krona is 11,28 kronor per euro). Öre per litre is therefore price
 * divided by rate divided by ten — read as anything else the figure looks
 * sane and is wrong by an order of magnitude, which is why the conversion
 * sits in one tested function with the units written next to it.
 *
 * The layout is a spreadsheet meant for people, so nothing about it is
 * assumed: the sheet is found by name, the two columns by their header codes,
 * and anything missing is an error that says what changed rather than a
 * silent zero. If the Commission reshapes the file, this stops and says so.
 */

const SOURCE = "oil-bulletin";

export interface OilBulletinConfig {
  url: string;
  sheet: string;
  priceColumn: string;
  rateColumn: string;
  litresPerUnit: number;
  from: string;
  publishLagDays: number;
  series: { key: string; name: string; source: string };
}

export const OIL_BULLETIN = config as OilBulletinConfig;

/**
 * Öre per litre, from a price in euro per `litresPerUnit` litres and an
 * exchange rate in euro per krona. Null when either is missing: a week the
 * Commission has no figure for is a gap, not a free tank.
 */
export function orePerLitre(priceEur: unknown, eurPerUnit: unknown, litresPerUnit: number): number | null {
  if (typeof priceEur !== "number" || typeof eurPerUnit !== "number") return null;
  if (!Number.isFinite(priceEur) || !Number.isFinite(eurPerUnit) || priceEur <= 0 || eurPerUnit <= 0) return null;
  // price / rate is the national currency per `litresPerUnit` litres; öre is
  // that in hundredths, per one litre.
  return Math.round((priceEur / eurPerUnit / litresPerUnit) * 100);
}

/** A cell that is meant to be a date: the library gives a Date, older files a string. */
export function cellDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value.trim().slice(0, 10);
  return null;
}

export class OilBulletinProvider implements IndexProvider {
  readonly name = SOURCE;
  readonly series: PriceSeriesDef[];
  readonly schedule: IndexSchedule;

  constructor(
    private readonly fetcher: BinaryFetcher = globalThis.fetch as unknown as BinaryFetcher,
    private readonly config: OilBulletinConfig = OIL_BULLETIN,
  ) {
    this.series = [{ key: config.series.key, name: config.series.name, unit: "ore_per_liter", source: config.series.source, frequency: "weekly" }];
    this.schedule = { frequency: "weekly", from: config.from, publishLagDays: config.publishLagDays };
  }

  async fetch(from: string): Promise<IndexFetch> {
    const bytes = await requestBytes(this.fetcher, this.config.url, this.name, {});
    let rows: unknown[][];
    try {
      rows = (await readSheet(bytes, this.config.sheet)) as unknown[][];
    } catch (e) {
      throw new PriceError(`Weekly Oil Bulletin gick inte att läsa som Excel (bladet "${this.config.sheet}"): ${(e as Error).message}`, this.name);
    }

    // The first row carries the machine-readable column codes; the two below
    // it are headings for a reader, and the weeks start after them.
    const header = (rows[0] ?? []).map((c) => (typeof c === "string" ? c.trim() : ""));
    const priceAt = header.indexOf(this.config.priceColumn);
    const rateAt = header.indexOf(this.config.rateColumn);
    if (priceAt < 0 || rateAt < 0) {
      throw new PriceError(
        `Weekly Oil Bulletin saknar kolumnerna ${this.config.priceColumn} och ${this.config.rateColumn}. Filen kan ha gjorts om — jag hämtar inget hellre än fel siffror.`,
        this.name,
      );
    }

    const points: PointInput[] = [];
    for (const row of rows.slice(1)) {
      const date = cellDate(row[0]);
      if (!date || date < from) continue;
      const value = orePerLitre(row[priceAt], row[rateAt], this.config.litresPerUnit);
      if (value === null) continue;
      points.push({ date, value });
    }
    if (points.length === 0) {
      throw new PriceError(`Weekly Oil Bulletin gav inga veckor från ${from} och framåt. Filen kan ha gjorts om.`, this.name);
    }
    points.sort((a, b) => a.date.localeCompare(b.date));

    // The file carries no publication stamp of its own, and the answer has no
    // Last-Modified: the newest week in it is what says how fresh it is.
    return { series: [{ def: this.series[0], points }], publishedAt: null };
  }
}
