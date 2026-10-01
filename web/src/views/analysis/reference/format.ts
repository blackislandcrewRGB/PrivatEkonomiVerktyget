import { formatKr } from "../../../lib/format";
import { kr, monthLabel, shiftMonth } from "../common";

/** '+2 788 kr' / '−717 kr': signed, whole kronor. */
export const signedKr = (ore: number | null) => (ore === null ? "–" : formatKr(Math.round(ore / 100) * 100, { sign: "always", whole: true }));
export const signedPct = (pct: number | null) => (pct === null ? "" : `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
export const money = (ore: number | null) => (ore === null ? "–" : kr(ore));

/** The KPI base in words: a single month, or the twelve months averaged. */
export const baseText = (b: { from: string; to: string }) => (b.from === b.to ? `KPI ${monthLabel(b.from, true)}` : `snittet ${monthLabel(b.from)}–${monthLabel(b.to)}`);

export const windowText = (w: { from: string; to: string; counted: number }, n: number) =>
  w.counted === n ? `${monthLabel(w.from)}–${monthLabel(w.to)}` : `${w.counted} av ${n} månader (data från ${monthLabel(shiftMonth(w.to, -(w.counted - 1)))})`;
