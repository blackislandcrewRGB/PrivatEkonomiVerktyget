import type { Category } from "../api";

/**
 * 16 category colours that stay apart for red-green colour blindness as far
 * as 16 colours can: Okabe–Ito (without black) first, then Paul Tol's muted
 * scheme. New categories take the next one; the same colour is used for a
 * category everywhere (chip, bar, legend).
 */
export const CATEGORY_PALETTE = [
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#332288", // indigo
  "#117733", // green
  "#CC6677", // rose
  "#882255", // wine
  "#AA4499", // purple
  "#999933", // olive
  "#DDCC77", // sand
  "#44AA99", // teal
  "#88CCEE", // cyan
] as const;

/** Uncategorised and 'Okänt'. */
export const NEUTRAL_COLOR = "#94a3b8";

/** The i:th of n subcategories: the main colour mixed with white, 15 % to 60 % (as the server's db/palette.ts). */
export function subTone(parent: string, index: number, count: number): string {
  const t = count <= 1 ? 0.3 : 0.15 + (0.45 * index) / (count - 1);
  const channel = (i: number) => {
    const v = parseInt(parent.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * A category's colour. A main category has its own. A subcategory with its
 * own colour keeps it; one that follows its main category (the same colour,
 * or none) is a lighter tone of it, by its place among its siblings.
 */
export function categoryColor(c: Pick<Category, "id" | "color" | "parentId"> | undefined, all: Category[] = []): string {
  if (!c) return NEUTRAL_COLOR;
  const parent = c.parentId != null ? all.find((p) => p.id === c.parentId) : undefined;
  if (parent) {
    const main = parent.color ?? CATEGORY_PALETTE[parent.id % CATEGORY_PALETTE.length];
    if (c.color && c.color.toLowerCase() !== main.toLowerCase()) return c.color;
    if (main === NEUTRAL_COLOR) return NEUTRAL_COLOR;
    const siblings = all.filter((x) => x.parentId === parent.id).sort((a, b) => a.id - b.id);
    return subTone(main, Math.max(0, siblings.findIndex((x) => x.id === c.id)), siblings.length);
  }
  return c.color ?? CATEGORY_PALETTE[c.id % CATEGORY_PALETTE.length];
}
