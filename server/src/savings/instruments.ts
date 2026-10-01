import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  INSTRUMENT_CURRENCIES,
  INSTRUMENT_KINDS,
  INSTRUMENT_ZONES,
  TRADE_ACCOUNTS,
  TRADE_SIDES,
  instruments,
  trades,
  transactions,
  type Instrument,
  type Trade,
} from "../db/schema.js";

/**
 * Innehav: the securities, the trades, and what is held right now.
 *
 * What is held is never stored. It is the trades summed per instrument and
 * account — buys and the opening holding add, sells take away — so a holding
 * can't drift away from the trades that made it. The price and the exchange
 * rate are fetched separately; nothing here talks to the outside world.
 *
 * Integers all the way, as with öre: quantities in ten-thousandths of a share
 * (`quantity_e4`), prices in ten-thousandths of the instrument's currency
 * (`price_e4`), exchange rates in millionths (`rate_e6`). The products get
 * large enough to leave what a double can count exactly, so they are
 * multiplied as BigInt and rounded once, at the end.
 */

export class InstrumentError extends Error {}

export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];
export type InstrumentZone = (typeof INSTRUMENT_ZONES)[number];
export type InstrumentCurrency = (typeof INSTRUMENT_CURRENCIES)[number];
export type TradeAccount = (typeof TRADE_ACCOUNTS)[number];
export type TradeSide = (typeof TRADE_SIDES)[number];

export const E4 = 10_000;
export const E6 = 1_000_000;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Rounds a BigInt division half away from zero, the way money is rounded. */
function divRound(value: bigint, by: bigint): number {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const q = (v + by / 2n) / by;
  return Number(negative ? -q : q);
}

/**
 * What `quantity` of something priced `price` is worth in öre, at `rate`
 * kronor per unit of its currency. 73 × 167,14 EUR × 11,29 = 137 749,40 kr.
 */
export function sekOre(quantityE4: number, priceE4: number, rateE6: number): number {
  // quantity × price × rate × 100 öre / (1e4 × 1e4 × 1e6)
  return divRound(BigInt(quantityE4) * BigInt(priceE4) * BigInt(rateE6), 10n ** 12n);
}

/** The same, for something already in kronor (rate 1). */
export const sekOreFromSek = (quantityE4: number, priceE4: number) => sekOre(quantityE4, priceE4, E6);

/** '73' → 730000, '0,5' → 5000. Swedish decimal comma, at most four decimals. */
export function parseQuantity(input: string | number): number | null {
  return parseScaled(input, 4);
}
/** '167,14' → 1671400. */
export function parsePrice(input: string | number): number | null {
  return parseScaled(input, 4);
}
/** '11,2903' → 11290300. */
export function parseRate(input: string | number): number | null {
  return parseScaled(input, 6);
}

function parseScaled(input: string | number, decimals: number): number | null {
  const text = String(input).replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  if (fraction.length > decimals) return null;
  const value = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || 0);
  return negative ? -value : value;
}

// ---------- Instruments ----------

export interface InstrumentInput {
  name: string;
  isin?: string | null;
  currency: InstrumentCurrency;
  kind: InstrumentKind;
  zone: InstrumentZone;
  tickerYahoo?: string | null;
  tickerAvanza?: string | null;
}

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

function checkInstrument(input: InstrumentInput) {
  if (!clean(input.name)) throw new InstrumentError("Instrumentet behöver ett namn.");
  if (!INSTRUMENT_CURRENCIES.includes(input.currency)) throw new InstrumentError("Okänd valuta.");
  if (!INSTRUMENT_KINDS.includes(input.kind)) throw new InstrumentError("Okänd sorts instrument.");
  if (!INSTRUMENT_ZONES.includes(input.zone)) throw new InstrumentError("Okänd zon.");
  const isin = clean(input.isin);
  // Twelve characters, two of them a country: enough to catch a typo, not a
  // validator that refuses something the broker accepts.
  if (isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) throw new InstrumentError("ISIN ska vara 12 tecken, t.ex. IE00EXEMPEL1.");
}

export function listInstruments(db: Db): Instrument[] {
  return db.select().from(instruments).where(isNull(instruments.deletedAt)).orderBy(asc(instruments.zone), asc(instruments.name)).all();
}

export function getInstrument(db: Db, id: number): Instrument | undefined {
  return db.select().from(instruments).where(eq(instruments.id, id)).get();
}

export function createInstrument(db: Db, input: InstrumentInput): Instrument {
  checkInstrument(input);
  return db
    .insert(instruments)
    .values({
      name: clean(input.name)!,
      isin: clean(input.isin),
      currency: input.currency,
      kind: input.kind,
      zone: input.zone,
      tickerYahoo: clean(input.tickerYahoo),
      tickerAvanza: clean(input.tickerAvanza),
    })
    .returning()
    .get();
}

export function updateInstrument(db: Db, id: number, patch: Partial<InstrumentInput>): Instrument {
  const current = getInstrument(db, id);
  if (!current || current.deletedAt) throw new InstrumentError("Instrumentet finns inte.");
  const next = { ...current, ...patch } as InstrumentInput;
  checkInstrument(next);
  return db
    .update(instruments)
    .set({
      name: clean(next.name)!,
      isin: clean(next.isin),
      currency: next.currency,
      kind: next.kind,
      zone: next.zone,
      tickerYahoo: clean(next.tickerYahoo),
      tickerAvanza: clean(next.tickerAvanza),
    })
    .where(eq(instruments.id, id))
    .returning()
    .get();
}

/**
 * Soft delete, and only when nothing is held: an instrument with a holding
 * would take the holding with it out of every sum.
 */
export function deleteInstrument(db: Db, id: number): void {
  const instrument = getInstrument(db, id);
  if (!instrument || instrument.deletedAt) throw new InstrumentError("Instrumentet finns inte.");
  if (holdingsOf(db, id).some((h) => h.quantityE4 !== 0)) throw new InstrumentError("Sälj eller ta bort affärerna först — instrumentet har ett innehav.");
  db.update(instruments).set({ deletedAt: new Date().toISOString() }).where(eq(instruments.id, id)).run();
}

// ---------- Trades ----------

export interface TradeInput {
  instrumentId: number;
  account: TradeAccount;
  side: TradeSide;
  date: string;
  quantityE4: number;
  priceE4: number;
  feeOre?: number;
  fxRateE6?: number | null;
  transactionId?: number | null;
  note?: string | null;
}

export function listTrades(db: Db, opts: { instrumentId?: number } = {}): Trade[] {
  return db
    .select()
    .from(trades)
    .where(and(isNull(trades.deletedAt), opts.instrumentId ? eq(trades.instrumentId, opts.instrumentId) : undefined))
    .orderBy(asc(trades.date), asc(trades.id))
    .all();
}

export function createTrade(db: Db, input: TradeInput): Trade {
  const instrument = getInstrument(db, input.instrumentId);
  if (!instrument || instrument.deletedAt) throw new InstrumentError("Instrumentet finns inte.");
  if (!TRADE_ACCOUNTS.includes(input.account)) throw new InstrumentError("Okänt konto.");
  if (!TRADE_SIDES.includes(input.side)) throw new InstrumentError("Okänd sorts affär.");
  if (!ISO.test(input.date)) throw new InstrumentError("Datumet ska vara ÅÅÅÅ-MM-DD.");
  if (!Number.isInteger(input.quantityE4) || input.quantityE4 <= 0) throw new InstrumentError("Antalet ska vara större än noll.");
  if (!Number.isInteger(input.priceE4) || input.priceE4 < 0) throw new InstrumentError("Kursen ska vara noll eller mer.");
  const feeOre = input.feeOre ?? 0;
  if (!Number.isInteger(feeOre) || feeOre < 0) throw new InstrumentError("Courtaget ska vara noll eller mer.");
  if (input.fxRateE6 !== null && input.fxRateE6 !== undefined && (!Number.isInteger(input.fxRateE6) || input.fxRateE6 <= 0)) {
    throw new InstrumentError("Valutakursen ska vara större än noll.");
  }
  if (input.transactionId != null && !db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, input.transactionId)).get()) {
    throw new InstrumentError("Transaktionen finns inte.");
  }
  // Selling more than is held would make a negative holding, which is not a
  // thing that can happen at a broker.
  if (input.side === "sell") {
    const held = holdingsOf(db, input.instrumentId).find((h) => h.account === input.account)?.quantityE4 ?? 0;
    if (input.quantityE4 > held) throw new InstrumentError(`Du äger ${formatQuantity(held)} — det går inte att sälja ${formatQuantity(input.quantityE4)}.`);
  }
  return db
    .insert(trades)
    .values({
      instrumentId: input.instrumentId,
      account: input.account,
      side: input.side,
      date: input.date,
      quantityE4: input.quantityE4,
      priceE4: input.priceE4,
      feeOre,
      fxRateE6: input.fxRateE6 ?? null,
      transactionId: input.transactionId ?? null,
      note: clean(input.note),
    })
    .returning()
    .get();
}

/** Soft delete, as everywhere else: the holding follows from what is left. */
export function deleteTrade(db: Db, id: number): void {
  const row = db.update(trades).set({ deletedAt: new Date().toISOString() }).where(and(eq(trades.id, id), isNull(trades.deletedAt))).returning().get();
  if (!row) throw new InstrumentError("Affären finns inte.");
}

export function restoreTrade(db: Db, id: number): void {
  const row = db.update(trades).set({ deletedAt: null }).where(eq(trades.id, id)).returning().get();
  if (!row) throw new InstrumentError("Affären finns inte.");
}

/** '73', '0,5', '1 000,25' — the way a quantity is written in Swedish. */
export function formatQuantity(quantityE4: number): string {
  return (quantityE4 / E4).toLocaleString("sv-SE", { maximumFractionDigits: 4 });
}

// ---------- What is held ----------

export interface Holding {
  instrumentId: number;
  account: TradeAccount;
  /** Buys and the opening holding, less what has been sold. */
  quantityE4: number;
  /** The trades behind it, oldest first. */
  tradeCount: number;
  firstDate: string;
  lastDate: string;
}

/**
 * Sums the trades into holdings, per instrument and account. Zero ones are
 * kept out. With `through`, only the trades up to that day: the holdings as
 * they stood then.
 */
export function holdings(db: Db, opts: { instrumentId?: number; includeEmpty?: boolean; through?: string } = {}): Holding[] {
  const rows = db
    .select({
      instrumentId: trades.instrumentId,
      account: trades.account,
      quantityE4: sql<number>`sum(case when ${trades.side} = 'sell' then -${trades.quantityE4} else ${trades.quantityE4} end)`,
      tradeCount: sql<number>`count(*)`,
      firstDate: sql<string>`min(${trades.date})`,
      lastDate: sql<string>`max(${trades.date})`,
    })
    .from(trades)
    .where(
      and(
        isNull(trades.deletedAt),
        opts.instrumentId ? eq(trades.instrumentId, opts.instrumentId) : undefined,
        opts.through ? lte(trades.date, opts.through) : undefined,
      ),
    )
    .groupBy(trades.instrumentId, trades.account)
    .orderBy(asc(trades.instrumentId), asc(trades.account))
    .all();
  return rows.filter((r) => opts.includeEmpty || r.quantityE4 !== 0);
}

/** The holdings of one instrument, one row per account. */
export const holdingsOf = (db: Db, instrumentId: number) => holdings(db, { instrumentId, includeEmpty: true });

/** How much of an instrument is held in total, over both accounts. */
export function quantityOf(db: Db, instrumentId: number): number {
  return holdingsOf(db, instrumentId).reduce((s, h) => s + h.quantityE4, 0);
}

/** The latest trade of each instrument, for 'senast handlad'. */
export function lastTradeDates(db: Db): Map<number, string> {
  return new Map(
    db
      .select({ instrumentId: trades.instrumentId, date: sql<string>`max(${trades.date})` })
      .from(trades)
      .where(isNull(trades.deletedAt))
      .groupBy(trades.instrumentId)
      .orderBy(desc(trades.instrumentId))
      .all()
      .map((r) => [r.instrumentId, r.date]),
  );
}

// ---------- Startinnehav ----------

export interface OpeningRow extends InstrumentInput {
  quantityE4: number;
  /** Avanza's average purchase price (GAV), in the instrument's currency. */
  priceE4: number;
  /** The rate actually paid, when it is known. */
  fxRateE6?: number | null;
}

export interface OpeningInput {
  date: string;
  account: TradeAccount;
  rows: OpeningRow[];
}

/**
 * What is already held, written down once.
 *
 * A portfolio exists before the tool does. This is the way in: the
 * instruments as they are at the broker, with how many and what they cost on
 * average, as one trade each of the kind `opening`. The price is the average
 * paid (GAV), not a single purchase — the trades behind it are gone, and
 * saying so is more honest than inventing them.
 *
 * An instrument that is already here is reused, never duplicated: the same
 * ticker is the same holding. A second opening for one that already has one
 * is refused, because that would silently double the holding.
 */
export function createOpening(db: Db, input: OpeningInput): { instruments: Instrument[]; trades: Trade[] } {
  if (!ISO.test(input.date)) throw new InstrumentError("Datumet ska vara ÅÅÅÅ-MM-DD.");
  if (!TRADE_ACCOUNTS.includes(input.account)) throw new InstrumentError("Okänt konto.");
  if (!input.rows?.length) throw new InstrumentError("Lägg till minst ett innehav.");

  const existing = listInstruments(db);
  const match = (row: OpeningRow) =>
    existing.find((i) => (row.tickerYahoo && i.tickerYahoo && i.tickerYahoo.toLowerCase() === row.tickerYahoo.toLowerCase()) || i.name.trim() === row.name.trim());

  for (const row of input.rows) {
    const found = match(row);
    if (found && listTrades(db, { instrumentId: found.id }).some((t) => t.side === "opening")) {
      throw new InstrumentError(`${found.name} har redan ett startinnehav. Registrera ett köp i stället.`);
    }
  }

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const instruments: Instrument[] = [];
    const trades: Trade[] = [];
    for (const row of input.rows) {
      const instrument = match(row) ?? createInstrument(tx, row);
      instruments.push(instrument);
      trades.push(
        createTrade(tx, {
          instrumentId: instrument.id,
          account: input.account,
          side: "opening",
          date: input.date,
          quantityE4: row.quantityE4,
          priceE4: row.priceE4,
          feeOre: 0,
          fxRateE6: row.fxRateE6 ?? null,
          note: "Startinnehav",
        }),
      );
    }
    return { instruments, trades };
  }) as { instruments: Instrument[]; trades: Trade[] };
}
