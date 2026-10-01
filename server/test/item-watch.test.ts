import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { createApp } from "../src/app.js";
import { createItem, linkTransaction } from "../src/items/items.js";
import { itemWatchSettings, setItemWatchSettings } from "../src/items/itemWatch.js";
import { dismissFinding, findings, setWatchKinds } from "../src/watch/watch.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-20";
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});

let seq = 0;
function tx(db: Db, values: { amount: number; desc: string; date?: string; categoryPath?: string }) {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  const date = values.date ?? "2026-09-14";
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: values.desc,
      descriptionClean: values.desc,
      counterparty: values.desc,
      amount: values.amount,
      categoryId: values.categoryPath ? getCategoryPathMap(db).get(values.categoryPath)! : null,
      categorySource: values.categoryPath ? "rule" : "none",
      fingerprint: `w${++seq}`,
    })
    .returning()
    .get();
}

const base = { name: "Ovalring Gen 4", purchaseDate: "2026-08-31", priceOre: 449000, merchant: "Amazon" };

/** Only the findings about prylar; the rest of Vakt has its own tests. */
const itemFindings = (db: Db) => findings(db, TODAY).filter((f) => ["warranty_ending", "return_deadline", "maybe_item"].includes(f.kind));

describe("Vakt and prylar", () => {
  it("says when a warranty is about to run out, and not before that", () => {
    const db = freshDb({ seeded: true });
    // 24 months from 31 August 2026: far away.
    createItem(db, { ...base, warrantyMonths: 24 });
    // 12 months from 30 September 2025: runs out in 10 days.
    const soon = createItem(db, { ...base, name: "Hörlurar", purchaseDate: "2025-09-30", warrantyMonths: 12 });
    // Ran out yesterday: nothing to do about it now.
    createItem(db, { ...base, name: "Mus", purchaseDate: "2025-09-19", warrantyMonths: 12 });
    // No warranty known.
    createItem(db, { ...base, name: "Matta", warrantyMonths: null });

    const found = itemFindings(db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: `warranty_ending:${soon.id}`, kind: "warranty_ending", itemId: soon.id, date: "2026-09-30" });
    expect(found[0].text).toBe("Garantin på Hörlurar går ut 30/9, om 10 dagar");
  });

  it("gives the right of return three days, not thirty", () => {
    const db = freshDb({ seeded: true });
    const soon = createItem(db, { ...base, name: "Tangentbord", returnDeadline: "2026-09-23" });
    createItem(db, { ...base, name: "Skärm", returnDeadline: "2026-10-10" });
    createItem(db, { ...base, name: "Kabel", returnDeadline: "2026-09-19" });

    const found = itemFindings(db);
    expect(found.map((f) => f.key)).toEqual([`return_deadline:${soon.id}`]);
    expect(found[0].text).toBe("Ångerrätten på Tangentbord går ut 23/9, om 3 dagar");
  });

  it("leaves a pryl that is sold or thrown alone", async () => {
    const db = freshDb({ seeded: true });
    const item = createItem(db, { ...base, name: "Hörlurar", purchaseDate: "2025-09-30", warrantyMonths: 12 });
    expect(itemFindings(db)).toHaveLength(1);
    const app = createApp(db, { databasePath: ":memory:" });
    await app.request(`/api/items/${item.id}`, json("PATCH", { status: "sold" }));
    expect(itemFindings(db)).toHaveLength(0);
  });

  it("asks whether a purchase in the chosen category is a thing, once", () => {
    const db = freshDb({ seeded: true });
    const electronics = tx(db, { amount: -129900, desc: "KJELL & CO", date: "2026-09-14", categoryPath: "Prylar & hem/Elektronik" });
    // Under the threshold, and in a category that isn't usually things.
    tx(db, { amount: -29900, desc: "KJELL & CO", date: "2026-09-15", categoryPath: "Prylar & hem/Elektronik" });
    tx(db, { amount: -159900, desc: "ICA", date: "2026-09-15", categoryPath: "Mat/Livsmedel" });
    // Old enough to have been seen.
    tx(db, { amount: -199900, desc: "ELGIGANTEN", date: "2026-07-01", categoryPath: "Prylar & hem/Elektronik" });

    const found = itemFindings(db);
    expect(found.map((f) => f.key)).toEqual([`maybe_item:${electronics.id}`]);
    expect(found[0].text).toMatch(/^KJELL & CO 1\s299 kr 14\/9 – är det en pryl\?$/);

    // 'Nej' is remembered by the transaction, so it is never asked about again.
    dismissFinding(db, found[0].key, TODAY);
    expect(itemFindings(db)).toHaveLength(0);
  });

  it("stops asking once the purchase belongs to a pryl", () => {
    const db = freshDb({ seeded: true });
    const purchase = tx(db, { amount: -449000, desc: "AMAZON EU", date: "2026-09-14", categoryPath: "Prylar & hem/Elektronik" });
    expect(itemFindings(db)).toHaveLength(1);
    const item = createItem(db, base);
    linkTransaction(db, item.id, purchase.id);
    expect(itemFindings(db).filter((f) => f.kind === "maybe_item")).toHaveLength(0);
  });

  it("takes the threshold and the categories from the settings", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const cat = getCategoryPathMap(db);
    const lamp = tx(db, { amount: -89900, desc: "IKEA", date: "2026-09-15", categoryPath: "Prylar & hem/Inredning & verktyg" });
    expect(itemFindings(db)).toHaveLength(0);

    // The defaults the view shows before anything is chosen.
    const before = (await (await app.request("/api/items/settings")).json()) as any;
    expect(before).toEqual({ categoryIds: [cat.get("Prylar & hem/Elektronik")], minAmount: 50000, defaultMinAmount: 50000 });

    const after = (await (
      await app.request("/api/items/settings", json("PUT", { categoryIds: [cat.get("Prylar & hem/Inredning & verktyg"), 9999], minAmount: 80000 }))
    ).json()) as any;
    // A category that doesn't exist is dropped rather than stored.
    expect(after).toMatchObject({ categoryIds: [cat.get("Prylar & hem/Inredning & verktyg")], minAmount: 80000 });
    expect(itemWatchSettings(db).minAmount).toBe(80000);
    expect(itemFindings(db).map((f) => f.key)).toEqual([`maybe_item:${lamp.id}`]);

    // Over the threshold now: nothing is asked about.
    setItemWatchSettings(db, { minAmount: 100000 });
    expect(itemFindings(db)).toHaveLength(0);
  });

  it("can be turned off one kind at a time, like the rest of Vakt", () => {
    const db = freshDb({ seeded: true });
    createItem(db, { ...base, name: "Tangentbord", returnDeadline: "2026-09-22" });
    tx(db, { amount: -129900, desc: "KJELL & CO", date: "2026-09-14", categoryPath: "Prylar & hem/Elektronik" });
    expect(itemFindings(db)).toHaveLength(2);

    setWatchKinds(db, { maybe_item: false });
    expect(itemFindings(db).map((f) => f.kind)).toEqual(["return_deadline"]);
    setWatchKinds(db, { return_deadline: false });
    expect(itemFindings(db)).toHaveLength(0);
  });
});
