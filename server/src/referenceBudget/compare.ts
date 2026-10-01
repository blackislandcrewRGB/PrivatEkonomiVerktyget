import { and, asc, eq, gte, isNull, lte, min } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  REFERENCE_NOT_INCLUDED,
  categories,
  recurringExpenses,
  referenceBudgetAdjustments,
  referenceBudgetAmounts,
  referenceBudgetCategoryMap,
  referenceBudgetExpenseMap,
  referenceBudgetItems,
  referenceBudgetYears,
  transactions,
  type REFERENCE_BUDGET_CONDITIONS,
} from "../db/schema.js";
import { addMonths, daysInMonth, monthOf } from "../overview/dates.js";
import { myPart } from "../overview/overview.js";
import { loadSplits, partsOf } from "../splits.js";
import { SCB_KPI } from "../prices/scb.js";
import { pointsOf, seriesByKey } from "../prices/series.js";
import { getHousehold, personName, type HouseholdPerson, type ReferenceHousehold } from "./household.js";

/**
 * Jämfört med Konsumentverket: vad vi faktiskt lägger per post mot vad
 * referensbudgeten säger, per månad.
 *
 * Two halves. The pure one — what the reference comes to for a household,
 * and the rolling averages — takes plain data and is tested on its own. The
 * other half reads the database: the year, the household, the mapping and
 * the rows.
 *
 * Min del / Hela hushållet follows Översikten (`myPart`): shared rows half,
 * what the partner paid for me whole, what I paid for her not at all — and
 * the rows she paid are counted too, so my half of a shared purchase is not
 * lost because she held the card. On the reference side, 'mine' is my own
 * individual items and half of the household's (all of it without a
 * partner); 'household' is everyone's individual items and the household's
 * in full.
 *
 * Clothes and furniture are bought in lumps, so a single month says little:
 * the comparison is a rolling average over the last 12 and 3 whole months.
 * Every sum is in öre; an average is rounded to the öre once, at the end.
 */

export type Share = "mine" | "household";
type Condition = (typeof REFERENCE_BUDGET_CONDITIONS)[number];

// ---------- The reference ----------

export interface YearData {
  year: number;
  ageGroups: { key: string; label: string }[];
  householdSizes: number[];
  /** A month to read the figures' price level at ('2026-07'), or null for the year's average (the default). */
  priceBase: string | null;
  items: { key: string; scope: "individual" | "household"; choice: string | null; name: string; sortOrder: number; kpi?: string | null }[];
  /** `${itemKey}|${bracket}` → öre. A missing key is an empty cell. */
  amounts: Map<string, number>;
  adjustments: { itemKey: string; condition: Condition; amountOre: number }[];
}

/** The display name of a choice, as one line in the comparison. */
export const CHOICE_NAMES: Record<string, string> = { food: "Livsmedel" };

/** Under 8: by the exact age when given, else only when the whole age group is ('0', '1-3', '4-6'). */
function underEight(p: HouseholdPerson): boolean {
  if (p.age != null) return p.age < 8;
  const upper = /^(\d+)(?:-(\d+))?$/.exec(p.ageGroup);
  if (!upper) return false; // '71+'
  return Number(upper[2] ?? upper[1]) < 8;
}

/** Whether a footnote holds for a person (the exact-age ones need the age). */
function holds(condition: Condition, p: HouseholdPerson, household: ReferenceHousehold): boolean {
  switch (condition) {
    case "child_under_8":
      return household.persons.some(underEight);
    case "age_18_19":
      return p.age != null && p.age >= 18 && p.age <= 19;
    case "age_over_65":
      return p.age != null && p.age > 65;
  }
}

export interface ReferenceLine {
  /** An item key, or a choice ('food'). */
  target: string;
  name: string;
  scope: "individual" | "household";
  /** Öre per month; 0 when excluded. */
  referenceOre: number;
  excluded: boolean;
  /** What the figure is made of, for the view to say. */
  basis: string;
  /** SCB's COICOP group the item moves with, for the KPI adjustment. */
  kpi: string | null;
}

/**
 * What the reference comes to per month, item by item, for this household and
 * share. A choice is one line: each person counts their own variant. An
 * excluded item is kept, at 0, so the view can say it is left out.
 */
export function referenceLines(year: YearData, household: ReferenceHousehold, share: Share, names: (p: HouseholdPerson) => string = (p) => p.role): ReferenceLine[] {
  const persons = share === "mine" ? household.persons.filter((p) => p.role === "me") : household.persons;
  const hasPartner = household.persons.some((p) => p.role === "partner");
  const sizes = [...year.householdSizes].sort((a, b) => a - b);
  // Beyond the largest household the publication prices, the largest is used.
  const size = Math.min(household.persons.length, sizes.at(-1) ?? household.persons.length);
  const householdShare = share === "mine" && hasPartner ? 0.5 : 1;
  // A person's item takes the footnotes that hold for that person; the household's only the household's own (children under 8).
  const adjust = (itemKey: string, p: HouseholdPerson | null) =>
    year.adjustments
      .filter((a) => a.itemKey === itemKey && (p ? holds(a.condition, p, household) : a.condition === "child_under_8" && household.persons.some(underEight)))
      .reduce((s, a) => s + a.amountOre, 0);
  const cell = (itemKey: string, bracket: string) => year.amounts.get(`${itemKey}|${bracket}`) ?? 0;
  const excluded = new Set(household.excluded);

  const lines: ReferenceLine[] = [];
  const items = [...year.items].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const it of items) {
    if (it.choice) {
      if (lines.some((l) => l.target === it.choice)) continue;
      const variants = items.filter((x) => x.choice === it.choice).map((x) => x.key);
      const parts = persons.map((p) => {
        const key = variants.includes(p.food) ? p.food : variants[0];
        const ore = Math.max(0, cell(key, p.ageGroup) + adjust(key, p));
        return { p, key, ore };
      });
      lines.push({
        target: it.choice,
        name: CHOICE_NAMES[it.choice] ?? it.choice,
        scope: "individual",
        referenceOre: parts.reduce((s, x) => s + x.ore, 0),
        excluded: false,
        basis: parts.map((x) => `${names(x.p)} ${items.find((i) => i.key === x.key)!.name.replace(/^Livsmedel, /, "")}`).join(" · "),
        kpi: it.kpi ?? null,
      });
      continue;
    }
    const isExcluded = excluded.has(it.key);
    if (it.scope === "individual") {
      const ore = persons.reduce((s, p) => s + Math.max(0, cell(it.key, p.ageGroup) + (cell(it.key, p.ageGroup) ? adjust(it.key, p) : 0)), 0);
      lines.push({
        target: it.key,
        name: it.name,
        scope: "individual",
        referenceOre: isExcluded ? 0 : ore,
        excluded: isExcluded,
        basis: persons.map((p) => `${names(p)} ${year.ageGroups.find((g) => g.key === p.ageGroup)?.label ?? p.ageGroup}`).join(" · "),
        kpi: it.kpi ?? null,
      });
    } else {
      const whole = Math.max(0, cell(it.key, String(size)) + adjust(it.key, null));
      lines.push({
        target: it.key,
        name: it.name,
        scope: "household",
        referenceOre: isExcluded ? 0 : Math.round(whole * householdShare),
        excluded: isExcluded,
        basis: `hushåll med ${size} ${size === 1 ? "person" : "personer"}${householdShare < 1 ? ", din halva" : ""}`,
        kpi: it.kpi ?? null,
      });
    }
  }
  return lines;
}

/**
 * The year a comparison ending in `month` uses: that year, else the latest
 * before it, else — nothing earlier being loaded — the earliest there is.
 */
export function pickYear(loaded: number[], month: string): { year: number; wanted: number; fallback: "earlier" | "later" | null } | null {
  const wanted = Number(month.slice(0, 4));
  const sorted = [...loaded].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const earlier = sorted.filter((y) => y <= wanted).at(-1);
  if (earlier !== undefined) return { year: earlier, wanted, fallback: earlier === wanted ? null : "earlier" };
  return { year: sorted[0], wanted, fallback: "later" };
}

// ---------- Averages ----------

export interface Window {
  from: string;
  to: string;
  /** Months in the window that the data reaches; the average divides by these. */
  counted: number;
}

/** The `n` months ending with `to`, and how many of them are on or after `dataFrom`. */
export function windowOf(to: string, n: number, dataFrom: string | null): Window {
  const from = addMonths(to, -(n - 1));
  const start = dataFrom && dataFrom > from ? dataFrom : from;
  let counted = 0;
  for (let m = start; m <= to; m = addMonths(m, 1)) counted++;
  return { from, to, counted: dataFrom && dataFrom > to ? 0 : counted };
}

/** The average per month over a window, rounded to the öre once. Null when no month counts. */
export function average(monthly: Map<string, number>, w: Window): number | null {
  if (w.counted === 0) return null;
  let sum = 0;
  for (let m = w.from; m <= w.to; m = addMonths(m, 1)) sum += monthly.get(m) ?? 0;
  return Math.round(sum / w.counted) || 0;
}

/** The difference from the reference in öre, and in per cent (one decimal), null against a zero reference. */
export function difference(actual: number | null, reference: number): { ore: number | null; pct: number | null } {
  if (actual === null) return { ore: null, pct: null };
  const ore = actual - reference;
  return { ore, pct: reference === 0 ? null : Math.round((ore / reference) * 1000) / 10 };
}

// ---------- KPI ----------

/** An index as months ('YYYY-MM') to values; the value any unit, only ratios are used. */
export type IndexPoints = Map<string, number>;

/** The value for a month: its own, else the latest before it (a month not yet published). Null before the series starts. */
export function indexOn(points: IndexPoints, month: string): { month: string; value: number } | null {
  let best: string | null = null;
  for (const m of points.keys()) if (m <= month && (best === null || m > best)) best = m;
  return best === null ? null : { month: best, value: points.get(best)! };
}

/** What the figures' price level is taken to be, in index terms. */
export interface IndexBase {
  value: number;
  /** In words, for the view: 'KPI-snittet 2026', 'KPI-snittet sep 2025–aug 2026', 'KPI juli 2026'. */
  from: string;
  to: string;
}

/**
 * The base for a reference year: the average of the index over that year —
 * Konsumentverket's figures are a forecast of the year's price level, and an
 * average leaves the seasons out (clothes are on sale in July and January,
 * package holidays peak in July). Until the year is over, the latest twelve
 * published months up to its December stand in. A month given in the year
 * file is used as it is. Null with fewer than twelve months to go on.
 */
export function indexBase(points: IndexPoints, year: number, month: string | null = null): IndexBase | null {
  if (month) {
    const v = points.get(month);
    return v ? { value: v, from: month, to: month } : null;
  }
  const last = indexOn(points, `${year}-12`);
  if (!last) return null;
  const from = addMonths(last.month, -11);
  let sum = 0;
  for (let m = from; m <= last.month; m = addMonths(m, 1)) {
    const v = points.get(m);
    if (v === undefined) return null;
    sum += v;
  }
  return { value: sum / 12, from, to: last.month };
}

/**
 * The reference averaged over a window with each month moved by the index
 * from the base: reference × index(month) ÷ base. A month not yet published
 * takes the latest that is; a month before the series starts means nothing is
 * adjusted rather than something guessed. Rounded once.
 */
export function adjustedAverage(referenceOre: number, points: IndexPoints, base: IndexBase, w: Window): number | null {
  if (w.counted === 0) return null;
  let sum = 0;
  for (let m = addMonths(w.to, -(w.counted - 1)); m <= w.to; m = addMonths(m, 1)) {
    const v = indexOn(points, m);
    if (!v) return null;
    sum += (referenceOre * v.value) / base.value;
  }
  return Math.round(sum / w.counted) || 0;
}

/** The change from the base to a month, in per cent with one decimal, and the month it was read at. */
export function indexChange(points: IndexPoints, base: IndexBase, month: string): { pct: number; month: string } | null {
  const v = indexOn(points, month);
  if (!v) return null;
  return { pct: Math.round((v.value / base.value - 1) * 1000) / 10, month: v.month };
}

// ---------- From the database ----------

export function loadYear(db: Db, year: number): YearData | null {
  const y = db.select().from(referenceBudgetYears).where(eq(referenceBudgetYears.year, year)).get();
  if (!y) return null;
  return {
    year,
    ageGroups: JSON.parse(y.ageGroups),
    householdSizes: JSON.parse(y.householdSizes),
    priceBase: y.priceBase ?? null,
    items: db
      .select({ key: referenceBudgetItems.key, scope: referenceBudgetItems.scope, choice: referenceBudgetItems.choice, name: referenceBudgetItems.name, sortOrder: referenceBudgetItems.sortOrder, kpi: referenceBudgetItems.kpi })
      .from(referenceBudgetItems)
      .where(eq(referenceBudgetItems.year, year))
      .all(),
    amounts: new Map(
      db
        .select()
        .from(referenceBudgetAmounts)
        .where(eq(referenceBudgetAmounts.year, year))
        .all()
        .map((a) => [`${a.itemKey}|${a.bracket}`, a.amountOre]),
    ),
    adjustments: db
      .select({ itemKey: referenceBudgetAdjustments.itemKey, condition: referenceBudgetAdjustments.condition, amountOre: referenceBudgetAdjustments.amountOre })
      .from(referenceBudgetAdjustments)
      .where(eq(referenceBudgetAdjustments.year, year))
      .all(),
  };
}

/** Bucket keys besides the targets: spending the reference leaves out, and categories with no answer yet. */
export const NOT_INCLUDED = REFERENCE_NOT_INCLUDED;
export const UNMAPPED = "unmapped";

export interface ActualSpending {
  /** target → month → öre spent (refunds net). */
  byTarget: Map<string, Map<string, number>>;
  /** Unmapped spending per category path (and 'Utan kategori'), month → öre. */
  unmapped: Map<string, Map<string, number>>;
}

/**
 * Spending per target and month, from `from` to `to` (months). Each part of a
 * split purchase goes to its own category's target; a row linked to a fixed
 * expense with a target of its own goes there whole. Income, transfers and
 * the settlement categories are not spending; money in without a category
 * is left out, as in Analys.
 */
export function actualSpending(db: Db, fromMonth: string, toMonth: string, share: Share): ActualSpending {
  const cats = db.select().from(categories).all();
  const byId = new Map(cats.map((c) => [c.id, c]));
  const catTarget = new Map(db.select().from(referenceBudgetCategoryMap).all().map((r) => [r.categoryId, r.target]));
  const expenseTarget = new Map(db.select().from(referenceBudgetExpenseMap).all().map((r) => [r.recurringExpenseId, r.target]));
  const [y, m] = toMonth.split("-").map(Number);
  const rows = db
    .select({
      id: transactions.id,
      date: transactions.bookingDate,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      shared: transactions.shared,
      forOther: transactions.forOther,
      paidBy: transactions.paidBy,
      recurringExpenseId: transactions.recurringExpenseId,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.bookingDate, `${fromMonth}-01`),
        lte(transactions.bookingDate, `${toMonth}-${String(daysInMonth(y, m)).padStart(2, "0")}`),
        isNull(transactions.deletedAt),
        eq(transactions.isTransfer, false),
        isNull(transactions.returnGroupId),
      ),
    )
    .all();
  const splits = loadSplits(db);
  const out: ActualSpending = { byTarget: new Map(), unmapped: new Map() };
  const add = (map: Map<string, Map<string, number>>, key: string, month: string, ore: number) => {
    const inner = map.get(key) ?? new Map<string, number>();
    inner.set(month, (inner.get(month) ?? 0) + ore);
    map.set(key, inner);
  };
  for (const r of rows) {
    const part = share === "household" ? 1 : myPart(r);
    if (part === 0) continue;
    const month = monthOf(r.date);
    const fixed = r.recurringExpenseId !== null ? expenseTarget.get(r.recurringExpenseId) : undefined;
    for (const p of partsOf(r, splits)) {
      const c = p.categoryId !== null ? byId.get(p.categoryId) : undefined;
      const parent = c?.parentId ? byId.get(c.parentId) : undefined;
      if (c && (c.isTransfer || c.isSettlement || c.systemKey === "income" || parent?.systemKey === "income")) continue;
      if (!c && p.amount > 0) continue;
      const spent = -p.amount * part;
      const target = fixed ?? (c ? catTarget.get(c.id) : undefined);
      if (target) add(out.byTarget, target, month, spent);
      else add(out.unmapped, c ? (parent ? `${parent.name} › ${c.name}` : c.name) : "Utan kategori", month, spent);
    }
  }
  return out;
}

export interface ComparisonItem extends ReferenceLine {
  /** The reference over each window: `referenceOre`, or moved by KPI when asked and possible. */
  reference12Ore: number;
  reference3Ore: number;
  /** The KPI adjustment, when asked for and possible for this item: the change from the base to the month compared through. */
  kpiAdjustment: { code: string; name: string; changePct: number; month: string; base: { from: string; to: string } } | null;
  actual12Ore: number | null;
  actual3Ore: number | null;
  diff12: { ore: number | null; pct: number | null };
  diff3: { ore: number | null; pct: number | null };
  /** What is counted here: category paths, and fixed expenses with a target of their own. */
  sources: string[];
}

export interface Comparison {
  share: Share;
  year: number;
  /** The year the period asked for, when another had to be used. */
  fallback: { wanted: number; direction: "earlier" | "later" } | null;
  source: { title: string; url: string };
  persons: { name: string; ageGroup: string; food: string; age: number | null }[];
  excluded: { key: string; name: string }[];
  months12: Window;
  months3: Window;
  items: ComparisonItem[];
  /** Whether the reference is moved by KPI, from what, and what could not be. */
  kpi: { on: boolean; base: { kind: "year"; year: number } | { kind: "month"; month: string }; adjusted: number; unadjusted: string[]; reason: string | null };
  /** Food, consumables and hygiene as one line: the groceries hold all three. */
  groceries: { targets: string[]; referenceOre: number; reference12Ore: number; reference3Ore: number; actual12Ore: number | null; actual3Ore: number | null; diff12: { ore: number | null; pct: number | null }; diff3: { ore: number | null; pct: number | null } };
  total: { referenceOre: number; reference12Ore: number; reference3Ore: number; actual12Ore: number | null; actual3Ore: number | null; diff12: { ore: number | null; pct: number | null }; diff3: { ore: number | null; pct: number | null } };
  notIncluded: { actual12Ore: number | null; actual3Ore: number | null };
  unmapped: { path: string; actual12Ore: number | null }[];
  /** The last 12 months, each with the rolling averages ending there, per target and in total. */
  series: { month: string; rolling12: Record<string, number | null>; rolling3: Record<string, number | null>; reference12: number }[];
}

export type ComparisonResult = { ok: true; comparison: Comparison } | { ok: false; reason: "no_year" | "no_household" };

/** Groceries: the targets whose spending sits in the same shop basket. */
export const GROCERY_TARGETS = ["food", "consumables", "hygiene"];

/**
 * The comparison through `through` (a whole month, 'YYYY-MM'): each item's
 * reference against the 12- and 3-month average up to and including it.
 */
export function compare(db: Db, through: string, share: Share, opts: { kpi?: boolean } = {}): ComparisonResult {
  const years = db.select({ year: referenceBudgetYears.year }).from(referenceBudgetYears).all().map((r) => r.year);
  const picked = pickYear(years, through);
  if (!picked) return { ok: false, reason: "no_year" };
  const household = getHousehold(db);
  if (!household) return { ok: false, reason: "no_household" };
  const year = loadYear(db, picked.year)!;
  const yearRow = db.select().from(referenceBudgetYears).where(eq(referenceBudgetYears.year, picked.year)).get()!;
  const names = (p: HouseholdPerson) => personName(db, p);
  const lines = referenceLines(year, household, share, names);

  // The first month with any row at all: before it, a month is missing data, not a month of nothing.
  const first = db.select({ d: min(transactions.bookingDate) }).from(transactions).where(isNull(transactions.deletedAt)).get()?.d ?? null;
  const dataFrom = first ? monthOf(first) : null;
  const seriesFrom = addMonths(through, -22);
  const actual = actualSpending(db, seriesFrom, through, share);
  const months12 = windowOf(through, 12, dataFrom);
  const months3 = windowOf(through, 3, dataFrom);
  const monthly = (target: string) => actual.byTarget.get(target) ?? new Map<string, number>();

  // What each target is made of, for the view to say.
  const catMap = db.select().from(referenceBudgetCategoryMap).all();
  const cats = db.select().from(categories).orderBy(asc(categories.name)).all();
  const catById = new Map(cats.map((c) => [c.id, c]));
  const pathOf = (id: number) => {
    const c = catById.get(id)!;
    const parent = c.parentId ? catById.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };
  const expenseMap = db
    .select({ target: referenceBudgetExpenseMap.target, name: recurringExpenses.name })
    .from(referenceBudgetExpenseMap)
    .innerJoin(recurringExpenses, eq(recurringExpenses.id, referenceBudgetExpenseMap.recurringExpenseId))
    .all();
  const sources = (target: string) => [
    ...catMap.filter((r) => r.target === target && catById.has(r.categoryId)).map((r) => pathOf(r.categoryId)).sort((a, b) => a.localeCompare(b, "sv")),
    ...expenseMap.filter((e) => e.target === target).map((e) => `${e.name} (fast utgift)`),
  ];

  // KPI: each item's own group from SCB, read as months to values.
  const indexCache = new Map<string, IndexPoints | null>();
  const indexFor = (code: string): IndexPoints | null => {
    if (!indexCache.has(code)) {
      const cfg = SCB_KPI.series.find((x) => x.coicop === code);
      const series = cfg ? seriesByKey(db, cfg.key) : undefined;
      indexCache.set(code, series ? new Map(pointsOf(db, series).map((p) => [p.date.slice(0, 7), p.value])) : null);
    }
    return indexCache.get(code)!;
  };
  const kpiName = (code: string) => SCB_KPI.series.find((x) => x.coicop === code)?.name ?? code;
  const baseOf = (points: IndexPoints) => indexBase(points, year.year, year.priceBase);

  const items: ComparisonItem[] = lines.map((l) => {
    const a12 = average(monthly(l.target), months12);
    const a3 = average(monthly(l.target), months3);
    let reference12Ore = l.referenceOre;
    let reference3Ore = l.referenceOre;
    let kpiAdjustment: ComparisonItem["kpiAdjustment"] = null;
    if (opts.kpi && l.kpi && !l.excluded && l.referenceOre > 0) {
      const points = indexFor(l.kpi);
      const base = points ? baseOf(points) : null;
      const r12 = points && base ? adjustedAverage(l.referenceOre, points, base, months12) : null;
      const r3 = points && base ? adjustedAverage(l.referenceOre, points, base, months3) : null;
      const change = points && base ? indexChange(points, base, through) : null;
      if (base && r12 !== null && r3 !== null && change) {
        reference12Ore = r12;
        reference3Ore = r3;
        kpiAdjustment = { code: l.kpi, name: kpiName(l.kpi), changePct: change.pct, month: change.month, base: { from: base.from, to: base.to } };
      }
    }
    return {
      ...l,
      reference12Ore,
      reference3Ore,
      kpiAdjustment,
      actual12Ore: a12,
      actual3Ore: a3,
      diff12: difference(a12, reference12Ore),
      diff3: difference(a3, reference3Ore),
      sources: sources(l.target),
    };
  });
  const priced = items.filter((i) => !i.excluded && i.referenceOre > 0);
  const kpiInfo: Comparison["kpi"] = {
    on: !!opts.kpi,
    base: year.priceBase ? { kind: "month", month: year.priceBase } : { kind: "year", year: year.year },
    adjusted: priced.filter((i) => i.kpiAdjustment).length,
    unadjusted: opts.kpi ? priced.filter((i) => !i.kpiAdjustment).map((i) => i.name) : [],
    reason: opts.kpi && !priced.some((i) => i.kpiAdjustment)
      ? year.priceBase
        ? `KPI för ${year.priceBase} är inte hämtat eller publicerat än, så referensen visas som den är publicerad.`
        : "KPI från SCB saknas eller täcker färre än tolv månader, så referensen visas som den är publicerad."
      : null,
  };

  const combine = (targets: string[]) => {
    const merged = new Map<string, number>();
    for (const t of targets) for (const [m, v] of monthly(t)) merged.set(m, (merged.get(m) ?? 0) + v);
    const picked = items.filter((i) => targets.includes(i.target));
    const referenceOre = picked.reduce((s, i) => s + i.referenceOre, 0);
    const reference12Ore = picked.reduce((s, i) => s + i.reference12Ore, 0);
    const reference3Ore = picked.reduce((s, i) => s + i.reference3Ore, 0);
    const a12 = average(merged, months12);
    const a3 = average(merged, months3);
    return { targets, referenceOre, reference12Ore, reference3Ore, actual12Ore: a12, actual3Ore: a3, diff12: difference(a12, reference12Ore), diff3: difference(a3, reference3Ore), merged };
  };
  const included = items.filter((i) => !i.excluded).map((i) => i.target);
  const { merged: _groceriesMonthly, ...groceries } = combine(GROCERY_TARGETS.filter((t) => items.some((i) => i.target === t && !i.excluded)));
  const { merged: totalMonthly, ...total } = combine(included);

  const series = [];
  for (let m = addMonths(through, -11); m <= through; m = addMonths(m, 1)) {
    const w12 = windowOf(m, 12, dataFrom);
    const w3 = windowOf(m, 3, dataFrom);
    const rolling12: Record<string, number | null> = { total: average(totalMonthly, w12) };
    const rolling3: Record<string, number | null> = { total: average(totalMonthly, w3) };
    for (const t of included) {
      rolling12[t] = average(monthly(t), w12);
      rolling3[t] = average(monthly(t), w3);
    }
    // The reference the 12-month average is held against at this point, moved by KPI like the items.
    const reference12 = items
      .filter((i) => !i.excluded)
      .reduce((sum, i) => {
        const points = i.kpiAdjustment ? indexFor(i.kpiAdjustment.code) : null;
        const base = points ? baseOf(points) : null;
        return sum + ((points && base && adjustedAverage(i.referenceOre, points, base, w12)) ?? i.referenceOre);
      }, 0);
    series.push({ month: m, rolling12, rolling3, reference12 });
  }

  const labelOf = (key: string) => year.ageGroups.find((g) => g.key === key)?.label ?? key;
  const itemName = (key: string) => year.items.find((i) => i.key === key)?.name ?? key;
  return {
    ok: true,
    comparison: {
      share,
      year: picked.year,
      fallback: picked.fallback ? { wanted: picked.wanted, direction: picked.fallback } : null,
      source: { title: yearRow.sourceTitle, url: yearRow.sourceUrl },
      persons: household.persons.map((p) => ({ name: names(p), ageGroup: labelOf(p.ageGroup), food: itemName(p.food), age: p.age ?? null })),
      excluded: household.excluded.map((k) => ({ key: k, name: itemName(k) })),
      months12,
      months3,
      items,
      kpi: kpiInfo,
      groceries,
      total,
      notIncluded: { actual12Ore: average(monthly(NOT_INCLUDED), months12), actual3Ore: average(monthly(NOT_INCLUDED), months3) },
      unmapped: [...actual.unmapped.entries()]
        .map(([path, byMonth]) => ({ path, actual12Ore: average(byMonth, months12) }))
        .filter((u) => u.actual12Ore)
        .sort((a, b) => (b.actual12Ore ?? 0) - (a.actual12Ore ?? 0)),
      series,
    },
  };
}

/** The last whole month before `today`: a month in progress would pull the average down. */
export const lastWholeMonth = (today: string) => addMonths(monthOf(today), -1);
