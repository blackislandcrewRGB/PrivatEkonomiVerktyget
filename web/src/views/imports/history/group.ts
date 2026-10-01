import type { ImportLog } from "../../../api";

export type HistoryFilter = "all" | "files" | "syncs";

export interface Totals {
  files: number;
  syncs: number;
  rowsNew: number;
  rowsSkipped: number;
}

export type HistoryRow =
  | { kind: "file"; imp: ImportLog }
  | { kind: "sync"; imp: ImportLog }
  /** An older day's bank syncs (or a run of days'), as one row that folds out to them. */
  | { kind: "syncs"; key: string; imps: ImportLog[]; totals: Totals; days: string[] };

export interface HistoryBand {
  key: string;
  /** Newest first: one day, or a run of days with only bank syncs. */
  days: string[];
  rows: HistoryRow[];
  totals: Totals;
}

const TZ = "Europe/Stockholm";
const DAY = 86_400_000;

/** The Swedish day of a timestamp: '2026-09-25'. */
export const swedishDay = (ts: string) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: TZ });
/** '06:00', Swedish time. */
export const swedishTime = (ts: string) => new Date(ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

const isSync = (i: ImportLog) => i.via === "enable_banking";
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

export function totalsOf(list: ImportLog[]): Totals {
  const t: Totals = { files: 0, syncs: 0, rowsNew: 0, rowsSkipped: 0 };
  for (const i of list) {
    if (isSync(i)) t.syncs++;
    else t.files++;
    t.rowsNew += i.rowsNew;
    t.rowsSkipped += i.rowsSkipped;
  }
  return t;
}

const sum = (list: Totals[]): Totals =>
  list.reduce((a, t) => ({ files: a.files + t.files, syncs: a.syncs + t.syncs, rowsNew: a.rowsNew + t.rowsNew, rowsSkipped: a.rowsSkipped + t.rowsSkipped }), {
    files: 0,
    syncs: 0,
    rowsNew: 0,
    rowsSkipped: 0,
  });

/**
 * The history by Swedish day, newest first. Files are always rows of their
 * own. Bank syncs today and yesterday are too; on older days they become one
 * row per day that folds out to them, and a run of older days with nothing
 * but syncs becomes one band with one such row. Each band totals its imports.
 */
export function groupHistory(list: ImportLog[], today: string): HistoryBand[] {
  const recent = dayBefore(today);
  const byDay = new Map<string, ImportLog[]>();
  for (const i of list) {
    const d = swedishDay(i.importedAt);
    byDay.set(d, [...(byDay.get(d) ?? []), i]);
  }
  const days = [...byDay.keys()].sort().reverse();

  const bands: HistoryBand[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const imps = run.flatMap((d) => byDay.get(d)!);
    const totals = totalsOf(imps);
    bands.push({ key: run.join("|"), days: run, rows: [{ kind: "syncs", key: `syncs:${run.join("|")}`, imps, totals, days: run }], totals });
    run = [];
  };

  for (const day of days) {
    const imps = byDay.get(day)!;
    const files = imps.filter((i) => !isSync(i));
    const syncs = imps.filter(isSync);
    if (day >= recent) {
      flush();
      bands.push({ key: day, days: [day], rows: imps.map((imp) => ({ kind: isSync(imp) ? "sync" : "file", imp }) as HistoryRow), totals: totalsOf(imps) });
      continue;
    }
    if (files.length === 0) {
      run.push(day);
      continue;
    }
    flush();
    const rows: HistoryRow[] = files.map((imp) => ({ kind: "file", imp }));
    if (syncs.length) rows.push({ kind: "syncs", key: `syncs:${day}`, imps: syncs, totals: totalsOf(syncs), days: [day] });
    bands.push({ key: day, days: [day], rows, totals: totalsOf(imps) });
  }
  flush();
  return bands;
}

/** A band's totals as its rows add up: the imports in them, and their rows. */
export function rowTotals(rows: HistoryRow[]): Totals {
  return sum(rows.map((r) => (r.kind === "syncs" ? r.totals : totalsOf([r.imp]))));
}

const n = (x: number) => x.toLocaleString("sv-SE");

/** '3 filer · 3 banksynkar · 4 nya · 27 dubbletter', leaving out what is none. */
export function totalsText(t: Totals): string {
  return [
    t.files && `${n(t.files)} ${t.files === 1 ? "fil" : "filer"}`,
    t.syncs && `${n(t.syncs)} ${t.syncs === 1 ? "banksynk" : "banksynkar"}`,
    t.rowsNew && `${n(t.rowsNew)} nya`,
    t.rowsSkipped && `${n(t.rowsSkipped)} ${t.rowsSkipped === 1 ? "dubblett" : "dubbletter"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("sv") + s.slice(1);
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const weekdayDay = (iso: string) => at(iso).toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", timeZone: "UTC" });
const month = (iso: string) => at(iso).toLocaleDateString("sv-SE", { month: "long", timeZone: "UTC" });

/**
 * 'Fredag 25 september'; a run 'Onsdag 23 – lördag 19 september' (newest
 * first, as the list). The year only when it isn't this year's.
 */
export function bandLabel(days: string[], thisYear: string): string {
  const year = (iso: string) => (iso.slice(0, 4) === thisYear ? "" : ` ${iso.slice(0, 4)}`);
  const first = days[0];
  const last = days[days.length - 1];
  if (first === last) return cap(`${weekdayDay(first)} ${month(first)}${year(first)}`);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return cap(`${weekdayDay(first)}${sameMonth ? "" : ` ${month(first)}${first.slice(0, 4) === last.slice(0, 4) ? "" : year(first)}`} – ${weekdayDay(last)} ${month(last)}${year(last)}`);
}

/** '3/9 – 17/9'; with the year when it isn't this year's, on both ends when they differ. */
export function periodText(from: string, to: string, thisYear: string): string {
  const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
  const fy = from.slice(0, 4);
  const ty = to.slice(0, 4);
  if (fy !== ty) return `${dm(from)} ${fy} – ${dm(to)} ${ty}`;
  return `${dm(from)} – ${dm(to)}${ty === thisYear ? "" : ` ${ty}`}`;
}
