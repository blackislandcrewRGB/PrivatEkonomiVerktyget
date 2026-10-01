import { NEUTRAL_COLOR, subTone } from "../db/palette.js";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, categories, contacts, imports, transactions, IMPORT_SOURCES } from "../db/schema.js";
import { iconResolver, type IconRef } from "../icons/icons.js";
import { loadSplits, partsOf } from "../splits.js";
import { addDays, addMonths, daysBetween, daysInMonth, monthOf } from "../overview/dates.js";

/**
 * Analysis over transactions. Ground rules for every view:
 * - transfers, partner settlement (Till/Från partner) and rows the partner
 *   paid are never included;
 * - private rows count in sums but are never listed by name;
 * - 'mine' counts shared rows at half and wholly-the-partner's rows not at
 *   all; 'household' counts every row in full;
 * - Övrigt › Okänt is its own entry next to the main categories.
 */

export type Share = "mine" | "household";

/** Analys › Mat: Mat › Livsmedel, Restaurang & café and Hämtmat, by category key. */
const FOOD_KINDS = ["groceries", "restaurants", "takeaway"] as const;
type FoodKind = (typeof FOOD_KINDS)[number];

/**
 * A row's money in one category: the whole row, or one part of a purchase
 * split across categories. Everything that sums per category counts parts,
 * never rows, so a split purchase lands in each of its categories with its
 * own amount and is never counted twice.
 */
export interface RowPart {
  categoryId: number | null;
  /** Main category id, 'unknown' for Övrigt › Okänt, 'none' without category. */
  topKey: string;
  isIncome: boolean;
  isFood: FoodKind | null;
  /** Signed öre, my part for 'mine'. */
  amount: number;
}

export interface Row {
  id: number;
  date: string;
  month: string;
  /** Signed öre, my part for 'mine'. */
  amount: number;
  accountId: number | null;
  /** The row's own category (the largest part of a split purchase). */
  categoryId: number | null;
  /** Main category id, 'unknown' for Övrigt › Okänt, 'none' without category. */
  topKey: string;
  isIncome: boolean;
  isFood: FoodKind | null;
  /** The row itself, or its parts when the purchase is split. Always at least one. */
  parts: RowPart[];
  recurring: boolean;
  private: boolean;
  merchant: string;
  /** The bank's text. */
  text: string;
  label: string | null;
  contactName: string | null;
  /** The town the bank gives for a card purchase. */
  area: string | null;
}

const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
};

/** Months (YYYY-MM) from the month of `from` to the month of `to`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

export function loadRows(db: Db, from: string, to: string, share: Share): Row[] {
  const cats = db.select().from(categories).all();
  const byId = new Map(cats.map((c) => [c.id, c]));
  const incomeTop = cats.find((c) => c.systemKey === "income")?.id;
  const raw = db
    .select({
      id: transactions.id,
      date: transactions.bookingDate,
      amount: transactions.amount,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      shared: transactions.shared,
      forOther: transactions.forOther,
      private: transactions.private,
      recurringExpenseId: transactions.recurringExpenseId,
      counterparty: transactions.counterparty,
      descriptionClean: transactions.descriptionClean,
      label: transactions.label,
      contactName: contacts.name,
      area: transactions.merchantArea,
    })
    .from(transactions)
    .leftJoin(contacts, eq(contacts.counterparty, transactions.counterparty))
    .where(
      and(
        gte(transactions.bookingDate, from),
        lte(transactions.bookingDate, to),
        isNull(transactions.deletedAt),
        eq(transactions.isTransfer, false),
        eq(transactions.paidBy, "me"),
        isNull(transactions.returnGroupId),
      ),
    )
    .all();

  const splits = loadSplits(db);
  const describe = (categoryId: number | null, amount: number): RowPart => {
    const c = categoryId !== null ? byId.get(categoryId) : undefined;
    const top = c ? (c.parentId ?? c.id) : null;
    return {
      categoryId,
      topKey: c?.systemKey === "unknown" ? "unknown" : top === null ? "none" : String(top),
      isIncome: top !== null && top === incomeTop,
      isFood: FOOD_KINDS.find((k) => k === c?.systemKey) ?? null,
      amount,
    };
  };

  const out: Row[] = [];
  for (const r of raw) {
    const cat = r.categoryId !== null ? byId.get(r.categoryId) : undefined;
    if (cat?.isSettlement || cat?.isTransfer) continue;
    const part = share === "household" ? 1 : r.shared ? 0.5 : r.forOther ? 0 : 1;
    if (part === 0) continue;
    const whole = describe(r.categoryId, r.amount * part);
    out.push({
      id: r.id,
      date: r.date,
      month: r.date.slice(0, 7),
      amount: whole.amount,
      accountId: r.accountId,
      categoryId: r.categoryId,
      topKey: whole.topKey,
      isIncome: whole.isIncome,
      isFood: whole.isFood,
      parts: partsOf({ id: r.id, amount: r.amount, categoryId: r.categoryId }, splits).map((p) => describe(p.categoryId, p.amount * part)),
      recurring: r.recurringExpenseId !== null,
      private: r.private,
      merchant: r.counterparty ?? r.descriptionClean,
      text: r.descriptionClean,
      label: r.label,
      contactName: r.contactName,
      area: r.area,
    });
  }
  return out;
}

/** Spending (positive öre) of one part: expenses net of refunds, never income. Uncategorised money in is left out. */
const spendPart = (p: RowPart) => (p.isIncome || (p.topKey === "none" && p.amount > 0) ? 0 : -p.amount);
/** A row's spending: the sum of its parts, which is the row itself when it isn't split. */
const spend = (r: Row) => r.parts.reduce((s, p) => s + spendPart(p), 0);
/** Sums the parts a predicate picks, over the given rows. */
const sumParts = (rows: Row[], pick: (p: RowPart) => boolean, value: (p: RowPart) => number = spendPart) =>
  rows.reduce((s, r) => s + r.parts.reduce((x, p) => (pick(p) ? x + value(p) : x), 0), 0);
const round = (n: number) => Math.round(n) || 0; // never -0

/** Series (main categories, or the subcategories of one) in display order. */
function seriesFor(db: Db, parent: number | null) {
  const cats = db.select().from(categories).all();
  if (parent !== null) {
    const p = cats.find((c) => c.id === parent);
    // Subcategories that follow the main category's colour are drawn in lighter tones of it (as everywhere).
    const subs = cats.filter((c) => c.parentId === parent).sort((a, b) => a.id - b.id);
    const color = (c: (typeof cats)[number]) =>
      p?.color && (c.color === null || c.color === p.color) ? subTone(p.color, subs.indexOf(c), subs.length) : (c.color ?? NEUTRAL_COLOR);
    return subs
      .filter((c) => c.systemKey !== "unknown")
      .map((c) => ({ key: String(c.id), categoryId: c.id as number | null, name: c.name, color: color(c) }))
      .concat(p ? [{ key: `self:${p.id}`, categoryId: p.id, name: `${p.name} (utan underkategori)`, color: "#cbd5e1" }] : []);
  }
  const unknown = cats.find((c) => c.systemKey === "unknown");
  return cats
    .filter((c) => c.parentId === null && !c.isTransfer && !c.isSettlement && c.systemKey !== "income")
    .map((c) => ({ key: String(c.id), categoryId: c.id as number | null, name: c.name, color: c.color ?? NEUTRAL_COLOR }))
    .concat(unknown ? [{ key: "unknown", categoryId: unknown.id, name: "Okänt", color: "#71717a" }] : [])
    .concat([{ key: "none", categoryId: null, name: "Utan kategori", color: "#d4d4d8" }]);
}

/** Spending per month and main category (or subcategory of `parent`) for the last `months` months up to `today`. */
/** Spending per main category and month. */
export function byCategoryAndMonth(db: Db, today: string, months: number, share: Share, parent: number | null) {
  const monthList = Array.from({ length: months }, (_, i) => addMonths(monthOf(today), i - months + 1));
  const rows = loadRows(db, `${monthList[0]}-01`, today, share);
  const cats = new Map(db.select().from(categories).all().map((c) => [c.id, c]));
  const keyOf = (p: RowPart): string | null => {
    if (parent === null) return p.topKey;
    if (p.topKey !== String(parent)) return null;
    return p.categoryId === parent ? `self:${parent}` : cats.get(p.categoryId!)?.systemKey === "unknown" ? null : String(p.categoryId);
  };
  const series = seriesFor(db, parent);
  const data = monthList.map((month) => {
    const point: Record<string, number | string> = { month };
    let total = 0;
    for (const s of series) point[s.key] = 0;
    for (const r of rows) {
      if (r.month !== month) continue;
      for (const p of r.parts) {
        const k = keyOf(p);
        if (k === null || !(k in point)) continue;
        const v = spendPart(p);
        point[k] = (point[k] as number) + v;
        total += v;
      }
    }
    for (const s of series) point[s.key] = round(point[s.key] as number);
    point.total = round(total);
    return point;
  });
  const used = series.filter((s) => data.some((d) => d[s.key] !== 0));
  return { months: monthList, series: used, data, parent: parent !== null ? { id: parent, name: cats.get(parent)?.name ?? "" } : null };
}

// ---------- Averages ----------

const weekday = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

/** Whole weeks (Monday–Sunday) and whole months inside [from, to], never past yesterday. */
export function wholePeriods(from: string, to: string, today: string) {
  const end = to < today ? to : addDays(today, -1);
  const firstMonday = weekday(from) === 0 ? from : addDays(from, 7 - weekday(from));
  const weeks: { from: string; to: string }[] = [];
  for (let d = firstMonday; addDays(d, 6) <= end; d = addDays(d, 7)) weeks.push({ from: d, to: addDays(d, 6) });
  const months = monthsBetween(from, end).filter((m) => `${m}-01` >= from && monthEnd(m) <= end);
  return { weeks, months, end };
}

/**
 * Months in [from, to] that a source's imports don't fully cover: before the
 * first import, after the latest, or in a gap between them. Import periods
 * come from the first and last row of a file, so a few days at the edges
 * (a month export starting on the 2nd) still count as covered.
 */
export function incompleteMonths(db: Db, from: string, to: string, today: string) {
  const EDGE_DAYS = 3;
  const out: Record<(typeof IMPORT_SOURCES)[number], string[]> = { swedbank: [], norwegian: [], mastercard: [], csv: [] };
  for (const source of IMPORT_SOURCES) {
    const periods = db
      .select({ from: imports.periodFrom, to: imports.periodTo })
      .from(imports)
      .where(eq(imports.source, source))
      .all()
      .filter((p): p is { from: string; to: string } => !!p.from && !!p.to)
      .sort((a, b) => a.from.localeCompare(b.from));
    if (!db.select({ id: imports.id }).from(imports).where(eq(imports.source, source)).get()) continue;
    // Merge overlapping or nearly touching periods.
    const merged: { from: string; to: string }[] = [];
    for (const p of periods) {
      const last = merged.at(-1);
      if (last && p.from <= addDays(last.to, EDGE_DAYS + 1)) last.to = p.to > last.to ? p.to : last.to;
      else merged.push({ ...p });
    }
    const yesterday = addDays(today, -1);
    for (const m of monthsBetween(from, to)) {
      const needFrom = `${m}-01`;
      const needTo = monthEnd(m) < yesterday ? monthEnd(m) : yesterday;
      if (needTo < needFrom) continue;
      const covered = merged.some((iv) => iv.from <= addDays(needFrom, EDGE_DAYS) && iv.to >= addDays(needTo, -EDGE_DAYS));
      if (!covered) out[source].push(m);
    }
  }
  return out;
}

export function averages(db: Db, from: string, to: string, today: string, share: Share) {
  const { weeks, months, end } = wholePeriods(from, to, today);
  const rows = loadRows(db, from, end, share);
  const inWeeks = (d: string) => weeks.length > 0 && d >= weeks[0].from && d <= weeks.at(-1)!.to;
  const inMonths = (d: string) => months.includes(d.slice(0, 7));
  const avg = (list: Row[], pick: (p: RowPart) => boolean = () => true) => {
    const w = sumParts(list.filter((r) => inWeeks(r.date)), pick);
    const m = sumParts(list.filter((r) => inMonths(r.date)), pick);
    return {
      total: round(sumParts(list, pick)),
      perWeek: weeks.length ? round(w / weeks.length) : null,
      perMonth: months.length ? round(m / months.length) : null,
    };
  };
  const incomplete = incompleteMonths(db, from, end, today);
  const accountList = db.select().from(accounts).orderBy(accounts.id).all();
  const bySource = accountList
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      kind: a.kind as (typeof a.kind) | null,
      ...avg(rows.filter((r) => r.accountId === a.id)),
      incompleteMonths: a.source ? incomplete[a.source] : [],
      imported: a.source !== null && rows.some((r) => r.accountId === a.id),
    }))
    .filter((s) => s.total !== 0 || s.imported);
  const manual = rows.filter((r) => r.accountId === null);
  if (manual.length) bySource.push({ accountId: -1, name: "Manuella utan konto", kind: null, ...avg(manual), incompleteMonths: [], imported: false });

  const cats = db.select().from(categories).all();
  const series = seriesFor(db, null);
  const byCategory = series.flatMap((s) => {
    const top = avg(rows, (p) => p.topKey === s.key);
    const hasChildren = s.categoryId !== null && s.key !== "unknown";
    // The subcategories' colours as in Per kategori: lighter tones of the main one's unless they have their own.
    const subColour = new Map(hasChildren ? seriesFor(db, s.categoryId).map((c) => [c.key, c.color]) : []);
    const children = hasChildren
      ? cats
          .filter((c) => c.parentId === s.categoryId && c.systemKey !== "unknown")
          .map((c) => ({ key: String(c.id), categoryId: c.id, parentKey: s.key, name: c.name, color: subColour.get(String(c.id)) ?? s.color, ...avg(rows, (p) => p.categoryId === c.id) }))
          .filter((c) => c.total !== 0)
      : [];
    return top.total === 0 && children.length === 0 ? [] : [{ key: s.key, categoryId: s.categoryId, parentKey: null as string | null, name: s.name, color: s.color, ...top }, ...children];
  });
  const all = avg(rows);
  return {
    from,
    to: end,
    weeks: { count: weeks.length, from: weeks[0]?.from ?? null, to: weeks.at(-1)?.to ?? null },
    months: { count: months.length, list: months },
    total: all,
    bySource,
    byCategory,
    incomplete: Object.entries(incomplete)
      .filter(([, list]) => list.length)
      .map(([source, list]) => ({ source, months: list })),
  };
}

// ---------- Food ----------

export function food(db: Db, from: string, to: string, share: Share) {
  const rows = loadRows(db, from, to, share).filter((r) => r.parts.some((p) => p.isFood));
  // outShare: what wasn't cooked at home (restaurants, cafés and takeaway) of all the food.
  const shareOf = (m: { groceries: number; restaurants: number; takeaway: number }) => {
    const all = m.groceries + m.restaurants + m.takeaway;
    return all > 0 ? (m.restaurants + m.takeaway) / all : null;
  };
  const months = monthsBetween(from, to).map((month) => {
    const sum = (k: FoodKind) =>
      round(sumParts(rows.filter((r) => r.month === month), (p) => p.isFood === k, (p) => -p.amount));
    const m = { groceries: sum("groceries"), restaurants: sum("restaurants"), takeaway: sum("takeaway") };
    return { month, ...m, outShare: shareOf(m) };
  });
  const sum = (k: FoodKind) => months.reduce((s, m) => s + m[k], 0);
  const total = { groceries: sum("groceries"), restaurants: sum("restaurants"), takeaway: sum("takeaway") };
  return { months, total: { ...total, outShare: shareOf(total) } };
}

// ---------- Fixed vs variable ----------

export function fixedVariable(db: Db, from: string, to: string, share: Share) {
  const rows = loadRows(db, from, to, share);
  const months = monthsBetween(from, to).map((month) => {
    const inMonth = rows.filter((r) => r.month === month);
    const fixed = round(sumParts(inMonth.filter((r) => r.recurring), (p) => !p.isIncome));
    const variable = round(sumParts(inMonth.filter((r) => !r.recurring), (p) => !p.isIncome));
    const income = round(sumParts(inMonth, (p) => p.isIncome, (p) => p.amount));
    return { month, fixed, variable, income, net: income - fixed - variable, fixedShareOfIncome: income > 0 ? fixed / income : null };
  });
  const sum = (k: "fixed" | "variable" | "income") => months.reduce((s, m) => s + m[k], 0);
  const total = { fixed: sum("fixed"), variable: sum("variable"), income: sum("income") };
  return { months, total: { ...total, net: total.income - total.fixed - total.variable, fixedShareOfIncome: total.income > 0 ? total.fixed / total.income : null } };
}

// ---------- Top merchants ----------

/**
 * Topplista: purchases (not refunds) in pieces the page puts together – per
 * bank text, name (the name rules' label), category and town. Off, the page
 * lists per bank text; 'Slå ihop samma handlare' lists per name. The
 * categories the purchases have come along, with their main categories, for
 * the filter.
 */
export function topMerchants(db: Db, from: string, to: string, share: Share, showPrivate: boolean) {
  const rows = loadRows(db, from, to, share).filter((r) => r.amount < 0 && !r.isIncome);
  const hidden = showPrivate ? [] : rows.filter((r) => r.private);
  const icon = iconResolver(db);
  const pieces = new Map<
    string,
    { key: string; label: string | null; contactName: string | null; icon?: IconRef; categoryId: number | null; area: string | null; count: number; total: number; lastDate: string }
  >();
  for (const r of rows) {
    if (r.private && !showPrivate) continue;
    const id = JSON.stringify([r.merchant, r.label, r.categoryId, r.area]);
    const p = pieces.get(id) ?? { key: r.merchant, label: r.label, contactName: r.contactName, icon: icon(r.text, -1), categoryId: r.categoryId, area: r.area, count: 0, total: 0, lastDate: "" };
    p.count++;
    p.total -= r.amount;
    if (r.date > p.lastDate) p.lastDate = r.date;
    pieces.set(id, p);
  }
  const used = new Set([...pieces.values()].map((p) => p.categoryId));
  const cats = db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).all();
  const parents = new Set(cats.filter((c) => used.has(c.id)).map((c) => c.parentId));
  return {
    pieces: [...pieces.values()].map((p) => ({ ...p, total: round(p.total) })),
    categories: cats.filter((c) => used.has(c.id) || parents.has(c.id)),
    private: { count: hidden.length, total: round(hidden.reduce((s, r) => s - r.amount, 0)) },
  };
}

// ---------- Compare two periods ----------

/**
 * A against B per category and subcategory. `bScale` multiplies B's sums
 * (Jämför perioder's 'Snitt 12 mån': the twelve months as A's share of them).
 */
export function comparePeriods(db: Db, a: { from: string; to: string }, b: { from: string; to: string }, share: Share, bScale = 1) {
  const rowsA = loadRows(db, a.from, a.to, share);
  const rowsB = loadRows(db, b.from, b.to, share);
  const cats = db.select().from(categories).all();
  const series = seriesFor(db, null);
  const sumBy = (rows: Row[], pick: (p: RowPart) => boolean, scale = 1) => round(sumParts(rows, pick) * scale);
  const line = (key: string, categoryId: number | null, parentKey: string | null, name: string, pick: (p: RowPart) => boolean) => {
    const va = sumBy(rowsA, pick);
    const vb = sumBy(rowsB, pick, bScale);
    return { key, categoryId, parentKey, name, a: va, b: vb, diff: va - vb, pct: vb !== 0 ? (va - vb) / Math.abs(vb) : null };
  };
  const rows = series.flatMap((s) => {
    const top = line(s.key, s.categoryId, null, s.name, (p) => p.topKey === s.key);
    const children =
      s.categoryId !== null && s.key !== "unknown"
        ? cats
            .filter((c) => c.parentId === s.categoryId && c.systemKey !== "unknown")
            .map((c) => line(String(c.id), c.id, s.key, c.name, (p) => p.categoryId === c.id))
            .filter((l) => l.a !== 0 || l.b !== 0)
        : [];
    return top.a === 0 && top.b === 0 ? [] : [top, ...children];
  });
  const total = line("total", null, null, "Totalt", () => true);
  return { a, b, rows, total, days: { a: daysBetween(a.from, a.to) + 1, b: daysBetween(b.from, b.to) + 1 } };
}
