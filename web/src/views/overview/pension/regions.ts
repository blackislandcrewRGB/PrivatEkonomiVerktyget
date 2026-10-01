import { REGION_NAMES, type PensionOverview } from "../../../api";

/** Each region its colour (tokens, so both themes); one not named here takes the next from the spare ones. */
const COLOURS: Record<string, string> = { usa: "var(--v2-caution)", global: "var(--v2-accent)", sweden: "var(--v2-positive)", other: "var(--v2-eating-out)" };
const SPARE = ["var(--v2-yellow)", "var(--v2-job)", "var(--v2-alarm)"];

export function regionColour(region: string, known: string[] = Object.keys(COLOURS)): string {
  if (COLOURS[region]) return COLOURS[region];
  const unknown = [...new Set(known.filter((r) => !COLOURS[r]))];
  return SPARE[Math.max(0, unknown.indexOf(region)) % SPARE.length];
}

export const regionName = (region: string) => (REGION_NAMES as Record<string, string>)[region] ?? region;

/** The donut: r 48, 16 wide. */
export const R = 48;
export const CIRCUMFERENCE = 2 * Math.PI * R;

export interface DonutSegment {
  region: string;
  amountOre: number;
  share: number;
  colour: string;
  /** stroke-dasharray and -dashoffset along the circle. */
  length: number;
  offset: number;
}

/** The placeable capital per region as the donut's segments, end to end around the circle. */
export function donutSegments(regions: PensionOverview["regions"]): DonutSegment[] {
  const total = regions.reduce((s, r) => s + Math.max(0, r.amountOre), 0);
  const keys = regions.map((r) => r.region);
  let at = 0;
  return regions.map((r) => {
    const length = total > 0 ? (CIRCUMFERENCE * Math.max(0, r.amountOre)) / total : 0;
    const seg = { region: r.region, amountOre: r.amountOre, share: r.share, colour: regionColour(r.region, keys), length, offset: -at };
    at += length;
    return seg;
  });
}
