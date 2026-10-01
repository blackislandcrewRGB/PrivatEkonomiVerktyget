import { describe, expect, it } from "vitest";
import type { Category, CategoryUsage } from "../../api";
import { categoryStats, filterTree, fold, isOpen, toggleFolded } from "./treeFilter";

const cat = (id: number, name: string, parentId: number | null = null): Category =>
  ({ id, name, parentId, color: null, isTransfer: false, isSettlement: false, systemKey: null }) as Category;
const CATS = [cat(1, "Mat"), cat(2, "Livsmedel", 1), cat(3, "Hämtmat", 1), cat(4, "Nöje"), cat(5, "Mjukvara", 4), cat(6, "Mjukvara & AI"), cat(7, "API", 6)];
const names = (t: ReturnType<typeof filterTree>) => t.tops.map((top) => [top.name, ...t.children.get(top.id)!.map((c) => c.name)]);

describe("the tree's search", () => {
  it("no search: everything, nothing forced open", () => {
    const t = filterTree(CATS, "  ");
    expect(names(t)).toEqual([["Mat", "Livsmedel", "Hämtmat"], ["Nöje", "Mjukvara"], ["Mjukvara & AI", "API"]]);
    expect(t.searching).toBe(false);
  });

  it("a main category that matches keeps all its subcategories; otherwise only the ones that match", () => {
    expect(names(filterTree(CATS, "mjuk"))).toEqual([["Nöje", "Mjukvara"], ["Mjukvara & AI", "API"]]);
    expect(names(filterTree(CATS, "MAT"))).toEqual([["Mat", "Livsmedel", "Hämtmat"]]);
    expect(filterTree(CATS, "mjuk").searching).toBe(true);
  });

  it("finds names without å/ä/ö, and nothing when nothing matches", () => {
    expect(names(filterTree(CATS, "hamt"))).toEqual([["Mat", "Hämtmat"]]);
    expect(names(filterTree(CATS, "noje"))).toEqual([["Nöje", "Mjukvara"]]);
    expect(filterTree(CATS, "zzz").tops).toEqual([]);
    expect(fold("Åre Öl")).toBe("are ol");
  });
});

describe("folding", () => {
  it("open unless folded, and always while searching", () => {
    expect(isOpen(1, [], false)).toBe(true);
    expect(isOpen(1, [1], false)).toBe(false);
    expect(isOpen(1, [1], true)).toBe(true);
    expect(toggleFolded([], 1)).toEqual([1]);
    expect(toggleFolded([4, 1], 1)).toEqual([4]);
  });
});

describe("rows and sum", () => {
  const usage: CategoryUsage = {
    1: { transactions: 5, rules: 0, count12: 2, sum12: -1000, countYtd: 1, sumYtd: -400 },
    2: { transactions: 9, rules: 0, count12: 3, sum12: -3000, countYtd: 2, sumYtd: -2000 },
  };
  it("a main category adds its subcategories, over the chosen period", () => {
    expect(categoryStats(CATS[0], CATS, usage, "12m")).toEqual({ count: 5, sum: -4000 });
    expect(categoryStats(CATS[0], CATS, usage, "ytd")).toEqual({ count: 3, sum: -2400 });
    expect(categoryStats(CATS[1], CATS, usage, "ytd")).toEqual({ count: 2, sum: -2000 });
    expect(categoryStats(CATS[3], CATS, usage, "12m")).toEqual({ count: 0, sum: 0 });
  });
});
