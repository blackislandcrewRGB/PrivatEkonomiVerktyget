import type { FX_PAIRS, INSTRUMENT_CURRENCIES, INSTRUMENT_KINDS } from "../../db/schema.js";

/**
 * Where a price comes from.
 *
 * Three sources are wired up — Yahoo and then Avanza for quotes, the
 * Riksbank for exchange rates — but nothing above this file knows that. A
 * source that stops working (an undocumented endpoint changes, a rate limit
 * tightens) is replaced, or fallen back from, by writing another
 * implementation of this interface, not by touching the valuation.
 *
 * Every source is public and unauthenticated. The tool never logs in to a
 * broker: it reads prices, never accounts.
 */

export type FxPair = (typeof FX_PAIRS)[number];
export type Currency = (typeof INSTRUMENT_CURRENCIES)[number];
export type Kind = (typeof INSTRUMENT_KINDS)[number];

export interface Quote {
  ticker: string;
  /** Ten-thousandths of `currency`, as everywhere else. */
  priceE4: number;
  currency: Currency;
  /** The trading day the price is for — on a Sunday that is Friday, not today. */
  date: string;
  source: string;
}

export interface FxQuote {
  pair: FxPair;
  /** Kronor per unit of the foreign currency, in millionths. */
  rateE6: number;
  /** The day the rate is for: the latest fixing on or before the day asked for. */
  date: string;
  source: string;
}

export interface PriceProvider {
  readonly name: string;
  /** The ticker is whatever *this* source calls the instrument: a symbol, an id. */
  getQuote(ticker: string, kind?: Kind): Promise<Quote>;
  getFxRate(pair: FxPair, date: string): Promise<FxQuote>;
}

/**
 * A source said no, or said something that couldn't be read. Always thrown
 * with a sentence that says which source and what happened, because the
 * alternative — a missing price shown as if it were a price — is the one
 * thing this must never do.
 */
export class PriceError extends Error {
  /** The HTTP status, when the refusal was one — 429 is the one that matters. */
  readonly status?: number;
  /** What the source itself asked us to wait, in milliseconds, if it said. */
  readonly retryAfterMs?: number;

  constructor(message: string, readonly source: string, extra: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.status = extra.status;
    this.retryAfterMs = extra.retryAfterMs;
  }
}

/** The fetch the providers use. Tests hand in a reader over recorded answers. */
export type Fetcher = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; method?: string; body?: string },
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; text(): Promise<string> }>;

/**
 * Retry-After, in milliseconds. The header comes either as a number of
 * seconds or as an HTTP date, and both are worth reading: a source that says
 * when to come back has told us more than any schedule of ours knows.
 */
export function retryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return seconds > 0 ? Math.round(seconds * 1000) : undefined;
  const when = Date.parse(value);
  if (Number.isNaN(when)) return undefined;
  const ms = when - Date.now();
  return ms > 0 ? ms : undefined;
}

export const REQUEST_TIMEOUT_MS = 15_000;

/** A GET, with a timeout, JSON parsed, and every failure as a PriceError. */
export const fetchJson = <T>(fetcher: Fetcher, url: string, source: string, headers: Record<string, string> = {}): Promise<T> => requestJson<T>(fetcher, url, source, { headers });

/**
 * One request, with a timeout, JSON parsed, and every failure as a
 * PriceError. A POST is the same request with something to say: SCB's PxWeb
 * takes its query as a body, and it deserves the same timeout, the same
 * reading of Retry-After and the same shape of error as everything else.
 */
export async function requestJson<T>(fetcher: Fetcher, url: string, source: string, init: RequestOptions = {}): Promise<T> {
  const res = await sendRequest(fetcher, url, source, init);
  const body = await res.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new PriceError(`${source} svarade med något som inte är JSON.`, source);
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

/**
 * One request and the answer's own status, with everything that can go wrong
 * turned into a PriceError.
 *
 * Kept apart from the parsing so that a source handing over a spreadsheet
 * gets the same timeout, the same reading of Retry-After and the same
 * sentence as one handing over JSON. Two copies of this would be two
 * behaviours under a rate limit, and only one of them would be the tested one.
 */
export async function sendRequest<R extends { ok: boolean; status: number; headers?: { get(name: string): string | null } }>(
  fetcher: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; method?: string; body?: string }) => Promise<R>,
  url: string,
  source: string,
  init: RequestOptions = {},
): Promise<R> {
  const headers = init.headers ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: R;
  try {
    res = await fetcher(url, { headers, signal: controller.signal, ...(init.method ? { method: init.method } : {}), ...(init.body !== undefined ? { body: init.body } : {}) });
  } catch (e) {
    const reason = (e as Error).name === "AbortError" ? `svarade inte inom ${REQUEST_TIMEOUT_MS / 1000} sekunder` : (e as Error).message;
    throw new PriceError(`${source} ${reason}.`, source);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // 429 is worth its own sentence: it is the one that comes back by itself.
    const why = res.status === 429 ? "svarade att för många frågor ställts (429). Nästa synk hämtar kursen." : `svarade ${res.status}.`;
    throw new PriceError(`${source} ${why}`, source, { status: res.status, retryAfterMs: retryAfterMs(res.headers?.get("retry-after")) });
  }
  return res;
}

/**
 * A number to an integer of `decimals` decimals, refusing what isn't a
 * finite number. A price read as NaN would otherwise be stored as one.
 */
export function scaled(value: unknown, decimals: number, what: string, source: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PriceError(`${source} gav inget ${what} som går att räkna med.`, source);
  }
  return Math.round(value * 10 ** decimals);
}

/**
 * The trading day a quote belongs to, in the exchange's own time zone.
 *
 * A New York close at 16:00 is 22:00 in Stockholm and still the same trading
 * day; read in UTC it would sometimes be tomorrow, and be valued at the wrong
 * day's exchange rate.
 */
export function tradingDay(epochSeconds: number, timeZone: string | undefined): string {
  const date = new Date(epochSeconds * 1000);
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
