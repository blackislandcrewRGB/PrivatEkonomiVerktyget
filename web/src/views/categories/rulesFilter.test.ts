import { describe, expect, it } from "vitest";
import type { Category, Rule } from "../../api";
import { page, ruleView, type RuleFilters } from "./rulesFilter";

const cat = (id: number, name: string, parentId: number | null = null) => ({ id, name, parentId, color: null, isTransfer: false, isSettlement: false, systemKey: null }) as Category;
const CATS = [cat(1, "Mat"), cat(2, "Livsmedel", 1), cat(3, "Nöje"), cat(4, "Spel", 3)];
let id = 0;
const rule = (pattern: string, categoryId: number, matches12: number, over: Partial<Rule> = {}): Rule => ({
  id: ++id,
  pattern,
  matchType: "contains",
  direction: "any",
  categoryId,
  sharedDefault: null,
  isTransfer: false,
  createdFrom: "seed",
  hits: matches12,
  matches12,
  brandSlug: null,
  iconPath: null,
  ...over,
});
const RULES = [
  rule("LIDL", 2, 211, { icon: { brand: "lidl" } }),
  rule("ICA", 2, 119, { matchType: "regex" }),
  rule("KJELL", 1, 3, { createdFrom: "manual" }),
  rule("STEAM", 4, 2, { createdFrom: "llm", icon: { image: "/api/icons/x.png" } }),
  rule("GAMMAL", 2, 0, { createdFrom: "manual" }),
  rule("TESTBILJARD", 3, 0),
];
const ALL: RuleFilters = { query: "", source: "all", noIcon: false, sort: "matches", category: null };
const view = (f: Partial<RuleFilters>) => ruleView(RULES, CATS, { ...ALL, ...f });
const names = (rs: Rule[]) => rs.map((r) => r.pattern);

describe("the rules' chips", () => {
  it("each chip's count is the rows the table shows with it on", () => {
    for (const f of [{}, { query: "l" }, { category: 1 }, { noIcon: true }, { query: "a", noIcon: true }] as Partial<RuleFilters>[]) {
      const { counts } = view(f);
      expect(counts.all).toBe(view({ ...f, source: "all" }).shown.length);
      expect(counts.seed).toBe(view({ ...f, source: "seed" }).shown.length);
      expect(counts.manual).toBe(view({ ...f, source: "manual" }).shown.length);
      expect(counts.seed + counts.manual).toBe(counts.all);
      for (const source of ["all", "seed", "manual"] as const) expect(view({ ...f, source }).counts.noIcon).toBe(view({ ...f, source, noIcon: true }).shown.length);
    }
  });

  it("'Manuella' includes the LLM's; 'Saknar ikon' keeps the rules with neither brand nor picture", () => {
    expect(names(view({ source: "manual" }).shown)).toEqual(["KJELL", "STEAM", "GAMMAL"]);
    expect(names(view({ noIcon: true }).shown)).toEqual(["ICA", "KJELL", "GAMMAL", "TESTBILJARD"]);
    expect(view({}).counts).toEqual({ all: 6, seed: 3, manual: 3, noIcon: 4 });
  });

  it("the category from the tree takes its subcategories; the search looks at pattern and category", () => {
    expect(names(view({ category: 1 }).shown)).toEqual(["LIDL", "ICA", "KJELL", "GAMMAL"]);
    expect(names(view({ query: "spel" }).shown)).toEqual(["STEAM"]);
    expect(names(view({ query: "testbil" }).shown)).toEqual(["TESTBILJARD"]);
  });

  it("used rules most hits first or A–Ö; unused apart", () => {
    const v = view({});
    expect(names(v.used)).toEqual(["LIDL", "ICA", "KJELL", "STEAM"]);
    expect(names(v.unused)).toEqual(["GAMMAL", "TESTBILJARD"]);
    expect(names(view({ sort: "pattern" }).used)).toEqual(["ICA", "KJELL", "LIDL", "STEAM"]);
  });
});

describe("paging", () => {
  it("50 at a time, and how many more", () => {
    const list = Array.from({ length: 120 }, (_, i) => i);
    expect(page(list, false)).toMatchObject({ more: 70 });
    expect(page(list, false).rows).toHaveLength(50);
    expect(page(list, true)).toMatchObject({ rows: list, more: 0 });
    expect(page(list.slice(0, 50), false).more).toBe(0);
  });
});
