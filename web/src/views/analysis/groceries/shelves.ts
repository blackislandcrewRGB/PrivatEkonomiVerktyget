/**
 * Matvaror's shelf colours (Design v2) as tokens, so the dark theme has its
 * own: the seeded shelves by name. They are used inline (SVG and style), so
 * they are read as the --v2- variables, which are always there; Tailwind
 * leaves out a theme colour no class uses. A shelf made later keeps the colour stored
 * with it; Utan hylla is grey.
 */
const TOKEN: Record<string, string> = {
  "Mejeri & ägg": "dairy",
  "Kött & chark": "meat",
  "Fisk & skaldjur": "fish",
  "Frukt & grönt": "produce",
  Bröd: "bread",
  Skafferi: "pantry",
  "Fryst & färdigmat": "frozen",
  "Snacks & godis": "snacks",
  Dryck: "drinks",
  "Kaffe & te": "coffee",
  "Hem & hushåll": "household",
  Hygien: "hygiene",
  Övrigt: "other",
};

export function shelfColour(shelf: { id: number | null; name: string | null; color: string | null }): string {
  if (shelf.id === null) return "var(--v2-shelf-none)";
  const token = shelf.name ? TOKEN[shelf.name] : undefined;
  return token ? `var(--v2-shelf-${token})` : (shelf.color ?? "var(--v2-shelf-other)");
}
