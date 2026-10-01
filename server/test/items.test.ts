import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, itemAttachments, items, itemTransactions, transactions } from "../src/db/schema.js";
import {
  ItemError,
  addAttachment,
  attachmentsFor,
  createItem,
  deleteAttachment,
  deleteItem,
  getItem,
  itemsByTransaction,
  linkTransaction,
  listItems,
  restoreItem,
  transactionIdsFor,
  unlinkTransaction,
  updateItem,
  warrantyEndsOn,
} from "../src/items/items.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;

let seq = 0;
function tx(db: Db, amount: number, desc: string, date = "2026-09-14") {
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
      fingerprint: `i${++seq}`,
    })
    .returning()
    .get();
}

const oura = {
  name: "  Ovalring Gen 4  ",
  category: "Elektronik",
  purchaseDate: "2026-08-31",
  priceOre: 449000,
  merchant: "Amazon",
  purchaseUrl: "https://www.amazon.se/dp/B0CQ",
  warrantyMonths: 24,
};

function setup() {
  const db = freshDb({ seeded: true });
  return { db, purchase: tx(db, -449000, "AMAZON EU") };
}

describe("a pryl", () => {
  it("is stored with its text trimmed and the defaults it wasn't given", () => {
    const { db } = setup();
    const item = createItem(db, oura);
    expect(item.name).toBe("Ovalring Gen 4");
    expect(item.priceOre).toBe(449000);
    expect(item.owner).toBe("me");
    expect(item.status).toBe("owned");
    expect(item.category).toBe("Elektronik");
    expect(item.deletedAt).toBeNull();
    expect(listItems(db)).toHaveLength(1);
  });

  it("says what is wrong instead of storing it", () => {
    const { db } = setup();
    expect(() => createItem(db, { ...oura, name: "   " })).toThrow(/namn/i);
    expect(() => createItem(db, { ...oura, purchaseDate: "31 augusti" })).toThrow(/ÅÅÅÅ-MM-DD/);
    expect(() => createItem(db, { ...oura, priceOre: -100 })).toThrow(ItemError);
    expect(() => createItem(db, { ...oura, priceOre: 12.5 })).toThrow(ItemError);
    expect(() => createItem(db, { ...oura, owner: "someone" as never })).toThrow(/ägare/i);
    expect(() => createItem(db, { ...oura, warrantyMonths: -1 })).toThrow(/[Gg]aranti/);
    expect(db.select().from(items).all()).toHaveLength(0);
  });

  // The link is rendered as something to click, so only a web address gets in.
  it("takes a purchase link only if it is http or https", () => {
    const { db } = setup();
    expect(() => createItem(db, { ...oura, purchaseUrl: "javascript:alert(1)" })).toThrow(/http/);
    expect(() => createItem(db, { ...oura, purchaseUrl: "data:text/html,<script>" })).toThrow(/http/);
    expect(() => createItem(db, { ...oura, purchaseUrl: "www.amazon.se/dp/B0CQ" })).toThrow(/http/);
    expect(createItem(db, { ...oura, purchaseUrl: null }).purchaseUrl).toBeNull();
    expect(createItem(db, oura).purchaseUrl).toBe("https://www.amazon.se/dp/B0CQ");
  });

  it("keeps the fields an edit didn't mention", () => {
    const { db } = setup();
    const item = createItem(db, oura);
    const sold = updateItem(db, item.id, { status: "sold", soldPriceOre: 200000, soldDate: "2026-09-19" });
    expect(sold.status).toBe("sold");
    expect(sold.soldPriceOre).toBe(200000);
    expect(sold.name).toBe("Ovalring Gen 4");
    expect(sold.merchant).toBe("Amazon");
    expect(sold.warrantyMonths).toBe(24);
    expect(sold.updatedAt >= item.updatedAt).toBe(true);
  });

  it("counts the warranty from the purchase date, and clamps a short month", () => {
    expect(warrantyEndsOn({ purchaseDate: "2026-08-31", warrantyMonths: 24 })).toBe("2028-08-31");
    expect(warrantyEndsOn({ purchaseDate: "2026-08-31", warrantyMonths: 6 })).toBe("2027-02-28");
    expect(warrantyEndsOn({ purchaseDate: "2026-09-14", warrantyMonths: 12 })).toBe("2027-09-14");
    expect(warrantyEndsOn({ purchaseDate: "2026-09-14", warrantyMonths: null })).toBeNull();
    expect(warrantyEndsOn({ purchaseDate: "2026-09-14", warrantyMonths: 0 })).toBeNull();
  });
});

describe("a pryl and its transactions", () => {
  it("links both ways, and linking twice is still one link", () => {
    const { db, purchase } = setup();
    const item = createItem(db, oura);
    const refund = tx(db, 449000, "AMAZON EU RETUR", "2026-09-18");
    linkTransaction(db, item.id, purchase.id);
    linkTransaction(db, item.id, purchase.id);
    linkTransaction(db, item.id, refund.id);
    expect(transactionIdsFor(db, item.id)).toEqual([purchase.id, refund.id]);
    expect(itemsByTransaction(db, [purchase.id, refund.id]).get(purchase.id)).toEqual([{ id: item.id, name: "Ovalring Gen 4" }]);
    expect(unlinkTransaction(db, item.id, refund.id)).toBe(true);
    expect(unlinkTransaction(db, item.id, refund.id)).toBe(false);
    expect(transactionIdsFor(db, item.id)).toEqual([purchase.id]);
  });

  it("lets one transaction hold several prylar", () => {
    const { db, purchase } = setup();
    const ring = createItem(db, oura);
    const cable = createItem(db, { ...oura, name: "USB-C-kabel", priceOre: 19900 });
    linkTransaction(db, ring.id, purchase.id);
    linkTransaction(db, cable.id, purchase.id);
    expect(itemsByTransaction(db, [purchase.id]).get(purchase.id)?.map((i) => i.name)).toEqual(["Ovalring Gen 4", "USB-C-kabel"]);
  });

  it("refuses a link to something that isn't there", () => {
    const { db, purchase } = setup();
    const item = createItem(db, oura);
    expect(() => linkTransaction(db, item.id, 9999)).toThrow(/[Tt]ransaktionen/);
    expect(() => linkTransaction(db, 9999, purchase.id)).toThrow(/[Pp]rylen/);
  });

  // The point of the whole feature: a note about a thing must never be able to
  // change the money it was bought with.
  it("leaves the transaction exactly as it was when the pryl is removed", () => {
    const { db, purchase } = setup();
    const item = createItem(db, oura);
    linkTransaction(db, item.id, purchase.id);
    const before = db.select().from(transactions).where(eq(transactions.id, purchase.id)).get();

    expect(deleteItem(db, item.id)).toBe(true);
    expect(deleteItem(db, item.id)).toBe(false);

    const after = db.select().from(transactions).where(eq(transactions.id, purchase.id)).get();
    expect(after).toEqual(before);
    expect(after!.deletedAt).toBeNull();
    expect(after!.categoryId).toBe(before!.categoryId);
    expect(after!.manuallyEditedAt).toBeNull();
    // Gone from the lists, still in the database, and the link is waiting for an undo.
    expect(listItems(db)).toHaveLength(0);
    expect(getItem(db, item.id)?.deletedAt).not.toBeNull();
    expect(db.select().from(itemTransactions).all()).toHaveLength(1);
    expect(itemsByTransaction(db, [purchase.id]).size).toBe(0);

    expect(restoreItem(db, item.id)).toBe(true);
    expect(listItems(db)).toHaveLength(1);
    expect(transactionIdsFor(db, item.id)).toEqual([purchase.id]);
  });

  it("keeps the pryl when a transaction is really deleted, and drops the link", () => {
    const { db, purchase } = setup();
    const item = createItem(db, oura);
    linkTransaction(db, item.id, purchase.id);
    db.delete(transactions).where(eq(transactions.id, purchase.id)).run();
    expect(getItem(db, item.id)?.name).toBe("Ovalring Gen 4");
    expect(transactionIdsFor(db, item.id)).toEqual([]);
  });
});

describe("pictures and receipts", () => {
  it("are listed per pryl and disappear one at a time", () => {
    const { db } = setup();
    const item = createItem(db, oura);
    const image = addAttachment(db, item.id, { kind: "image", filePath: "1/a1b2.webp", originalFilename: "IMG_0042.HEIC", thumbnailPath: "1/a1b2-thumb.webp" });
    addAttachment(db, item.id, { kind: "receipt", filePath: "1/c3d4.pdf", originalFilename: "kvitto.pdf" });
    expect(attachmentsFor(db, item.id).map((a) => a.kind)).toEqual(["image", "receipt"]);
    expect(image.originalFilename).toBe("IMG_0042.HEIC");

    expect(deleteAttachment(db, image.id)).toBe(true);
    expect(deleteAttachment(db, image.id)).toBe(false);
    expect(attachmentsFor(db, item.id).map((a) => a.kind)).toEqual(["receipt"]);
    // Soft delete: the row stays, because the file on disk stays too.
    expect(db.select().from(itemAttachments).all()).toHaveLength(2);
  });

  it("belong to a pryl that exists", () => {
    const { db } = setup();
    const item = createItem(db, oura);
    deleteItem(db, item.id);
    expect(() => addAttachment(db, item.id, { kind: "image", filePath: "1/x.webp" })).toThrow(/[Pp]rylen/);
    expect(() => addAttachment(db, 9999, { kind: "image", filePath: "1/x.webp" })).toThrow(ItemError);
  });
});
