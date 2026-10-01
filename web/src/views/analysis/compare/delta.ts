/** GET /api/analysis/compare: a row per category and subcategory, in öre. */
export interface Line {
  key: string;
  categoryId: number | null;
  parentKey: string | null;
  name: string;
  a: number;
  b: number;
  diff: number;
  /** (A − B) / |B|; null when B is 0. */
  pct: number | null;
}
export interface CompareData {
  a: { from: string; to: string };
  b: { from: string; to: string };
  rows: Line[];
  total: Line;
  days: { a: number; b: number };
}

/** A − B as a tone, by the whole kronor: more spent in A orange, less green, the same grey. */
export type DeltaTone = "more" | "less" | "even";
export const deltaTone = (diffOre: number): DeltaTone => {
  const kr = Math.round(diffOre / 100);
  return kr > 0 ? "more" : kr < 0 ? "less" : "even";
};
export const DELTA = {
  more: { text: "text-caution-text", pill: "bg-caution-soft text-caution-text" },
  less: { text: "text-positive-text", pill: "bg-positive-soft text-positive-text" },
  even: { text: "text-ink-2", pill: "bg-segment text-ink-2" },
} as const;

/** The main categories with the largest difference either way, largest first. */
export const largestDiffs = (rows: Line[], n = 4) =>
  rows
    .filter((l) => l.parentKey === null && Math.round(l.diff / 100) !== 0)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
    .slice(0, n);

/** '+7 850 kr' / '−1 138 kr' / '±0'. */
export const signedKr = (ore: number) => {
  const kr = Math.round(ore / 100);
  return kr === 0 ? "±0" : `${kr > 0 ? "+" : "−"}${Math.abs(kr).toLocaleString("sv-SE")} kr`;
};
/** '+39,1 %' with one decimal, or whole per cent ('+227 %'). */
export const signedPct = (pct: number, digits = 0) => {
  const v = pct * 100;
  const s = Math.abs(v).toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${s} %`;
};

export type CompareOrder = "diff" | "category";

/**
 * The main categories in order, each with its subcategories: largest
 * difference in kronor either way first, or the categories' own order (as
 * the server lists them). Rows where A and B are both 0 are left out.
 */
export function compareGroups(rows: Line[], order: CompareOrder): { main: Line; children: Line[] }[] {
  const shown = rows.filter((l) => l.a !== 0 || l.b !== 0);
  const byDiff = (x: Line, y: Line) => Math.abs(y.diff) - Math.abs(x.diff);
  const mains = shown.filter((l) => l.parentKey === null);
  if (order === "diff") mains.sort(byDiff);
  return mains.map((main) => {
    const children = shown.filter((l) => l.parentKey === main.key);
    if (order === "diff") children.sort(byDiff);
    return { main, children };
  });
}
