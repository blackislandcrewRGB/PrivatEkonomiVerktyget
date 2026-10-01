import type { PensionEntry, PensionOverview } from "../../../api";

/** 'SEB Pension' -> 'SEB': a provider's word in capitals, when it has one. */
export const capsWord = (s: string) => s.split(/[\s–-]+/).find((w) => /^\p{Lu}{2,}$/u.test(w)) ?? null;

/** What an entry is called in a sentence: the kind for the state's, else the provider's short name or the first word of the name. */
function shortName(e: PensionEntry): string {
  if (e.kind === "income_pension") return "inkomstpension";
  if (e.kind === "premium_pension") return "premiepension";
  return capsWord(e.provider) ?? e.name.split(/\s+/)[0].toLocaleLowerCase("sv");
}

/** 'inkomstpension och KPA', 'a, b och c'. */
const listed = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} och ${names.at(-1)}`);

export interface PensionPart {
  key: "placeable" | "fixed";
  label: string;
  ore: number;
  /** The entries in it, as a sentence. */
  names: string;
}

/** Låst till 65+ in two: what is placeable (funds chosen) and what is not, each with what is in it. */
export function pensionSplit(data: Pick<PensionOverview, "entries" | "placeableOre" | "fixedOre">): PensionPart[] {
  const names = (placeable: boolean) => listed([...new Set(data.entries.filter((e) => e.placeable === placeable).map(shortName))]);
  return [
    { key: "placeable", label: "Placerbart", ore: data.placeableOre, names: names(true) },
    { key: "fixed", label: "Ej placerbart", ore: data.fixedOre, names: names(false) },
  ];
}
