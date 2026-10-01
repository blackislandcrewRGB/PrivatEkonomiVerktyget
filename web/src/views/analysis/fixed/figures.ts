import { wholeMonths } from "../categories/figures";

/** GET /api/analysis/fixed-variable, in öre. */
export interface FixedMonth {
  month: string;
  fixed: number;
  variable: number;
  income: number;
  net: number;
  /** Fixed of income; null without income. */
  fixedShareOfIncome: number | null;
}
export interface FixedData {
  months: FixedMonth[];
  total: Omit<FixedMonth, "month">;
}

export interface Segment {
  key: "fixed" | "variable" | "net";
  ore: number;
  /** Of the bar's width, 0–1. */
  width: number;
  /** Of the income, 0–1; null without income. */
  ofIncome: number | null;
}

/**
 * The income bar: fixed, variable and what was left, each as its part of the
 * income. When more went out than came in there is nothing left: the bar is
 * the spending instead, and `over` is by how much.
 */
export function incomeBar(t: FixedData["total"]): { segments: Segment[]; over: number } {
  const spent = Math.max(0, t.fixed) + Math.max(0, t.variable);
  const over = Math.max(0, spent - t.income);
  const whole = over > 0 ? spent : t.income;
  const of = (ore: number) => (t.income > 0 ? ore / t.income : null);
  const part = (ore: number) => (whole > 0 ? Math.max(0, ore) / whole : 0);
  const segments: Segment[] = [
    { key: "fixed", ore: t.fixed, width: part(t.fixed), ofIncome: of(t.fixed) },
    { key: "variable", ore: t.variable, width: part(t.variable), ofIncome: of(t.variable) },
  ];
  if (over === 0) segments.push({ key: "net", ore: t.income - spent, width: part(t.income - spent), ofIncome: of(t.income - spent) });
  return { segments, over };
}

export interface Spread {
  average: number | null;
  min: { month: string; value: number } | null;
  max: { month: string; value: number } | null;
}

function spread(rows: FixedMonth[], value: (m: FixedMonth) => number | null): Spread {
  const vals = rows.map((m) => ({ month: m.month, value: value(m) })).filter((x): x is { month: string; value: number } => x.value !== null);
  if (vals.length === 0) return { average: null, min: null, max: null };
  const sorted = [...vals].sort((a, b) => a.value - b.value);
  return { average: vals.reduce((s, x) => s + x.value, 0) / vals.length, min: sorted[0], max: sorted.at(-1)! };
}

/**
 * The four key figures, over the whole months (the month so far left out,
 * as in Snitt): the fixed share's lowest and highest month, and the average
 * and the range per month of the fixed, the variable and the net, with how
 * many months the net was above nothing.
 */
export function fixedFigures(data: FixedData, to: string) {
  const whole = new Set(wholeMonths(data.months.map((m) => m.month), to));
  const rows = data.months.filter((m) => whole.has(m.month));
  return {
    wholeMonths: rows.length,
    share: spread(rows, (m) => m.fixedShareOfIncome),
    fixed: spread(rows, (m) => m.fixed),
    variable: spread(rows, (m) => m.variable),
    net: spread(rows, (m) => m.net),
    positive: rows.filter((m) => m.net > 0).length,
  };
}

/**
 * A month's Fördelning av inkomsten: fixed, variable and the net as parts of
 * a full bar. In a month that went well the three make up the income; in one
 * that went back the net is the deficit, drawn red after the spending.
 */
export function monthSpread(m: FixedMonth): { fixed: number; variable: number; net: number; back: boolean } {
  const fixed = Math.max(0, m.fixed);
  const variable = Math.max(0, m.variable);
  const net = Math.abs(m.net);
  const whole = fixed + variable + net;
  return whole > 0 ? { fixed: fixed / whole, variable: variable / whole, net: net / whole, back: m.net < 0 } : { fixed: 0, variable: 0, net: 0, back: false };
}

/**
 * The fixed share as a tone, by the figure shown (one decimal): under 25 %
 * green, 25–40 % grey, over 40 % orange.
 */
export type ShareTone = "low" | "normal" | "high";
export function fixedShareTone(share: number): ShareTone {
  const p = Math.round(share * 1000) / 10;
  return p < 25 ? "low" : p <= 40 ? "normal" : "high";
}
