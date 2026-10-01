import { isoDate, lastDayOf, monthLabel, shiftMonth } from "../common";

/**
 * Jämför perioder's choices (Design v2), as they stand in the address:
 * A is a month ('2026-08'), a quarter ('2026-K3'), a year ('2026') or a
 * range ('2026-08-03_2026-09-10'). B is one of those, or relative to A:
 * 'fore' (the period of the same length just before), 'ifjol' (the same
 * period a year earlier) or 'snitt12' (the 12 whole months before A, as an
 * average scaled to A's length).
 */
export type Kind = "month" | "quarter" | "year" | "custom";
export interface Period {
  kind: Kind;
  from: string;
  to: string;
}
export type Relative = "fore" | "ifjol" | "snitt12";
export type BChoice = { relative: Relative } | { period: Period };

const pad = (n: number) => String(n).padStart(2, "0");
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const monthPeriod = (m: string): Period => ({ kind: "month", from: `${m}-01`, to: lastDayOf(m) });
export function quarterPeriod(year: number, q: number): Period {
  const first = `${year}-${pad(q * 3 - 2)}`;
  return { kind: "quarter", from: `${first}-01`, to: lastDayOf(shiftMonth(first, 2)) };
}
export const yearPeriod = (y: number): Period => ({ kind: "year", from: `${y}-01-01`, to: `${y}-12-31` });
const quarterOf = (iso: string) => Math.ceil(Number(iso.slice(5, 7)) / 3);

/** The period of another kind that holds A's start: Kvartal on August is Q3. */
export function asKind(p: Period, kind: Kind): Period {
  const y = Number(p.from.slice(0, 4));
  if (kind === "month") return monthPeriod(p.from.slice(0, 7));
  if (kind === "quarter") return quarterPeriod(y, quarterOf(p.from));
  if (kind === "year") return yearPeriod(y);
  return { kind: "custom", from: p.from, to: p.to };
}

/** B from A: the same length just before, the same period a year earlier, or the 12 months before. */
export function relative(a: Period, r: Relative): Period {
  if (r === "ifjol") {
    const back = (iso: string) => {
      const y = Number(iso.slice(0, 4)) - 1;
      const md = iso.slice(5);
      // 29 February has no day a year earlier: the 28th.
      return md === "02-29" ? `${y}-02-28` : `${y}-${md}`;
    };
    if (a.kind === "month") return monthPeriod(`${Number(a.from.slice(0, 4)) - 1}${a.from.slice(4, 7)}`);
    return { kind: a.kind, from: back(a.from), to: a.kind === "custom" ? back(a.to) : lastDayOf(back(a.to).slice(0, 7)) };
  }
  if (r === "snitt12") {
    const first = shiftMonth(a.from.slice(0, 7), -12);
    return { kind: "custom", from: `${first}-01`, to: lastDayOf(shiftMonth(first, 11)) };
  }
  if (a.kind === "month") return monthPeriod(shiftMonth(a.from.slice(0, 7), -1));
  if (a.kind === "quarter") {
    const first = shiftMonth(a.from.slice(0, 7), -3);
    return quarterPeriod(Number(first.slice(0, 4)), quarterOf(first));
  }
  if (a.kind === "year") return yearPeriod(Number(a.from.slice(0, 4)) - 1);
  const n = days(a.from, a.to);
  return { kind: "custom", from: addDays(a.from, -n), to: addDays(a.from, -1) };
}

export const resolveB = (a: Period, b: BChoice): Period => ("relative" in b ? relative(a, b.relative) : b.period);

/**
 * What B's sums are multiplied by: 1, or for 'Snitt 12 mån' A's share of
 * the twelve months (a month 1/12, a quarter 3/12, a year 1; a range by its
 * days against the twelve months' days).
 */
export function bScale(a: Period, b: BChoice): number {
  if (!("relative" in b) || b.relative !== "snitt12") return 1;
  if (a.kind === "month") return 1 / 12;
  if (a.kind === "quarter") return 3 / 12;
  if (a.kind === "year") return 1;
  const twelve = relative(a, "snitt12");
  return days(a.from, a.to) / days(twelve.from, twelve.to);
}

export const periodDays = (p: Period) => days(p.from, p.to);

/** 'augusti 2026', 'Q3 2026', '2026', '3 aug – 10 sep 2026'. */
export function periodName(p: Period): string {
  if (p.kind === "month") return monthLabel(p.from.slice(0, 7), true);
  if (p.kind === "quarter") return `Q${quarterOf(p.from)} ${p.from.slice(0, 4)}`;
  if (p.kind === "year") return p.from.slice(0, 4);
  return rangeText(p);
}
/** Short, for "mer i augusti": a month without its year when the other period is in the same year, else the name. */
export const shortName = (p: Period, other: Period) =>
  p.kind === "month" && p.from.slice(0, 4) === other.from.slice(0, 4) ? monthLabel(p.from.slice(0, 7), true).replace(/ \d{4}$/, "") : periodName(p);
/** The name for B: 'Snitt 12 mån' for the average. */
export const bName = (a: Period, b: BChoice) => ("relative" in b && b.relative === "snitt12" ? "Snitt 12 mån" : periodName(resolveB(a, b)));

/** '1–31 aug 2026', '1 jul – 30 sep 2026', '1 sep 2025 – 31 aug 2026'. */
export function rangeText(p: Period): string {
  const d = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00`).toLocaleDateString("sv-SE", opts).replace(".", "");
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  const sameMonth = sameYear && p.from.slice(5, 7) === p.to.slice(5, 7);
  if (sameMonth) return `${Number(p.from.slice(8))}–${d(p.to, { day: "numeric", month: "short", year: "numeric" })}`;
  if (sameYear) return `${d(p.from, { day: "numeric", month: "short" })} – ${d(p.to, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${d(p.from, { day: "numeric", month: "short", year: "numeric" })} – ${d(p.to, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** The last whole month, A's default. */
export const defaultA = (today = isoDate(new Date())): Period => monthPeriod(shiftMonth(today.slice(0, 7), -1));

// ---------- The address ----------

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function encodePeriod(p: Period): string {
  if (p.kind === "month") return p.from.slice(0, 7);
  if (p.kind === "quarter") return `${p.from.slice(0, 4)}-K${quarterOf(p.from)}`;
  if (p.kind === "year") return p.from.slice(0, 4);
  return `${p.from}_${p.to}`;
}

export function decodePeriod(s: string | null): Period | null {
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})-(\d{2})$/.exec(s)) && Number(m[2]) >= 1 && Number(m[2]) <= 12) return monthPeriod(s);
  if ((m = /^(\d{4})-K([1-4])$/.exec(s))) return quarterPeriod(Number(m[1]), Number(m[2]));
  if (/^\d{4}$/.test(s)) return yearPeriod(Number(s));
  const [from, to] = s.split("_");
  if (from && to && isDay(from) && isDay(to) && from <= to) return { kind: "custom", from, to };
  return null;
}

export function fromSearch(q: URLSearchParams, today?: string): { a: Period; b: BChoice } {
  const a = decodePeriod(q.get("a")) ?? defaultA(today);
  const raw = q.get("b");
  const b: BChoice = raw === "ifjol" || raw === "snitt12" || raw === "fore" ? { relative: raw } : decodePeriod(raw) ? { period: decodePeriod(raw)! } : { relative: "fore" };
  return { a, b };
}

/** The address's query with A and B written in; B 'fore' (the default) is left out. */
export function toSearch(current: string, a: Period, b: BChoice): string {
  const q = new URLSearchParams(current);
  q.set("a", encodePeriod(a));
  if ("relative" in b) {
    if (b.relative === "fore") q.delete("b");
    else q.set("b", b.relative);
  } else q.set("b", encodePeriod(b.period));
  return `?${q.toString()}`;
}

/** ⇄: A becomes what B was, and B the period A was. Not with the average, which is no period to look at on its own. */
export function swap(a: Period, b: BChoice): { a: Period; b: BChoice } | null {
  if ("relative" in b && b.relative === "snitt12") return null;
  return { a: resolveB(a, b), b: { period: a } };
}
