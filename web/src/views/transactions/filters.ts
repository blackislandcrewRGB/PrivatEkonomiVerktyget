/**
 * The transaction list's filters, kept in the URL so back works and a view
 * can be linked: /transaktioner?period=2026-09&account=4&category=12.
 */
export interface Filters {
  /** 'YYYY-MM' (a month), 'all', 'inv:YYYY-MM' (a Norwegian invoice) or 'range' (from–to). */
  period: string;
  from: string;
  to: string;
  account: string;
  /** Any of these (each with its subcategories). */
  categories: number[];
  uncategorized: boolean;
  /** With uncategorized: also Övrigt › Okänt. */
  includeUnknown: boolean;
  source: "" | "swedbank" | "norwegian" | "mastercard" | "manual";
  owner: "" | "shared" | "own" | "other";
  transfers: boolean;
  privateOnly: boolean;
  /** Linked to a fixed expense or a recurring income. */
  recurring: boolean;
  /** With a receipt. */
  receipt: boolean;
  /** Newest first (the default) or oldest first. */
  sort: "newest" | "oldest";
  /** Kronor as typed, on the absolute amount. */
  min: string;
  max: string;
  q: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const currentMonth = (now = new Date()) => monthKey(now);

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}

export function lastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
}

export const defaultFilters = (now = new Date()): Filters => ({
  period: currentMonth(now),
  from: "",
  to: "",
  account: "",
  categories: [],
  uncategorized: false,
  includeUnknown: false,
  source: "",
  owner: "",
  transfers: false,
  privateOnly: false,
  recurring: false,
  receipt: false,
  sort: "newest",
  min: "",
  max: "",
  q: "",
});

const SOURCES = new Set(["swedbank", "norwegian", "mastercard", "manual"]);
const OWNERS = new Set(["shared", "own", "other"]);
const isMonth = (s: string) => /^\d{4}-\d{2}$/.test(s);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Reads filters from a query string; anything missing or malformed is the default. */
export function parseFilters(search: string, now = new Date()): Filters {
  const p = new URLSearchParams(search);
  const f = defaultFilters(now);
  const period = p.get("period") ?? "";
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  if (isDate(from) || isDate(to)) Object.assign(f, { period: "range", from: isDate(from) ? from : "", to: isDate(to) ? to : "" });
  else if (period === "all" || isMonth(period) || /^inv:\d{4}-\d{2}$/.test(period)) f.period = period;
  const account = p.get("account") ?? "";
  if (/^\d+$/.test(account)) f.account = account;
  f.categories = (p.get("category") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  f.uncategorized = p.get("uncategorized") === "1";
  f.includeUnknown = f.uncategorized && p.get("unknown") === "1";
  const source = p.get("source") ?? "";
  if (SOURCES.has(source)) f.source = source as Filters["source"];
  const owner = p.get("owner") ?? "";
  if (OWNERS.has(owner)) f.owner = owner as Filters["owner"];
  f.transfers = p.get("transfers") === "1";
  f.privateOnly = p.get("private") === "only";
  f.recurring = p.get("recurring") === "1";
  f.receipt = p.get("receipt") === "1";
  if (p.get("sort") === "aldst") f.sort = "oldest";
  f.min = parseKronor(p.get("min") ?? "") !== null ? p.get("min")! : "";
  f.max = parseKronor(p.get("max") ?? "") !== null ? p.get("max")! : "";
  f.q = p.get("q") ?? "";
  return f;
}

/** Writes filters as a query string ('' for the defaults), in a stable order. */
export function serializeFilters(f: Filters, now = new Date()): string {
  const p = new URLSearchParams();
  if (f.period === "range") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  } else if (f.period !== currentMonth(now)) p.set("period", f.period);
  if (f.account) p.set("account", f.account);
  if (f.categories.length) p.set("category", f.categories.join(","));
  if (f.uncategorized) p.set("uncategorized", "1");
  if (f.uncategorized && f.includeUnknown) p.set("unknown", "1");
  if (f.source) p.set("source", f.source);
  if (f.owner) p.set("owner", f.owner);
  if (f.transfers) p.set("transfers", "1");
  if (f.privateOnly) p.set("private", "only");
  if (f.recurring) p.set("recurring", "1");
  if (f.receipt) p.set("receipt", "1");
  if (f.min) p.set("min", f.min);
  if (f.max) p.set("max", f.max);
  if (f.q) p.set("q", f.q);
  if (f.sort === "oldest") p.set("sort", "aldst");
  const s = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  return s ? `?${s}` : "";
}

/** '1 234,50' -> 123450 öre; null when it isn't a number. */
export function parseKronor(s: string): number | null {
  const clean = s.replace(/[\s  ]/g, "").replace(",", ".");
  if (!clean || !/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** The period as booking dates, or nothing for 'all' and invoices. */
export function periodRange(f: Pick<Filters, "period" | "from" | "to">): { from?: string; to?: string } {
  if (f.period === "all" || f.period.startsWith("inv:")) return {};
  if (f.period === "range") return { from: f.from || undefined, to: f.to || undefined };
  return { from: `${f.period}-01`, to: lastDay(f.period) };
}

/** The query for GET /api/transactions. */
export function apiQuery(f: Filters, showPrivate: boolean): string {
  const p = new URLSearchParams();
  const { from, to } = periodRange(f);
  if (f.period.startsWith("inv:")) p.set("invoice", f.period.slice(4));
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (f.account) p.set("accountId", f.account);
  if (f.uncategorized) {
    p.set("categoryId", "none");
    if (f.includeUnknown) p.set("includeUnknown", "1");
  } else if (f.categories.length) p.set("categoryIds", f.categories.join(","));
  if (f.source) p.set("source", f.source);
  if (f.owner) p.set("shared", f.owner);
  if (f.transfers) p.set("transfers", "1");
  if (f.privateOnly) p.set("private", "only");
  if (f.recurring) p.set("recurring", "1");
  if (f.receipt) p.set("receipt", "1");
  const min = parseKronor(f.min);
  const max = parseKronor(f.max);
  if (min !== null) p.set("amountMin", String(min));
  if (max !== null) p.set("amountMax", String(max));
  if (f.q) p.set("q", f.q);
  if (f.sort === "oldest") p.set("order", "asc");
  if (showPrivate) p.set("showPrivate", "1");
  return p.toString();
}

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTHS_LONG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

const shortDay = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** 'september 2026', 'Alla datum', '1/8–30/9 2026', 'Faktura sep 2026'. */
export function periodLabel(f: Pick<Filters, "period" | "from" | "to">): string {
  if (f.period === "all") return "Alla datum";
  if (f.period.startsWith("inv:")) return `Norwegian-faktura ${monthLabel(f.period.slice(4))}`;
  if (f.period === "range") {
    if (f.from && f.to) return `${shortDay(f.from)} ${f.from.slice(0, 4) !== f.to.slice(0, 4) ? f.from.slice(0, 4) + " " : ""}– ${shortDay(f.to)} ${f.to.slice(0, 4)}`;
    if (f.from) return `från ${f.from}`;
    if (f.to) return `till ${f.to}`;
    return "Alla datum";
  }
  return monthLabel(f.period, true);
}

/**
 * ← / →: the month before or after. From a range or invoice, the month of
 * its end; from 'all', the current month.
 */
export function stepPeriod(f: Filters, step: -1 | 1, now = new Date()): Filters {
  const base =
    f.period === "all"
      ? currentMonth(now)
      : f.period === "range"
        ? (f.to || f.from || `${currentMonth(now)}-01`).slice(0, 7)
        : f.period.startsWith("inv:")
          ? f.period.slice(4)
          : f.period;
  const next = f.period === "all" ? base : addMonths(base, step);
  return { ...f, period: next, from: "", to: "" };
}

/**
 * 'Visa äldre': one more month before what is shown (a month or a range
 * becomes a range starting a month earlier). Null when everything is shown.
 */
export function extendOlder(f: Filters): Filters | null {
  if (f.period === "all" || f.period.startsWith("inv:")) return null;
  if (f.period === "range") {
    if (!f.from) return null;
    return { ...f, from: `${addMonths(f.from.slice(0, 7), -1)}-01` };
  }
  return { ...f, period: "range", from: `${addMonths(f.period, -1)}-01`, to: lastDay(f.period) };
}

/** How many filters besides the period (and the order) are on (for 'Rensa'). */
export function activeCount(f: Filters): number {
  return [
    f.account,
    f.categories.length,
    f.uncategorized,
    f.source,
    f.owner,
    f.transfers,
    f.privateOnly,
    f.recurring,
    f.receipt,
    f.min,
    f.max,
    f.q,
  ].filter(Boolean).length;
}

/**
 * The old preset shape used by Översikt and Analys (period 'this' | 'last' |
 * 'YYYY-MM' | 'custom' | 'all' | 'inv:…', categoryId 'none' | id, shared …).
 */
export interface LegacyPreset {
  period?: string;
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  includeUnknown?: boolean;
  source?: string;
  shared?: string;
  transfers?: boolean;
  q?: string;
}

export function fromLegacy(p: LegacyPreset, now = new Date()): Filters {
  const f = { ...defaultFilters(now), period: "all" };
  const period = p.period ?? "all";
  if (period === "this") f.period = currentMonth(now);
  else if (period === "last") f.period = addMonths(currentMonth(now), -1);
  else if (period === "custom") Object.assign(f, { period: "range", from: p.from ?? "", to: p.to ?? "" });
  else f.period = period;
  f.account = p.accountId ?? "";
  if (p.categoryId === "none") Object.assign(f, { uncategorized: true, includeUnknown: !!p.includeUnknown });
  else if (p.categoryId) f.categories = [Number(p.categoryId)];
  if (SOURCES.has(p.source ?? "")) f.source = p.source as Filters["source"];
  if (OWNERS.has(p.shared ?? "")) f.owner = p.shared as Filters["owner"];
  f.transfers = !!p.transfers;
  f.q = p.q ?? "";
  return f;
}
