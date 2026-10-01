import type { Db } from "../db/client.js";
import config from "./oil-bulletin.json" with { type: "json" };
import { pointOn, seriesByKey } from "./series.js";

/**
 * Rikssnittet för diesel, så som resten av verktyget frågar efter det.
 *
 * A small door of its own, so that Pendling & bränsle can ask what a litre
 * costs on average without pulling in the fetching, the spreadsheet reader or
 * the schedule — and so that the series key lives in one place, the source's
 * own configuration.
 */

export const DIESEL_SERIES_KEY = config.series.key;

export interface NationalPrice {
  /** The Monday of the week the figure is for. */
  week: string;
  /** Öre per litre. */
  ore: number;
}

/**
 * The national average that applies on a day: the week it falls in, or the
 * newest week before it. Null when the series doesn't reach that far back —
 * never the week after, which would be a price from the future.
 */
export function nationalDieselPrice(db: Db, on: string): NationalPrice | null {
  const series = seriesByKey(db, DIESEL_SERIES_KEY);
  if (!series) return null;
  const point = pointOn(db, series, on);
  return point ? { week: point.date, ore: point.value } : null;
}
