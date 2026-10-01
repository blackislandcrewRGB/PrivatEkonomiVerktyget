import { PriceError, fetchJson, scaled, tradingDay, type Currency, type Fetcher, type FxPair, type FxQuote, type PriceProvider, type Quote } from "./provider.js";
import { INSTRUMENT_CURRENCIES } from "../../db/schema.js";

/**
 * Yahoo Finance, through the chart endpoint their own pages call.
 *
 * It is undocumented and unsupported, and it can change or start refusing
 * without notice. Everything here is written for that day: the shape is
 * checked field by field, and anything unexpected becomes a PriceError with a
 * sentence that says what was missing. A price that couldn't be read is never
 * quietly replaced by an older one — the caller keeps the last snapshot and
 * the interface says which day it is from.
 *
 * The ticker carries the exchange, which is the point: EXFG.DE is priced in
 * EUR on Xetra and EXFG.L in USD in London, and they are not the same
 * instrument to a portfolio.
 */

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
// Yahoo answers a plain script with 429 far more often than a browser.
const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", Accept: "application/json" };

interface ChartResponse {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        currency?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
        exchangeTimezoneName?: string;
        fullExchangeName?: string;
      };
    }[];
    error?: { code?: string; description?: string } | null;
  };
}

export class YahooProvider implements PriceProvider {
  readonly name = "yahoo";
  constructor(private readonly fetcher: Fetcher = globalThis.fetch) {}

  /**
   * One request, and the smallest one that carries a price.
   *
   * Everything read is in `meta`, which the endpoint returns whatever range
   * is asked for — so it asks for a single day. The candle series is history
   * we already keep ourselves, in price_snapshots, and asking Yahoo for four
   * more days of it every six hours would be paying a rate limit for data
   * that is thrown away.
   */
  private async meta(symbol: string): Promise<NonNullable<NonNullable<NonNullable<ChartResponse["chart"]>["result"]>[number]["meta"]>> {
    const url = `${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const body = await fetchJson<ChartResponse>(this.fetcher, url, this.name, HEADERS);
    const error = body.chart?.error;
    if (error) throw new PriceError(`Yahoo känner inte igen ${symbol}: ${error.description ?? error.code ?? "okänt fel"}.`, this.name);
    const meta = body.chart?.result?.[0]?.meta;
    if (!meta) throw new PriceError(`Yahoo svarade utan kurs för ${symbol}. Endpointen kan ha ändrats.`, this.name);
    return meta;
  }

  async getQuote(ticker: string): Promise<Quote> {
    const symbol = ticker.trim();
    if (!symbol) throw new PriceError("Instrumentet har ingen ticker att hämta kurs för.", this.name);
    const meta = await this.meta(symbol);
    const currency = (meta.currency ?? "").toUpperCase();
    if (!INSTRUMENT_CURRENCIES.includes(currency as Currency)) {
      throw new PriceError(`${symbol} handlas i ${currency || "okänd valuta"}, som verktyget inte räknar med.`, this.name);
    }
    return {
      ticker: symbol,
      priceE4: scaled(meta.regularMarketPrice, 4, "pris", this.name),
      currency: currency as Currency,
      date: tradingDay(this.time(meta.regularMarketTime, symbol), meta.exchangeTimezoneName),
      source: this.name,
    };
  }

  /**
   * Yahoo's own currency pair, as a stand-in when the Riksbank is quiet. It
   * is a market rate rather than the day's fixing, so it is never the first
   * choice — but a rate from a minute ago beats none at all.
   */
  async getFxRate(pair: FxPair, _date: string): Promise<FxQuote> {
    const meta = await this.meta(`${pair}=X`);
    return {
      pair,
      rateE6: scaled(meta.regularMarketPrice, 6, "växelkurs", this.name),
      date: tradingDay(this.time(meta.regularMarketTime, `${pair}=X`), meta.exchangeTimezoneName),
      source: this.name,
    };
  }

  /**
   * When the price was set. Without it there is no day to put the price on,
   * and today's would pass an old price off as current: refused, so the next
   * source is asked instead (as Avanza does).
   */
  private time(epochSeconds: number | undefined, symbol: string): number {
    if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
      throw new PriceError(`${symbol}: svaret saknar tidpunkt för kursen.`, this.name);
    }
    return epochSeconds;
  }
}
