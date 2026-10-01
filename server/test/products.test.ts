import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, productAliases, products, receiptLines, transactions } from "../src/db/schema.js";
import { parseReceipt, type ParsedReceipt } from "../src/receipts/parse.js";
import { createReceipt, deleteReceipt } from "../src/receipts/receipts.js";
import {
  detachAlias,
  getProduct,
  listGroups,
  listProducts,
  mergeProducts,
  placeUnplaced,
  renameProduct,
  resolveProduct,
  setProductGroup,
  syncProducts,
} from "../src/receipts/products.js";
import { groupForName } from "../src/receipts/productRules.js";
import { freshDb } from "./helpers.js";

/**
 * Varor: the groceries behind the receipt rows.
 *
 * Nothing here is money. What is worth holding on to is that a name only ever
 * decides where a *new* product starts, and that the user's answers — the
 * shelf, the name, which names mean the same thing — survive every receipt
 * pasted afterwards.
 */

type Db = ReturnType<typeof freshDb>;

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/receipts", name), "utf8");

let seq = 0;
function tx(db: Db, amount: number, desc: string, date = "2026-09-15") {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  return db
    .insert(transactions)
    .values({ source: "swedbank", accountId, bookingDate: date, transactionDate: date, descriptionRaw: desc, descriptionClean: desc, counterparty: desc, amount, fingerprint: `p${++seq}` })
    .returning()
    .get();
}

const input = (parsed: ParsedReceipt, transactionId: number | null, raw: string, date: string) => ({
  transactionId,
  store: parsed.store,
  storeArea: parsed.storeArea,
  // The Lidl receipt doesn't write its own date; the purchase's is used.
  purchaseDate: parsed.purchaseDate ?? date,
  purchaseTime: parsed.purchaseTime,
  totalOre: parsed.totalOre ?? parsed.sumOre,
  statedItemCount: parsed.statedItemCount,
  source: "text" as const,
  rawText: raw,
  lines: parsed.lines,
});

/** A receipt stored the way the panel stores one. */
function store(db: Db, file: string, amount: number, desc: string, date = "2026-09-15") {
  const raw = fixture(file);
  const row = tx(db, amount, desc, date);
  return createReceipt(db, input(parseReceipt(raw), row.id, raw, date));
}

const named = (db: Db, name: string) => listProducts(db).find((p) => p.name === name);

describe("which shelf a name lands on", () => {
  it("reads Swedish words whole, where \\b would cut them", () => {
    // 'öl' inside vetemjöl, 'vin' inside vinäger, 'sill' inside fusilli,
    // 'mjöl' inside mjölk, 'wasa' inside wasabi: JavaScript's \b counts ö and
    // ä as punctuation, so the rules use whole words of their own.
    expect(groupForName("VETEMJÖL 2KG")).toBe("Skafferi");
    expect(groupForName("vinäger röd 7,1%")).toBe("Skafferi");
    expect(groupForName("Fusilli")).toBe("Skafferi");
    expect(groupForName("MJÖLK 3% LÄNGR HÅLLB")).toBe("Mejeri & ägg");
    expect(groupForName("Potatischips wasab")).toBe("Snacks & godis");
  });

  it("lets the narrower rule win, because the wider one comes after it", () => {
    expect(groupForName("IKAFFE HAVREDRYCK 1L")).toBe("Dryck");
    expect(groupForName("Snabbkaffe Gold")).toBe("Kaffe & te");
    expect(groupForName("KORVBRÖD DURUM 400G")).toBe("Bröd");
    expect(groupForName("Jambalaya ölkorv")).toBe("Kött & chark");
    expect(groupForName("PASTA BACON PARMSÅS")).toBe("Skafferi");
    expect(groupForName("Glass jordgubb")).toBe("Fryst & färdigmat");
  });

  it("says nothing rather than guessing", () => {
    expect(groupForName("Sneb Superior")).toBeNull();
    expect(groupForName("Fresh Island")).toBeNull();
  });
});

describe("the groceries a receipt leaves behind", () => {
  it("makes one product per item row, on the shelf the rules suggest", () => {
    const db = freshDb({ seeded: true });
    store(db, "lidl.txt", -18772, "LIDL");

    const list = listProducts(db);
    // Eight groceries. The deposit, the bag and the discount are not things
    // that are bought again and again — they are how a receipt is written.
    expect(list).toHaveLength(8);
    expect(list.map((p) => p.name)).toContain("Havredryck Barista");
    expect(list.some((p) => p.name === "Plastkasse" || p.name === "Lidl Plus-rabatt")).toBe(false);

    expect(named(db, "Filmjölk 3%")?.groupName).toBe("Mejeri & ägg");
    expect(named(db, "Havregryn fullkorn")?.groupName).toBe("Skafferi");
    expect(named(db, "Morötter lösvikt")?.groupName).toBe("Frukt & grönt");
    expect(named(db, "Äppeljuice 1l")?.groupName).toBe("Dryck");
  });

  it("counts what a grocery has cost, over all the receipts it is on", () => {
    const db = freshDb({ seeded: true });
    store(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    store(db, "lidl.txt", -18772, "LIDL", "2026-09-18");

    const juice = named(db, "Apelsinjuice kyld")!;
    expect(juice.times).toBe(2);
    expect(juice.totalOre).toBe(5580);
    expect(juice.lastPurchase).toBe("2026-09-18");
    // Still one product: the second receipt found the name it already knew.
    expect(listProducts(db)).toHaveLength(8);
  });

  it("stops counting a deleted receipt, but remembers the grocery", () => {
    const db = freshDb({ seeded: true });
    const receipt = store(db, "lidl.txt", -18772, "LIDL");
    deleteReceipt(db, receipt.id);

    const juice = named(db, "Apelsinjuice kyld")!;
    expect(juice.times).toBe(0);
    expect(juice.totalOre).toBe(0);
    expect(listProducts(db)).toHaveLength(8);
  });

  it("stops shouting what Willys writes in capitals", () => {
    const db = freshDb({ seeded: true });
    const id = resolveProduct(db, "KORVBRÖD DURUM 400G");
    expect(getProduct(db, id)).toMatchObject({ name: "Korvbröd durum 400g", groupName: "Bröd" });
    // A name that is already written like a name is left as it is.
    expect(getProduct(db, resolveProduct(db, "XXL Kycklingbröstf"))?.name).toBe("XXL Kycklingbröstf");
  });
});

describe("the answers the user gives", () => {
  it("keeps the name and the shelf when the same grocery is bought again", () => {
    const db = freshDb({ seeded: true });
    store(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    const juice = named(db, "Apelsinjuice kyld")!;
    renameProduct(db, juice.id, "Färsk apelsinjuice");
    setProductGroup(db, juice.id, listGroups(db).find((g) => g.name === "Frukt & grönt")!.id);

    store(db, "lidl.txt", -18772, "LIDL", "2026-09-18");
    const after = getProduct(db, juice.id)!;
    expect(after.name).toBe("Färsk apelsinjuice");
    expect(after.groupName).toBe("Frukt & grönt");
    expect(after.times).toBe(2);
  });

  it("puts two names together, for the rows already stored and the ones to come", () => {
    const db = freshDb({ seeded: true });
    store(db, "lidl.txt", -18772, "LIDL", "2026-09-15");
    const barista = named(db, "Havredryck Barista")!;
    const willys = getProduct(db, resolveProduct(db, "HAVREDRYCK NATURELL"))!;
    expect(willys.id).not.toBe(barista.id);

    mergeProducts(db, barista.id, [willys.id]);
    expect(getProduct(db, willys.id)).toBeUndefined();
    expect(getProduct(db, barista.id)!.aliases).toEqual(["havredryck barista", "havredryck naturell"]);

    // A receipt pasted afterwards with either name lands on the same grocery.
    expect(resolveProduct(db, "Havredryck naturell")).toBe(barista.id);
    expect(db.select().from(products).all()).toHaveLength(8);
  });

  it("lets a name leave again, but never the last one", () => {
    const db = freshDb({ seeded: true });
    const keep = resolveProduct(db, "Havredryck Barista");
    mergeProducts(db, keep, [resolveProduct(db, "HAVREDRYCK NATURELL")]);

    const split = detachAlias(db, "havredryck naturell");
    expect(split.id).not.toBe(keep);
    expect(getProduct(db, keep)!.aliases).toEqual(["havredryck barista"]);
    expect(resolveProduct(db, "HAVREDRYCK NATURELL")).toBe(split.id);
    expect(() => detachAlias(db, "havredryck barista")).toThrow(/bara det här namnet/);
  });

  it("refuses to merge a grocery into itself or into one that isn't there", () => {
    const db = freshDb({ seeded: true });
    const id = resolveProduct(db, "Havregryn fullkorn");
    expect(() => mergeProducts(db, id, [id])).toThrow(/minst en vara/);
    expect(() => mergeProducts(db, id, [id + 999])).toThrow(/finns inte/);
  });
});

describe("the period the tab is showing", () => {
  it("counts only the receipts inside it, but lists every grocery", () => {
    const db = freshDb({ seeded: true });
    store(db, "lidl.txt", -18772, "LIDL", "2026-08-15");
    store(db, "lidl.txt", -18772, "LIDL", "2026-09-18");

    const september = listProducts(db, { from: "2026-09-01", to: "2026-09-30" });
    expect(september.find((p) => p.name === "Havregryn fullkorn")).toMatchObject({ times: 1, lastPurchase: "2026-09-18" });
    // The dictionary doesn't shrink with the period: a grocery not bought in
    // it is still a grocery, at zero.
    expect(september).toHaveLength(8);
    expect(listProducts(db, { from: "2026-10-01" }).every((p) => p.times === 0 && p.totalOre === 0)).toBe(true);
  });
});

describe("the rules run again, when asked", () => {
  it("places the ones without a shelf and never moves one that has one", () => {
    const db = freshDb({ seeded: true });
    const unknown = resolveProduct(db, "Sneb Superior");
    // Put somewhere else by hand, where the rules would have said Skafferi.
    const flakes = resolveProduct(db, "Havregryn fullkorn");
    setProductGroup(db, flakes, listGroups(db).find((g) => g.name === "Frukt & grönt")!.id);
    // Taken off its shelf: this one the button does put back, which is why it
    // is a button and not something that happens at every start.
    const juice = resolveProduct(db, "Färsk apelsinjuice");
    setProductGroup(db, juice, null);

    expect(placeUnplaced(db)).toBe(1);
    expect(getProduct(db, flakes)!.groupName).toBe("Frukt & grönt");
    expect(getProduct(db, juice)!.groupName).toBe("Dryck");
    expect(getProduct(db, unknown)!.groupName).toBeNull();
    expect(placeUnplaced(db)).toBe(0);
  });
});

describe("receipts stored before there were products", () => {
  it("gives every item row a grocery, and doesn't make a second one on a rerun", () => {
    const db = freshDb({ seeded: true });
    store(db, "ica.txt", -9120, "ICA SUPERMARKET EXEMPELSTAD");
    db.delete(productAliases).run();
    db.delete(products).run();

    // Five groceries: the sixth row of the receipt is a discount.
    expect(syncProducts(db)).toBe(5);
    expect(listProducts(db)).toHaveLength(5);
    expect(syncProducts(db)).toBe(0);
    // Every grocery row knows its product; nothing is left dangling.
    const items = db.select().from(receiptLines).where(eq(receiptLines.kind, "item")).all();
    const keys = new Set(db.select().from(productAliases).all().map((a) => a.nameKey));
    expect(items.every((l) => keys.has(l.nameKey))).toBe(true);
  });
});
