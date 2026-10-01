import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, categories, receiptLines, transactions } from "../src/db/schema.js";
import { parseReceipt, type ParsedReceipt } from "../src/receipts/parse.js";
import { createReceipt, deleteReceipt } from "../src/receipts/receipts.js";
import { listProducts, mergeProducts, setProductGroup } from "../src/receipts/products.js";
import { grocerySummary, productHistory } from "../src/receipts/groceryStats.js";
import { freshDb } from "./helpers.js";

/**
 * What the receipts add up to.
 *
 * The number that has to be right before any of the others matter is the
 * coverage: a sum of half the groceries reads as all of them unless it says
 * which half it is.
 */

type Db = ReturnType<typeof freshDb>;

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/receipts", name), "utf8");

let seq = 0;
/** A grocery purchase, in the category the food analysis counts. */
function grocery(db: Db, amount: number, desc: string, date: string) {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  const categoryId = db.select().from(categories).where(eq(categories.systemKey, "groceries")).get()!.id;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId,
      categoryId,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount,
      fingerprint: `g${++seq}`,
    })
    .returning()
    .get();
}

const input = (parsed: ParsedReceipt, transactionId: number, raw: string, date: string) => ({
  transactionId,
  store: parsed.store,
  storeArea: parsed.storeArea,
  purchaseDate: parsed.purchaseDate ?? date,
  purchaseTime: parsed.purchaseTime,
  totalOre: parsed.totalOre ?? parsed.sumOre,
  statedItemCount: parsed.statedItemCount,
  source: "text" as const,
  rawText: raw,
  lines: parsed.lines,
});

function withReceipt(db: Db, file: string, amount: number, desc: string, date: string) {
  const raw = fixture(file);
  const row = grocery(db, amount, desc, date);
  return createReceipt(db, input(parseReceipt(raw), row.id, raw, date));
}

const PERIOD = ["2026-09-01", "2026-09-30"] as const;

describe("how much of the food the receipts cover", () => {
  it("says how many of the period's grocery purchases have one, and for how much", () => {
    const db = freshDb({ seeded: true });
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    withReceipt(db, "ica.txt", -9120, "ICA SUPERMARKET", "2026-09-05");
    // Two grocery purchases nobody has pasted a receipt for.
    grocery(db, -25000, "COOP", "2026-09-17");
    grocery(db, -14000, "HEMKÖP", "2026-09-19");

    const { coverage } = grocerySummary(db, ...PERIOD);
    expect(coverage).toEqual({ purchases: 4, withReceipt: 2, spentOre: 18772 + 9120 + 25000 + 14000, receiptOre: 18772 + 9120 });
  });

  it("counts whole purchases, not half ones: a receipt is never halved", () => {
    const db = freshDb({ seeded: true });
    const row = grocery(db, -18772, "LIDL", "2026-09-15");
    db.update(transactions).set({ shared: true }).where(eq(transactions.id, row.id)).run();

    // 'Min del' would say 93,86 here. The receipt says 187,72, so the money
    // it is held against has to be the whole amount too.
    expect(grocerySummary(db, ...PERIOD).coverage.spentOre).toBe(18772);
  });

  it("leaves a deleted receipt out of everything", () => {
    const db = freshDb({ seeded: true });
    const receipt = withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    deleteReceipt(db, receipt.id);

    const summary = grocerySummary(db, ...PERIOD);
    expect(summary.coverage).toMatchObject({ purchases: 1, withReceipt: 0, receiptOre: 0 });
    expect(summary.groups).toEqual([]);
    expect(summary.stores).toEqual([]);
  });
});

describe("what the receipts were spent on", () => {
  it("sorts the shelves by what they cost, with the unplaced ones last", () => {
    const db = freshDb({ seeded: true });
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    // One grocery taken off its shelf: it still counts, in its own row.
    const flakes = listProducts(db).find((p) => p.name === "Havregryn fullkorn")!;
    setProductGroup(db, flakes.id, null);

    const { groups } = grocerySummary(db, ...PERIOD);
    expect(groups.map((g) => g.name).at(-1)).toBe("Utan hylla");
    expect(groups.find((g) => g.name === "Utan hylla")).toMatchObject({ id: null, totalOre: 2240, times: 1 });
    // Falling amounts, so the biggest shelf is the first answer.
    const placed = groups.filter((g) => g.id !== null).map((g) => g.totalOre);
    expect([...placed].sort((a, b) => b - a)).toEqual(placed);
    expect(groups.reduce((s, g) => s + g.totalOre, 0)).toBe(18772 - 200 - 200 - 400 + 800);
  });

  it("keeps the rows that aren't groceries out of the shelves, and says what they were", () => {
    const db = freshDb({ seeded: true });
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    const { extras, groups } = grocerySummary(db, ...PERIOD);
    // Lidl's receipt: an 8 kr discount, two 2 kr deposits and a 4 kr bag.
    // The bag row says neither how many nor the price of one: no count.
    expect(extras).toEqual({ discountOre: -800, depositOre: 400, bagOre: 400, bags: null });
    expect(groups.some((g) => g.name === "Utan hylla")).toBe(false);
  });

  it("counts the bags when the bag rows say how many or what one costs", () => {
    const db = freshDb({ seeded: true });
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    db.update(receiptLines).set({ quantityMilli: 2000 }).where(eq(receiptLines.kind, "bag")).run();
    expect(grocerySummary(db, ...PERIOD).extras.bags).toBe(2);
    db.update(receiptLines).set({ quantityMilli: null, unitPriceOre: 200 }).where(eq(receiptLines.kind, "bag")).run();
    expect(grocerySummary(db, ...PERIOD).extras.bags).toBe(2);
  });

  it("gives every month in the period a bar, including the empty ones", () => {
    const db = freshDb({ seeded: true });
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    const { months } = grocerySummary(db, "2026-07-01", "2026-09-30");
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(months.slice(0, 2).every((m) => m.totalOre === 0 && Object.keys(m.groups).length === 0)).toBe(true);
    expect(months[2].totalOre).toBeGreaterThan(0);
    // How many receipts each month has, for the bars that are drawn.
    expect(months.map((m) => m.receipts)).toEqual([0, 0, 1]);
  });
});

describe("one grocery over time", () => {
  it("tells how often it is bought, what it costs in a month and where it is cheapest", () => {
    const db = freshDb({ seeded: true });
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-01");
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-11");
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-21");
    const fil = listProducts(db).find((p) => p.name === "Filmjölk 3%")!;

    const history = productHistory(db, fil.id, ...PERIOD);
    expect(history.rows.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-11", "2026-09-21"]);
    expect(history.everyDays).toBe(10);
    expect(history.perMonthOre).toBe(1350 * 3);
    // One shop only: there is nothing to say about where it is cheapest.
    expect(history.cheapestStore).toBeNull();
  });

  it("follows a grocery through both its names once they are one", () => {
    const db = freshDb({ seeded: true });
    withReceipt(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    withReceipt(db, "ica.txt", -9120, "ICA SUPERMARKET", "2026-09-05");
    const lidl = listProducts(db).find((p) => p.name === "Cremé Fraiche Lätt")!;
    const ica = listProducts(db).find((p) => p.name === "Creme fraiche 32%")!;
    mergeProducts(db, lidl.id, [ica.id]);

    const history = productHistory(db, lidl.id, ...PERIOD);
    expect(history.rows.map((r) => [r.store, r.totalOre])).toEqual([
      ["ica", 1575],
      ["lidl", 2950],
    ]);
    expect(history.cheapestStore).toBe("ica");
  });
});
