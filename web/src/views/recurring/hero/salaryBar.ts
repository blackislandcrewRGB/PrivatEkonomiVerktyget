/** Öre rounded to whole kronor, so the segments add up with the figures shown. */
export const whole = (ore: number) => Math.round(ore / 100) * 100;

export type SegmentKey = "fixed" | "food" | "fuel" | "left";

export interface Segment {
  key: SegmentKey;
  /** 'Fasta', 'Mat', 'Bränsle', 'Kvar av lönen'. */
  name: string;
  /** Whole kronor, in öre. */
  ore: number;
  /** Of the bar's width, 0–1. */
  share: number;
}

export interface SalaryBar {
  segments: Segment[];
  /** What the bar's full width is: the salary, or the sum when there is none or it is more. */
  scale: number;
  /** How much the sum is over the salary (öre), else null. */
  over: number | null;
}

/**
 * The salary bar: the fixed expenses, food and fuel, and what is left of the
 * usual salary, the whole width being the salary. Without a salary (the
 * household's view) the width is the sum and nothing is left; over the
 * salary, nothing is left either and the bar says by how much.
 */
export function salaryBar({ fixed, food, fuel, salary }: { fixed: number; food: number; fuel: number; salary: number | null }): SalaryBar {
  const parts: Omit<Segment, "share">[] = [
    { key: "fixed", name: "Fasta", ore: whole(fixed) },
    { key: "food", name: "Mat", ore: whole(food) },
    { key: "fuel", name: "Bränsle", ore: whole(fuel) },
  ].filter((p) => p.ore > 0) as Omit<Segment, "share">[];
  const sum = parts.reduce((s, p) => s + p.ore, 0);
  const pay = salary === null ? null : whole(salary);
  const left = pay !== null && pay > sum ? pay - sum : 0;
  if (left > 0) parts.push({ key: "left", name: "Kvar av lönen", ore: left });
  const scale = Math.max(sum, pay ?? 0);
  return {
    segments: parts.map((p) => ({ ...p, share: scale ? p.ore / scale : 0 })),
    scale,
    over: pay !== null && sum > pay ? sum - pay : null,
  };
}

/** Roughly how wide 11 px semibold text is, per character, plus the segment's padding. */
const CHAR_PX = 6.4;
const PAD_PX = 16;

/**
 * What fits in a segment this wide: its name and amount ('Mat 4 390'), the
 * amount only ('1 557'), or nothing (then it is said in the row under).
 */
export function segmentLabel(name: string, amount: string, px: number): "full" | "amount" | "none" {
  const fits = (text: string) => text.length * CHAR_PX + PAD_PX <= px;
  if (fits(`${name} ${amount}`)) return "full";
  if (px >= 60 && fits(amount)) return "amount";
  return "none";
}
