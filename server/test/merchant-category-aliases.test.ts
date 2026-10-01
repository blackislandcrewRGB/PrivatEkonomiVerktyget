import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { categories, merchantCategoryMap, transactions } from "../src/db/schema.js";
import { mergeMerchantCategoryKeys } from "../src/db/dataMigrations.js";
import { categorize, loadCategorizeContext } from "../src/categorize/categorize.js";
import { merchantCategoryKey } from "../src/import/norwegianKey.js";
import { freshDb } from "./helpers.js";

describe("Bank Norwegian's two wordings of a merchant category", () => {
  it("Visa's wording, whole or cut at 36 characters, gets the export's key", () => {
    // As the bank sync sends them since September 2026.
    expect(merchantCategoryKey("Package Stores – Beer, Wine, and Liq")).toBe(merchantCategoryKey("PKG STORES/BEER/WINE/LIQUOR"));
    expect(merchantCategoryKey("Misc. Food Stores – Convenience Stor")).toBe(merchantCategoryKey("MISC FOOD STORES - DEFAULT"));
    expect(merchantCategoryKey("Miscellaneous and Specialty Retail S")).toBe(merchantCategoryKey("MISC SPECIALTY RETAIL"));
    expect(merchantCategoryKey("Drug Stores and Pharmacies")).toBe("DRUG STORES PHARMACIES");
    // The same wording in both: no alias needed.
    expect(merchantCategoryKey("Grocery Stores, Supermarkets")).toBe(merchantCategoryKey("GROCERY STORES/SUPERMARKETS"));
  });

  it("leaves alone what has no short name, and too short a start", () => {
    expect(merchantCategoryKey("Computer Software Stores")).toBe("COMPUTER SOFTWARE STORES");
    expect(merchantCategoryKey("Norwegian Air Shuttle")).toBe("NORWEGIAN AIR SHUTTLE");
    expect(merchantCategoryKey("Drug Stores")).toBe("DRUG STORES");
    expect(merchantCategoryKey("PKG STORES/BEER/WINE/LIQUOR")).toBe("PKG STORES BEER WINE LIQUOR");
  });

  it("a card row in Visa's wording gets the category mapped under the export's", () => {
    const db = freshDb({ seeded: true });
    const ctx = loadCategorizeContext(db);
    const r = categorize(ctx, { accountId: null, descriptionClean: "OKÄND BUTIK 123", counterparty: "", amount: -12900, merchantCategory: "Package Stores – Beer, Wine, and Liq", defaultShared: false });
    const alcohol = db.select().from(categories).where(eq(categories.name, "Alkohol")).get()!;
    expect(r).toMatchObject({ categoryId: alcohol.id, source: "merchant_category" });
  });

  it("an entry logged under Visa's wording joins the export's, keeping its category and adding up the rows", () => {
    const db = freshDb({ seeded: true });
    const pkg = db.select().from(merchantCategoryMap).where(eq(merchantCategoryMap.key, "PKG STORES BEER WINE LIQUOR")).get()!;
    db.update(merchantCategoryMap).set({ timesSeen: 18, lastSeenAt: "2026-09-18T10:00:00Z" }).where(eq(merchantCategoryMap.id, pkg.id)).run();
    // As logged before the aliases: their own keys, no category.
    const food = db.select().from(categories).where(eq(categories.name, "Livsmedel")).get()!;
    db.insert(merchantCategoryMap)
      .values([
        { key: "PACKAGE STORES BEER WINE AND LIQ", label: "Package Stores – Beer, Wine, and Liq", timesSeen: 1, lastSeenAt: "2026-09-21T04:00:00Z" },
        { key: "MISC SPECIALTY RETAIL", label: "MISC SPECIALTY RETAIL", timesSeen: 4 },
        { key: "MISCELLANEOUS AND SPECIALTY RETAIL S", label: "Miscellaneous and Specialty Retail S", timesSeen: 1, categoryId: food.id },
        { key: "COMPUTER SOFTWARE STORES", label: "Computer Software Stores", timesSeen: 1 },
      ])
      .run();

    expect(mergeMerchantCategoryKeys(db)).toBe(2);
    const all = db.select().from(merchantCategoryMap).all();
    expect(all.find((m) => m.key === "PKG STORES BEER WINE LIQUOR")).toMatchObject({ label: "PKG STORES/BEER/WINE/LIQUOR", categoryId: pkg.categoryId, timesSeen: 19, lastSeenAt: "2026-09-21T04:00:00Z" });
    // The export's entry had no category: it takes the one chosen under Visa's wording.
    expect(all.find((m) => m.key === "MISC SPECIALTY RETAIL")).toMatchObject({ categoryId: food.id, timesSeen: 5 });
    expect(all.filter((m) => /PACKAGE|MISCELLANEOUS/.test(m.key))).toEqual([]);
    expect(all.find((m) => m.key === "COMPUTER SOFTWARE STORES")).toMatchObject({ timesSeen: 1, categoryId: null });
    // Run again: nothing left to do.
    expect(mergeMerchantCategoryKeys(db)).toBe(0);
  });

  it("the list says how many of a bank category's rows are still without a category", async () => {
    const db = freshDb({ seeded: true });
    db.insert(merchantCategoryMap).values([
      { key: "HOME SUPPLY WAREHOUSE STORES", label: "HOME SUPPLY WAREHOUSE STORES", timesSeen: 3 },
      { key: "BOOK STORES", label: "BOOK STORES", timesSeen: 1 },
    ]).run();
    const food = db.select().from(categories).all().find((c) => c.name === "Livsmedel")!.id;
    let n = 0;
    const row = (o: { mcc: string; categoryId?: number; deleted?: boolean; transfer?: boolean }) =>
      db.insert(transactions).values({
        source: "norwegian",
        bookingDate: "2026-09-01",
        descriptionRaw: "X",
        descriptionClean: "X",
        amount: -1000,
        merchantCategory: o.mcc,
        categoryId: o.categoryId ?? null,
        isTransfer: o.transfer ?? false,
        deletedAt: o.deleted ? "2026-09-02T00:00:00Z" : null,
        fingerprint: `m${++n}`,
      }).run();
    row({ mcc: "HOME SUPPLY WAREHOUSE STORES" });
    // Spelled another way in another export: the same key.
    row({ mcc: "Home Supply Warehouse Stores" });
    row({ mcc: "HOME SUPPLY WAREHOUSE STORES", categoryId: food });
    row({ mcc: "HOME SUPPLY WAREHOUSE STORES", deleted: true });
    row({ mcc: "HOME SUPPLY WAREHOUSE STORES", transfer: true });
    row({ mcc: "BOOK STORES", categoryId: food });
    const list = (await (await createApp(db, { databasePath: ":memory:" }).request("/api/merchant-categories")).json()) as { key: string; uncategorized: number }[];
    const count = (key: string) => list.find((m) => m.key === key)?.uncategorized;
    expect(count("HOME SUPPLY WAREHOUSE STORES")).toBe(2);
    expect(count("BOOK STORES")).toBe(0);
  });
});

