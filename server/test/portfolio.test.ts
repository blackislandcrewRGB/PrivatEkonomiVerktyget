import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { fxRates, priceSnapshots } from "../src/db/schema.js";
import { createHolding, setHoldingValue } from "../src/savings/savings.js";
import { createInstrument, createTrade, parsePrice, parseQuantity, parseRate, type InstrumentInput } from "../src/savings/instruments.js";
import { BET_FLOOR, BET_LIMIT, investedByInstrument, oldPriceLimit, policyFor, reconcile, setCash, valuePortfolio } from "../src/savings/portfolio.js";
import { findings } from "../src/watch/watch.js";
import { buildOverview } from "../src/overview/overview.js";
import { freshDb } from "./helpers.js";

/**
 * Värderingen, räknad på en påhittad portfölj.
 *
 * Every number in here is made up: the holdings, the average purchase
 * prices, the closing prices and the exchange rates (USD/SEK 9,95 and
 * EUR/SEK 11,05, as if fixed on 18 September 2026). They are round enough
 * that every expected value can be checked by hand — quantity × price × rate
 * for each holding, the zones as shares of the sum, the cash added on top —
 * which is the point of testing a valuation at all, and that the figure
 * entered from a broker is reconciled against that sum, not against a
 * guess.
 */

type Db = ReturnType<typeof freshDb>;

const DAY = "2026-09-18";
const TODAY = "2026-09-20";
const USD = parseRate("9,95")!;
const EUR = parseRate("11,05")!;

interface Position {
  spec: InstrumentInput;
  quantity: string;
  /** The closing price on 18 September. */
  price: string;
  /** Avanza's average purchase price (GAV). */
  gav: string;
}

const PORTFOLIO: Position[] = [
  { spec: { name: "Exempelfond Global Index", isin: "IE00EXEMPEL1", currency: "EUR", kind: "etf", zone: "base", tickerYahoo: "EXFG.DE" }, quantity: "50", price: "150,40", gav: "100,00" },
  { spec: { name: "Exempelbolaget A", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXA" }, quantity: "12", price: "230,50", gav: "200,00" },
  { spec: { name: "Exempelbolaget B", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXB" }, quantity: "5", price: "120,25", gav: "151,00" },
  { spec: { name: "Exempelbolaget C", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXC" }, quantity: "30", price: "25,10", gav: "40,00" },
];

/** The whole portfolio: instruments, opening trades, prices, rates and cash. */
function portfolio(db: Db, opts: { prices?: boolean; rates?: boolean; cash?: boolean } = {}) {
  const ids = new Map<string, number>();
  for (const p of PORTFOLIO) {
    const instrument = createInstrument(db, p.spec);
    ids.set(p.spec.name, instrument.id);
    createTrade(db, {
      instrumentId: instrument.id,
      account: "isk",
      side: "opening",
      date: DAY,
      quantityE4: parseQuantity(p.quantity)!,
      priceE4: parsePrice(p.gav)!,
    });
    if (opts.prices !== false) {
      db.insert(priceSnapshots).values({ instrumentId: instrument.id, date: DAY, priceE4: parsePrice(p.price)!, currency: p.spec.currency, source: "yahoo" }).run();
    }
  }
  if (opts.rates !== false) {
    db.insert(fxRates).values({ pair: "USDSEK", date: DAY, rateE6: USD, source: "riksbank" }).run();
    db.insert(fxRates).values({ pair: "EURSEK", date: DAY, rateE6: EUR, source: "riksbank" }).run();
  }
  // 10 000,00 kr standing in the ISK, which the broker counts in its own total.
  if (opts.cash !== false) setCash(db, "isk", DAY, 1000000);
  return ids;
}

/** Swedish formatting uses no-break and thin spaces; a sentence is a sentence. */
const plain = (text: string) => text.replace(/\s/g, " ");

const valueOf = (db: Db, name: string, on = TODAY) => valuePortfolio(db, on).instruments.find((i) => i.name === name)!;

describe("marknadsvärdet", () => {
  it("är antal × kurs × valutakursen för kursens egen dag", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const value = valuePortfolio(db, TODAY);

    expect(value.holdings.map((h) => [h.name, h.valueOre])).toEqual([
      ["Exempelfond Global Index", 8309600],
      ["Exempelbolaget A", 2752170],
      ["Exempelbolaget B", 598244],
      ["Exempelbolaget C", 749235],
    ]);
    // 124 092,49 kr: 50 × 150,40 × 11,05, 12 × 230,50 × 9,95 and so on, summed.
    expect(value.totalOre).toBe(12409249);
    expect(value.missing).toEqual([]);
    // The price is Friday's, and the interface has the date to say so.
    expect(value.priceDate).toBe(DAY);
    expect(value.holdings[0]).toMatchObject({ priceE4: 1504000, priceDate: DAY, priceSource: "yahoo", rateE6: EUR, rateDate: DAY, rateSource: "riksbank" });
  });

  it("räknar per konto, med likviderna som en egen post", () => {
    const db = freshDb({ seeded: true });
    const ids = portfolio(db);
    // One Exempelbolaget A in the ordinary depot as well.
    createTrade(db, { instrumentId: ids.get("Exempelbolaget A")!, account: "depot", side: "buy", date: DAY, quantityE4: parseQuantity("1")!, priceE4: parsePrice("230,50")! });

    const value = valuePortfolio(db, TODAY);
    expect(value.accounts).toEqual([
      { account: "isk", securitiesOre: 12409249, cashOre: 1000000, cashDate: DAY, totalOre: 13409249 },
      { account: "depot", securitiesOre: 229348, cashOre: null, cashDate: null, totalOre: 229348 },
    ]);
  });

  it("lämnar ett innehav utan kurs utan värde, i stället för att gissa noll", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    // Exempelbolaget C's price never arrived.
    db.delete(priceSnapshots).where(undefined as never).run();
    for (const p of PORTFOLIO.filter((x) => x.spec.name !== "Exempelbolaget C")) {
      const id = valuePortfolio(db, TODAY).holdings.find((h) => h.name === p.spec.name)!.instrumentId;
      db.insert(priceSnapshots).values({ instrumentId: id, date: DAY, priceE4: parsePrice(p.price)!, currency: p.spec.currency, source: "yahoo" }).run();
    }

    const value = valuePortfolio(db, TODAY);
    expect(value.missing.map((h) => [h.name, h.missing])).toEqual([["Exempelbolaget C", "price"]]);
    expect(value.totalOre).toBe(8309600 + 2752170 + 598244);
    // The zones are still worked out, from what is valued.
    expect(value.zones.bet.valueOre).toBe(2752170 + 598244);
  });

  it("lämnar ett innehav utan valutakurs utan värde", () => {
    const db = freshDb({ seeded: true });
    portfolio(db, { rates: false });
    db.insert(fxRates).values({ pair: "EURSEK", date: DAY, rateE6: EUR, source: "riksbank" }).run();

    const value = valuePortfolio(db, TODAY);
    expect(value.missing.map((h) => [h.name, h.missing])).toEqual([
      ["Exempelbolaget A", "rate"],
      ["Exempelbolaget B", "rate"],
      ["Exempelbolaget C", "rate"],
    ]);
    expect(value.totalOre).toBe(8309600);
  });

  it("använder inte en kurs som är nyare än dagen man frågar om", () => {
    const db = freshDb({ seeded: true });
    const ids = portfolio(db);
    db.insert(priceSnapshots).values({ instrumentId: ids.get("Exempelbolaget B")!, date: "2026-09-25", priceE4: parsePrice("140,00")!, currency: "USD", source: "yahoo" }).run();

    expect(valueOf(db, "Exempelbolaget B", "2026-09-20").valueOre).toBe(598244);
    // On the later day the newer price counts — and the rate is still the one
    // that has a fixing, the 18th.
    expect(valueOf(db, "Exempelbolaget B", "2026-09-26").valueOre).toBe(696500);
  });
});

describe("zonerna och policyn", () => {
  it("delar portföljen i bas och bet, och säger var den står", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const { zones, policy } = valuePortfolio(db, TODAY);

    expect(zones.base).toMatchObject({ valueOre: 8309600, targetShare: 0.8 });
    expect(zones.bet).toMatchObject({ valueOre: 4099649, targetShare: 0.2 });
    expect(zones.bet.share).toBeCloseTo(0.3304, 4);
    // Over the ceiling as the portfolio actually stands.
    expect(policy).toMatchObject({ state: "over", trimOre: 2022249, toBaseOre: 3989347 });
    expect(plain(policy.text)).toBe(
      "Bet-zonen är 33 % av portföljen — över 25 %. Sälj för 20 222 kr så är den på 20 %, eller lägg 39 893 kr i basen så är den på 25 %.",
    );
  });

  it("räknar trimningen och påfyllnaden så att de faktiskt landar rätt", () => {
    // 100 000 kr, 30 % in the bet zone.
    const policy = policyFor(7_000_000, 3_000_000);
    expect(policy).toMatchObject({ state: "over", trimOre: 1_250_000, toBaseOre: 2_000_000 });
    // Selling 12 500 kr of it: 17 500 of 87 500 is the 20 % target.
    expect((3_000_000 - policy.trimOre!) / (10_000_000 - policy.trimOre!)).toBeCloseTo(0.2, 10);
    // Putting 20 000 kr in the base instead: 30 000 of 120 000 is 25 %.
    expect(3_000_000 / (10_000_000 + policy.toBaseOre!)).toBeCloseTo(BET_LIMIT, 10);
  });

  it("säger till när bet-zonen är under 15 %, utan att föreslå påfyllnad", () => {
    const policy = policyFor(8_800_000, 1_200_000);
    expect(policy).toMatchObject({ state: "under", trimOre: null, toBaseOre: null, roomOre: null });
    expect(policy.text).toBe("Bet-zonen är 12 % av portföljen — under 15 %. Den fylls inte på; nya pengar går till basen.");
    expect(policy.betShare).toBeCloseTo(BET_FLOOR - 0.03, 10);
  });

  it("ger utrymmet kvar när zonen ligger där den ska", () => {
    const policy = policyFor(8_000_000, 2_000_000);
    expect(policy).toMatchObject({ state: "within", roomOre: 666_667 });
    expect(plain(policy.text)).toBe("Bet-zonen är 20 % av portföljen, inom 15–25 %. Den kan växa 6 667 kr innan den når 25 %.");
    // Growing by that much puts it exactly at the ceiling.
    expect((2_000_000 + policy.roomOre!) / (10_000_000 + policy.roomOre!)).toBeCloseTo(BET_LIMIT, 6);
  });

  it("varnar först över 25 %: exakt 25 % är inom", () => {
    expect(policyFor(7_500_000, 2_500_000).state).toBe("within");
    expect(policyFor(7_499_000, 2_501_000).state).toBe("over");
    expect(policyFor(8_500_000, 1_500_000).state).toBe("within");
    expect(policyFor(8_501_000, 1_499_000).state).toBe("under");
  });

  it("säger ingenting alls om det inte finns något värderat", () => {
    expect(policyFor(0, 0)).toMatchObject({ state: "unknown", betShare: null, text: "Inget värderat innehav att fördela ännu." });
  });
});

describe("insatt netto", () => {
  it("räknas i kronor som de betalades, courtaget inräknat", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const value = valuePortfolio(db, TODAY);

    expect(value.instruments.map((i) => [i.name, i.investedOre])).toEqual([
      ["Exempelfond Global Index", 5525000],
      ["Exempelbolaget A", 2388000],
      ["Exempelbolaget B", 751225],
      ["Exempelbolaget C", 1194000],
    ]);
    expect(value.investedOre).toBe(9858225);
  });

  it("tar valutakursen från affären när den är känd, inte dagens", () => {
    const db = freshDb({ seeded: true });
    const ids = portfolio(db);
    const shareB = ids.get("Exempelbolaget B")!;
    // Five more Exempelbolaget B shares, bought when the dollar was 9,50 rather
    // than today's 9,95. The difference is currency, and it is real money.
    createTrade(db, { instrumentId: shareB, account: "depot", side: "buy", date: DAY, quantityE4: parseQuantity("5")!, priceE4: parsePrice("151,00")!, fxRateE6: parseRate("9,50")! });

    const invested = investedByInstrument(db).get(shareB)!;
    // 751 225 öre at the day's rate, 717 250 at the rate that was paid.
    expect(invested).toEqual({ investedOre: 751225 + 717250, unknown: false });
  });

  it("räknar en försäljning som pengar tillbaka, minus sitt courtage", () => {
    const db = freshDb({ seeded: true });
    const ids = portfolio(db);
    createTrade(db, {
      instrumentId: ids.get("Exempelbolaget C")!,
      account: "isk",
      side: "sell",
      date: DAY,
      quantityE4: parseQuantity("12")!,
      priceE4: parsePrice("25,10")!,
      feeOre: 2500,
    });

    // Sold 12 at 25,10 with the dollar at 9,95: 2 996,94 kr back, less
    // the 25 kr it cost to sell.
    expect(valueOf(db, "Exempelbolaget C").investedOre).toBe(1194000 - (299694 - 2500));
    expect(valueOf(db, "Exempelbolaget C").quantityE4).toBe(parseQuantity("18"));
  });

  it("säger 'vet inte' hellre än ett fel belopp när kursen saknas", () => {
    const db = freshDb({ seeded: true });
    portfolio(db, { rates: false });

    const value = valuePortfolio(db, TODAY);
    expect(value.instruments.every((i) => i.investedUnknown && i.investedOre === null)).toBe(true);
    expect(value.investedOre).toBeNull();
  });
});

describe("avstämningen mot det inmatade värdet", () => {
  it("räknar likviderna som en egen post, inte som skillnad", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const holding = createHolding(db, "Avanza");
    setHoldingValue(db, holding.id, "2026-09-19", 13400000, TODAY);

    const check = reconcile(db, TODAY);
    expect(check).toMatchObject({
      securitiesOre: 12409249,
      cashOre: 1000000,
      cashDate: DAY,
      computedOre: 13409249,
      enteredOre: 13400000,
      differenceOre: -9249,
    });
    // 92 kr of 134 000 is rounding and a broker's own exchange rate.
    expect(plain(check.text)).toBe("Skillnad −92 kr — avrundning, avgifter och att Avanza räknar med sin egen växelkurs.");
  });

  it("räknar på dagen värdet matades in, inte på dagens kurser", () => {
    const db = freshDb({ seeded: true });
    const ids = portfolio(db);
    const holding = createHolding(db, "Avanza");
    setHoldingValue(db, holding.id, "2026-09-19", 13400000, TODAY);

    // Monday: the market rises, and cash buys two Exempelbolaget D — neither is in Saturday's value.
    const MONDAY = "2026-09-21";
    const shareD = createInstrument(db, { name: "Exempelbolaget D", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXD" });
    createTrade(db, { instrumentId: shareD.id, account: "isk", side: "buy", date: MONDAY, quantityE4: parseQuantity("2")!, priceE4: parsePrice("300,00")!, feeOre: 4900, fxRateE6: parseRate("10,05")! });
    db.insert(fxRates).values({ pair: "USDSEK", date: MONDAY, rateE6: parseRate("10,10")!, source: "riksbank" }).run();
    db.insert(fxRates).values({ pair: "EURSEK", date: MONDAY, rateE6: parseRate("11,20")!, source: "riksbank" }).run();
    for (const [name, price] of [["Exempelfond Global Index", "152,00"], ["Exempelbolaget A", "235,00"], ["Exempelbolaget B", "122,00"], ["Exempelbolaget C", "24,50"]] as const) {
      db.insert(priceSnapshots).values({ instrumentId: ids.get(name)!, date: MONDAY, priceE4: parsePrice(price)!, currency: name.startsWith("Exempelfond") ? "EUR" : "USD", source: "yahoo" }).run();
    }
    db.insert(priceSnapshots).values({ instrumentId: shareD.id, date: MONDAY, priceE4: parsePrice("320,00")!, currency: "USD", source: "yahoo" }).run();
    setCash(db, "isk", "2026-09-22", 392100);

    // Tuesday's check still counts Saturday: Friday's prices, the cash before the purchase.
    const check = reconcile(db, "2026-09-22");
    expect(check).toMatchObject({ on: "2026-09-19", securitiesOre: 12409249, cashOre: 1000000, cashDate: DAY, computedOre: 13409249, differenceOre: -9249 });
    expect(plain(check.text)).toBe("Skillnad −92 kr — avrundning, avgifter och att Avanza räknar med sin egen växelkurs.");

    // A value entered on Tuesday is counted on Tuesday, with Exempelbolaget D and the cash left after it.
    const tuesday = valuePortfolio(db, "2026-09-22").totalOre + 392100;
    setHoldingValue(db, holding.id, "2026-09-22", tuesday, "2026-09-22");
    expect(reconcile(db, "2026-09-22")).toMatchObject({ on: "2026-09-22", cashOre: 392100, differenceOre: 0 });
  });

  it("stämmer inte av ett värde från före innehaven", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const holding = createHolding(db, "Avanza");
    setHoldingValue(db, holding.id, "2026-09-01", 12000000, TODAY);
    expect(reconcile(db, TODAY)).toMatchObject({ on: "2026-09-01", differenceOre: null, text: "Det inmatade värdet är äldre än innehaven. Mata in ett nytt värde för att stämma av." });
  });

  it("ropar till när skillnaden är för stor för att vara avrundning", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const holding = createHolding(db, "Avanza");
    setHoldingValue(db, holding.id, "2026-09-19", 15000000, TODAY);

    expect(plain(reconcile(db, TODAY).text)).toBe("Skillnad 15 908 kr. Kolla likviderna, en affär som inte lagts in, eller en utdelning.");
  });

  it("väntar hellre än stämmer av mot ett halvt underlag", () => {
    const db = freshDb({ seeded: true });
    portfolio(db, { rates: false });
    const holding = createHolding(db, "Avanza");
    setHoldingValue(db, holding.id, "2026-09-19", 13400000, TODAY);

    expect(reconcile(db, TODAY).text).toBe("Avstämningen väntar på kurser för alla innehav.");
  });

  it("säger ifrån när det inte finns något inmatat att stämma av mot", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    expect(reconcile(db, TODAY)).toMatchObject({ enteredOre: null, differenceOre: null, text: "Inget värde inmatat under Sparande att stämma av mot." });
  });
});

describe("Vakten om sparandet", () => {
  const plainAll = (db: Db, on = TODAY) => findings(db, on).map((f) => [f.kind, plain(f.text)]);

  it("säger till en gång i månaden när bet-zonen passerat 25 %", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);

    const found = plainAll(db).filter(([kind]) => kind === "bet_zone_over");
    expect(found).toEqual([["bet_zone_over", "Bet-zonen är 33 % av portföljen — över 25 %. Sälj för 20 222 kr så är den på 20 %, eller lägg 39 893 kr i basen så är den på 25 %."]]);
    // The key holds the month: said once, not once per sync, and asked again
    // next month if it is still over.
    expect(findings(db, TODAY).find((f) => f.kind === "bet_zone_over")!.key).toBe("bet_zone_over:2026-09");
    expect(findings(db, "2026-10-05").find((f) => f.kind === "bet_zone_over")!.key).toBe("bet_zone_over:2026-10");
  });

  it("säger ingenting när zonen ligger där den ska", () => {
    const db = freshDb({ seeded: true });
    const ids = portfolio(db);
    // Enough of the base to put the bet zone under the ceiling.
    createTrade(db, { instrumentId: ids.get("Exempelfond Global Index")!, account: "isk", side: "buy", date: DAY, quantityE4: parseQuantity("40")!, priceE4: parsePrice("150,40")! });
    expect(plainAll(db).some(([kind]) => kind === "bet_zone_over")).toBe(false);
  });

  it("säger till när kurserna inte kunnat hämtas på tre dagar", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    // The prices were fetched on the 18th and nothing since.
    db.update(priceSnapshots).set({ fetchedAt: "2026-09-18T18:30:00.000Z" }).run();

    expect(plainAll(db, "2026-09-20").some(([kind]) => kind === "prices_stale")).toBe(false);
    expect(plainAll(db, "2026-09-21")).toContainEqual(["prices_stale", "Kurserna har inte kunnat hämtas sedan 18/9. Innehaven värderas med de kurser som finns."]);
    // One finding per stall, not one per day.
    expect(findings(db, "2026-09-25").find((f) => f.kind === "prices_stale")!.key).toBe("prices_stale:2026-09-18");
  });

  it("säger till när ett enda instrument fastnat medan de andra kommer", () => {
    const db = freshDb({ seeded: true });
    const ids = portfolio(db);
    // Everything fetched on the 21st, except Exempelbolaget C: last fetched on the 18th.
    db.update(priceSnapshots).set({ fetchedAt: "2026-09-21T06:30:00.000Z" }).run();
    db.update(priceSnapshots).set({ fetchedAt: "2026-09-18T18:30:00.000Z" }).where(eq(priceSnapshots.instrumentId, ids.get("Exempelbolaget C")!)).run();

    const stale = findings(db, "2026-09-21").filter((f) => f.kind === "prices_stale");
    expect(stale.map((f) => [f.key, plain(f.text)])).toEqual([
      [`prices_stale:${ids.get("Exempelbolaget C")}:2026-09-18`, "Kursen för Exempelbolaget C har inte kunnat hämtas sedan 18/9, fast de andra kurserna kommer. Innehavet värderas med kursen från 18/9."],
    ]);
    // Two days: not yet.
    expect(findings(db, "2026-09-20").some((f) => f.kind === "prices_stale")).toBe(false);
  });

  it("säger vilka innehav som inte kan värderas när en valutakurs saknas", () => {
    const db = freshDb({ seeded: true });
    portfolio(db, { rates: false });
    db.insert(fxRates).values({ pair: "EURSEK", date: DAY, rateE6: EUR, source: "riksbank" }).run();

    expect(plainAll(db)).toContainEqual(["fx_missing", "Valutakursen USD/SEK saknas, så Exempelbolaget A, Exempelbolaget B, Exempelbolaget C kan inte värderas."]);
    expect(findings(db, TODAY).find((f) => f.kind === "fx_missing")!.key).toBe("fx_missing:USD/SEK");
  });

  it("tiger helt när det inte finns något innehav", () => {
    const db = freshDb({ seeded: true });
    expect(findings(db, TODAY).filter((f) => ["bet_zone_over", "prices_stale", "fx_missing"].includes(f.kind))).toEqual([]);
  });
});

describe("gamla kurser", () => {
  it("räknar tre bankdagar bakåt: fredagens kurs är aktuell på måndagen, också runt en helgdag", () => {
    expect(oldPriceLimit("2026-09-21")).toBe("2026-09-16"); // Monday: Fri, Thu, Wed
    expect(oldPriceLimit("2026-04-07")).toBe("2026-03-31"); // Tuesday after Easter: Thu 2/4, Wed 1/4, Tue 31/3
  });

  it("värderar med en gammal kurs men märker den, och säger vilka", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    // Prices from Friday 18/9: current on Monday 21/9, old from Thursday 24/9.
    expect(valuePortfolio(db, "2026-09-21").stale).toEqual([]);
    const later = valuePortfolio(db, "2026-09-24");
    expect(later.stale.map((h) => h.name)).toEqual(["Exempelfond Global Index", "Exempelbolaget A", "Exempelbolaget B", "Exempelbolaget C"]);
    expect(later.holdings.every((h) => h.stale && h.valueOre !== null)).toBe(true);
    // The total still counts them: an old price is a price, it just says so.
    expect(later.totalOre).toBe(valuePortfolio(db, "2026-09-21").totalOre);
    expect(buildOverview(db, "2026-09-24").portfolio).toMatchObject({ stale: 4, missing: 0 });
  });
});

describe("Översikten", () => {
  it("visar värdet och zonerna — ingenting om rörelsen sedan i går", () => {
    const db = freshDb({ seeded: true });
    portfolio(db);
    const overview = buildOverview(db, TODAY);

    expect(overview.portfolio).toEqual({
      totalOre: 12409249,
      priceDate: DAY,
      zones: { base: 8309600 / 12409249, bet: 4099649 / 12409249 },
      betState: "over",
      missing: 0,
      stale: 0,
    });
    // Nothing that could be read as a gain or a loss since yesterday.
    expect(Object.keys(overview.portfolio!)).toEqual(["totalOre", "priceDate", "zones", "betState", "missing", "stale"]);
  });

  it("har ingen ruta alls utan innehav", () => {
    const db = freshDb({ seeded: true });
    expect(buildOverview(db, TODAY).portfolio).toBeNull();
  });
});
