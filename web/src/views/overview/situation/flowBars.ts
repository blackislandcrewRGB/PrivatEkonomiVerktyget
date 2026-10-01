import type { Flow } from "../../../api";

export interface BarPart {
  key: string;
  label: string;
  ore: number;
  /** Where it starts and how wide it is, as shares of the bar. */
  from: number;
  width: number;
  /** Takes away from what is before it (drawn under their end). */
  subtracts?: boolean;
}

/**
 * Flöde per månad's first bar: Fasta, Rörligt and Kvar as shares of the net
 * income (of what went out, when that was more: then Kvar is nothing).
 */
export function incomeBar(p: Flow["perMonth"]): { parts: BarPart[]; scale: number } {
  const scale = Math.max(p.incomeOre, p.fixedOre + p.variableOre, 1);
  const parts: BarPart[] = [];
  let at = 0;
  for (const [key, label, ore] of [
    ["fixed", "Fasta", p.fixedOre],
    ["variable", "Rörligt", p.variableOre],
    ["left", "Kvar", Math.max(0, p.leftOre)],
  ] as const) {
    const width = Math.max(0, ore) / scale;
    parts.push({ key, label, ore, from: at, width });
    at += width;
  }
  return { parts, scale };
}

/**
 * The second bar, on the first one's scale: where what was left went. The
 * portfolio and the buffer account (and a positive unexplained rest, grey)
 * laid end to end; a negative one under their end, so that where it
 * starts is Kvar: 7 000 + 1 000 − 1 500 = 6 500.
 */
export function surplusBar(flow: Pick<Flow, "destinations" | "perMonth">, scale: number): { parts: BarPart[]; net: number } {
  const d = flow.destinations;
  const items = [
    { key: "portfolio", label: "Portföljen", ore: d.portfolioOre },
    ...(d.bufferAccount ? [{ key: "buffer", label: d.bufferAccount.name, ore: d.bufferOre }] : []),
    { key: "unexplained", label: "Oförklarat", ore: d.unexplainedOre },
  ].filter((i) => i.ore !== 0);
  const parts: BarPart[] = [];
  let at = 0;
  for (const i of items.filter((i) => i.ore > 0)) {
    parts.push({ ...i, from: at, width: i.ore / scale });
    at += i.ore / scale;
  }
  for (const i of items.filter((i) => i.ore < 0)) {
    at += i.ore / scale;
    parts.push({ ...i, from: at, width: -i.ore / scale, subtracts: true });
  }
  return { parts, net: at };
}
