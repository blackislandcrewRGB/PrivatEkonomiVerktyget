import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, receiptLines, receipts, transactions } from "../src/db/schema.js";
import { ReceiptError, parseReceipt, type ParsedReceipt } from "../src/receipts/parse.js";
import {
  countReceipts,
  createReceipt,
  deleteReceipt,
  getReceipt,
  listReceipts,
  receiptForTransaction,
  receiptNameKey,
  receiptsByTransaction,
  restoreReceipt,
} from "../src/receipts/receipts.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/receipts", name), "utf8");

let seq = 0;
function tx(db: Db, amount: number, desc: string, date = "2026-09-05") {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount,
      fingerprint: `r${++seq}`,
    })
    .returning()
    .get();
}

/** What is saved from a parsed receipt, the way the API will do it (step 2). */
const input = (parsed: ParsedReceipt, transactionId: number | null, raw: string) => ({
  transactionId,
  store: parsed.store,
  storeArea: parsed.storeArea,
  purchaseDate: parsed.purchaseDate ?? "2026-09-05",
  purchaseTime: parsed.purchaseTime,
  totalOre: parsed.totalOre ?? parsed.sumOre,
  statedItemCount: parsed.statedItemCount,
  source: "text" as const,
  rawText: raw,
  lines: parsed.lines,
});

function seeded(db: Db, amount = -9120, file = "ica.txt") {
  const raw = fixture(file);
  const row = tx(db, amount, "ICA SUPERMARKET EXEMPELSTAD");
  return { row, receipt: createReceipt(db, input(parseReceipt(raw), row.id, raw)) };
}

describe("storing a receipt", () => {
  it("keeps the rows in the order of the receipt, with a key to group them by", () => {
    const db = freshDb({ seeded: true });
    const { receipt } = seeded(db);
    expect(receipt.lines.map((l) => l.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(receipt.lines.map((l) => l.name)).toEqual([
      "Bladspenat",
      "Havrebar Choklad",
      "Creme fraiche 32%",
      "Crème Fraic 10kr/st",
      "Kanelbulle 6-p",
      "Vispgrädde 36%",
    ]);
    expect(receipt.lines[0].nameKey).toBe("bladspenat");
    expect(receipt.totalOre).toBe(9120);
    expect(receipt.lines.reduce((s, l) => s + l.totalOre, 0)).toBe(receipt.totalOre);
    expect(countReceipts(db)).toBe(1);
  });

  it("is metadata, not money: the transaction is exactly as it was", () => {
    const db = freshDb({ seeded: true });
    const raw = fixture("ica.txt");
    const row = tx(db, -9120, "ICA SUPERMARKET EXEMPELSTAD");
    const before = db.select().from(transactions).where(eq(transactions.id, row.id)).get();

    const receipt = createReceipt(db, input(parseReceipt(raw), row.id, raw));
    expect(db.select().from(transactions).where(eq(transactions.id, row.id)).get()).toEqual(before);

    deleteReceipt(db, receipt.id);
    expect(db.select().from(transactions).where(eq(transactions.id, row.id)).get()).toEqual(before);
  });

  it("refuses rows that don't add up to the total, and says by how much", () => {
    const db = freshDb({ seeded: true });
    const raw = fixture("ica.txt");
    const parsed = parseReceipt(raw);
    const wrong = { ...parsed, lines: parsed.lines.slice(1) };
    expect(() => createReceipt(db, input(wrong, null, raw))).toThrow(/75,30 kr.*91,20 kr/);
    expect(countReceipts(db)).toBe(0);
  });

  it("takes the card and membership numbers out of the text it keeps", () => {
    const db = freshDb({ seeded: true });
    const raw = `${fixture("ica.txt")}\nStammiskort ************9609\nKundnummer: 9752000000001234`;
    const parsed = parseReceipt(raw);
    const receipt = createReceipt(db, input(parsed, null, raw));
    const stored = db.select().from(receipts).where(eq(receipts.id, receipt.id)).get()!;
    expect(stored.rawText).not.toContain("9752000000001234");
    expect(stored.rawText).not.toContain("9609");
    expect(stored.rawText).toContain("Bladspenat");
  });

  it("gives a purchase one receipt, not two", () => {
    const db = freshDb({ seeded: true });
    const { row, receipt } = seeded(db);
    const raw = fixture("ica.txt");
    expect(() => createReceipt(db, input(parseReceipt(raw), row.id, raw))).toThrow(/redan ett kvitto/);

    // ...unless the first one was removed.
    deleteReceipt(db, receipt.id);
    expect(receiptForTransaction(db, row.id)).toBeUndefined();
    const second = createReceipt(db, input(parseReceipt(raw), row.id, raw));
    expect(second.id).not.toBe(receipt.id);
    // And then the old one can't come back and take the place again.
    expect(() => restoreReceipt(db, receipt.id)).toThrow(/redan ett kvitto/);
  });

  it("removes and restores without losing the rows", () => {
    const db = freshDb({ seeded: true });
    const { receipt } = seeded(db);
    expect(deleteReceipt(db, receipt.id)).toBe(true);
    expect(listReceipts(db)).toEqual([]);
    expect(countReceipts(db)).toBe(0);
    // Soft delete: still there with everything on it.
    expect(getReceipt(db, receipt.id)!.lines).toHaveLength(6);

    expect(restoreReceipt(db, receipt.id)).toBe(true);
    expect(listReceipts(db).map((r) => r.id)).toEqual([receipt.id]);
  });

  it("finds the receipts of a page of transactions in one query", () => {
    const db = freshDb({ seeded: true });
    const { row, receipt } = seeded(db);
    const other = tx(db, -18772, "LIDL");
    expect(receiptsByTransaction(db, [row.id, other.id])).toEqual(new Map([[row.id, { id: receipt.id, lines: 6 }]]));
    expect(receiptsByTransaction(db, [])).toEqual(new Map());
  });

  it("keeps the receipt when the transaction is deleted for real", () => {
    const db = freshDb({ seeded: true });
    const { row, receipt } = seeded(db);
    db.delete(transactions).where(eq(transactions.id, row.id)).run();
    const kept = getReceipt(db, receipt.id)!;
    expect(kept.transactionId).toBeNull();
    expect(kept.lines).toHaveLength(6);
  });

  it("takes the rows with it when the receipt itself is deleted for real", () => {
    const db = freshDb({ seeded: true });
    const { receipt } = seeded(db);
    db.delete(receipts).where(eq(receipts.id, receipt.id)).run();
    expect(db.select().from(receiptLines).all()).toEqual([]);
  });

  it("checks what it is given", () => {
    const db = freshDb({ seeded: true });
    const raw = fixture("ica.txt");
    const parsed = parseReceipt(raw);
    expect(() => createReceipt(db, { ...input(parsed, null, raw), lines: [] })).toThrow(ReceiptError);
    expect(() => createReceipt(db, { ...input(parsed, null, raw), purchaseDate: "13/9" })).toThrow(/ÅÅÅÅ-MM-DD/);
    expect(() => createReceipt(db, { ...input(parsed, 99999, raw) })).toThrow(/Transaktionen finns inte/);
    const halfOre = { ...parsed, lines: parsed.lines.map((l, i) => (i === 0 ? { ...l, totalOre: 1590.5 } : l)) };
    expect(() => createReceipt(db, input(halfOre, null, raw))).toThrow(/hela ören/);
  });

  it("folds a name only by case and spacing", () => {
    expect(receiptNameKey("  Fil  Vispgrädde 36% ")).toBe("fil vispgrädde 36%");
    // Different things stay different: that judgement is the user's to make.
    expect(receiptNameKey("HAVREDRYCK NATURELL")).not.toBe(receiptNameKey("Havredryck Barista"));
  });
});
