import type { PensionInflow } from "../../../api";

export interface InflowPart {
  key: "income" | "premium" | "saflo";
  /** The whole name, and the short one for the bar. */
  name: string;
  short: string;
  ore: number;
  /** A Tailwind background (and text) class. */
  colour: string;
}

/** What goes in a month, part by part: the state's two and the agreement pension. They add up to the total. */
export const inflowParts = (f: Pick<PensionInflow, "incomePensionOre" | "premiumPensionOre" | "safLoOre">): InflowPart[] => [
  { key: "income", name: "Inkomstpension", short: "Inkomstpension", ore: f.incomePensionOre, colour: "bg-ink text-card" },
  { key: "premium", name: "Premiepension", short: "Premiepension", ore: f.premiumPensionOre, colour: "bg-accent text-white" },
  { key: "saflo", name: "Avtalspension SAF-LO", short: "SAF-LO", ore: f.safLoOre, colour: "bg-wallet-isk text-black/80" },
];
