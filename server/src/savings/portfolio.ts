import { and, asc, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { TRADE_ACCOUNTS, cashBalances, instruments, priceSnapshots, trades, transactions, type Instrument } from "../db/schema.js";
import { categoryIdByKey } from "../db/seed.js";
import { E6, holdings, sekOre, type InstrumentCurrency, type InstrumentZone, type TradeAccount } from "./instruments.js";
import { pairFor, rateOn } from "./prices/sync.js";
import { listHoldings } from "./savings.js";
import { previousBankDay } from "../calendar/bankDays.js";
import { addDays } from "../overview/dates.js";

/**
 * Vad portföljen är värd.
 *
 * Every number here is built the same way: quantity × the latest price ×
 * the exchange rate of that price's own day. The rate is the one that
 * belonged to the price, not today's — a price from Friday valued at
 * Monday's rate is a number nobody can check.
 *
 * What is missing stays missing. A holding whose price or rate couldn't be
 * fetched has no value, not a stale one and not a zero: it is listed apart,
 * so a total is either right or visibly incomplete.
 *
 * There are no day-to-day changes in here, no percentages up or down, and
 * nothing is coloured green or red. Short movements are noise, and the
 * purchase price is information in the detail view — never a verdict.
 */

/** The investment policy: the base is the world, the bet zone is the rest. */
export const ZONE_TARGET = { base: 0.8, bet: 0.2 } as const;
/** Over this, the bet zone is trimmed back towards its target. */
export const BET_LIMIT = 0.25;
/** Under this it isn't topped up either: new money goes to the base. */
export const BET_FLOOR = 0.15;

export interface ValuedHolding {
  instrumentId: number;
  name: string;
  isin: string | null;
  currency: InstrumentCurrency;
  kind: Instrument["kind"];
  zone: InstrumentZone;
  account: TradeAccount;
  quantityE4: number;
  priceE4: number | null;
  priceDate: string | null;
  priceSource: string | null;
  rateE6: number | null;
  rateDate: string | null;
  rateSource: string | null;
  valueOre: number | null;
  /** Why there is no value, when there isn't one. */
  missing: "price" | "rate" | null;
  /** The price is older than PRICE_OLD_BANK_DAYS bank days: valued, but not at a current price. */
  stale: boolean;
}

export interface ValuedInstrument {
  instrumentId: number;
  name: string;
  zone: InstrumentZone;
  currency: InstrumentCurrency;
  quantityE4: number;
  valueOre: number | null;
  /** Bought less sold, in kronor as they were paid, courtage included. */
  investedOre: number | null;
  /** A trade whose exchange rate isn't known leaves the amount unknown, not wrong. */
  investedUnknown: boolean;
}

export interface ZoneTotal {
  zone: InstrumentZone;
  valueOre: number;
  /** Of the securities that have a value; null when nothing is valued. */
  share: number | null;
  targetShare: number;
}

export interface Policy {
  betShare: number | null;
  /** Over the ceiling, under the floor, or in between. */
  state: "over" | "under" | "within" | "unknown";
  /** Sell this much of the bet zone to be back at the 20 % target. */
  trimOre: number | null;
  /** Or put this much new money in the base, and the bet zone is at 25 %. */
  toBaseOre: number | null;
  /** Room for the bet zone to grow before it reaches 25 %. */
  roomOre: number | null;
  text: string;
}

export interface AccountValue {
  account: TradeAccount;
  securitiesOre: number;
  cashOre: number | null;
  cashDate: string | null;
  /** Securities and cash: what the broker shows for the account. */
  totalOre: number;
}

export interface PortfolioValue {
  /** The day it was valued as of. */
  on: string;
  holdings: ValuedHolding[];
  instruments: ValuedInstrument[];
  accounts: AccountValue[];
  zones: { base: ZoneTotal; bet: ZoneTotal };
  policy: Policy;
  /** Securities only, over both accounts. */
  totalOre: number;
  investedOre: number | null;
  /** The oldest price behind the total: what 'kurs från' has to say. */
  priceDate: string | null;
  /** Holdings with no value, and why. Empty is the normal case. */
  missing: ValuedHolding[];
  /** Holdings valued at an old price (see PRICE_OLD_BANK_DAYS). Empty is the normal case. */
  stale: ValuedHolding[];
}

const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
const percent = (share: number) => `${(share * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;

/**
 * A price is old when it is from before the third bank day back: Friday's
 * close on a Monday is current (Thursday's too, around a holiday), a week-old
 * one is not. It still values the holding, and says so.
 */
export const PRICE_OLD_BANK_DAYS = 3;
export function oldPriceLimit(on: string): string {
  let d = on;
  for (let i = 0; i < PRICE_OLD_BANK_DAYS; i++) d = previousBankDay(addDays(d, -1));
  return d;
}

/** The newest price on or before a day. */
function priceOn(db: Db, instrumentId: number, on: string) {
  return db
    .select()
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.instrumentId, instrumentId), lte(priceSnapshots.date, on)))
    .orderBy(desc(priceSnapshots.date), desc(priceSnapshots.id))
    .get();
}

/** The cash standing in an account on a day, as last entered. */
export function cashOn(db: Db, account: TradeAccount, on: string) {
  return db
    .select()
    .from(cashBalances)
    .where(and(eq(cashBalances.account, account), lte(cashBalances.date, on)))
    .orderBy(desc(cashBalances.date))
    .get();
}

const TRADE_ACCOUNT_NAMES: Record<TradeAccount, string> = { isk: "ISK", depot: "Depå" };

export interface LiquidCash {
  /** The cash last entered per trade account (not 0). */
  accounts: { account: TradeAccount; name: string; ore: number; date: string }[];
  /** Moved to Avanza (Sparande, net of what came back) after the latest entered day, up to `on`. */
  depositedOre: number;
  /** The latest day cash was entered, or null when never. */
  since: string | null;
  totalOre: number;
}

/**
 * The cash on Avanza, money that can be moved to the bank any day: the cash
 * last entered per account, plus what was moved there (Sparande transfers,
 * net) after that day. Money moved to Avanza is still money to spend until it
 * is invested, and buying something shows when the cash is entered next.
 * Nothing entered: nothing is assumed.
 */
export function liquidCash(db: Db, on: string): LiquidCash {
  const accounts = TRADE_ACCOUNTS.map((account) => ({ account, cash: cashOn(db, account, on) }))
    .filter((a) => a.cash && a.cash.amountOre !== 0)
    .map((a) => ({ account: a.account, name: TRADE_ACCOUNT_NAMES[a.account], ore: a.cash!.amountOre, date: a.cash!.date }));
  const entered = TRADE_ACCOUNTS.map((a) => cashOn(db, a, on)?.date).filter((d): d is string => !!d);
  const since = entered.length ? entered.sort().at(-1)! : null;
  const savings = categoryIdByKey(db, "savings");
  const depositedOre =
    since === null || savings === undefined
      ? 0
      : -(
          db
            .select({ s: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
            .from(transactions)
            .where(
              and(
                eq(transactions.categoryId, savings),
                isNull(transactions.deletedAt),
                // Between my own bank accounts is not a move to Avanza.
                isNull(transactions.counterAccountId),
                gt(transactions.bookingDate, since),
                lte(transactions.bookingDate, on),
              ),
            )
            .get()?.s ?? 0
        );
  // Taken out since then: never below nothing.
  return { accounts, depositedOre, since, totalOre: Math.max(0, accounts.reduce((t, a) => t + a.ore, 0) + depositedOre) };
}

export function setCash(db: Db, account: TradeAccount, date: string, amountOre: number) {
  return db
    .insert(cashBalances)
    .values({ account, date, amountOre })
    .onConflictDoUpdate({ target: [cashBalances.account, cashBalances.date], set: { amountOre } })
    .returning()
    .get();
}

/**
 * What was put in, per instrument, in kronor as they were paid.
 *
 * The rate that decides it is the one on the trade when it is known, and the
 * day's fixing otherwise — never today's. A stock bought when the dollar was
 * cheaper cost fewer kronor, which is why a share can stand above what was
 * paid while its price is below the average: the difference is currency, and
 * it is real money.
 */
export function investedByInstrument(db: Db): Map<number, { investedOre: number; unknown: boolean }> {
  const out = new Map<number, { investedOre: number; unknown: boolean }>();
  const rows = db.select().from(trades).where(isNull(trades.deletedAt)).orderBy(asc(trades.date), asc(trades.id)).all();
  const currency = new Map(db.select().from(instruments).all().map((i) => [i.id, i.currency]));

  for (const trade of rows) {
    const entry = out.get(trade.instrumentId) ?? { investedOre: 0, unknown: false };
    const pair = pairFor(currency.get(trade.instrumentId) ?? "SEK");
    const rateE6 = pair === null ? E6 : (trade.fxRateE6 ?? rateOn(db, pair, trade.date)?.rateE6 ?? null);
    if (rateE6 === null) {
      entry.unknown = true;
      out.set(trade.instrumentId, entry);
      continue;
    }
    const amount = sekOre(trade.quantityE4, trade.priceE4, rateE6);
    // A sale gives money back, less its courtage; a purchase costs its own.
    entry.investedOre += trade.side === "sell" ? -(amount - trade.feeOre) : amount + trade.feeOre;
    out.set(trade.instrumentId, entry);
  }
  return out;
}

/** The policy in one sentence, with the amount that would answer it. */
export function policyFor(baseOre: number, betOre: number): Policy {
  const total = baseOre + betOre;
  if (total <= 0) return { betShare: null, state: "unknown", trimOre: null, toBaseOre: null, roomOre: null, text: "Inget värderat innehav att fördela ännu." };
  const betShare = betOre / total;
  const share = percent(betShare);

  if (betShare > BET_LIMIT) {
    // Sell s of the bet zone: (bet − s) / (total − s) = target.
    const trimOre = Math.round((betOre - ZONE_TARGET.bet * total) / (1 - ZONE_TARGET.bet));
    // Or add x to the base: bet / (total + x) = the ceiling.
    const toBaseOre = Math.round(betOre / BET_LIMIT - total);
    return {
      betShare,
      state: "over",
      trimOre,
      toBaseOre,
      roomOre: null,
      text: `Bet-zonen är ${share} av portföljen — över 25 %. Sälj för ${kr(trimOre)} så är den på 20 %, eller lägg ${kr(toBaseOre)} i basen så är den på 25 %.`,
    };
  }
  if (betShare < BET_FLOOR) {
    return {
      betShare,
      state: "under",
      trimOre: null,
      toBaseOre: null,
      roomOre: null,
      text: `Bet-zonen är ${share} av portföljen — under 15 %. Den fylls inte på; nya pengar går till basen.`,
    };
  }
  // Room to grow before the ceiling: (bet + g) / (total + g) = the ceiling.
  const roomOre = Math.round((BET_LIMIT * total - betOre) / (1 - BET_LIMIT));
  return {
    betShare,
    state: "within",
    trimOre: null,
    toBaseOre: null,
    roomOre,
    text: `Bet-zonen är ${share} av portföljen, inom 15–25 %. Den kan växa ${kr(roomOre)} innan den når 25 %.`,
  };
}

/**
 * With `holdingsOn`, the holdings are the trades up to `on` — the portfolio
 * as it stood that day, for comparing with a value from then. Without it, the
 * holdings are today's, valued at the prices of `on`.
 */
export function valuePortfolio(db: Db, on: string, opts: { holdingsOn?: boolean } = {}): PortfolioValue {
  const byId = new Map(db.select().from(instruments).where(isNull(instruments.deletedAt)).all().map((i) => [i.id, i]));
  const invested = investedByInstrument(db);

  const staleBefore = oldPriceLimit(on);
  const valued: ValuedHolding[] = [];
  for (const holding of holdings(db, opts.holdingsOn ? { through: on } : {})) {
    const instrument = byId.get(holding.instrumentId);
    if (!instrument) continue;
    const price = priceOn(db, instrument.id, on);
    const pair = pairFor(instrument.currency);
    // The rate that belonged to the price's own day, not today's.
    const rate = price && pair !== null ? rateOn(db, pair, price.date) : null;
    const rateE6 = pair === null ? E6 : (rate?.rateE6 ?? null);
    valued.push({
      instrumentId: instrument.id,
      name: instrument.name,
      isin: instrument.isin,
      currency: instrument.currency,
      kind: instrument.kind,
      zone: instrument.zone,
      account: holding.account,
      quantityE4: holding.quantityE4,
      priceE4: price?.priceE4 ?? null,
      priceDate: price?.date ?? null,
      priceSource: price?.source ?? null,
      rateE6: pair === null ? E6 : (rate?.rateE6 ?? null),
      rateDate: pair === null ? null : (rate?.date ?? null),
      rateSource: pair === null ? null : (rate?.source ?? null),
      valueOre: price && rateE6 !== null ? sekOre(holding.quantityE4, price.priceE4, rateE6) : null,
      missing: !price ? "price" : rateE6 === null ? "rate" : null,
      stale: !!price && price.date < staleBefore,
    });
  }

  const withValue = valued.filter((h) => h.valueOre !== null);
  const missing = valued.filter((h) => h.valueOre === null);
  const totalOre = withValue.reduce((s, h) => s + h.valueOre!, 0);
  const zoneOre = (zone: InstrumentZone) => withValue.filter((h) => h.zone === zone).reduce((s, h) => s + h.valueOre!, 0);
  const base = zoneOre("base");
  const bet = zoneOre("bet");

  const perInstrument = new Map<number, ValuedInstrument>();
  for (const h of valued) {
    const entry = perInstrument.get(h.instrumentId) ?? {
      instrumentId: h.instrumentId,
      name: h.name,
      zone: h.zone,
      currency: h.currency,
      quantityE4: 0,
      valueOre: null as number | null,
      investedOre: invested.get(h.instrumentId)?.unknown ? null : (invested.get(h.instrumentId)?.investedOre ?? 0),
      investedUnknown: invested.get(h.instrumentId)?.unknown ?? false,
    };
    entry.quantityE4 += h.quantityE4;
    if (h.valueOre !== null) entry.valueOre = (entry.valueOre ?? 0) + h.valueOre;
    perInstrument.set(h.instrumentId, entry);
  }

  const accounts: AccountValue[] = (["isk", "depot"] as const)
    .map((account) => {
      const securitiesOre = withValue.filter((h) => h.account === account).reduce((s, h) => s + h.valueOre!, 0);
      const cash = cashOn(db, account, on);
      const has = valued.some((h) => h.account === account);
      return {
        account,
        securitiesOre,
        cashOre: cash?.amountOre ?? null,
        cashDate: cash?.date ?? null,
        totalOre: securitiesOre + (cash?.amountOre ?? 0),
        has: has || !!cash,
      };
    })
    .filter((a) => a.has)
    .map(({ has: _has, ...a }) => a);

  const investedTotal = [...perInstrument.values()].some((i) => i.investedUnknown)
    ? null
    : [...perInstrument.values()].reduce((s, i) => s + (i.investedOre ?? 0), 0);

  return {
    on,
    holdings: valued,
    instruments: [...perInstrument.values()],
    accounts,
    zones: {
      base: { zone: "base", valueOre: base, share: totalOre > 0 ? base / totalOre : null, targetShare: ZONE_TARGET.base },
      bet: { zone: "bet", valueOre: bet, share: totalOre > 0 ? bet / totalOre : null, targetShare: ZONE_TARGET.bet },
    },
    policy: policyFor(base, bet),
    totalOre,
    investedOre: investedTotal,
    // The oldest of the prices the total rests on: saying 'kurs från 18/9'
    // about a total that has a week-old price in it would be a half-truth.
    priceDate: withValue.length ? withValue.map((h) => h.priceDate!).sort()[0] : null,
    missing,
    stale: valued.filter((h) => h.stale),
  };
}

// ---------- Against the value entered by hand ----------

export interface Reconciliation {
  /** The day both sides are counted on: the entered value's, or `on` when there is none. */
  on: string;
  /** What the securities come to, from the trades and the prices. */
  securitiesOre: number;
  /** Money in the account, entered by hand. Part of the broker's own total. */
  cashOre: number | null;
  cashDate: string | null;
  computedOre: number;
  /** The latest value entered under Sparande, and when. */
  enteredOre: number | null;
  enteredDate: string | null;
  /** Entered less computed: rounding and fees, once the cash is counted. */
  differenceOre: number | null;
  text: string;
}

/**
 * The computed value beside the one entered by hand in Sparande.
 *
 * Both are counted on the same day: the day the value was entered, with the
 * holdings, prices and cash as they were then. Today's prices against a value
 * from Friday would call a day on the market an error, and a purchase since
 * would move money from the cash to a holding the entered value never saw.
 *
 * The cash is a row of its own, not a difference: the broker's value for the
 * account includes it, so leaving it out would call 12 480 kr an error. What
 * is left after it is rounding and fees, and it should be small.
 */
export function reconcile(db: Db, on: string): Reconciliation {
  const entered = listHoldings(db)
    .map((h) => h.values.filter((v) => v.date <= on).at(-1))
    .filter((v): v is { date: string; value: number } => v !== undefined);
  const enteredOre = entered.length ? entered.reduce((s, v) => s + v.value, 0) : null;
  const enteredDate = entered.length ? entered.map((v) => v.date).sort().at(-1)! : null;

  const day = enteredDate ?? on;
  const portfolio = valuePortfolio(db, day, { holdingsOn: true });
  const cash = (["isk", "depot"] as const).map((a) => cashOn(db, a, day)).filter((c) => c !== undefined);
  const cashOre = cash.length ? cash.reduce((s, c) => s + c!.amountOre, 0) : null;
  const cashDate = cash.length ? cash.map((c) => c!.date).sort().at(-1)! : null;

  const computedOre = portfolio.totalOre + (cashOre ?? 0);
  const differenceOre = enteredOre === null || portfolio.holdings.length === 0 ? null : enteredOre - computedOre;

  // Half a percent of the account: Avanza values with its own exchange rate
  // and at its own moment, so the two will never land on the same öre.
  const tolerance = Math.max(10_000, Math.round((enteredOre ?? 0) * 0.005));
  let text: string;
  if (enteredOre === null) text = "Inget värde inmatat under Sparande att stämma av mot.";
  else if (portfolio.holdings.length === 0) text = "Det inmatade värdet är äldre än innehaven. Mata in ett nytt värde för att stämma av.";
  else if (portfolio.missing.length) text = "Avstämningen väntar på kurser för alla innehav.";
  else if (differenceOre === null) text = "";
  else if (Math.abs(differenceOre) <= tolerance) text = `Skillnad ${kr(differenceOre)} — avrundning, avgifter och att Avanza räknar med sin egen växelkurs.`;
  else text = `Skillnad ${kr(differenceOre)}. Kolla likviderna, en affär som inte lagts in, eller en utdelning.`;

  return { on: day, securitiesOre: portfolio.totalOre, cashOre, cashDate, computedOre, enteredOre, enteredDate, differenceOre, text };
}

// ---------- One instrument ----------

export interface TradeRow {
  id: number;
  account: TradeAccount;
  side: "buy" | "sell" | "opening";
  date: string;
  quantityE4: number;
  priceE4: number;
  feeOre: number;
  fxRateE6: number | null;
  /** What it came to in kronor, courtage included. Null when no rate is known. */
  amountOre: number | null;
  transactionId: number | null;
  note: string | null;
}

export interface InstrumentDetail {
  instrument: Instrument;
  quantityE4: number;
  valueOre: number | null;
  investedOre: number | null;
  investedUnknown: boolean;
  priceE4: number | null;
  priceDate: string | null;
  priceSource: string | null;
  trades: TradeRow[];
  /** The price over time, for a plain line. No percentages anywhere near it. */
  history: { date: string; priceE4: number; source: string }[];
}

/** Everything the detail view of one instrument shows. */
export function instrumentDetail(db: Db, id: number, on: string): InstrumentDetail | null {
  const instrument = db.select().from(instruments).where(eq(instruments.id, id)).get();
  if (!instrument) return null;
  const valued = valuePortfolio(db, on);
  const own = valued.instruments.find((i) => i.instrumentId === id);
  const holding = valued.holdings.find((h) => h.instrumentId === id);
  const pair = pairFor(instrument.currency);

  const rows = db
    .select()
    .from(trades)
    .where(and(eq(trades.instrumentId, id), isNull(trades.deletedAt)))
    .orderBy(desc(trades.date), desc(trades.id))
    .all();

  return {
    instrument,
    quantityE4: own?.quantityE4 ?? 0,
    valueOre: own?.valueOre ?? null,
    investedOre: own?.investedOre ?? null,
    investedUnknown: own?.investedUnknown ?? false,
    priceE4: holding?.priceE4 ?? null,
    priceDate: holding?.priceDate ?? null,
    priceSource: holding?.priceSource ?? null,
    trades: rows.map((t) => {
      const rateE6 = pair === null ? E6 : (t.fxRateE6 ?? rateOn(db, pair, t.date)?.rateE6 ?? null);
      const amount = rateE6 === null ? null : sekOre(t.quantityE4, t.priceE4, rateE6);
      return {
        id: t.id,
        account: t.account,
        side: t.side,
        date: t.date,
        quantityE4: t.quantityE4,
        priceE4: t.priceE4,
        feeOre: t.feeOre,
        fxRateE6: t.fxRateE6,
        amountOre: amount === null ? null : t.side === "sell" ? amount - t.feeOre : amount + t.feeOre,
        transactionId: t.transactionId,
        note: t.note,
      };
    }),
    history: db
      .select({ date: priceSnapshots.date, priceE4: priceSnapshots.priceE4, source: priceSnapshots.source })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.instrumentId, id))
      .orderBy(asc(priceSnapshots.date))
      .all(),
  };
}
