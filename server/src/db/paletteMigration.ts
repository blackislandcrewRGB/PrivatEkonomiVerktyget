import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { categories } from "./schema.js";
import { SEED_CATEGORIES } from "./seedData.js";
import { assignTopColors, NEUTRAL_COLOR } from "./palette.js";

/**
 * Every main category to the colour-blind-safe palette: the seed categories
 * to their colour (the nearest one, with Mat green and Bil red), others to the
 * nearest colour no other main category has. The main category above Okänt
 * (Övrigt) is neutral grey. Subcategories that followed their main
 * category's colour keep following it (drawn in lighter tones of it).
 */
export function applyCategoryPalette(db: Db): void {
  const all = db.select().from(categories).all();
  const tops = all.filter((c) => c.parentId === null);
  const unknownParent = all.find((c) => c.systemKey === "unknown")?.parentId ?? null;
  const fixed: Record<string, string> = Object.fromEntries(SEED_CATEGORIES.map((c) => [c.name, c.color]));
  const unknownTop = tops.find((t) => t.id === unknownParent);
  if (unknownTop) fixed[unknownTop.name] = NEUTRAL_COLOR;
  const colors = assignTopColors(tops, fixed);
  for (const top of tops) {
    const next = colors.get(top.id)!;
    if (next === top.color) continue;
    for (const sub of all.filter((c) => c.parentId === top.id && (c.color === top.color || c.color === null))) {
      db.update(categories).set({ color: next }).where(eq(categories.id, sub.id)).run();
    }
    db.update(categories).set({ color: next }).where(eq(categories.id, top.id)).run();
  }
}
