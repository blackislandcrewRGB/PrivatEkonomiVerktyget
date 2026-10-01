import { PriceError, fetchJson, scaled, tradingDay, type Currency, type Fetcher, type FxPair, type FxQuote, type Kind, type PriceProvider, type Quote } from "./provider.js";
import { INSTRUMENT_CURRENCIES } from "../../db/schema.js";

/**
 * Avanzas publika kurssidor — reserven när Yahoo säger nej.
 *
 * This is the market guide their own public instrument pages read, with no
 * key, no cookie and no account. Nothing here logs in, nothing touches a
 * holding, nothing asks about a portfolio: it reads the same page anyone can
 * open without being a customer. That boundary is the whole point of using it
 * at all, and it is not to be crossed to get a nicer number.
 *
 * Two things it gives that a bare quote doesn't:
 *
 * The currency, from the listing. So the same check as everywhere else holds
 * — a price in the wrong currency is refused rather than valued.
 *
 * The marketplace and its country, which is how the trading day is worked
 * out. Avanza times everything in milliseconds since the epoch, and a NASDAQ
 * close read in UTC would sometimes land on tomorrow.
 *
 * The instrument is named by Avanza's orderbook id — the digits in the
 * address of its page — because Avanza has no tickers of its own to ask by.
 */

const BASE = "https://www.avanza.se/_api/market-guide";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", Accept: "application/json" };

/**
 * Which part of the market guide an instrument lives in. Exchange-traded
 * funds sit under 'certificate' with the rest of the exchange-traded
 * products — checked against a real fund, not assumed.
 */
const SECTION: Record<Kind, string> = { stock: "stock", etf: "certificate" };

/**
 * The exchange's time zone, from the country Avanza names. Only the markets
 * whose currency the tool counts in are here; anything else is refused rather
 * than dated in UTC and quietly put on the wrong day.
 */
const ZONES: Record<string, string> = {
  US: "America/New_York",
  SE: "Europe/Stockholm",
  DE: "Europe/Berlin",
  NL: "Europe/Amsterdam",
  FR: "Europe/Paris",
  IT: "Europe/Rome",
  ES: "Europe/Madrid",
  BE: "Europe/Brussels",
  AT: "Europe/Vienna",
  PT: "Europe/Lisbon",
  FI: "Europe/Helsinki",
  IE: "Europe/Dublin",
};

interface MarketGuide {
  name?: string;
  isin?: string;
  listing?: { currency?: string; countryCode?: string; marketPlaceName?: string; tickerSymbol?: string };
  quote?: { last?: number; timeOfLast?: number };
}

export class AvanzaProvider implements PriceProvider {
  readonly name = "avanza";
  constructor(private readonly fetcher: Fetcher = globalThis.fetch) {}

  async getQuote(ticker: string, kind: Kind = "stock"): Promise<Quote> {
    const id = ticker.trim();
    if (!id) throw new PriceError("Instrumentet har inget Avanza-id att hämta kurs för.", this.name);
    if (!/^\d+$/.test(id)) {
      throw new PriceError(`'${id}' är inget Avanza-id. Det är orderbokens nummer — siffrorna i adressen till instrumentets sida hos Avanza.`, this.name);
    }

    const body = await fetchJson<MarketGuide>(this.fetcher, `${BASE}/${SECTION[kind]}/${id}`, this.name, HEADERS);
    const listing = body.listing;
    const quote = body.quote;
    if (!listing || !quote) throw new PriceError(`Avanza svarade utan kurs för ${id}. Endpointen kan ha ändrats.`, this.name);

    const currency = (listing.currency ?? "").toUpperCase();
    if (!INSTRUMENT_CURRENCIES.includes(currency as Currency)) {
      throw new PriceError(`${body.name ?? id} handlas i ${currency || "okänd valuta"}, som verktyget inte räknar med.`, this.name);
    }

    const zone = ZONES[listing.countryCode ?? ""];
    if (!zone) {
      throw new PriceError(`Avanza noterar ${body.name ?? id} i ${listing.countryCode || "okänt land"}, och då går det inte att säga vilken handelsdag kursen hör till.`, this.name);
    }
    // No time, no day — and a price on the wrong day would be valued at the
    // wrong exchange rate. Better to say so than to date it 'now'.
    if (typeof quote.timeOfLast !== "number" || !Number.isFinite(quote.timeOfLast) || quote.timeOfLast <= 0) {
      throw new PriceError(`Avanza gav ingen tidpunkt för kursen på ${body.name ?? id}, så handelsdagen är okänd.`, this.name);
    }

    return {
      ticker: id,
      priceE4: scaled(quote.last, 4, "pris", this.name),
      currency: currency as Currency,
      date: tradingDay(quote.timeOfLast / 1000, zone),
      source: this.name,
    };
  }

  async getFxRate(pair: FxPair, _date: string): Promise<FxQuote> {
    throw new PriceError(`Avanza används bara för kurser, inte för valutakurser (${pair}).`, this.name);
  }
}
