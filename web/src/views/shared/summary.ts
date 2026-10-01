import type { SharedFigures, SharedMonth } from "../../api";

/** '6 514' (whole kronor, thin space, no unit). */
const n = (ore: number) =>
  Math.round(Math.abs(ore) / 100)
    .toLocaleString("sv-SE")
    .replace(/\s/g, " ");
const kr = (ore: number) => `${n(ore)} kr`;

const GROUP_WORD: Record<string, string> = { norwegian: "Norwegian", recurring: "fasta", swedbank: "Swedbank", manual: "övrigt" };

export const monthLabel = (m: string, year = false) => {
  const s = new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", year ? { month: "long", year: "numeric" } : { month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * A short text to send the partner (Swish, Messenger), written to her:
 * 'September: Norwegian 6 514 + fasta 9 155 = 15 668 delat, hälften 7 834.
 * Du swishar 7 934 kr.' From the reconciled figures when the month is locked.
 */
export function settlementSummary(data: SharedMonth): string {
  const f: SharedFigures = data.settlement ?? data.live;
  // Groups of the same kind (two Norwegian invoices) add up to one part.
  const byKind = new Map<string, number>();
  for (const g of data.iPaid.groups) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + g.total);
  const parts = [...byKind].filter(([, v]) => v !== 0).map(([k, v]) => `${GROUP_WORD[k] ?? k} ${n(v)}`);

  const sentences: string[] = [];
  let first = `${monthLabel(data.month)}: `;
  if (parts.length === 0) first += "inget delat";
  else if (parts.length === 1) first += `${parts[0]} delat`;
  else first += `${parts.join(" + ")} = ${n(f.iPaid)} delat`;
  if (f.partnerPaid) first += `, du har lagt ut ${n(f.partnerPaid)}`;
  first += `, hälften ${f.half < 0 ? "−" : ""}${n(f.half)}.`;
  sentences.push(first);

  if (f.iPaidForPartner) sentences.push(`Dina köp som jag betalat: ${kr(f.iPaidForPartner)}.`);
  if (f.partnerPaidForMe) sentences.push(`Mina köp som du betalat: ${kr(f.partnerPaidForMe)}.`);
  if (f.fromPartner) sentences.push(`Du har redan swishat ${kr(f.fromPartner)}.`);
  if (f.toPartner) sentences.push(`Jag har swishat dig ${kr(f.toPartner)}.`);
  if (f.carryIn && data.carryFrom) {
    sentences.push(`Från ${monthLabel(data.carryFrom.month).toLowerCase()}: ${f.carryIn > 0 ? "du är skyldig" : "jag är skyldig"} ${kr(f.carryIn)}.`);
  }
  sentences.push(f.result > 0 ? `Du swishar ${kr(f.result)}.` : f.result < 0 ? `Jag swishar dig ${kr(f.result)}.` : "Vi är jämna.");
  return sentences.join(" ");
}
