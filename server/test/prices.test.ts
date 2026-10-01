import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fxRates, priceSnapshots } from "../src/db/schema.js";
import { createInstrument, type InstrumentInput } from "../src/savings/instruments.js";
import { PriceError, retryAfterMs, tradingDay, type Fetcher } from "../src/savings/prices/provider.js";
import { FIRST_WAIT_MS, MAX_WAIT_MS, humanWait, nextStepMs, pausedForMs } from "../src/savings/prices/backoff.js";
import { YahooProvider } from "../src/savings/prices/yahoo.js";
import { RiksbankProvider } from "../src/savings/prices/riksbank.js";
import { AvanzaProvider } from "../src/savings/prices/avanza.js";
import { latestPrices, pairFor, priceAgeDays, rateOn, syncPrices } from "../src/savings/prices/sync.js";
import { freshDb } from "./helpers.js";

/**
 * Kurskällorna, mot inspelade svar.
 *
 * The fixtures are real answers from Yahoo and the Riksbank, fetched on 20
 * September 2026, and the prices in them are the ones the portfolio actually
 * had. Nothing here touches the network: every test hands the provider a
 * reader over a recorded answer, which is also how a source that has changed
 * its shape is simulated.
 *
 * The Yahoo recordings were made with `range=5d`, before the provider was
 * narrowed to `range=1d`. They are the same answers either way — everything
 * read is in `meta`, which comes back whatever range is asked for — and the
 * candle series they still carry is simply ignored, exactly as it is in
 * production. Re-recording them has to wait for Yahoo to stop refusing.
 */

type Db = ReturnType<typeof freshDb>;

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/prices", name), "utf8");

type Answer = string | { status: number; body: string; headers?: Record<string, string> };

interface Asked {
  url: string;
  headers: Record<string, string>;
}

/** A fetch that answers from the recordings, and remembers what was asked for. */
function recorded(answers: Record<string, Answer>): Fetcher & { urls: string[]; requests: Asked[] } {
  const urls: string[] = [];
  const requests: Asked[] = [];
  const fetcher = (async (url: string, init?: { headers?: Record<string, string> }) => {
    urls.push(url);
    requests.push({ url, headers: init?.headers ?? {} });
    // The keys are written the way a ticker is ('EURSEK=X'); the URL has it
    // percent-encoded.
    const asked = decodeURIComponent(url);
    const key = Object.keys(answers).find((k) => asked.includes(k));
    if (key === undefined) return { ok: false, status: 404, text: async () => "" };
    const answer = answers[key];
    if (typeof answer === "string") return { ok: true, status: 200, text: async () => answer };
    const headers = { get: (name: string) => answer.headers?.[name.toLowerCase()] ?? null };
    return { ok: answer.status < 400, status: answer.status, headers, text: async () => answer.body };
  }) as Fetcher & { urls: string[]; requests: Asked[] };
  fetcher.urls = urls;
  fetcher.requests = requests;
  return fetcher;
}

const YAHOO = {
  "EXFG.DE": fixture("yahoo-EXFG.DE.json"),
  EXA: fixture("yahoo-EXA.json"),
  EXB: fixture("yahoo-EXB.json"),
  EXC: fixture("yahoo-EXC.json"),
  "EURSEK=X": fixture("yahoo-EURSEK=X.json"),
};
const RIKSBANK = { SEKUSDPMI: fixture("riksbank-SEKUSDPMI.json"), SEKEURPMI: fixture("riksbank-SEKEURPMI.json") };
/** Avanza asks by orderbook id — the digits in the address of a page. */
const AVANZA = {
  "certificate/1000001": fixture("avanza-1000001.json"),
  "stock/1000002": fixture("avanza-1000002.json"),
  "stock/1000003": fixture("avanza-1000003.json"),
  "stock/1000004": fixture("avanza-1000004.json"),
};

const EXFG: InstrumentInput = { name: "Exempelfond Global Index", isin: "IE00EXEMPEL1", currency: "EUR", kind: "etf", zone: "base", tickerYahoo: "EXFG.DE", tickerAvanza: "1000001" };
const EXA: InstrumentInput = { name: "Exempelbolaget A", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXA", tickerAvanza: "1000002" };
const EXB: InstrumentInput = { name: "Exempelbolaget B", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXB", tickerAvanza: "1000003" };
const EXC: InstrumentInput = { name: "Exempelbolaget C", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXC", tickerAvanza: "1000004" };

const TODAY = "2026-09-20";

describe("Yahoo", () => {
  it("reads the price, the currency and the trading day it belongs to", async () => {
    const yahoo = new YahooProvider(recorded(YAHOO));
    expect(await yahoo.getQuote("EXFG.DE")).toMatchObject({ ticker: "EXFG.DE", priceE4: 1002800, currency: "EUR", source: "yahoo" });
    expect(await yahoo.getQuote("EXA")).toMatchObject({ priceE4: 2029700, currency: "USD" });
    expect(await yahoo.getQuote("EXB")).toMatchObject({ priceE4: 2987000, currency: "USD" });
    expect(await yahoo.getQuote("EXC")).toMatchObject({ priceE4: 340400, currency: "USD" });
    // Friday's close, though it is fetched on a Sunday: the exchange's day,
    // in the exchange's own time zone.
    expect((await yahoo.getQuote("EXFG.DE")).date).toBe("2026-09-18");
  });

  it("puts the day in the exchange's time zone, not the server's", () => {
    // 22:30 in Stockholm on the 18th is still the 18th in New York.
    const evening = Date.parse("2026-09-18T20:30:00Z") / 1000;
    expect(tradingDay(evening, "America/New_York")).toBe("2026-09-18");
    expect(tradingDay(evening, "Europe/Berlin")).toBe("2026-09-18");
    // A time zone Yahoo made up doesn't crash the fetch.
    expect(tradingDay(evening, "Mars/Olympus")).toBe("2026-09-18");
  });

  it("says what went wrong instead of guessing, when the endpoint changes", async () => {
    const changed = new YahooProvider(recorded({ EXA: '{"chart":{"result":[{"nothing":true}],"error":null}}' }));
    await expect(changed.getQuote("EXA")).rejects.toThrow(/svarade utan kurs för EXA. Endpointen kan ha ändrats/);

    const unknown = new YahooProvider(recorded({ XYZ: '{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}' }));
    await expect(unknown.getQuote("XYZ")).rejects.toThrow(/känner inte igen XYZ: No data found/);

    const html = new YahooProvider(recorded({ EXA: "<!DOCTYPE html><html>Are you a robot?</html>" }));
    await expect(html.getQuote("EXA")).rejects.toThrow(/inte är JSON/);

    const limited = new YahooProvider(recorded({ EXA: { status: 429, body: "" } }));
    await expect(limited.getQuote("EXA")).rejects.toThrow(/för många frågor ställts \(429\)/);

    const priceless = new YahooProvider(recorded({ EXA: '{"chart":{"result":[{"meta":{"currency":"USD","regularMarketPrice":null}}]}}' }));
    await expect(priceless.getQuote("EXA")).rejects.toThrow(/inget pris som går att räkna med/);
  });

  it("refuses a currency the tool doesn't count in", async () => {
    const yen = new YahooProvider(recorded({ "7203.T": '{"chart":{"result":[{"meta":{"currency":"JPY","regularMarketPrice":2800,"regularMarketTime":1789745758}}]}}' }));
    await expect(yen.getQuote("7203.T")).rejects.toThrow(/handlas i JPY/);
  });
});

describe("vad Yahoo faktiskt får för frågor", () => {
  it("asks the chart endpoint once per instrument, and for one day", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const yahoo = recorded(YAHOO);
    await syncPrices(db, TODAY, { quotes: new YahooProvider(yahoo), quotesFallback: null, fx: new RiksbankProvider(recorded(RIKSBANK)), fxFallback: null, sleep: async () => {} });

    // Four instruments, four requests: nothing asks twice, and nothing asks
    // for history. It is the chart endpoint their own pages call — never
    // v7/finance/quote — with the smallest range that still carries a price.
    expect(yahoo.urls).toEqual([
      "https://query1.finance.yahoo.com/v8/finance/chart/EXFG.DE?interval=1d&range=1d",
      "https://query1.finance.yahoo.com/v8/finance/chart/EXA?interval=1d&range=1d",
      "https://query1.finance.yahoo.com/v8/finance/chart/EXB?interval=1d&range=1d",
      "https://query1.finance.yahoo.com/v8/finance/chart/EXC?interval=1d&range=1d",
    ]);
  });

  it("asks as a browser would, because a plain script is refused far more often", async () => {
    const yahoo = recorded(YAHOO);
    await new YahooProvider(yahoo).getQuote("EXA");
    expect(yahoo.requests[0].headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 .*\bChrome\/\d/);
    expect(yahoo.requests[0].headers.Accept).toBe("application/json");
  });

  it("doesn't ask Yahoo for a rate the Riksbank already gave", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const fallback = recorded(YAHOO);
    await syncPrices(db, TODAY, {
      quotes: new YahooProvider(recorded(YAHOO)),
      quotesFallback: null,
      fx: new RiksbankProvider(recorded(RIKSBANK)),
      fxFallback: new YahooProvider(fallback),
      sleep: async () => {},
    });
    // The fallback exists for the day the Riksbank is quiet, and costs
    // nothing on every other day.
    expect(fallback.urls).toEqual([]);
  });
});

describe("Avanza", () => {
  const avanza = () => new AvanzaProvider(recorded(AVANZA));

  it("reads the price, the currency and the trading day from the public page", async () => {
    // The same four prices the portfolio has, from the other source — and
    // the same trading day, Friday the 18th, though this was fetched on a
    // Sunday. Yahoo's own numbers for these are identical to the öre.
    expect(await avanza().getQuote("1000001", "etf")).toEqual({ ticker: "1000001", priceE4: 1002800, currency: "EUR", date: "2026-09-18", source: "avanza" });
    expect(await avanza().getQuote("1000002")).toMatchObject({ priceE4: 2029700, currency: "USD", date: "2026-09-18" });
    expect(await avanza().getQuote("1000003")).toMatchObject({ priceE4: 2987000, currency: "USD", date: "2026-09-18" });
    expect(await avanza().getQuote("1000004")).toMatchObject({ priceE4: 340500, currency: "USD", date: "2026-09-18" });
  });

  it("asks the right part of the market guide, and nothing else", async () => {
    const fetcher = recorded(AVANZA);
    await new AvanzaProvider(fetcher).getQuote("1000002", "stock");
    await new AvanzaProvider(fetcher).getQuote("1000001", "etf");
    // One request each, no key and no cookie — the page anyone can open.
    // Exchange-traded funds sit with the rest of the exchange-traded
    // products, under 'certificate'.
    expect(fetcher.urls).toEqual([
      "https://www.avanza.se/_api/market-guide/stock/1000002",
      "https://www.avanza.se/_api/market-guide/certificate/1000001",
    ]);
    expect(fetcher.requests[0].headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 /);
  });

  it("wants an orderbook id, and says so when it is given a ticker", async () => {
    await expect(avanza().getQuote("EXA")).rejects.toThrow(/'EXA' är inget Avanza-id. Det är orderbokens nummer/);
    await expect(avanza().getQuote("  ")).rejects.toThrow(/inget Avanza-id att hämta kurs för/);
  });

  it("says what went wrong instead of guessing", async () => {
    const gone = new AvanzaProvider(recorded({ "stock/1000002": '{"orderbookId":"1000002","name":"Exempelbolaget A"}' }));
    await expect(gone.getQuote("1000002")).rejects.toThrow(/svarade utan kurs för 1000002. Endpointen kan ha ändrats/);

    const missing = new AvanzaProvider(recorded({}));
    await expect(missing.getQuote("999")).rejects.toThrow(/avanza svarade 404/);

    const yen = new AvanzaProvider(recorded({ "stock/1": '{"name":"Toyota","listing":{"currency":"JPY","countryCode":"JP"},"quote":{"last":2800,"timeOfLast":1789761600000}}' }));
    await expect(yen.getQuote("1")).rejects.toThrow(/Toyota handlas i JPY, som verktyget inte räknar med/);
  });

  it("refuses to date a price it can't place on a trading day", async () => {
    // A market the tool has no time zone for: the day could be off by one,
    // and a day off by one is valued at the wrong exchange rate.
    const far = new AvanzaProvider(recorded({ "stock/1": '{"name":"Något","listing":{"currency":"USD","countryCode":"AU"},"quote":{"last":10,"timeOfLast":1789761600000}}' }));
    await expect(far.getQuote("1")).rejects.toThrow(/noterar Något i AU, och då går det inte att säga vilken handelsdag/);

    const timeless = new AvanzaProvider(recorded({ "stock/1": '{"name":"Något","listing":{"currency":"USD","countryCode":"US"},"quote":{"last":10}}' }));
    await expect(timeless.getQuote("1")).rejects.toThrow(/gav ingen tidpunkt för kursen på Något, så handelsdagen är okänd/);
  });

  it("has no exchange rates to give", async () => {
    await expect(avanza().getFxRate("USDSEK", TODAY)).rejects.toThrow(/bara för kurser, inte för valutakurser \(USDSEK\)/);
  });
});

describe("Riksbanken", () => {
  it("gives the day's fixing, in millionths", async () => {
    const bank = new RiksbankProvider(recorded(RIKSBANK));
    expect(await bank.getFxRate("USDSEK", "2026-09-18")).toEqual({ pair: "USDSEK", rateE6: 9852970, date: "2026-09-18", source: "riksbank" });
    expect(await bank.getFxRate("EURSEK", "2026-09-18")).toEqual({ pair: "EURSEK", rateE6: 11291500, date: "2026-09-18", source: "riksbank" });
  });

  it("answers a weekend with Friday's rate, and says that it is Friday's", async () => {
    const bank = new RiksbankProvider(recorded(RIKSBANK));
    // Sunday the 20th: there is no fixing, and the answer carries the 18th.
    const sunday = await bank.getFxRate("USDSEK", TODAY);
    expect(sunday).toMatchObject({ date: "2026-09-18", rateE6: 9852970 });
    // A day in the middle of the window takes that day's, not the newest.
    expect((await bank.getFxRate("USDSEK", "2026-09-16")).rateE6).toBe(9783740);
  });

  it("asks for a window that ends on the day wanted", async () => {
    const fetcher = recorded(RIKSBANK);
    await new RiksbankProvider(fetcher).getFxRate("EURSEK", "2026-09-20");
    expect(fetcher.urls[0]).toBe("https://api.riksbank.se/swea/v1/Observations/SEKEURPMI/2026-09-10/2026-09-20");
  });

  it("says so when there is no rate at all, and has no quotes to give", async () => {
    const empty = new RiksbankProvider(recorded({ SEKUSDPMI: "[]" }));
    await expect(empty.getFxRate("USDSEK", TODAY)).rejects.toThrow(/ingen USDSEK-kurs de 10 dagarna före 2026-09-20/);
    await expect(new RiksbankProvider(recorded({})).getQuote("EXA")).rejects.toThrow(/bara valutakurser/);
  });
});

/** The portfolio, ready to be priced. */
function portfolio(db: Db) {
  return [EXFG, EXA, EXB, EXC].map((i) => createInstrument(db, i));
}

describe("the run every six hours", () => {
  const sources = (overrides: { yahoo?: Record<string, Answer>; riksbank?: Record<string, string> } = {}) => ({
    quotes: new YahooProvider(recorded({ ...YAHOO, ...overrides.yahoo })),
    quotesFallback: null,
    fx: new RiksbankProvider(recorded({ ...RIKSBANK, ...overrides.riksbank })),
    fxFallback: new YahooProvider(recorded({ ...YAHOO, ...overrides.yahoo })),
    sleep: async () => {},
  });

  it("stores one price per instrument and day, and the rates they need", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const result = await syncPrices(db, TODAY, sources());

    expect(result.ok).toBe(true);
    expect(result.prices.map((p) => [p.name, p.priceE4, p.date])).toEqual([
      ["Exempelfond Global Index", 1002800, "2026-09-18"],
      ["Exempelbolaget A", 2029700, "2026-09-18"],
      ["Exempelbolaget B", 2987000, "2026-09-18"],
      ["Exempelbolaget C", 340400, "2026-09-18"],
    ]);
    // One pair per currency held, not one per instrument.
    expect(result.rates.map((r) => [r.pair, r.rateE6, r.date])).toEqual([
      ["EURSEK", 11291500, "2026-09-18"],
      ["USDSEK", 9852970, "2026-09-18"],
    ]);
    expect(db.select().from(priceSnapshots).all()).toHaveLength(4);
    expect(db.select().from(fxRates).all()).toHaveLength(2);
  });

  it("fetching again the same day replaces the price, it doesn't add one", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    await syncPrices(db, TODAY, sources());
    const moved = { EXA: JSON.stringify({ chart: { result: [{ meta: { currency: "USD", regularMarketPrice: 208.5, regularMarketTime: 1789745758, exchangeTimezoneName: "America/New_York" } }] } }) };
    await syncPrices(db, TODAY, sources({ yahoo: moved }));

    expect(db.select().from(priceSnapshots).all()).toHaveLength(4);
    expect([...latestPrices(db).values()].find((p) => p.priceE4 === 2085000)).toBeDefined();
  });

  it("one instrument being quiet doesn't cost the others their prices", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    // A symbol Yahoo doesn't know is about that instrument, not the source —
    // unlike a 429, which pauses the whole source (see 'efter en spärr').
    const gone = { EXB: '{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}' };
    const result = await syncPrices(db, TODAY, sources({ yahoo: gone }));

    expect(result.ok).toBe(false);
    expect(result.prices.filter((p) => p.ok)).toHaveLength(3);
    expect(result.prices.find((p) => !p.ok)).toMatchObject({ name: "Exempelbolaget B", error: expect.stringContaining("känner inte igen EXB") });
    // Nothing stored for the one that failed: no price at all beats a wrong one.
    expect(db.select().from(priceSnapshots).all()).toHaveLength(3);
  });

  it("falls back to Yahoo's rate when the Riksbank is quiet, and says which source it was", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXFG);
    const result = await syncPrices(db, TODAY, sources({ riksbank: { SEKEURPMI: "[]" } }));

    // Yahoo's pair is a market rate with a clock of its own — it carries
    // Sunday, while the Riksbank's fixing would have said Friday. That is
    // exactly why the Riksbank is asked first: 11,288 against the fixing's
    // 11,2915.
    expect(result.rates).toEqual([{ pair: "EURSEK", ok: true, date: "2026-09-20", rateE6: 11288000, source: "yahoo" }]);
    expect(rateOn(db, "EURSEK", TODAY)).toMatchObject({ source: "yahoo" });
  });

  it("gives up on a rate when both sources are quiet, and keeps both reasons", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const result = await syncPrices(db, TODAY, { ...sources({ riksbank: { SEKUSDPMI: "[]" } }), fxFallback: new YahooProvider(recorded({})) });

    expect(result.ok).toBe(false);
    expect(result.rates[0]).toMatchObject({ pair: "USDSEK", ok: false });
    expect(result.rates[0].error).toMatch(/Riksbanken har ingen USDSEK-kurs/);
    expect(result.rates[0].error).toMatch(/yahoo svarade 404/);
    expect(db.select().from(fxRates).all()).toEqual([]);
  });

  it("refuses a price in another currency than the instrument's", async () => {
    const db = freshDb({ seeded: true });
    // The same fund, but the London listing in USD: the price is real and the
    // valuation would be wrong by the whole EUR/USD difference.
    createInstrument(db, { ...EXFG, tickerYahoo: "EXFG.L" });
    const london = { "EXFG.L": JSON.stringify({ chart: { result: [{ meta: { currency: "USD", regularMarketPrice: 156.2, regularMarketTime: 1789745758 } }] } }) };
    const result = await syncPrices(db, TODAY, sources({ yahoo: london }));

    expect(result.prices[0]).toMatchObject({ ok: false, error: "EXFG.L handlas i USD, men Exempelfond Global Index är i EUR. Rätta tickern eller valutan." });
    expect(db.select().from(priceSnapshots).all()).toEqual([]);
  });

  it("skips an instrument without a ticker, and a portfolio with nothing in it", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, { ...EXC, tickerYahoo: null });
    const result = await syncPrices(db, TODAY, sources());
    expect(result.prices).toEqual([]);
    // The currency is still held, so the rate is still worth having.
    expect(result.rates.map((r) => r.pair)).toEqual(["USDSEK"]);
    expect(result.ok).toBe(true);
  });

  it("knows how old the newest price is", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    expect(priceAgeDays(db, TODAY)).toBeNull();
    await syncPrices(db, TODAY, sources());
    expect(priceAgeDays(db, TODAY)).toBe(2);
    expect(priceAgeDays(db, "2026-09-18")).toBe(0);
  });

  it("knows which pair a currency needs", () => {
    expect(pairFor("USD")).toBe("USDSEK");
    expect(pairFor("EUR")).toBe("EURSEK");
    expect(pairFor("SEK")).toBeNull();
  });
});

describe("reservkällan", () => {
  const LIMITED: Answer = { status: 429, body: "" };

  /** Yahoo first, Avanza after it — the chain as it runs in production. */
  const chain = (yahoo: Record<string, Answer> = YAHOO, avanza: Record<string, Answer> = AVANZA) => {
    const first = recorded(yahoo);
    const second = recorded(avanza);
    return {
      first,
      second,
      opts: {
        quotes: new YahooProvider(first),
        quotesFallback: new AvanzaProvider(second),
        fx: new RiksbankProvider(recorded(RIKSBANK)),
        fxFallback: null,
        sleep: async () => {},
        log: () => {},
      },
    };
  };

  it("costs nothing on a day Yahoo answers", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const { second, opts } = chain();
    const result = await syncPrices(db, TODAY, opts);

    expect(result.ok).toBe(true);
    expect(result.prices.map((p) => p.source)).toEqual(["yahoo", "yahoo", "yahoo", "yahoo"]);
    expect(second.urls).toEqual([]);
  });

  it("carries the whole portfolio when Yahoo blocks the address", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    // The day this was written: every Yahoo request refused. The first one
    // pauses the source, the other three don't even ask it, and all four
    // prices arrive from Avanza anyway.
    const { first, opts } = chain({ "EXFG.DE": LIMITED, EXA: LIMITED, EXB: LIMITED, EXC: LIMITED });
    const result = await syncPrices(db, TODAY, opts);

    expect(first.urls).toHaveLength(1);
    expect(result.ok).toBe(true);
    expect(result.prices.map((p) => [p.name, p.priceE4, p.date, p.source])).toEqual([
      ["Exempelfond Global Index", 1002800, "2026-09-18", "avanza"],
      ["Exempelbolaget A", 2029700, "2026-09-18", "avanza"],
      ["Exempelbolaget B", 2987000, "2026-09-18", "avanza"],
      ["Exempelbolaget C", 340500, "2026-09-18", "avanza"],
    ]);
    // Three of the four are the same to the öre as Yahoo's own numbers.
    // Exempelbolaget C differs by an öre — 34,05 against 34,04 — which is what two
    // sources rounding the same close look like, and why the row says
    // which one it came from.
    expect(db.select().from(priceSnapshots).all().map((p) => p.source)).toEqual(["avanza", "avanza", "avanza", "avanza"]);
  });

  it("tries the next source when a ticker points at the wrong listing", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, { ...EXFG, tickerYahoo: "EXFG.L" });
    // The London listing of the same fund, in USD: a real price, and a
    // valuation that would be wrong by the whole EUR/USD difference. Avanza's
    // Xetra listing is asked instead, and is the one stored.
    const london = { "EXFG.L": JSON.stringify({ chart: { result: [{ meta: { currency: "USD", regularMarketPrice: 156.2, regularMarketTime: 1789745758 } }] } }) };
    const result = await syncPrices(db, TODAY, chain(london).opts);

    expect(result.prices[0]).toMatchObject({ ok: true, priceE4: 1002800, currency: "EUR", source: "avanza" });
    expect(db.select().from(priceSnapshots).all()).toHaveLength(1);
  });

  it("keeps every reason when neither source can answer", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const result = await syncPrices(db, TODAY, chain({ EXA: LIMITED }, {}).opts);

    expect(result.ok).toBe(false);
    expect(result.prices[0].error).toMatch(/för många frågor ställts \(429\)/);
    expect(result.prices[0].error).toMatch(/avanza svarade 404/);
    expect(db.select().from(priceSnapshots).all()).toEqual([]);
  });

  it("asks only the sources that know the instrument by some name", async () => {
    const db = freshDb({ seeded: true });
    // Yahoo knows this one and Avanza doesn't; nobody knows the other.
    createInstrument(db, { ...EXB, tickerAvanza: null });
    createInstrument(db, { ...EXC, tickerYahoo: null, tickerAvanza: null });
    const { second, opts } = chain();
    const result = await syncPrices(db, TODAY, opts);

    // One row, not two: an instrument no source has a name for is nothing to
    // fetch, which is not the same as a fetch that failed.
    expect(result.prices.map((p) => [p.name, p.source])).toEqual([["Exempelbolaget B", "yahoo"]]);
    expect(result.ok).toBe(true);
    expect(second.urls).toEqual([]);
  });
});

describe("efter en spärr", () => {
  const HOUR = 60 * 60_000;
  const LIMITED: Answer = { status: 429, body: "" };
  /** The wait out of a log line: 'Väntar 30 minuter — nästa försök …'. */
  const waitIn = (line: string) => line.match(/Väntar ([^—]+?)(?:,| —)/)?.[1] ?? line;

  /** A run against a Yahoo that answers however the test says, on a clock it owns. */
  function runner(db: Db) {
    const clock = { ms: Date.parse("2026-09-20T12:00:00Z") };
    const logs: string[] = [];
    const run = (yahoo: Record<string, Answer>) => {
      const fetcher = recorded(yahoo);
      return syncPrices(db, TODAY, {
        quotes: new YahooProvider(fetcher),
        quotesFallback: null,
        fx: new RiksbankProvider(recorded(RIKSBANK)),
        fxFallback: null,
        sleep: async () => {},
        now: () => clock.ms,
        log: (text) => void logs.push(text),
      }).then((result) => ({ result, asked: fetcher.urls.length }));
    };
    /** Sit out whatever pause is in force. */
    const waitItOut = () => void (clock.ms += pausedForMs(db, "yahoo", clock.ms) ?? 0);
    return { clock, logs, run, waitItOut };
  }

  it("pauses the source instead of asking the next three anyway", async () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const { logs, run } = runner(db);
    const { result, asked } = await run({ "EXFG.DE": LIMITED, EXA: LIMITED, EXB: LIMITED, EXC: LIMITED });

    // One refusal is enough to learn from. The other three are not asked.
    expect(asked).toBe(1);
    expect(result.prices[0].error).toMatch(/för många frågor ställts \(429\)/);
    expect(result.prices[3].error).toBe("yahoo är pausad efter en spärr — nästa försök om 30 minuter.");
    // The Riksbank is another source, and has done nothing wrong.
    expect(result.rates.map((r) => [r.pair, r.ok])).toEqual([
      ["EURSEK", true],
      ["USDSEK", true],
    ]);
    expect(logs).toEqual(["Kurskällan yahoo spärrade (429). Väntar 30 minuter — nästa försök 2026-09-20T12:30:00.000Z."]);
  });

  it("waits longer every time, and never longer than six hours", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const { logs, run, waitItOut } = runner(db);

    for (let i = 0; i < 6; i++) {
      await run({ EXA: LIMITED });
      waitItOut();
    }
    // The ceiling is ten minutes short of six hours, so the six-hourly run after it asks again.
    expect(logs.map(waitIn)).toEqual(["30 minuter", "1 timme", "2 timmar", "4 timmar", "6 timmar", "6 timmar"]);
  });

  it("is over before the next six-hourly run, even at the ceiling", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const { clock, run } = runner(db);
    // Refused at 06:30:05 on the ladder's top step: paused until before 12:30.
    for (let i = 0; i < 5; i++) {
      await run({ EXA: LIMITED });
      clock.ms += pausedForMs(db, "yahoo", clock.ms)!;
    }
    await run({ EXA: LIMITED });
    expect(pausedForMs(db, "yahoo", clock.ms)).toBe(MAX_WAIT_MS);
    clock.ms += 6 * HOUR - 5_000;
    expect(pausedForMs(db, "yahoo", clock.ms)).toBeNull();
  });

  it("waits two days at most, however long the source asks for", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const { clock, run } = runner(db);
    await run({ EXA: { ...LIMITED, headers: { "retry-after": String(365 * 24 * 3600) } } });
    expect(pausedForMs(db, "yahoo", clock.ms)).toBe(48 * HOUR);
  });

  it("refuses a Yahoo price without a time, so Avanza is asked instead of an old price getting today's date", async () => {
    const noTime = new YahooProvider(recorded({ EXA: '{"chart":{"result":[{"meta":{"currency":"USD","regularMarketPrice":202.97}}]}}' }));
    await expect(noTime.getQuote("EXA")).rejects.toThrow(/saknar tidpunkt/);
    const rate = new YahooProvider(recorded({ "USDSEK=X": '{"chart":{"result":[{"meta":{"currency":"SEK","regularMarketPrice":9.5}}]}}' }));
    await expect(rate.getFxRate("USDSEK", "2026-09-18")).rejects.toThrow(/saknar tidpunkt/);
  });

  it("doesn't ask again while the pause is on, however often the button is pressed", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const { clock, run } = runner(db);

    await run({ EXA: LIMITED });
    clock.ms += 29 * 60_000;
    expect((await run({ EXA: YAHOO.EXA })).asked).toBe(0);
    // Half past, and the price it would have had is fetched.
    clock.ms += 60_000;
    const { result, asked } = await run({ EXA: YAHOO.EXA });
    expect(asked).toBe(1);
    expect(result.prices[0]).toMatchObject({ ok: true, priceE4: 2029700 });
  });

  it("waits as long as the source asked, when the source asked for longer", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const { clock, logs, run } = runner(db);

    // A whole day, and uncapped: it knows when it will answer, we don't.
    await run({ EXA: { ...LIMITED, headers: { "retry-after": "86400" } } });
    expect(pausedForMs(db, "yahoo", clock.ms)).toBe(24 * HOUR);
    expect(waitIn(logs[0])).toBe("24 timmar");
    expect(logs[0]).toContain("som källan själv bad om");

    // Ten seconds is a rate limit all the same, so the ladder decides — and
    // the ladder is where the day-long wait left it, at its second step.
    clock.ms += 24 * HOUR;
    await run({ EXA: { ...LIMITED, headers: { "retry-after": "10" } } });
    expect(pausedForMs(db, "yahoo", clock.ms)).toBe(HOUR);
  });

  it("reads Retry-After as seconds or as a date, and shrugs at anything else", () => {
    expect(retryAfterMs("120")).toBe(120_000);
    expect(retryAfterMs(new Date(Date.now() + 3 * HOUR).toUTCString())).toBeGreaterThan(2.9 * HOUR);
    expect(retryAfterMs("0")).toBeUndefined();
    expect(retryAfterMs("i morgon")).toBeUndefined();
    expect(retryAfterMs(null)).toBeUndefined();
    // A date already passed is not a wait.
    expect(retryAfterMs(new Date(Date.now() - HOUR).toUTCString())).toBeUndefined();
  });

  it("a price that arrives pays off the whole ladder", async () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, EXA);
    const { clock, logs, run, waitItOut } = runner(db);

    await run({ EXA: LIMITED });
    waitItOut();
    await run({ EXA: LIMITED });
    waitItOut();
    await run({ EXA: YAHOO.EXA });
    expect(pausedForMs(db, "yahoo", clock.ms)).toBeNull();

    // Back to the first step, not the third.
    await run({ EXA: LIMITED });
    expect(pausedForMs(db, "yahoo", clock.ms)).toBe(FIRST_WAIT_MS);
    expect(logs.map(waitIn)).toEqual(["30 minuter", "1 timme", "30 minuter"]);
  });

  it("counts the steps and says them in Swedish", () => {
    expect(nextStepMs(null)).toBe(FIRST_WAIT_MS);
    expect(nextStepMs(FIRST_WAIT_MS)).toBe(HOUR);
    expect(nextStepMs(4 * HOUR)).toBe(MAX_WAIT_MS);
    expect(nextStepMs(MAX_WAIT_MS)).toBe(MAX_WAIT_MS);
    expect([60_000, 30 * 60_000, HOUR, 2.5 * HOUR, 6 * HOUR].map(humanWait)).toEqual(["1 minut", "30 minuter", "1 timme", "2,5 timmar", "6 timmar"]);
  });
});

describe("what a failed fetch must never do", () => {
  it("leaves the price that is there, with the day it is from", async () => {
    const db = freshDb({ seeded: true });
    const [fund] = portfolio(db);
    await syncPrices(db, TODAY, { quotes: new YahooProvider(recorded(YAHOO)), quotesFallback: null, fx: new RiksbankProvider(recorded(RIKSBANK)), fxFallback: null, sleep: async () => {} });

    // Everything goes quiet for days.
    const dead = { quotes: new YahooProvider(recorded({})), quotesFallback: null, fx: new RiksbankProvider(recorded({})), fxFallback: null, sleep: async () => {} };
    const result = await syncPrices(db, "2026-09-25", dead);
    expect(result.ok).toBe(false);

    const price = latestPrices(db).get(fund.id)!;
    expect(price).toMatchObject({ priceE4: 1002800, date: "2026-09-18" });
    // Seven days old, and the interface has the date to say so.
    expect(priceAgeDays(db, "2026-09-25")).toBe(7);
    expect(new PriceError("x", "yahoo").source).toBe("yahoo");
  });
});
