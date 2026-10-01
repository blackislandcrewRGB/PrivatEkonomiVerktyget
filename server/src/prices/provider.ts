import type { PRICE_SERIES_FREQUENCIES } from "../db/schema.js";
import { PriceError, requestJson, retryAfterMs, sendRequest, type Fetcher, type RequestOptions } from "../savings/prices/provider.js";
import type { PointInput, PriceSeriesDef } from "./series.js";

/**
 * Var ett index eller ett rikssnitt kommer ifrån.
 *
 * The same shape as the quote sources in Sparande, for the same reason:
 * nothing above this file knows who publishes a number, so a source that
 * changes its format is replaced by writing another implementation instead of
 * by touching a single chart.
 *
 * The plumbing itself — the timeout, the reading of Retry-After, the shape of
 * the error, the pause after a refusal — is the quote sources' own, imported
 * rather than copied. Two ladders that drift apart would be worse than one
 * that lives in a slightly surprising folder.
 *
 * Every source is public, official and unauthenticated. No key, no account,
 * and no scraping of a petrol company's own site.
 */

export { PriceError, requestJson, retryAfterMs };
export type { Fetcher };

/**
 * The fetch a source that hands over a file needs. The real `fetch` is one;
 * a test hands in a reader over a recorded spreadsheet.
 */
export type BinaryFetcher = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; method?: string; body?: string },
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

/** One request whose answer is a file, with the same timeout and the same errors. */
export async function requestBytes(fetcher: BinaryFetcher, url: string, source: string, init: RequestOptions = {}): Promise<Buffer> {
  const res = await sendRequest(fetcher, url, source, init);
  try {
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new PriceError(`${source} svarade med en fil som inte gick att läsa: ${(e as Error).message}`, source);
  }
}

/** Readings for one series, as a source hands them over. */
export interface FetchedSeries {
  def: PriceSeriesDef;
  points: PointInput[];
}

export interface IndexFetch {
  series: FetchedSeries[];
  /** When the source says it last published, when it says. */
  publishedAt: string | null;
}

/**
 * How often a source has anything new, and how far back it is worth asking.
 *
 * It is declared, not decided in code, so that the one place that works out
 * whether to ask today can be read — and tested — on its own. `publishDay` is
 * the day of the month a monthly source is expected to have published the
 * previous month; `publishLagDays` the days a weekly source needs before a
 * finished week shows up.
 */
export interface IndexSchedule {
  frequency: (typeof PRICE_SERIES_FREQUENCIES)[number];
  /** The first period worth having at all. */
  from: string;
  publishDay?: number;
  publishLagDays?: number;
}

export interface IndexProvider {
  readonly name: string;
  /** The series this source can deliver, with their units and names. */
  readonly series: readonly PriceSeriesDef[];
  readonly schedule: IndexSchedule;
  /** Everything from `from` up to and including the newest period published. */
  fetch(from: string, today: string): Promise<IndexFetch>;
}

/**
 * A decimal string to an integer of `decimals` decimals: '124.57' -> 12457.
 *
 * Null for anything that isn't a number, which is how the missing values a
 * statistics office writes as '..' stay missing. Read as a number they would
 * become a zero, and a zero drawn on a line is a claim that a price collapsed.
 */
export function decimalToInt(value: unknown, decimals: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 10 ** decimals) : null;
}
