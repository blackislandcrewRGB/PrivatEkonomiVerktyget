/**
 * Category colours: 16 that stay apart for red-green colour blindness as far
 * as 16 colours can (Okabe–Ito without black, then Paul Tol's muted scheme).
 * The same list is in web/src/lib/palette.ts. Every main category has its own;
 * a subcategory that follows its main category is drawn in a lighter tone of it.
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

/** Uncategorised, Okänt, and Övrigt (the 17th main category: 16 colours for 17). */
export const NEUTRAL_COLOR = "#94a3b8";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The i:th of n subcategories: the main colour mixed with white, 15 % to 60 %. */
export function subTone(parent: string, index: number, count: number): string {
  const t = count <= 1 ? 0.3 : 0.15 + (0.45 * index) / (count - 1);
  return toHex(rgb(parent).map((v) => v + (255 - v) * t));
}

// Perceptual distance (CIE76 in Lab), enough to pick the nearest palette colour.
function lab(hex: string): number[] {
  const lin = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [x, y, z] = [
    (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047,
    lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722,
    (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883,
  ].map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function colorDistance(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Palette colours for main categories: `fixed` (by name) first, then each
 * remaining one the nearest colour no other main category has, closest pairs
 * first. When the palette runs out, the neutral grey.
 */
export function assignTopColors(tops: { id: number; name: string; color: string | null }[], fixed: Record<string, string>): Map<number, string> {
  const out = new Map<number, string>();
  const used = new Set<string>();
  for (const t of tops) {
    const f = fixed[t.name];
    if (f && (f === NEUTRAL_COLOR || !used.has(f))) {
      out.set(t.id, f);
      if (f !== NEUTRAL_COLOR) used.add(f);
    }
  }
  const rest = tops.filter((t) => !out.has(t.id));
  const pairs = rest
    .flatMap((t) => CATEGORY_PALETTE.map((p) => ({ id: t.id, p: p as string, d: t.color && HEX.test(t.color) ? colorDistance(t.color, p) : 100 })))
    .sort((a, b) => a.d - b.d || a.id - b.id);
  for (const { id, p } of pairs) {
    if (out.has(id) || used.has(p)) continue;
    out.set(id, p);
    used.add(p);
  }
  for (const t of rest) if (!out.has(t.id)) out.set(t.id, NEUTRAL_COLOR);
  return out;
}

/** A colour for a new main category: the first one no main category has, else neutral. */
export function nextTopColor(usedColors: (string | null)[]): string {
  const used = new Set(usedColors.map((c) => c?.toUpperCase()));
  return CATEGORY_PALETTE.find((p) => !used.has(p)) ?? NEUTRAL_COLOR;
}
