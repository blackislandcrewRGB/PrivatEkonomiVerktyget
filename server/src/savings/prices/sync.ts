import { and, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { FX_PAIRS, fxRates, instruments, priceSnapshots, recurringExpenses, type Instrument } from "../../db/schema.js";
import { refreshForeignPrices } from "../../recurring/foreignPrice.js";
import { PriceError, type FxPair, type PriceProvider } from "./provider.js";
import { YahooProvider } from "./yahoo.js";
import { RiksbankProvider } from "./riksbank.js";
import { AvanzaProvider } from "./avanza.js";
import { clearPause, humanWait, noteRefusal, pausedForMs } from "./backoff.js";

/**
 * Fetching the prices, every six hours and on the 'Hämta nu' button.
 *
 * Two rules decide everything here:
 *
 * One failure is one failure. A source that is quiet for one instrument must
 * not cost the other three their prices, so every fetch is caught on its own
 * and the run always ends with a result that says what worked and what
 * didn't. A quote is asked of Yahoo first and of Avanza after it, and the row
 * says which one answered.
 *
 * Nothing stale is ever passed off as current. A price is stored under the
 * trading day it belongs to, never under today's date, and a failed fetch
 * stores nothing at all — the last snapshot stays where it is, and the
 * interface says which day it is from.
 */

export interface PriceResult {
  instrumentId: number;
  name: string;
  ticker: string;
  ok: boolean;
  date?: string;
  priceE4?: number;
  currency?: string;
  /** Which source answered, since there is more than one. */
  source?: string;
  error?: string;
}

export interface RateResult {
  pair: FxPair;
  ok: boolean;
  date?: string;
  rateE6?: number;
  source?: string;
  error?: string;
}

export interface SyncResult {
  at: string;
  prices: PriceResult[];
  rates: RateResult[];
  /** Nothing to fetch is not a failure; it is an empty portfolio. */
  ok: boolean;
}

export interface SyncOptions {
  /** Where quotes come from, and what to try when that source is quiet. */
  quotes?: PriceProvider;
  quotesFallback?: PriceProvider | null;
  /** Where exchange rates come from, and what to try when it is quiet. */
  fx?: PriceProvider;
  fxFallback?: PriceProvider | null;
  /** Waiting, so tests don't. */
  sleep?: (ms: number) => Promise<void>;
  /** The clock, so the backoff can be tested without one. */
  now?: () => number;
  /** Where the waits are written down. */
  log?: (text: string) => void;
}

/**
 * Yahoo counts requests, and a burst is what it counts. Four instruments four
 * times a day is nothing, but asking for them in the same breath is what a
 * rate limit is looking for — so they are spaced out inside a run.
 *
 * A refusal is not answered by asking again. It pauses the source, for longer
 * each time, and the run says so instead of a price. See backoff.ts.
 */
const SPACING_MS = 400;

const rateLimited = (e: unknown) => e instanceof PriceError && e.status === 429;

/** The currency pair an instrument's currency needs, or null for kronor. */
export const pairFor = (currency: string): FxPair | null => (currency === "SEK" ? null : FX_PAIRS.find((p) => p.startsWith(currency)) ?? null);

const message = (e: unknown) => (e instanceof PriceError ? e.message : `Oväntat fel: ${(e as Error).message}`);

/**
 * One question to one source, with the pause respected on the way in and
 * lengthened on the way out.
 */
type Ask = <T>(source: PriceProvider, run: () => Promise<T>) => Promise<T>;

function asker(db: Db, now: () => number, log: (text: string) => void, sleep: (ms: number) => Promise<void>): Ask {
  let asked = 0;
  return async (source, run) => {
    // Checked before the wait: a paused source costs nothing and holds up
    // nothing, so the next source is tried at once.
    const paused = pausedForMs(db, source.name, now());
    if (paused !== null) {
      throw new PriceError(`${source.name} är pausad efter en spärr — nästa försök om ${humanWait(paused)}.`, source.name);
    }
    if (asked++) await sleep(SPACING_MS);
    try {
      const value = await run();
      clearPause(db, source.name);
      return value;
    } catch (e) {
      if (rateLimited(e)) {
        const waitMs = noteRefusal(db, source.name, (e as PriceError).retryAfterMs, now());
        const told = (e as PriceError).retryAfterMs !== undefined ? ", som källan själv bad om" : "";
        log(`Kurskällan ${source.name} spärrade (429). Väntar ${humanWait(waitMs)}${told} — nästa försök ${new Date(now() + waitMs).toISOString()}.`);
      }
      throw e;
    }
  };
}

export async function syncPrices(db: Db, today: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const quotes = opts.quotes ?? new YahooProvider();
  const quotesFallback = opts.quotesFallback === undefined ? new AvanzaProvider() : opts.quotesFallback;
  const fx = opts.fx ?? new RiksbankProvider();
  const fxFallback = opts.fxFallback === undefined ? new YahooProvider() : opts.fxFallback;
  const at = new Date().toISOString();

  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const ask = asker(db, now, opts.log ?? ((text) => console.log(text)), sleep);
  const quoteSources = [quotes, ...(quotesFallback ? [quotesFallback] : [])];

  const rows = db.select().from(instruments).where(isNull(instruments.deletedAt)).all();
  const prices: PriceResult[] = [];
  for (const instrument of rows) {
    const result = await fetchOne(db, ask, quoteSources, instrument);
    if (result) prices.push(result);
  }

  // The holdings' currencies, and those fixed expenses are priced in (a subscription in euro).
  const expenseCurrencies = db
    .select({ currency: recurringExpenses.currency })
    .from(recurringExpenses)
    .where(isNotNull(recurringExpenses.currency))
    .all()
    .map((e) => e.currency as Instrument["currency"]);
  const needed = [...new Set([...rows.map((i) => i.currency), ...expenseCurrencies].map((c) => pairFor(c)).filter((p): p is FxPair => p !== null))];
  const rates: RateResult[] = [];
  for (const pair of needed) {
    rates.push(await fetchRate(db, ask, fx, fxFallback, pair, today));
  }
  // Their kronor amounts follow the new rate.
  refreshForeignPrices(db);

  return { at, prices, rates, ok: prices.every((p) => p.ok) && rates.every((r) => r.ok) };
}

/**
 * Each source calls the instrument something of its own: Yahoo a ticker with
 * the exchange in it, Avanza the orderbook id from its page's address. A
 * source with no name for this instrument is simply not asked.
 */
const TICKER_OF: Record<string, (i: Instrument) => string | null> = {
  yahoo: (i) => i.tickerYahoo,
  avanza: (i) => i.tickerAvanza,
};

/**
 * One instrument, down the chain of sources until one answers.
 *
 * Null means there was nothing to ask — no source knows this instrument by
 * any name — which is not a failure. Anything else carries either a price or
 * every reason it hasn't got one.
 */
async function fetchOne(db: Db, ask: Ask, sources: PriceProvider[], instrument: Instrument): Promise<PriceResult | null> {
  const known = sources
    .map((provider) => ({ provider, ticker: TICKER_OF[provider.name]?.(instrument)?.trim() || null }))
    .filter((s): s is { provider: PriceProvider; ticker: string } => s.ticker !== null);
  if (!known.length) return null;

  const base = { instrumentId: instrument.id, name: instrument.name, ticker: known[0].ticker };
  const errors: string[] = [];
  for (const { provider, ticker } of known) {
    try {
      const quote = await ask(provider, () => provider.getQuote(ticker, instrument.kind));
      // The exchange decides the currency. A ticker pointing at another
      // listing (EXFG.L is the same fund in USD) would otherwise be valued at
      // a rate that has nothing to do with the price — so it is refused here
      // and the next source gets its turn.
      if (quote.currency !== instrument.currency) {
        errors.push(`${ticker} handlas i ${quote.currency}, men ${instrument.name} är i ${instrument.currency}. Rätta tickern eller valutan.`);
        continue;
      }
      db.insert(priceSnapshots)
        .values({ instrumentId: instrument.id, date: quote.date, priceE4: quote.priceE4, currency: quote.currency, source: quote.source })
        .onConflictDoUpdate({
          target: [priceSnapshots.instrumentId, priceSnapshots.date],
          set: { priceE4: quote.priceE4, currency: quote.currency, source: quote.source, fetchedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
        })
        .run();
      return { ...base, ticker, ok: true, date: quote.date, priceE4: quote.priceE4, currency: quote.currency, source: quote.source };
    } catch (e) {
      errors.push(message(e));
    }
  }
  return { ...base, ok: false, error: errors.join(" ") };
}

async function fetchRate(db: Db, ask: Ask, provider: PriceProvider, fallback: PriceProvider | null, pair: FxPair, today: string): Promise<RateResult> {
  const errors: string[] = [];
  for (const source of [provider, ...(fallback ? [fallback] : [])]) {
    try {
      const rate = await ask(source, () => source.getFxRate(pair, today));
      db.insert(fxRates)
        .values({ pair, date: rate.date, rateE6: rate.rateE6, source: rate.source })
        .onConflictDoUpdate({
          target: [fxRates.pair, fxRates.date],
          set: { rateE6: rate.rateE6, source: rate.source, fetchedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
        })
        .run();
      return { pair, ok: true, date: rate.date, rateE6: rate.rateE6, source: rate.source };
    } catch (e) {
      errors.push(message(e));
    }
  }
  return { pair, ok: false, error: errors.join(" ") };
}

// ---------- Reading what has been fetched ----------

export interface LatestPrice {
  instrumentId: number;
  date: string;
  priceE4: number;
  currency: string;
  source: string;
  fetchedAt: string;
}

/** The newest price of each instrument, whatever day it is from. */
export function latestPrices(db: Db): Map<number, LatestPrice> {
  const rows = db
    .select()
    .from(priceSnapshots)
    .orderBy(desc(priceSnapshots.date), desc(priceSnapshots.id))
    .all();
  const out = new Map<number, LatestPrice>();
  for (const r of rows) {
    if (out.has(r.instrumentId)) continue;
    out.set(r.instrumentId, { instrumentId: r.instrumentId, date: r.date, priceE4: r.priceE4, currency: r.currency, source: r.source, fetchedAt: r.fetchedAt });
  }
  return out;
}

/** The rate for a day: the latest fixing on or before it, or null. */
export function rateOn(db: Db, pair: FxPair, date: string): { rateE6: number; date: string; source: string } | null {
  const row = db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.pair, pair), lte(fxRates.date, date)))
    .orderBy(desc(fxRates.date))
    .get();
  return row ? { rateE6: row.rateE6, date: row.date, source: row.source } : null;
}

/**
 * When a price was last *fetched* — not what day it is for. A Friday close
 * read on a Monday is not a stale fetch; a fetch that failed for three days
 * is, and that is the one worth saying something about.
 */
export function lastFetchAt(db: Db): string | null {
  const rows = db.select({ fetchedAt: priceSnapshots.fetchedAt }).from(priceSnapshots).all();
  return rows.length ? rows.map((r) => r.fetchedAt).sort().at(-1)! : null;
}

/** The latest successful fetch per instrument (a price stored or stored again), by instrument id. */
export function lastFetchByInstrument(db: Db): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of db.select({ id: priceSnapshots.instrumentId, fetchedAt: priceSnapshots.fetchedAt }).from(priceSnapshots).all()) {
    if (!out.has(r.id) || r.fetchedAt > out.get(r.id)!) out.set(r.id, r.fetchedAt);
  }
  return out;
}

/** How old the newest price is, in days. */
export function priceAgeDays(db: Db, today: string): number | null {
  const newest = [...latestPrices(db).values()].map((p) => p.date).sort().at(-1);
  if (!newest) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / 86400000);
}
