import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { trades } from "../src/db/schema.js";
import {
  E4,
  E6,
  createInstrument,
  createOpening,
  createTrade,
  deleteInstrument,
  deleteTrade,
  formatQuantity,
  holdings,
  listInstruments,
  parsePrice,
  parseQuantity,
  parseRate,
  quantityOf,
  restoreTrade,
  sekOre,
  updateInstrument,
  type InstrumentInput,
} from "../src/savings/instruments.js";
import { freshDb } from "./helpers.js";

/**
 * Innehav och affärer.
 *
 * The holding is never stored, only summed from the trades, so these tests
 * are mostly about that sum being right — including the part where something
 * is sold off a little at a time.
 *
 * The numbers are a made-up portfolio dated 18 September 2026.
 */

type Db = ReturnType<typeof freshDb>;

const EXFG: InstrumentInput = { name: "Exempelfond Global Index", isin: "IE00EXEMPEL1", currency: "EUR", kind: "etf", zone: "base", tickerYahoo: "EXFG.DE" };
const EXA: InstrumentInput = { name: "Exempelbolaget A", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXA" };

const add = (db: Db, spec: InstrumentInput = EXFG) => createInstrument(db, { ...spec });

/** A buy, in the units they are written in: 50 shares at 150,40. */
const buy = (db: Db, instrumentId: number, o: { quantity: number; price: number; date?: string; account?: "isk" | "depot"; side?: "buy" | "sell" | "opening"; fee?: number }) =>
  createTrade(db, {
    instrumentId,
    account: o.account ?? "isk",
    side: o.side ?? "buy",
    date: o.date ?? "2026-09-18",
    quantityE4: Math.round(o.quantity * E4),
    priceE4: Math.round(o.price * E4),
    feeOre: o.fee ?? 0,
  });

describe("counting in integers", () => {
  it("multiplies quantity, price and rate without losing öre", () => {
    // A made-up portfolio. The product of the three integers is larger than
    // a double counts exactly (500000 × 1504000 × 11050000 ≈ 8,3e18), so it
    // is multiplied as BigInt and rounded once.
    const value = (quantity: string, price: string, rate: string) => sekOre(parseQuantity(quantity)!, parsePrice(price)!, parseRate(rate)!);
    // 83 112,575 kr: exactly half an öre, rounded away from zero.
    expect(value("50", "150,43", "11,05")).toBe(8311258);
    expect(value("12", "230,50", "9,95")).toBe(2752170);
    expect(value("5", "120,25", "9,95")).toBe(598244);
    expect(value("30", "25,10", "9,95")).toBe(749235);
    // Fractions of a share, and something already in kronor.
    expect(value("0,5", "150,40", "11,05")).toBe(83096);
    expect(sekOre(5000, 100 * E4, E6)).toBe(5000);
    // Half an öre rounds away from zero, the way öre are rounded elsewhere.
    expect(sekOre(E4, 50, E6)).toBe(1);
    expect(sekOre(E4, 49, E6)).toBe(0);
  });

  it("reads Swedish numbers, and refuses what it can't hold exactly", () => {
    expect(parseQuantity("50")).toBe(500000);
    expect(parseQuantity("0,5")).toBe(5000);
    expect(parseQuantity("1 000,25")).toBe(10002500);
    expect(parsePrice("150,40")).toBe(1504000);
    expect(parseRate("11,0503")).toBe(11050300);
    // More decimals than the column holds is a refusal, not a rounding.
    expect(parseQuantity("0,00005")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(formatQuantity(500000)).toBe("50");
    expect(formatQuantity(5000)).toBe("0,5");
  });
});

describe("the securities", () => {
  it("keeps them apart by zone and currency, and checks the ISIN", () => {
    const db = freshDb({ seeded: true });
    add(db);
    add(db, EXA);
    expect(listInstruments(db).map((i) => [i.name, i.zone, i.currency])).toEqual([
      ["Exempelfond Global Index", "base", "EUR"],
      ["Exempelbolaget A", "bet", "USD"],
    ]);
    expect(() => add(db, { ...EXFG, isin: "IE00" })).toThrow(/ISIN/);
    expect(() => add(db, { ...EXFG, name: "  " })).toThrow(/namn/);
  });

  it("moves between zones without touching the trades", () => {
    const db = freshDb({ seeded: true });
    const shareA = add(db, EXA);
    buy(db, shareA.id, { quantity: 12, price: 200 });
    expect(updateInstrument(db, shareA.id, { zone: "base" }).zone).toBe("base");
    expect(quantityOf(db, shareA.id)).toBe(12 * E4);
  });

  it("won't be deleted while something is held", () => {
    const db = freshDb({ seeded: true });
    const shareA = add(db, EXA);
    const trade = buy(db, shareA.id, { quantity: 12, price: 200 });
    expect(() => deleteInstrument(db, shareA.id)).toThrow(/innehav/);
    deleteTrade(db, trade.id);
    deleteInstrument(db, shareA.id);
    expect(listInstruments(db)).toHaveLength(0);
  });
});

describe("what is held, summed from the trades", () => {
  it("is the opening holding plus the buys, less what has been sold", () => {
    const db = freshDb({ seeded: true });
    const shareA = add(db, EXA);
    buy(db, shareA.id, { quantity: 12, price: 200, side: "opening", date: "2026-09-18" });
    buy(db, shareA.id, { quantity: 6, price: 230.5, date: "2026-09-25" });
    buy(db, shareA.id, { quantity: 5, price: 240.0, date: "2026-10-02", side: "sell" });

    expect(holdings(db)).toEqual([
      { instrumentId: shareA.id, account: "isk", quantityE4: 13 * E4, tradeCount: 3, firstDate: "2026-09-18", lastDate: "2026-10-02" },
    ]);
  });

  it("sells a part at a time, down to nothing, and then stops showing it", () => {
    const db = freshDb({ seeded: true });
    const shareC = add(db, { ...EXA, name: "Exempelbolaget C", tickerYahoo: "EXC" });
    buy(db, shareC.id, { quantity: 30, price: 40, side: "opening" });

    buy(db, shareC.id, { quantity: 12, price: 28, side: "sell", date: "2026-10-01" });
    expect(quantityOf(db, shareC.id)).toBe(18 * E4);
    buy(db, shareC.id, { quantity: 18, price: 30, side: "sell", date: "2026-11-01" });
    expect(quantityOf(db, shareC.id)).toBe(0);
    // Nothing held is nothing to show, but the trades are still there.
    expect(holdings(db)).toEqual([]);
    expect(holdings(db, { includeEmpty: true })).toHaveLength(1);
  });

  it("refuses to sell more than is held, per account", () => {
    const db = freshDb({ seeded: true });
    const shareB = add(db, { ...EXA, name: "Exempelbolaget B", tickerYahoo: "EXB" });
    buy(db, shareB.id, { quantity: 5, price: 151, side: "opening", account: "isk" });
    expect(() => buy(db, shareB.id, { quantity: 6, price: 130, side: "sell", account: "isk" })).toThrow("Du äger 5 — det går inte att sälja 6.");
    // The other account holds none of it at all.
    expect(() => buy(db, shareB.id, { quantity: 1, price: 130, side: "sell", account: "depot" })).toThrow(/Du äger 0/);
  });

  it("keeps the two accounts apart", () => {
    const db = freshDb({ seeded: true });
    const fund = add(db);
    buy(db, fund.id, { quantity: 50, price: 100, side: "opening", account: "isk" });
    buy(db, fund.id, { quantity: 10, price: 150.4, account: "depot" });

    expect(holdings(db).map((h) => [h.account, h.quantityE4])).toEqual([
      ["depot", 10 * E4],
      ["isk", 50 * E4],
    ]);
    expect(quantityOf(db, fund.id)).toBe(60 * E4);
  });

  it("leaves a deleted trade out, and counts it again when it comes back", () => {
    const db = freshDb({ seeded: true });
    const fund = add(db);
    buy(db, fund.id, { quantity: 50, price: 100, side: "opening" });
    const extra = buy(db, fund.id, { quantity: 7, price: 150.4, date: "2026-09-30" });

    deleteTrade(db, extra.id);
    expect(quantityOf(db, fund.id)).toBe(50 * E4);
    expect(db.select().from(trades).where(eq(trades.id, extra.id)).get()!.deletedAt).not.toBeNull();
    restoreTrade(db, extra.id);
    expect(quantityOf(db, fund.id)).toBe(57 * E4);
  });

  it("holds fractions of a share", () => {
    const db = freshDb({ seeded: true });
    const fund = add(db);
    buy(db, fund.id, { quantity: 0.5, price: 150.4 });
    buy(db, fund.id, { quantity: 0.25, price: 151.0, date: "2026-09-19" });
    expect(quantityOf(db, fund.id)).toBe(7500);
    expect(formatQuantity(quantityOf(db, fund.id))).toBe("0,75");
  });

  it("says no to an affär that can't have happened", () => {
    const db = freshDb({ seeded: true });
    const fund = add(db);
    expect(() => buy(db, fund.id, { quantity: 0, price: 150.4 })).toThrow(/Antalet/);
    expect(() => buy(db, fund.id, { quantity: 1, price: 150.4, date: "18/9" as never })).toThrow(/ÅÅÅÅ-MM-DD/);
    expect(() => createTrade(db, { instrumentId: 999, account: "isk", side: "buy", date: "2026-09-18", quantityE4: E4, priceE4: E4 })).toThrow(/finns inte/);
    expect(() => createTrade(db, { instrumentId: fund.id, account: "isk", side: "buy", date: "2026-09-18", quantityE4: E4, priceE4: E4, transactionId: 4242 })).toThrow(
      /Transaktionen finns inte/,
    );
  });
});

describe("startinnehav", () => {
  /** A made-up portfolio as a broker could show it on 18 September 2026. */
  const AVANZA = {
    date: "2026-09-18",
    account: "isk" as const,
    rows: [
      { name: "Exempelfond Global Index", isin: "IE00EXEMPEL1", currency: "EUR" as const, kind: "etf" as const, zone: "base" as const, tickerYahoo: "EXFG.DE", quantityE4: parseQuantity("50")!, priceE4: parsePrice("100,00")! },
      { name: "Exempelbolaget A", currency: "USD" as const, kind: "stock" as const, zone: "bet" as const, tickerYahoo: "EXA", quantityE4: parseQuantity("12")!, priceE4: parsePrice("200,00")! },
      { name: "Exempelbolaget B", currency: "USD" as const, kind: "stock" as const, zone: "bet" as const, tickerYahoo: "EXB", quantityE4: parseQuantity("5")!, priceE4: parsePrice("151,00")! },
      { name: "Exempelbolaget C", currency: "USD" as const, kind: "stock" as const, zone: "bet" as const, tickerYahoo: "EXC", quantityE4: parseQuantity("30")!, priceE4: parsePrice("40,00")! },
    ],
  };

  it("skriver ner hela portföljen en gång, som en affär per innehav", () => {
    const db = freshDb({ seeded: true });
    const { instruments, trades } = createOpening(db, AVANZA);

    expect(instruments.map((i) => [i.name, i.zone, i.currency, i.tickerYahoo])).toEqual([
      ["Exempelfond Global Index", "base", "EUR", "EXFG.DE"],
      ["Exempelbolaget A", "bet", "USD", "EXA"],
      ["Exempelbolaget B", "bet", "USD", "EXB"],
      ["Exempelbolaget C", "bet", "USD", "EXC"],
    ]);
    expect(trades.every((t) => t.side === "opening" && t.date === "2026-09-18" && t.feeOre === 0 && t.note === "Startinnehav")).toBe(true);
    expect(holdings(db).map((h) => h.quantityE4)).toEqual([500000, 120000, 50000, 300000]);
  });

  it("återanvänder ett instrument som redan finns, i stället för att skapa det två gånger", () => {
    const db = freshDb({ seeded: true });
    createInstrument(db, { name: "Exempelbolaget A", currency: "USD", kind: "stock", zone: "bet", tickerYahoo: "EXA" });
    const { instruments } = createOpening(db, { ...AVANZA, rows: [AVANZA.rows[1]] });

    expect(listInstruments(db)).toHaveLength(1);
    // The one that was already there keeps its own name.
    expect(instruments[0].name).toBe("Exempelbolaget A");
  });

  it("vägrar ett andra startinnehav, som annars skulle dubbla innehavet", () => {
    const db = freshDb({ seeded: true });
    createOpening(db, AVANZA);
    expect(() => createOpening(db, AVANZA)).toThrow("Exempelfond Global Index har redan ett startinnehav. Registrera ett köp i stället.");
    // Nothing of the second attempt got in.
    expect(holdings(db)).toHaveLength(4);
  });

  it("säger ifrån om datumet eller raderna är fel", () => {
    const db = freshDb({ seeded: true });
    expect(() => createOpening(db, { ...AVANZA, date: "18/9" })).toThrow(/ÅÅÅÅ-MM-DD/);
    expect(() => createOpening(db, { ...AVANZA, rows: [] })).toThrow(/minst ett innehav/);
    expect(() => createOpening(db, { ...AVANZA, rows: [{ ...AVANZA.rows[0], quantityE4: 0 }] })).toThrow(/Antalet/);
    expect(listInstruments(db)).toEqual([]);
  });
});
