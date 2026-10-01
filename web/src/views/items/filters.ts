import type { Item, ItemOwner, ItemStatus } from "../../api";

/** The Prylar filters; each is a query parameter of GET /api/items, empty for none. */
export interface Filters {
  year: string;
  /** 'YYYY-MM': a month, from a bar in the calendar. */
  month: string;
  category: string;
  /** The merchant's name as the server gives it (Item.merchantName). */
  merchant: string;
  owner: "" | ItemOwner;
  status: "" | ItemStatus;
  q: string;
}

export const NO_FILTERS: Filters = { year: "", month: "", category: "", merchant: "", owner: "", status: "", q: "" };

/** The query string for the filters that are on. */
export const filterQuery = (f: Filters) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
};

export const activeFilters = (f: Filters) => Object.values(f).filter(Boolean).length;

/** Whose: 'Mina', 'Delade med Mio', 'Mios'. */
export const ownerLabel = (owner: ItemOwner, partner: string) => (owner === "me" ? "Mina" : owner === "shared" ? `Delade med ${partner}` : `${partner}s`);

export type Sort = "date" | "price" | "name";
export const SORT_LABELS: Record<Sort, string> = { date: "datum", price: "pris", name: "namn" };

/** Newest first (as the server gives them), dearest first, or A–Ö. */
export function sortItems(items: Item[], sort: Sort): Item[] {
  if (sort === "date") return items;
  return [...items].sort((a, b) => (sort === "price" ? b.priceOre - a.priceOre : a.name.localeCompare(b.name, "sv")) || b.purchaseDate.localeCompare(a.purchaseDate) || b.id - a.id);
}

/** 'aug 2026'. */
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short", year: "numeric" }).replace(".", "");
/** 'augusti 2026'. */
export const longMonth = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
