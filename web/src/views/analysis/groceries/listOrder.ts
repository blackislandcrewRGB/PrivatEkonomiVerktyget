import type { Product, ProductGroup } from "../../../api";

/** How the list is ordered: totalt (the default), gånger, senast, A–Ö. */
export type ProductSort = "total" | "times" | "latest" | "az";
export const SORT_LABEL: Record<ProductSort, string> = { total: "totalt", times: "gånger", latest: "senast", az: "A–Ö" };
export const SORT_MENU: Record<ProductSort, string> = { total: "Totalt, störst först", times: "Gånger, flest först", latest: "Senast köpt först", az: "Namn, A–Ö" };

/** 'all', 'unplaced' or a shelf's id. */
export type ShelfFilter = string;

/** Rows shown at a time; 'Visa fler' adds as many again. */
export const PAGE = 50;

/** The filter and the order in the address: ?hylla=utan or ?hylla=3, ?sortering=ganger|senast|a-o (totalt is the default). */
const URL_SORT: Record<ProductSort, string | null> = { total: null, times: "ganger", latest: "senast", az: "a-o" };

export function listFromSearch(q: URLSearchParams): { shelf: ShelfFilter; sort: ProductSort } {
  const h = q.get("hylla");
  const shelf = h === "utan" ? "unplaced" : h && /^\d+$/.test(h) ? h : "all";
  const sort = (Object.keys(URL_SORT) as ProductSort[]).find((s) => URL_SORT[s] !== null && URL_SORT[s] === q.get("sortering")) ?? "total";
  return { shelf, sort };
}

export function listSearch(current: string, next: { shelf: ShelfFilter; sort: ProductSort }): string {
  const q = new URLSearchParams(current);
  q.delete("hylla");
  q.delete("sortering");
  if (next.shelf !== "all") q.set("hylla", next.shelf === "unplaced" ? "utan" : next.shelf);
  const s = URL_SORT[next.sort];
  if (s) q.set("sortering", s);
  const str = q.toString();
  return str ? `?${str}` : "";
}

/** The groceries on the shelf chosen whose name, or a name a shop printed for them, holds the text. */
export function filterProducts(rows: Product[], shelf: ShelfFilter, text: string): Product[] {
  const needle = text.trim().toLocaleLowerCase("sv");
  return rows.filter((p) => {
    if (shelf === "unplaced" ? p.groupId !== null : shelf !== "all" && String(p.groupId) !== shelf) return false;
    if (!needle) return true;
    return p.name.toLocaleLowerCase("sv").includes(needle) || p.aliases.some((a) => a.includes(needle));
  });
}

const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, "sv");

/**
 * The list in order. By totalt the groceries without a shelf come first,
 * since they are waiting for an answer; then the largest total. Ties go by
 * name.
 */
export function sortProducts(rows: Product[], sort: ProductSort): Product[] {
  const cmp: Record<ProductSort, (a: Product, b: Product) => number> = {
    total: (a, b) => Number(a.groupId !== null) - Number(b.groupId !== null) || b.totalOre - a.totalOre || byName(a, b),
    times: (a, b) => b.times - a.times || byName(a, b),
    latest: (a, b) => (b.lastPurchase ?? "").localeCompare(a.lastPurchase ?? "") || byName(a, b),
    az: byName,
  };
  return [...rows].sort(cmp[sort]);
}

/** The shelves as chips: those with groceries, the most first, with how many. */
export function shelfChips(rows: Product[], groups: ProductGroup[]): (ProductGroup & { count: number })[] {
  return groups
    .map((g) => ({ ...g, count: rows.filter((p) => p.groupId === g.id).length }))
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count || a.position - b.position);
}
