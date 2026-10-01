import type { ManualDataItem, ManualDataStatus } from "../../../api";
import { dm, monthShort } from "../format";

/** The filter's choices: 'late' is Inaktuell and Aldrig ifylld together. */
export type StatusFilter = "all" | "soon" | "late" | "ok" | "info";

export const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Alla" },
  { value: "soon", label: "Snart dags" },
  { value: "late", label: "Inaktuell" },
  { value: "ok", label: "Aktuell" },
  { value: "info", label: "Vid behov" },
];

export const filterOf = (s: ManualDataStatus): Exclude<StatusFilter, "all"> => (s === "overdue" || s === "never" ? "late" : s);

export const matches = (i: ManualDataItem, f: StatusFilter) => f === "all" || filterOf(i.status) === f;

/** '?status=late' -> 'late'; anything else is Alla. */
export function parseFilter(search: string): StatusFilter {
  const v = new URLSearchParams(search).get("status");
  return FILTERS.some((f) => f.value === v) ? (v as StatusFilter) : "all";
}

/** How many rows each choice shows. The four statuses add up to Alla. */
export function counts(items: ManualDataItem[]): Record<StatusFilter, number> {
  const c: Record<StatusFilter, number> = { all: items.length, soon: 0, late: 0, ok: 0, info: 0 };
  for (const i of items) c[filterOf(i.status)]++;
  return c;
}

/** The status in words, for the dot's label. */
export const STATUS_WORD: Record<ManualDataStatus, string> = { overdue: "Inaktuell", never: "Aldrig ifylld", soon: "Snart dags", ok: "Aktuell", info: "Vid behov" };

/** Needs doing: late, never given or soon. */
export const needsDoing = (i: ManualDataItem) => i.status === "overdue" || i.status === "never" || i.status === "soon";

/** A group is folded by default when everything in it is up to date or only needed now and then. */
export const foldedByDefault = (items: ManualDataItem[]) => items.every((i) => i.status === "ok" || i.status === "info");

/** A group's pill: '4 av 4 aktuella', '2 aktuella · 1 vid behov', '1 inaktuell · 2 aktuella', and its tone. */
export function summary(items: ManualDataItem[]): { text: string; tone: "ok" | "neutral" | "soon" | "late" } {
  const c = counts(items);
  const tone = c.late > 0 ? "late" : c.soon > 0 ? "soon" : c.info > 0 ? "neutral" : "ok";
  const aktuella = (n: number) => `${n} ${n === 1 ? "aktuell" : "aktuella"}`;
  if (tone === "ok") return { text: `${c.ok} av ${items.length} ${c.ok === 1 ? "aktuell" : "aktuella"}`, tone };
  const parts = [
    c.late > 0 && `${c.late} inaktuell${c.late === 1 ? "" : "a"}`,
    c.soon > 0 && `${c.soon} snart dags`,
    c.ok > 0 && aktuella(c.ok),
    c.info > 0 && `${c.info} vid behov`,
  ].filter(Boolean);
  return { text: parts.join(" · "), tone };
}

/** '2026-09-04' -> '4/9' (with the year when it isn't this one), '2026-09' -> 'sep 2026', '2026' as it is. */
export function asOfText(asOf: string, thisYear: string): string {
  if (asOf.length === 4) return asOf;
  if (asOf.length === 7) return `${monthShort(`${asOf}-01`)} ${asOf.slice(0, 4)}`;
  return asOf.slice(0, 4) === thisYear ? dm(asOf) : `${dm(asOf)} ${asOf.slice(0, 4)}`;
}

/** How old, in the unit that reads naturally: days, then months. */
export function ageText(days: number): string {
  if (days < 0) return `om ${-days} ${days === -1 ? "dag" : "dagar"}`;
  if (days === 0) return "i dag";
  if (days < 60) return `${days} ${days === 1 ? "dag" : "dagar"} gammal`;
  return `${Math.floor(days / 30.4)} mån gammal`;
}

/**
 * 'äldst 21 dagar': the oldest row in a group by its age. When no row has an
 * age beyond today (a year or a month has none), the oldest date instead
 * ('aug 2026', '2026'). Null when nothing has a date.
 */
export function oldest(items: ManualDataItem[], thisYear: string): string | null {
  const days = Math.max(0, ...items.filter((i) => i.ageDays !== null).map((i) => i.ageDays!));
  if (days > 0) return ageText(days).replace(/ gammal$/, "");
  const dated = items.filter((i) => i.asOf !== null).map((i) => i.asOf!);
  if (!dated.length) return null;
  const first = dated.reduce((a, b) => (b < a ? b : a));
  return items.some((i) => i.asOf === first && i.ageDays !== null) ? "i dag" : asOfText(first, thisYear);
}
