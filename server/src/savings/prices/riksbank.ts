import { PriceError, fetchJson, scaled, type Fetcher, type FxPair, type FxQuote, type PriceProvider, type Quote } from "./provider.js";

/**
 * The Riksbank's open API (Swea) for the day's exchange rates.
 *
 * This is the official source and the one that decides what a krona was
 * worth: `SEKUSDPMI` and `SEKEURPMI` are the fixing, kronor per unit of the
 * foreign currency. It is documented and public, and needs no key.
 *
 * There are no observations on weekends and holidays, so a rate is asked for
 * as a window that ends on the day wanted and the last one in it is taken.
 * The answer carries its own date, and the interface shows it — 'kurs från
 * 18/9' is the truth on a Sunday, and showing Friday's rate as today's would
 * not be.
 */

const BASE = "https://api.riksbank.se/swea/v1";
const SERIES: Record<FxPair, string> = { USDSEK: "SEKUSDPMI", EURSEK: "SEKEURPMI" };
/** How far back to look for the latest fixing: a long weekend plus Christmas. */
const WINDOW_DAYS = 10;

interface Observation {
  date?: string;
  value?: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const daysBefore = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);

export class RiksbankProvider implements PriceProvider {
  readonly name = "riksbank";
  constructor(private readonly fetcher: Fetcher = globalThis.fetch) {}

  /** The Riksbank has exchange rates and nothing else; saying so beats an empty answer. */
  async getQuote(ticker: string): Promise<Quote> {
    throw new PriceError(`Riksbanken har bara valutakurser, inte kursen för ${ticker}.`, this.name);
  }

  async getFxRate(pair: FxPair, date: string): Promise<FxQuote> {
    const series = SERIES[pair];
    if (!series) throw new PriceError(`Riksbanken har ingen serie för ${pair}.`, this.name);
    if (!ISO.test(date)) throw new PriceError("Datumet ska vara ÅÅÅÅ-MM-DD.", this.name);

    const url = `${BASE}/Observations/${series}/${daysBefore(date, WINDOW_DAYS)}/${date}`;
    const body = await fetchJson<Observation[]>(this.fetcher, url, this.name);
    if (!Array.isArray(body)) throw new PriceError("Riksbanken svarade i ett format som inte gick att läsa.", this.name);
    const observations = body.filter((o): o is Required<Observation> => typeof o?.date === "string" && typeof o?.value === "number" && o.date <= date);
    const latest = observations.sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (!latest) {
      throw new PriceError(`Riksbanken har ingen ${pair}-kurs de ${WINDOW_DAYS} dagarna före ${date}.`, this.name);
    }
    return { pair, rateE6: scaled(latest.value, 6, "växelkurs", this.name), date: latest.date, source: this.name };
  }
}
