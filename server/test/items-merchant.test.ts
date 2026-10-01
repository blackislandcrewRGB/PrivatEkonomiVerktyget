import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { categories, merchantRules } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { createItem } from "../src/items/items.js";
import { merchantName } from "../src/items/merchantName.js";
import { freshDb } from "./helpers.js";

describe("a pryl's merchant by name", () => {
  it("takes the rule's name when a rule knows the merchant, calms a shouted name, keeps short capitals", () => {
    expect(merchantName("AMAZON.SE* KP6TV")).toBe("Amazon");
    expect(merchantName("AmazonMktplc*KR7SN4821", { pattern: "AMAZON", matchType: "contains" })).toBe("Amazon");
    expect(merchantName("ICA NARA EXEMPELBY")).toBe("ICA Nara Exempelby");
    expect(merchantName("Clas Ohlson")).toBe("Clas Ohlson");
    // A regex is no name: the text is used.
    expect(merchantName("WEBHALLEN SVERIGE AB", { pattern: "^WEBHALL", matchType: "regex" })).toBe("Webhallen Sverige");
  });

  it("the API: each pryl with its merchant's name, the merchants with counts, and filters on a merchant and a month", async () => {
    const db = freshDb({ seeded: true });
    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.insert(merchantRules).values({ pattern: "WEBHALLEN", matchType: "contains", categoryId: other.id }).run();
    const base = { category: "Elektronik", owner: "me" as const, status: "owned" as const };
    createItem(db, { ...base, name: "Hörlurar", purchaseDate: "2026-08-02", priceOre: 99000, merchant: "WEBHALLEN SVERIGE AB" });
    createItem(db, { ...base, name: "Laddare", purchaseDate: "2026-09-10", priceOre: 29900, merchant: "Webhallen.com*Order 88123" });
    createItem(db, { ...base, name: "Lampa", purchaseDate: "2026-08-20", priceOre: 45000, merchant: "BILTEMA SVERIGE" });
    createItem(db, { ...base, name: "Present", purchaseDate: "2026-08-21", priceOre: 10000, merchant: null });
    const app = createApp(db, { databasePath: ":memory:" });
    const list = async (q = "") => (await app.request(`/api/items${q}`)).json();

    const all = await list();
    expect(Object.fromEntries(all.items.map((i: { name: string; merchantName: string | null }) => [i.name, i.merchantName]))).toEqual({
      Hörlurar: "Webhallen",
      Laddare: "Webhallen",
      // BILTEMA is a seed rule, so its name is the rule's.
      Lampa: "Biltema",
      Present: null,
    });
    expect(all.merchants).toEqual([
      { name: "Webhallen", count: 2 },
      { name: "Biltema", count: 1 },
    ]);

    const webhallen = await list("?merchant=Webhallen");
    expect(webhallen.items.map((i: { name: string }) => i.name)).toEqual(["Laddare", "Hörlurar"]);
    expect(webhallen.totals).toMatchObject({ count: 2, priceOre: 128900 });
    // The choices are over everything, not the filtered set.
    expect(webhallen.merchants).toHaveLength(2);

    const august = await list("?month=2026-08");
    expect(august.items.map((i: { name: string }) => i.name)).toEqual(["Present", "Lampa", "Hörlurar"]);
    expect(august.totals).toMatchObject({ count: 3, priceOre: 154000 });
    expect((await list("?month=2026-08&merchant=Webhallen")).totals).toMatchObject({ count: 1, priceOre: 99000 });
  });
});
