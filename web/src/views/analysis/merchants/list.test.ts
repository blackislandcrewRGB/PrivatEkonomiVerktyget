import { describe, expect, it } from "vitest";
import { fromSearch, inCategory, matches, merchants, sortMerchants, toSearch, townName } from "./list";
import type { MerchantCategory, Piece } from "./types";

const piece = (p: Partial<Piece> & { key: string }): Piece => ({ label: null, contactName: null, categoryId: 2, area: null, count: 1, total: 10000, lastDate: "2026-08-01", ...p });
const CATS: MerchantCategory[] = [
  { id: 1, name: "Mat", parentId: null },
  { id: 2, name: "Livsmedel", parentId: 1 },
  { id: 3, name: "Bil", parentId: null },
  { id: 4, name: "Drivmedel", parentId: 3 },
];
const PIECES = [
  piece({ key: "LIDL 271 EXEMPELSTAD", label: "Lidl", count: 3, total: 30000, area: "Exempelstad" }),
  piece({ key: "LIDL SVERIGE", label: "Lidl", count: 1, total: 5000, lastDate: "2026-08-20" }),
  piece({ key: "CIRCLE K EXEMPELBY", categoryId: 4, count: 2, total: 40000, area: "Exempelby" }),
  piece({ key: "EXEMPELSHOP", categoryId: null, count: 1, total: 50000 }),
];

describe("Topplista's list", () => {
  it("merges the bank texts with the same name, or keeps one row per bank text", () => {
    const merged = merchants(PIECES, true);
    expect(merged.map((m) => [m.key, m.texts, m.count, m.total])).toEqual([
      ["Lidl", ["LIDL 271 EXEMPELSTAD", "LIDL SVERIGE"], 4, 35000],
      ["CIRCLE K EXEMPELBY", ["CIRCLE K EXEMPELBY"], 2, 40000],
      ["EXEMPELSHOP", ["EXEMPELSHOP"], 1, 50000],
    ]);
    expect(merchants(PIECES, false).map((m) => [m.key, m.label])).toEqual([
      ["LIDL 271 EXEMPELSTAD", "Lidl"],
      ["LIDL SVERIGE", "Lidl"],
      ["CIRCLE K EXEMPELBY", null],
      ["EXEMPELSHOP", null],
    ]);
  });

  it("gives a row the category most of its money went to, and its towns written as names", () => {
    const [circle] = merchants([piece({ key: "CIRCLE K", count: 18, total: 90000 }), piece({ key: "CIRCLE K", categoryId: 4, count: 2, total: 140000, area: "EXEMPELBY" })], true);
    expect(circle.categoryId).toBe(4);
    expect(circle.areas).toEqual(["Exempelby"]);
    expect(["STOCKHOLM", "Stockholm", "UPPLANDS VASBY", "WWW.AMAZON.SE"].map(townName)).toEqual(["Stockholm", "Stockholm", "Upplands Vasby", "www.amazon.se"]);
  });

  it("orders by sum, by purchases, or by average with single purchases last", () => {
    const list = merchants(PIECES, true);
    expect(sortMerchants(list, "summa").map((m) => m.key)).toEqual(["EXEMPELSHOP", "CIRCLE K EXEMPELBY", "Lidl"]);
    expect(sortMerchants(list, "antal").map((m) => m.key)).toEqual(["Lidl", "CIRCLE K EXEMPELBY", "EXEMPELSHOP"]);
    // Exempelshop's one purchase is the largest average, but says little: last.
    expect(sortMerchants(list, "snitt").map((m) => m.key)).toEqual(["CIRCLE K EXEMPELBY", "Lidl", "EXEMPELSHOP"]);
  });

  it("filters on a main category with its subcategories, or on a subcategory", () => {
    expect(PIECES.filter((p) => inCategory(p, 3, CATS)).map((p) => p.key)).toEqual(["CIRCLE K EXEMPELBY"]);
    expect(PIECES.filter((p) => inCategory(p, 2, CATS)).map((p) => p.key)).toEqual(["LIDL 271 EXEMPELSTAD", "LIDL SVERIGE"]);
    expect(PIECES.filter((p) => inCategory(p, null, CATS))).toHaveLength(4);
  });

  it("searches the name and the bank's texts", () => {
    const [lidl] = merchants(PIECES, true);
    expect(matches(lidl, "lidl")).toBe(true);
    expect(matches(lidl, "sverige")).toBe(true);
    expect(matches(lidl, "circle")).toBe(false);
  });

  it("keeps the choices in the address, leaving out the defaults", () => {
    expect(toSearch("?flik=topplista", { q: "lidl", sort: "antal", category: 2 })).toBe("?flik=topplista&sok=lidl&sortera=antal&kategori=2");
    expect(toSearch("?flik=topplista&sok=x&sortera=snitt", { q: "", sort: "summa", category: null })).toBe("?flik=topplista");
    expect(fromSearch(new URLSearchParams("sok=lidl&sortera=antal&kategori=2"))).toEqual({ q: "lidl", sort: "antal", category: 2 });
    expect(fromSearch(new URLSearchParams("sortera=nej&kategori=x"))).toEqual({ q: "", sort: "summa", category: null });
  });
});
