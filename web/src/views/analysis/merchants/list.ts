import type { Merchant, MerchantCategory, Piece } from "./types";

export type Sort = "summa" | "antal" | "snitt";
export const SORTS: Sort[] = ["summa", "antal", "snitt"];

/** Whether a purchase's category is `id` or one of its subcategories. */
export function inCategory(p: Piece, id: number | null, categories: MerchantCategory[]): boolean {
  if (id === null) return true;
  if (p.categoryId === id) return true;
  return categories.some((c) => c.id === p.categoryId && c.parentId === id);
}

/**
 * 'EXEMPELSTAD' and 'Exempelstad' as 'Exempelstad', an address as 'www.amazon.se'. The bank
 * writes towns without å, ä and ö, which can't be put back.
 */
export const townName = (s: string) => (s.includes(".") ? s.toLocaleLowerCase("sv") : s.toLocaleLowerCase("sv").replace(/(^|[\s-])\p{L}/gu, (c) => c.toLocaleUpperCase("sv")));

/** Values of a key, each once, the one with the largest sum first. */
function byTotal(pieces: Piece[], value: (p: Piece) => string | number | null) {
  const sums = new Map<string | number, number>();
  for (const p of pieces) {
    const v = value(p);
    if (v !== null) sums.set(v, (sums.get(v) ?? 0) + p.total);
  }
  return [...sums].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/**
 * The pieces as rows: per bank text, or merged per name (the name rules'
 * label; a bank text without one keeps its own). Unmerged, a row is known by
 * the label of its latest labelled purchase.
 */
export function merchants(pieces: Piece[], merge: boolean): Merchant[] {
  const groups = new Map<string, Piece[]>();
  for (const p of pieces) {
    const k = merge ? (p.label ?? p.key) : p.key;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups].map(([key, ps]) => {
    const count = ps.reduce((s, p) => s + p.count, 0);
    const total = ps.reduce((s, p) => s + p.total, 0);
    const largest = ps.reduce((a, b) => (b.total > a.total ? b : a));
    const labelled = ps.filter((p) => p.label).sort((a, b) => b.lastDate.localeCompare(a.lastDate))[0];
    const texts = byTotal(ps, (p) => p.key) as string[];
    // The category most of the money went to.
    const topCategory = byTotal(ps, (p) => p.categoryId ?? "none")[0];
    return {
      key,
      name: largest.contactName ?? largest.key,
      label: labelled?.label ?? null,
      contactName: largest.contactName,
      icon: largest.icon,
      texts,
      areas: byTotal(ps, (p) => (p.area ? townName(p.area) : null)) as string[],
      categoryId: topCategory === "none" ? null : Number(topCategory),
      count,
      total,
      avg: Math.round(total / count),
    };
  });
}

const byName = (a: Merchant, b: Merchant) => (a.label ?? a.name).localeCompare(b.label ?? b.name, "sv");

/**
 * Largest first: by sum, by number of purchases, or by average per purchase –
 * which says little for a single purchase, so those come last.
 */
export function sortMerchants(list: Merchant[], sort: Sort): Merchant[] {
  const order = {
    summa: (a: Merchant, b: Merchant) => b.total - a.total,
    antal: (a: Merchant, b: Merchant) => b.count - a.count || b.total - a.total,
    snitt: (a: Merchant, b: Merchant) => Number(b.count >= 2) - Number(a.count >= 2) || b.avg - a.avg,
  }[sort];
  return [...list].sort((a, b) => order(a, b) || byName(a, b));
}

/** The search: the name or any of the bank's texts. */
export function matches(m: Merchant, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("sv");
  if (!needle) return true;
  return [m.label, m.name, ...m.texts].some((t) => t?.toLocaleLowerCase("sv").includes(needle));
}

/** The toolbar's choices in the address: ?sok=lidl&sortera=antal&kategori=12. */
export interface Choices {
  q: string;
  sort: Sort;
  category: number | null;
}
export function fromSearch(params: URLSearchParams): Choices {
  const sort = params.get("sortera") as Sort | null;
  const category = Number(params.get("kategori"));
  return { q: params.get("sok") ?? "", sort: sort && SORTS.includes(sort) ? sort : "summa", category: Number.isInteger(category) && category > 0 ? category : null };
}
export function toSearch(search: string, c: Choices): string {
  const q = new URLSearchParams(search);
  const set = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
  set("sok", c.q || null);
  set("sortera", c.sort === "summa" ? null : c.sort);
  set("kategori", c.category === null ? null : String(c.category));
  const s = q.toString();
  return s ? `?${s}` : "";
}
