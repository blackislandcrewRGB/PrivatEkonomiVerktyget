import type { Category, CategoryUsage } from "../../api";

/** Lower case without accents: 'hamtmat' finds 'Hämtmat', as in the category picker. */
export const fold = (s: string) =>
  s
    .toLocaleLowerCase("sv-SE")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export interface TreeView {
  tops: Category[];
  /** The subcategories to show under each main category. */
  children: Map<number, Category[]>;
  /** A search is on: everything shown is open, whatever was folded. */
  searching: boolean;
}

/**
 * The tree for a search on names. A main category that matches keeps all its
 * subcategories; one that doesn't is shown only for the subcategories that do,
 * with just those. No search: everything.
 */
export function filterTree(categories: Category[], query: string): TreeView {
  const q = fold(query.trim());
  const tops = categories.filter((c) => c.parentId === null);
  const childrenOf = (id: number) => categories.filter((c) => c.parentId === id);
  const children = new Map<number, Category[]>();
  const shown: Category[] = [];
  for (const top of tops) {
    const all = childrenOf(top.id);
    if (!q || fold(top.name).includes(q)) {
      shown.push(top);
      children.set(top.id, all);
      continue;
    }
    const hits = all.filter((c) => fold(c.name).includes(q));
    if (hits.length) {
      shown.push(top);
      children.set(top.id, hits);
    }
  }
  return { tops: shown, children, searching: q !== "" };
}

/** Whether a main category's subcategories show: always while searching, otherwise unless folded. */
export const isOpen = (id: number, folded: readonly number[], searching: boolean) => searching || !folded.includes(id);

/** Folds a main category that is open, opens one that is folded. */
export const toggleFolded = (folded: readonly number[], id: number) => (folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id]);

export type UsagePeriod = "12m" | "ytd";

/** Rows and sum of a category (a main category with its subcategories) over the period. */
export function categoryStats(c: Category, categories: Category[], usage: CategoryUsage, period: UsagePeriod): { count: number; sum: number } {
  const ids = [c.id, ...(c.parentId === null ? categories.filter((x) => x.parentId === c.id).map((x) => x.id) : [])];
  return ids.reduce(
    (s, id) => {
      const u = usage[id];
      return { count: s.count + (period === "ytd" ? (u?.countYtd ?? 0) : (u?.count12 ?? 0)), sum: s.sum + (period === "ytd" ? (u?.sumYtd ?? 0) : (u?.sum12 ?? 0)) };
    },
    { count: 0, sum: 0 },
  );
}
