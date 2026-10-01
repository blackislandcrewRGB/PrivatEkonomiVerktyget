import { shareOf, type AverageCategory } from "./types";

export type CategoryOrder = "largest" | "az";

/** What a category is measured by: its average per month, or its sum when the period has no whole month. */
export const measureOf = (c: AverageCategory, wholeMonths: number) => (wholeMonths > 0 ? c.perMonth ?? 0 : c.total);

/**
 * The main categories in order, each with its subcategories in the same
 * order: 'largest' by the average per month (then by name), 'az' by name.
 */
export function sortCategories(rows: AverageCategory[], order: CategoryOrder, wholeMonths: number): { main: AverageCategory; children: AverageCategory[] }[] {
  const cmp = (a: AverageCategory, b: AverageCategory) =>
    order === "largest" ? measureOf(b, wholeMonths) - measureOf(a, wholeMonths) || a.name.localeCompare(b.name, "sv") : a.name.localeCompare(b.name, "sv");
  return rows
    .filter((c) => c.parentKey === null)
    .sort(cmp)
    .map((main) => ({ main, children: rows.filter((c) => c.parentKey === main.key).sort(cmp) }));
}

/**
 * The bars' widths, 0–1: a main category against the largest main
 * category, a subcategory against its own main category.
 */
export function barWidths(groups: ReturnType<typeof sortCategories>, wholeMonths: number): Map<string, number> {
  const largest = Math.max(0, ...groups.map((g) => measureOf(g.main, wholeMonths)));
  const out = new Map<string, number>();
  for (const { main, children } of groups) {
    out.set(main.key, shareOf(measureOf(main, wholeMonths), largest));
    for (const c of children) out.set(c.key, shareOf(measureOf(c, wholeMonths), measureOf(main, wholeMonths)));
  }
  return out;
}
