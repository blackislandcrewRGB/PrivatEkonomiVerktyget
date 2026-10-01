import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, fuelFills, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { deleteFill, discountPerLitre, fillsByTransaction, fillsMissing, listFills, litresOf, paidPerLitre, saveFill } from "../src/fuel/fills.js";
import { addPrice, calibration, FuelError, getFuelSettings, monthActuals, setShifts } from "../src/fuel/fuel.js";
import { freshDb } from "./helpers.js";

/**
 * Tankningen som den står på kvittot.
 *
 * The numbers are an invented receipt: 58,20 litres at 18,49 kr/l with
 * 11,64 kr off, charged as 1 064,48 kr. Those four check each other, and the
 * price actually paid — 18,29 kr/l — is worked out from them rather than
 * stored beside them.
 */

type Db = ReturnType<typeof freshDb>;

const RECEIPT = { date: "2026-09-10", litresE2: 5_820, listPriceOre: 1_849, discountOre: 1_164, amountOre: 106_448, station: "Circle K Exempelstad" };

let seq = 0;
function fuelTx(db: Db, date: string, ore: number): number {
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Mastercard Guld")).get()!.id,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "CIRCLE K EXEMPELSTAD",
      descriptionClean: "CIRCLE K EXEMPELSTAD",
      amount: -ore,
      categoryId: getCategoryPathMap(db).get("Bil/Drivmedel")!,
      fingerprint: `fill-${++seq}`,
    })
    .returning({ id: transactions.id })
    .get().id;
}

describe("kvittot", () => {
  it("keeps what it says, and works the paid price out from it", () => {
    const db = freshDb({ seeded: true });
    const fill = saveFill(db, RECEIPT);
    expect(fill).toMatchObject({ litresE2: 5_820, listPriceOre: 1_849, discountOre: 1_164, amountOre: 106_448 });
    // 1 064,48 kr over 58,20 l is 18,29 kr/l — 20 öre under the pump price.
    expect(paidPerLitre(fill)).toBe(1_829);
    expect(discountPerLitre(fill)).toBe(20);
    expect(litresOf(fill)).toBe(58.2);
    // The paid price is not a column: nothing can disagree with the four it
    // came from.
    expect(Object.keys(fill)).not.toContain("paidPriceOre");
  });

  it("refuses a receipt whose own arithmetic does not hold", () => {
    const db = freshDb({ seeded: true });
    // The litres mistyped as 5,82: everything else still looks reasonable.
    expect(() => saveFill(db, { ...RECEIPT, litresE2: 582 })).toThrow(/Kvittot går inte ihop/);
    expect(() => saveFill(db, { ...RECEIPT, discountOre: 0 })).toThrow(/går inte ihop/);
    // An öre of rounding is the receipt's own and passes.
    expect(saveFill(db, { ...RECEIPT, amountOre: 106_449 }).amountOre).toBe(106_449);
  });

  it("refuses what is not a number it can use", () => {
    const db = freshDb({ seeded: true });
    expect(() => saveFill(db, { ...RECEIPT, date: "10/09/2026" })).toThrow(FuelError);
    expect(() => saveFill(db, { ...RECEIPT, litresE2: 0 })).toThrow(/liter/);
    expect(() => saveFill(db, { ...RECEIPT, listPriceOre: 99 })).toThrow(/Literpriset/);
    expect(() => saveFill(db, { ...RECEIPT, discountOre: -100 })).toThrow(/Rabatten/);
  });
});

describe("kvittot mot banken", () => {
  it("must agree with what left the account", () => {
    const db = freshDb({ seeded: true });
    const id = fuelTx(db, "2026-09-10", 106_448);
    expect(saveFill(db, { ...RECEIPT, transactionId: id }).transactionId).toBe(id);
    // A receipt for another fill-up entirely.
    expect(() => saveFill(db, { ...RECEIPT, litresE2: 3_100, listPriceOre: 1_729, discountOre: 620, amountOre: 52_979, transactionId: id })).toThrow(/stämmer inte med transaktionens/);
    expect(() => saveFill(db, { ...RECEIPT, transactionId: 9_999 })).toThrow(/finns inte/);
  });

  it("is one per transaction: entering it again corrects it", () => {
    const db = freshDb({ seeded: true });
    const id = fuelTx(db, "2026-09-10", 106_448);
    const first = saveFill(db, { ...RECEIPT, transactionId: id });
    const again = saveFill(db, { ...RECEIPT, transactionId: id, station: "Exempelstad" });
    expect(again.id).toBe(first.id);
    expect(again.station).toBe("Exempelstad");
    expect(db.select().from(fuelFills).all()).toHaveLength(1);
  });

  it("takes a receipt that has no transaction yet, and more than one of them", () => {
    const db = freshDb({ seeded: true });
    saveFill(db, RECEIPT);
    saveFill(db, { ...RECEIPT, date: "2026-08-10" });
    expect(listFills(db)).toHaveLength(2);
    expect(fillsByTransaction(db).size).toBe(0);
  });

  it("goes with the transaction when that is deleted for good", () => {
    const db = freshDb({ seeded: true });
    const id = fuelTx(db, "2026-09-10", 106_448);
    saveFill(db, { ...RECEIPT, transactionId: id });
    db.delete(transactions).where(eq(transactions.id, id)).run();
    expect(listFills(db)).toEqual([]);
  });
});

describe("att hitta tankningarna som saknar kvitto", () => {
  it("lists the fuel purchases with nothing entered for them, newest first", () => {
    const db = freshDb({ seeded: true });
    const category = getFuelSettings(db).fuelCategoryId;
    const july = fuelTx(db, "2026-07-24", 83_437);
    const september = fuelTx(db, "2026-09-10", 106_448);

    expect(fillsMissing(db, category, "2026-01-01", "2026-12-31").map((r) => r.id)).toEqual([september, july]);
    saveFill(db, { ...RECEIPT, transactionId: september });
    expect(fillsMissing(db, category, "2026-01-01", "2026-12-31").map((r) => r.id)).toEqual([july]);
    // Outside the period it is not asked for.
    expect(fillsMissing(db, category, "2026-08-01", "2026-12-31")).toEqual([]);
  });

  it("gives nothing when no category is fuel", () => {
    const db = freshDb({ seeded: true });
    expect(fillsMissing(db, null, "2026-01-01", "2026-12-31")).toEqual([]);
  });
});

describe("att ta bort ett kvitto", () => {
  it("leaves the transaction alone", () => {
    const db = freshDb({ seeded: true });
    const id = fuelTx(db, "2026-09-10", 106_448);
    const fill = saveFill(db, { ...RECEIPT, transactionId: id });
    deleteFill(db, fill.id);
    expect(listFills(db)).toEqual([]);
    expect(db.select().from(transactions).where(eq(transactions.id, id)).get()).toBeDefined();
  });
});

describe("månaden räknad på kvittots liter", () => {
  /** 17 shifts is 880 km with the standard distances. */
  const month = (db: Db, m: string, shifts: number) => setShifts(db, m, shifts);

  it("reads the litres instead of reckoning them, and says it did", () => {
    const db = freshDb({ seeded: true });
    // The entered price is the pump's list price: 20 öre above what was paid,
    // so the reckoned litres come out about a percent short.
    addPrice(db, "2026-09-01", 1_849);
    month(db, "2026-09", 17);
    const tx = fuelTx(db, "2026-09-10", 106_448);

    const before = monthActuals(db, "2026-09", "2026-09")[0];
    expect(before.litres).toBeCloseTo(106_448 / 1_849, 2);
    expect(before.receipts).toBe(0);
    expect(before.litresExact).toBe(false);

    saveFill(db, { ...RECEIPT, transactionId: tx });
    const after = monthActuals(db, "2026-09", "2026-09")[0];
    expect(after.litres).toBe(58.2);
    expect(after.receipts).toBe(1);
    expect(after.litresExact).toBe(true);
    // 58,20 l over 880 km, against 57,57 reckoned: the consumption was
    // understated by more than a percent.
    expect(after.l100!).toBeCloseTo((58.2 / 880) * 100, 4);
    expect(after.l100!).toBeGreaterThan(before.l100!);
    // And the month's price is now what was actually paid per litre.
    expect(after.price!.price).toBe(1_829);
  });

  it("handles a month with one receipt and one without", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-07-01", 1_912);
    month(db, "2026-07", 15);
    const withReceipt = fuelTx(db, "2026-07-24", 83_437);
    fuelTx(db, "2026-07-06", 88_215);
    saveFill(db, { date: "2026-07-24", litresE2: 4_410, listPriceOre: 1_912, discountOre: 882, amountOre: 83_437, transactionId: withReceipt });

    const m = monthActuals(db, "2026-07", "2026-07")[0];
    expect(m.receipts).toBe(1);
    expect(m.litresExact).toBe(false);
    // 44,10 read plus 88 215 öre at 19,12 kr/l reckoned.
    expect(m.litres!).toBeCloseTo(44.1 + 88_215 / 1_912, 4);
  });

  it("works the litres out from receipts even when no price has been entered", () => {
    const db = freshDb({ seeded: true });
    month(db, "2026-09", 14);
    const tx = fuelTx(db, "2026-09-10", 106_448);
    saveFill(db, { ...RECEIPT, transactionId: tx });
    // Nothing in the price table at all: the receipt is enough on its own.
    const m = monthActuals(db, "2026-09", "2026-09")[0];
    expect(m.litres).toBe(58.2);
    expect(m.litresExact).toBe(true);
    expect(m.priceLater).toBe(false);
  });

  it("counts a month of receipts as exact in the calibration", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-06-01", 1_955);
    month(db, "2026-06", 15);
    month(db, "2026-07", 15);
    month(db, "2026-08", 15);
    const june = fuelTx(db, "2026-06-09", 101_394);
    fuelTx(db, "2026-07-06", 88_215);
    fuelTx(db, "2026-08-15", 151_620);
    saveFill(db, { date: "2026-06-09", litresE2: 5_240, listPriceOre: 1_955, discountOre: 1_048, amountOre: 101_394, transactionId: june });

    const cal = calibration(db, "2026-09-19")!;
    expect(cal.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(cal.exactMonths).toBe(1);
  });

  it("leaves a trip's receipt out of the month's litres", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-08-01", 1_894);
    month(db, "2026-08", 5);
    const trip = db
      .insert(transactions)
      .values({
        source: "swedbank",
        accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Mastercard Guld")).get()!.id,
        bookingDate: "2026-08-02",
        transactionDate: "2026-08-02",
        descriptionRaw: "OKQ8 EXEMPELSTAD",
        descriptionClean: "OKQ8 EXEMPELSTAD",
        note: "Resa",
        amount: -52_472,
        categoryId: getCategoryPathMap(db).get("Bil/Drivmedel")!,
        fingerprint: `trip-${++seq}`,
      })
      .returning({ id: transactions.id })
      .get().id;
    saveFill(db, { date: "2026-08-01", litresE2: 2_800, listPriceOre: 1_894, discountOre: 560, amountOre: 52_472, transactionId: trip });

    // The litres were driven to Exempelstad, not to work: the receipt is kept, but
    // the month's consumption knows nothing about it.
    const m = monthActuals(db, "2026-08", "2026-08")[0];
    expect(m.litres).toBeNull();
    expect(m.receipts).toBe(0);
    expect(m.trips).toBe(52_472);
  });
});
