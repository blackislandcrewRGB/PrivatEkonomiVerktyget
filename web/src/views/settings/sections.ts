/**
 * Inställningar's sections in the order of the page, each with its anchor
 * (/installningar#vakt): the section nav, the search and links from the rest
 * of the tool (Att göra, Vakt, Importer, Pendling …) all go by these.
 */
export const SECTIONS = [
  { id: "utseende", label: "Utseende" },
  { id: "moduler", label: "Moduler" },
  { id: "konton", label: "Konton och bankkopplingar" },
  { id: "vakt", label: "Vakt" },
  { id: "prylar", label: "Prylar" },
  { id: "kassaflode", label: "Kassaflöde" },
  { id: "uthallighet", label: "Uthållighet och a-kassa" },
  { id: "pension", label: "Pension" },
  { id: "referensbudget", label: "Referensbudget" },
  { id: "priser", label: "Priser" },
  { id: "veckodigest", label: "Veckodigest" },
  { id: "inkomster", label: "Återkommande inkomster" },
  { id: "bil", label: "Bil" },
  { id: "lon", label: "Lön" },
  { id: "deklaration", label: "Deklaration" },
  { id: "partner", label: "Partner" },
  { id: "kontakter", label: "Kontakter" },
  { id: "data", label: "Data" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** The anchors the cards had before (#banks, #reference-budget, bil-title …): links from outside may still use them. */
const ALIASES: Record<string, SectionId> = {
  appearance: "utseende",
  accounts: "konton",
  banks: "konton",
  watch: "vakt",
  items: "prylar",
  cashflow: "kassaflode",
  endurance: "uthallighet",
  "reference-budget": "referensbudget",
  prices: "priser",
  digest: "veckodigest",
  income: "inkomster",
  "bil-title": "bil",
  salary: "lon",
  "tax-returns": "deklaration",
  contacts: "kontakter",
};

/** The section an anchor names ('#banks' → 'konton'), or null. */
export function sectionOf(hash: string): SectionId | null {
  const h = decodeURIComponent(hash.replace(/^#/, ""));
  if (SECTIONS.some((s) => s.id === h)) return h as SectionId;
  return ALIASES[h] ?? null;
}
