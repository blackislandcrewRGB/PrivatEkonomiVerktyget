import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, savingsHoldings, savingsValues, transactions } from "../db/schema.js";
import { loadRows, monthsBetween } from "../analysis/analysis.js";

/**
 * Sparande: money into savings (Swish to Avanza) and back out (AVANZA on the
 * e-savings account) is the category Överföringar & sparande › Sparande. The
 * savings themselves (Avanza ISK) are valued by hand now and then; what the
 * value grew beyond the money put in is the return.
 */

export class SavingsError extends Error {}

/** The Sparande category and its subcategories. */
export function savingsCategoryIds(db: Db): number[] {
  const cats = db.select({ id: categories.id, parentId: categories.parentId, systemKey: categories.systemKey }).from(categories).all();
  const top = cats.find((c) => c.systemKey === "savings");
  return top ? [top.id, ...cats.filter((c) => c.parentId === top.id).map((c) => c.id)] : [];
}

/** Money into savings (positive öre) and out of it (negative), by booking date. */
export function savingsFlows(db: Db, from?: string, to?: string): { date: string; amount: number }[] {
  const ids = savingsCategoryIds(db);
  if (!ids.length) return [];
  return db
    .select({ date: transactions.bookingDate, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        inArray(transactions.categoryId, ids),
        isNull(transactions.deletedAt),
        from ? gte(transactions.bookingDate, from) : undefined,
        to ? lte(transactions.bookingDate, to) : undefined,
      ),
    )
    .orderBy(asc(transactions.bookingDate))
    .all()
    .map((r) => ({ date: r.date, amount: -r.amount }));
}

export interface SavingsMonth {
  month: string;
  deposited: number;
  withdrawn: number;
  /** Deposited − withdrawn: negative when more was taken out than put in. */
  net: number;
  /** Income that month (as in Analys: salary and other income, not from Mio). */
  income: number;
  /** net / income, or null without income. */
  rate: number | null;
}

const rateOf = (net: number, income: number) => (income > 0 ? net / income : null);

/** Per month from `from` to `to`, and the totals over them. */
export function savingsByMonth(db: Db, from: string, to: string) {
  const flows = savingsFlows(db, from, to);
  const income = new Map<string, number>();
  for (const r of loadRows(db, from, to, "mine")) if (r.isIncome) income.set(r.month, (income.get(r.month) ?? 0) + r.amount);
  const months: SavingsMonth[] = monthsBetween(from, to).map((month) => {
    const inMonth = flows.filter((f) => f.date.startsWith(month));
    const deposited = inMonth.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
    const withdrawn = inMonth.filter((f) => f.amount < 0).reduce((s, f) => s - f.amount, 0);
    const inc = Math.round(income.get(month) ?? 0);
    return { month, deposited, withdrawn, net: deposited - withdrawn, income: inc, rate: rateOf(deposited - withdrawn, inc) };
  });
  const sum = (k: "deposited" | "withdrawn" | "net" | "income") => months.reduce((s, m) => s + m[k], 0);
  const total = { deposited: sum("deposited"), withdrawn: sum("withdrawn"), net: sum("net"), income: sum("income"), rate: rateOf(sum("net"), sum("income")) };
  return { months, total };
}

// ---------- Holdings (valued by hand) ----------

export function listHoldings(db: Db) {
  const values = db.select().from(savingsValues).orderBy(asc(savingsValues.date)).all();
  return db
    .select()
    .from(savingsHoldings)
    .orderBy(asc(savingsHoldings.id))
    .all()
    .map((h) => {
      const own = values.filter((v) => v.holdingId === h.id).map((v) => ({ date: v.date, value: v.value }));
      return { id: h.id, name: h.name, values: own, latest: own.at(-1) ?? null };
    });
}
export type Holding = ReturnType<typeof listHoldings>[number];

/** A holding's value on a date: the latest entered on or before it. */
const valueOn = (h: Holding, date: string) => h.values.filter((v) => v.date <= date).at(-1)?.value ?? null;

/**
 * The holdings together, from the first date every one of them has a value:
 * each entered date with the total then, the money put in since the date
 * before, and what the value grew beyond it (the return). The return can only
 * be told from the first value on: the money put in before it isn't known.
 */
export function portfolio(db: Db, holdings = listHoldings(db)) {
  const valued = holdings.filter((h) => h.values.length);
  if (!valued.length) return null;
  const start = valued.map((h) => h.values[0].date).sort().at(-1)!;
  const dates = [...new Set(valued.flatMap((h) => h.values.map((v) => v.date)))].filter((d) => d >= start).sort();
  const flows = savingsFlows(db, start);
  const total = (date: string) => valued.reduce((s, h) => s + (valueOn(h, date) ?? 0), 0);
  const points = dates.map((date, i) => {
    const value = total(date);
    if (i === 0) return { date, value, deposited: null, change: null, return: null };
    const prev = dates[i - 1];
    const deposited = flows.filter((f) => f.date > prev && f.date <= date).reduce((s, f) => s + f.amount, 0);
    const change = value - total(prev);
    return { date, value, deposited, change, return: change - deposited };
  });
  const first = points[0];
  const last = points.at(-1)!;
  const deposited = flows.filter((f) => f.date > first.date && f.date <= last.date).reduce((s, f) => s + f.amount, 0);
  // Put in after the last value: not in the value yet.
  const since = flows.filter((f) => f.date > last.date).reduce((s, f) => s + f.amount, 0);
  const change = last.value - first.value;
  return {
    since: first.date,
    startValue: first.value,
    date: last.date,
    value: last.value,
    deposited,
    change,
    return: change - deposited,
    /** Return relative to the start value plus the money put in. */
    returnRate: first.value + Math.max(0, deposited) > 0 ? (change - deposited) / (first.value + Math.max(0, deposited)) : null,
    depositedSinceValue: since,
    points,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function createHolding(db: Db, name: string) {
  const n = name.trim();
  if (!n) throw new SavingsError("Ge sparandet ett namn.");
  return db.insert(savingsHoldings).values({ name: n }).returning().get();
}

export function renameHolding(db: Db, id: number, name: string) {
  const n = name.trim();
  if (!n) throw new SavingsError("Ge sparandet ett namn.");
  const row = db.update(savingsHoldings).set({ name: n }).where(eq(savingsHoldings.id, id)).returning().get();
  if (!row) throw new SavingsError("Sparandet finns inte.");
  return row;
}

export function deleteHolding(db: Db, id: number) {
  const row = db.delete(savingsHoldings).where(eq(savingsHoldings.id, id)).returning().get();
  if (!row) throw new SavingsError("Sparandet finns inte.");
}

/** Sets the value (öre) for a date; a second value the same day replaces the first. */
export function setHoldingValue(db: Db, holdingId: number, date: string, value: number, today: string) {
  if (!db.select().from(savingsHoldings).where(eq(savingsHoldings.id, holdingId)).get()) throw new SavingsError("Sparandet finns inte.");
  if (!ISO.test(date)) throw new SavingsError("Datumet ska vara ÅÅÅÅ-MM-DD.");
  if (date > today) throw new SavingsError("Datumet kan inte vara i framtiden.");
  if (!Number.isInteger(value) || value < 0) throw new SavingsError("Värdet ska vara ett antal öre, noll eller mer.");
  return db
    .insert(savingsValues)
    .values({ holdingId, date, value })
    .onConflictDoUpdate({ target: [savingsValues.holdingId, savingsValues.date], set: { value } })
    .returning()
    .get();
}

export function deleteHoldingValue(db: Db, holdingId: number, date: string) {
  const row = db
    .delete(savingsValues)
    .where(and(eq(savingsValues.holdingId, holdingId), eq(savingsValues.date, date)))
    .returning()
    .get();
  if (!row) throw new SavingsError("Värdet finns inte.");
}

/** Everything Analys › Sparande shows. */
export function savingsOverview(db: Db, from: string, to: string) {
  const holdings = listHoldings(db);
  const all = savingsFlows(db);
  return {
    categoryId: savingsCategoryIds(db)[0] ?? null,
    ...savingsByMonth(db, from, to),
    /** Net put in since the first row in Sparande. */
    allTime: all.length ? { since: all[0].date, net: all.reduce((s, f) => s + f.amount, 0) } : null,
    holdings,
    portfolio: portfolio(db, holdings),
  };
}
