import type { Category, Rule } from "../../api";
import { fold } from "./treeFilter";

export type SourceFilter = "all" | "seed" | "manual";
export type RuleSort = "matches" | "pattern";

export interface RuleFilters {
  query: string;
  source: SourceFilter;
  /** Only the rules without a brand icon or picture. */
  noIcon: boolean;
  sort: RuleSort;
  /** A category from the tree: it and its subcategories. */
  category: number | null;
}

/** Rows shown at a time before 'visa alla'. */
export const RULES_PAGE = 50;

/** Made by hand or suggested (the LLM's count as 'Manuella'). */
export const isManual = (r: Rule) => r.createdFrom !== "seed";
export const hasIcon = (r: Rule) => !!r.icon;

export function categoryPath(categories: Category[], id: number): string {
  const c = categories.find((x) => x.id === id);
  const p = c?.parentId != null ? categories.find((x) => x.id === c.parentId) : undefined;
  return c ? (p ? `${p.name} › ${c.name}` : c.name) : "";
}

/**
 * The rules the table shows, and the numbers on its chips. The chips count
 * what the table would show with that chip on and every other filter as it
 * is: 'Grund · 82' is the rows 'Grund' gives (used and unused).
 */
export function ruleView(rules: Rule[], categories: Category[], f: RuleFilters) {
  const q = fold(f.query.trim());
  const inCategory = (r: Rule) =>
    f.category === null || r.categoryId === f.category || categories.find((c) => c.id === r.categoryId)?.parentId === f.category;
  const inQuery = (r: Rule) => !q || fold(r.pattern).includes(q) || fold(categoryPath(categories, r.categoryId)).includes(q);
  const inSource = (s: SourceFilter) => (r: Rule) => s === "all" || (s === "manual" ? isManual(r) : !isManual(r));
  const base = rules.filter((r) => inCategory(r) && inQuery(r));
  const withIcon = (list: Rule[]) => (f.noIcon ? list.filter((r) => !hasIcon(r)) : list);

  const shown = withIcon(base.filter(inSource(f.source))).sort(
    (a, b) => (f.sort === "matches" ? b.matches12 - a.matches12 || b.hits - a.hits : 0) || a.pattern.localeCompare(b.pattern, "sv"),
  );
  return {
    shown,
    used: shown.filter((r) => r.matches12 > 0),
    unused: shown.filter((r) => r.matches12 === 0),
    counts: {
      all: withIcon(base).length,
      seed: withIcon(base.filter(inSource("seed"))).length,
      manual: withIcon(base.filter(inSource("manual"))).length,
      noIcon: base.filter(inSource(f.source)).filter((r) => !hasIcon(r)).length,
    },
  };
}

/** The page of used rules to show, and how many more there are. */
export function page<T>(list: T[], all: boolean, size = RULES_PAGE): { rows: T[]; more: number } {
  return all || list.length <= size ? { rows: list, more: 0 } : { rows: list.slice(0, size), more: list.length - size };
}
