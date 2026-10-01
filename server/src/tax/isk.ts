import { and, asc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { cashBalances, iskQuarterValues, trades, transactions } from "../db/schema.js";
import { categoryIdByKey } from "../db/seed.js";
import { getSetting, setSetting } from "../settings.js";
import { valuePortfolio } from "../savings/portfolio.js";
import { taxReturnsByYear } from "../taxReturns/taxReturns.js";

/**
 * ISK-skatt. The capital base is the ISK's value at the start of each
 * quarter (1/1, 1/4, 1/7, 1/10) plus the year's deposits, divided by four;
 * from 2025 a tax-free allowance comes off it. The standard income is what
 * is left × the standard rate (the government loan rate on 30 November the
 * year before + 1 percentage point, at least 1,25 %), and the tax is 30 % of
 * it, paid with the final tax the spring after.
 */

export class IskError extends Error {}

/** The tax on the standard income, as on all capital income. */
export const CAPITAL_TAX = 0.3;
/** The rate never goes below this (basis points). */
export const MIN_RATE_BP = 125;

export interface IskRule {
  year: number;
  /** The standard rate in basis points (296 = 2,96 %); null until it is known (set in December). */
  rateBp: number | null;
  /** The tax-free allowance off the capital base, öre (0 before 2025). */
  allowanceOre: number;
  source: string;
}

/**
 * The rules per year. The rates are the government loan rate on 30 November
 * the year before + 1 percentage point, at least 1,25 % (Riksgälden sets the
 * loan rate, Skatteverket the rest). 2026's rate is left to be filled in.
 */
export const ISK_DEFAULTS: IskRule[] = [
  { year: 2020, rateBp: 125, allowanceOre: 0, source: "statslåneräntan 30/11 2019 + 1 procentenhet, lägst 1,25 %" },
  { year: 2021, rateBp: 125, allowanceOre: 0, source: "statslåneräntan 30/11 2020 + 1 procentenhet, lägst 1,25 %" },
  { year: 2022, rateBp: 125, allowanceOre: 0, source: "statslåneräntan 30/11 2021 (0,21 %) + 1 procentenhet, lägst 1,25 %" },
  { year: 2023, rateBp: 294, allowanceOre: 0, source: "statslåneräntan 30/11 2022 (1,94 %) + 1 procentenhet (Riksgälden)" },
  { year: 2024, rateBp: 362, allowanceOre: 0, source: "statslåneräntan 30/11 2023 (2,62 %) + 1 procentenhet (Riksgälden)" },
  { year: 2025, rateBp: 296, allowanceOre: 15_000_000, source: "statslåneräntan 30/11 2024 (1,96 %) + 1 procentenhet; fribelopp 150 000 kr (Skatteverket)" },
  { year: 2026, rateBp: null, allowanceOre: 30_000_000, source: "fribelopp 300 000 kr från 2026 (Skatteverket); räntan fylls i" },
];

const SETTING = "isk_rules";

/** The rules: the defaults with what is entered on top, by year. */
export function iskRules(db: Db): IskRule[] {
  const stored = getSetting<IskRule[]>(db, SETTING, []);
  const byYear = new Map(ISK_DEFAULTS.map((r) => [r.year, r]));
  for (const r of stored) byYear.set(r.year, r);
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** A year's rule: its own, else the latest earlier one's allowance with no rate. */
export function iskRuleFor(db: Db, year: number): IskRule {
  const rules = iskRules(db);
  const own = rules.find((r) => r.year === year);
  if (own) return own;
  const before = rules.filter((r) => r.year < year).at(-1);
  return { year, rateBp: null, allowanceOre: before?.allowanceOre ?? 0, source: before ? `fribeloppet som ${before.year}; räntan saknas` : "saknas" };
}

export function setIskRule(db: Db, input: Partial<IskRule>): IskRule[] {
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2012 || year > 2100) throw new IskError("Skriv året regeln gäller.");
  const rateBp = input.rateBp === null || input.rateBp === undefined ? null : Number(input.rateBp);
  if (rateBp !== null && (!Number.isInteger(rateBp) || rateBp < MIN_RATE_BP || rateBp > 2000)) throw new IskError("Schablonräntan ska vara minst 1,25 %.");
  const allowanceOre = Number(input.allowanceOre ?? 0);
  if (!Number.isInteger(allowanceOre) || allowanceOre < 0) throw new IskError("Fribeloppet ska vara noll kronor eller mer.");
  const source = String(input.source ?? "").trim();
  if (!source) throw new IskError("Skriv källan: var räntan och fribeloppet kommer ifrån.");
  const stored = getSetting<IskRule[]>(db, SETTING, []).filter((r) => r.year !== year);
  setSetting(db, SETTING, [...stored, { year, rateBp, allowanceOre, source }].sort((a, b) => a.year - b.year));
  return iskRules(db);
}

// ---------- Quarter values ----------

export const quarterDates = (year: number) => ["01-01", "04-01", "07-01", "10-01"].map((d) => `${year}-${d}`);

export function listQuarterValues(db: Db) {
  return db.select({ date: iskQuarterValues.date, valueOre: iskQuarterValues.valueOre }).from(iskQuarterValues).orderBy(asc(iskQuarterValues.date)).all();
}

export function setQuarterValue(db: Db, date: string, valueOre: number | null): void {
  if (!/^\d{4}-(01|04|07|10)-01$/.test(date)) throw new IskError("Ett kvartal börjar 1/1, 1/4, 1/7 eller 1/10.");
  if (valueOre === null) {
    db.delete(iskQuarterValues).where(eq(iskQuarterValues.date, date)).run();
    return;
  }
  if (!Number.isInteger(valueOre) || valueOre < 0) throw new IskError("Värdet ska vara noll kronor eller mer.");
  db.insert(iskQuarterValues).values({ date, valueOre }).onConflictDoUpdate({ target: iskQuarterValues.date, set: { valueOre } }).run();
}

/** The first day the tool knows the ISK's holdings or cash: before it, a quarter's value has to be entered. */
function firstKnown(db: Db): string | null {
  const t = db.select({ d: sql<string | null>`min(${trades.date})` }).from(trades).where(and(eq(trades.account, "isk"), isNull(trades.deletedAt))).get()?.d ?? null;
  const c = db.select({ d: sql<string | null>`min(${cashBalances.date})` }).from(cashBalances).where(eq(cashBalances.account, "isk")).get()?.d ?? null;
  return [t, c].filter((d): d is string => !!d).sort()[0] ?? null;
}

/** The ISK's value (securities and cash) as the tool works it out on a day. */
export function iskValueOn(db: Db, on: string): number {
  return valuePortfolio(db, on, { holdingsOn: true }).accounts.find((a) => a.account === "isk")?.totalOre ?? 0;
}

/**
 * Money put into the ISK in a period: the Sparande transfers from the bank
 * to Avanza (all of them go to the ISK), not those between my own accounts.
 * Only deposits count; a withdrawal doesn't lower the capital base.
 */
export function iskDeposits(db: Db, from: string, to: string): { ore: number; count: number } {
  const savings = categoryIdByKey(db, "savings");
  if (savings === undefined) return { ore: 0, count: 0 };
  const r = db
    .select({ s: sql<number>`coalesce(sum(${transactions.amount}), 0)`, n: sql<number>`count(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.categoryId, savings),
        isNull(transactions.deletedAt),
        isNull(transactions.counterAccountId),
        lt(transactions.amount, 0),
        gte(transactions.bookingDate, from),
        lte(transactions.bookingDate, to),
      ),
    )
    .get();
  return { ore: -(r?.s ?? 0), count: r?.n ?? 0 };
}

export type QuarterSource = "entered" | "computed" | "today" | "first";

export interface IskQuarter {
  date: string;
  valueOre: number;
  /**
   * Where it comes from: entered by hand, the tool's own valuation on the day,
   * today's value for a quarter still to come, or (a quarter before the
   * holdings were entered, with nothing entered) the first value known.
   */
  source: QuarterSource;
}

export interface IskTax {
  year: number;
  rule: IskRule;
  quarters: IskQuarter[];
  deposits: { ore: number; count: number; through: string };
  /** (the four quarters + deposits) ÷ 4. */
  capitalBaseOre: number;
  /** Less the allowance, never below nothing. */
  taxableBaseOre: number;
  /** The taxed part × the rate: the standard income after the allowance. Null without a rate. (Box 7.1 on the return is before it.) */
  standardIncomeOre: number | null;
  /** × 30 %. */
  taxOre: number | null;
  /** Anything not the year's own figures: a quarter to come or not entered, deposits still to come. */
  estimated: boolean;
  /** Quarters before the holdings were entered that nobody has entered either. */
  missing: string[];
}

export function iskTax(db: Db, year: number, today: string): IskTax {
  const rule = iskRuleFor(db, year);
  const entered = new Map(listQuarterValues(db).map((q) => [q.date, q.valueOre]));
  const first = firstKnown(db);
  const todayValue = iskValueOn(db, today);
  const firstValue = first ? iskValueOn(db, first) : 0;
  const missing: string[] = [];
  const quarters = quarterDates(year).map((date): IskQuarter => {
    const own = entered.get(date);
    if (own !== undefined) return { date, valueOre: own, source: "entered" };
    if (date > today) return { date, valueOre: todayValue, source: "today" };
    if (first && date >= first) return { date, valueOre: iskValueOn(db, date), source: "computed" };
    missing.push(date);
    return { date, valueOre: firstValue, source: "first" };
  });
  const through = `${year}-12-31` < today ? `${year}-12-31` : today;
  const deposits = { ...iskDeposits(db, `${year}-01-01`, through), through };
  const capitalBaseOre = Math.round((quarters.reduce((s, q) => s + q.valueOre, 0) + deposits.ore) / 4);
  const taxableBaseOre = Math.max(0, capitalBaseOre - rule.allowanceOre);
  // Under the allowance there is nothing to tax, whatever the rate.
  const standardIncomeOre = taxableBaseOre === 0 ? 0 : rule.rateBp === null ? null : Math.round((taxableBaseOre * rule.rateBp) / 10_000);
  return {
    year,
    rule,
    quarters,
    deposits,
    capitalBaseOre,
    taxableBaseOre,
    standardIncomeOre,
    taxOre: standardIncomeOre === null ? null : Math.round(standardIncomeOre * CAPITAL_TAX),
    estimated: quarters.some((q) => q.source === "today" || q.source === "first") || through < `${year}-12-31`,
    missing,
  };
}

export interface IskDeclaredYear {
  year: number;
  /** Box 7.1. */
  standardIncomeOre: number;
  rateBp: number | null;
  allowanceOre: number;
  /** The capital base worked back out of it: 7.1 ÷ the rate. Null without the year's rate. */
  capitalBaseOre: number | null;
  /** 30 % of 7.1 less the allowance × the rate, never below nothing. */
  taxOre: number;
}

/** The years with a return: the capital base as the return has it. */
export function iskDeclared(db: Db): IskDeclaredYear[] {
  return [...taxReturnsByYear(db).values()]
    .filter((r) => r.boxes.iskStandardIncome !== null)
    .map((r) => {
      const rule = iskRuleFor(db, r.incomeYear);
      const income = r.boxes.iskStandardIncome!;
      // Box 7.1 is the standard income on the whole base, the allowance not taken off: it comes off in the
      // tax decision. 2025: a base of 101 351 kr gives 7.1 = 3 000 kr, and under the 150 000 kr allowance no tax.
      const allowanceIncome = rule.rateBp === null ? 0 : (rule.allowanceOre * rule.rateBp) / 10_000;
      return {
        year: r.incomeYear,
        standardIncomeOre: income,
        rateBp: rule.rateBp,
        allowanceOre: rule.allowanceOre,
        capitalBaseOre: rule.rateBp === null ? null : Math.round((income * 10_000) / rule.rateBp),
        taxOre: Math.round(Math.max(0, income - allowanceIncome) * CAPITAL_TAX),
      };
    });
}

export interface IskOverview {
  current: IskTax;
  /** The ISK today against this year's allowance. */
  today: { valueOre: number; allowanceOre: number; share: number | null };
  declared: IskDeclaredYear[];
  /** A declared year the tool can also work out: its own base beside the return's. */
  compared: { year: number; declaredBaseOre: number; ownBaseOre: number; diffOre: number } | null;
}

export function iskOverview(db: Db, today: string): IskOverview {
  const year = Number(today.slice(0, 4));
  const current = iskTax(db, year, today);
  const declared = iskDeclared(db);
  // The latest declared year whose quarters the tool knows without guessing.
  const compared =
    declared
      .filter((d) => d.capitalBaseOre !== null)
      .map((d) => ({ d, own: iskTax(db, d.year, today) }))
      .filter(({ own }) => own.quarters.every((q) => q.source === "entered" || q.source === "computed"))
      .map(({ d, own }) => ({ year: d.year, declaredBaseOre: d.capitalBaseOre!, ownBaseOre: own.capitalBaseOre, diffOre: own.capitalBaseOre - d.capitalBaseOre! }))
      .sort((a, b) => b.year - a.year)[0] ?? null;
  const valueOre = iskValueOn(db, today);
  const allowanceOre = current.rule.allowanceOre;
  return { current, today: { valueOre, allowanceOre, share: allowanceOre > 0 ? valueOre / allowanceOre : null }, declared, compared };
}
