import { and, gt, gte, isNull, like, lte, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { payslips, transactions } from "../db/schema.js";
import { getSetting, setSetting } from "../settings.js";
import { taxReturnsByYear } from "../taxReturns/taxReturns.js";
import { annualIncome } from "../salary/annualIncome.js";
import { salaryForecasts } from "../salary/salary.js";
import { deductionYears } from "../fuel/deduction.js";
import { iskTax } from "./isk.js";
import { finalTax, MissingRatesError, type FinalTax, type FinalTaxInput } from "./finalTax.js";
import { TAX_CONSTANTS, taxRulesFor } from "./rules.js";

/**
 * Skatteåterbäring (uppskattad): the preliminary tax paid for an income year
 * less the final tax the model works out for it. Paid on a day in June the
 * year after (a setting); a negative amount is kvarskatt.
 *
 * With the year's return read in, its boxes are the input. Without it (this
 * year) the salary is Årsinkomst's forecast, the commute deduction
 * Reseavdrag's, the ISK's standard income the ISK tax's, and interest in and
 * out last year's declared figures. The preliminary tax is what the payslips
 * say was withheld, the months entered at their forecast's tax, the rest at
 * the payslips' average share; plus the 30 % the bank withholds on interest.
 * The ISK's standard income has none withheld.
 */

export interface RefundSettings {
  /** 'MM-DD' in the year after the income year. */
  payoutDay: string;
}
const SETTING = "tax_refund";
export const REFUND_DEFAULTS: RefundSettings = { payoutDay: "06-10" };

export function refundSettings(db: Db): RefundSettings {
  return { ...REFUND_DEFAULTS, ...getSetting<Partial<RefundSettings>>(db, SETTING, {}) };
}

export function setRefundSettings(db: Db, input: Partial<RefundSettings>): RefundSettings {
  const day = String(input.payoutDay ?? "");
  const [m, d] = day.split("-").map(Number);
  if (!/^\d{2}-\d{2}$/.test(day) || m < 1 || m > 12 || d < 1 || d > 31) throw new MissingRatesError("Skriv dagen som MM-DD, till exempel 06-10.");
  setSetting(db, SETTING, { payoutDay: day });
  return refundSettings(db);
}

type Basis = "return" | "forecast";
export interface RefundInput {
  value: number;
  /** Where the figure comes from, said plainly. */
  from: string;
}

export interface TaxRefund {
  incomeYear: number;
  payDate: string;
  /** The return read in, or the tool's own figures for a year without one. */
  basis: Basis;
  input: Record<keyof FinalTaxInput, RefundInput>;
  finalTax: FinalTax | null;
  /** Why there is none (rates missing). */
  missing: string | null;
  preliminary: {
    payslips: number;
    payslipMonths: number;
    forecast: number;
    forecastMonths: number;
    estimated: number;
    estimatedMonths: number;
    bank: number;
    total: number;
  } | null;
  /** Preliminary less final: positive back, negative to pay. Null without both. */
  refund: number | null;
  /** Skatteverket has paid something to the bank account after the year ended: the refund is in. */
  paid: { date: string; amount: number } | null;
  estimated: boolean;
}

const kr = (ore: number) => Math.floor(ore / 100);

/** The payslips' tax, by the year they were paid in. */
function preliminary(db: Db, year: number, today: string): TaxRefund["preliminary"] {
  const slips = db
    .select({ payDate: payslips.payDate, tax: payslips.tax, gross: payslips.gross })
    .from(payslips)
    .all()
    .filter((p) => p.payDate <= today);
  const inYear = slips.filter((p) => p.payDate.startsWith(`${year}-`));
  const months = new Set(inYear.map((p) => p.payDate.slice(0, 7)));
  const forecasts = salaryForecasts(db, today);
  let forecast = 0;
  let forecastMonths = 0;
  let left = 0;
  // Only a year still going has months to come; a past year's are what the payslips say.
  if (year >= Number(today.slice(0, 4))) {
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, "0")}`;
      if (months.has(month)) continue;
      const f = forecasts.get(month);
      if (f) {
        forecast += f.gross - f.net;
        forecastMonths++;
      } else left++;
    }
  }
  const recent = slips.sort((a, b) => a.payDate.localeCompare(b.payDate)).slice(-12);
  const share = recent.reduce((s, p) => s + p.gross, 0) > 0 ? recent.reduce((s, p) => s + p.tax, 0) / recent.reduce((s, p) => s + p.gross, 0) : 0;
  const average = annualIncome(db, today).current.average ?? 0;
  const estimated = Math.round(left * average * share);
  const fromSlips = inYear.reduce((s, p) => s + p.tax, 0);
  if (inYear.length === 0 && forecastMonths === 0 && left === 0) return null;
  return {
    payslips: kr(fromSlips),
    payslipMonths: months.size,
    forecast: kr(forecast),
    forecastMonths,
    estimated: kr(estimated),
    estimatedMonths: left,
    bank: 0,
    total: kr(fromSlips) + kr(forecast) + kr(estimated),
  };
}

/** A payment from Skatteverket after the income year: the refund has come. */
function paidRefund(db: Db, year: number, today: string) {
  const row = db
    .select({ date: transactions.bookingDate, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        gt(transactions.amount, 0),
        gte(transactions.bookingDate, `${year + 1}-02-01`),
        lte(transactions.bookingDate, today < `${year + 1}-12-31` ? today : `${year + 1}-12-31`),
        or(like(transactions.descriptionRaw, "%SKATTEVERKET%"), like(transactions.descriptionClean, "%Skatteverket%")),
      ),
    )
    .get();
  return row ?? null;
}

export function estimateTaxRefund(db: Db, incomeYear: number, today: string): TaxRefund {
  const ret = taxReturnsByYear(db).get(incomeYear);
  const rules = taxRulesFor(db, incomeYear);
  const payDate = `${incomeYear + 1}-${refundSettings(db).payoutDay}`;
  let input: TaxRefund["input"];
  if (ret) {
    const box = (v: number | null, what: string): RefundInput => ({ value: kr(v ?? 0), from: v === null ? `${what} saknas i deklarationen: 0` : `rad ${what} i deklarationen` });
    input = {
      salary: box(ret.boxes.employmentIncome, "1.1"),
      commuteDeduction: box(ret.boxes.commuteDeduction, "2.1"),
      iskStandardIncome: box(ret.boxes.iskStandardIncome, "7.1"),
      capitalIncome: box(ret.boxes.capitalIncome, "7.2"),
      capitalExpenses: box(ret.boxes.capitalExpenses, "8.1"),
    };
  } else {
    const annual = annualIncome(db, today).years.find((y) => y.year === incomeYear);
    const d = deductionYears(db, today);
    const commute = String(incomeYear) === today.slice(0, 4) ? d.forecast?.deductible : d.years.find((y) => y.year === String(incomeYear))?.deductible;
    const isk = iskTax(db, incomeYear, today);
    const lastReturn = [...taxReturnsByYear(db).values()].filter((r) => r.incomeYear < incomeYear).sort((a, b) => b.incomeYear - a.incomeYear)[0];
    input = {
      salary: { value: kr(annual?.amount ?? 0), from: annual?.source === "forecast" ? "Årsinkomst: utbetalt + prognos" : annual?.source === "payslips" ? "årets tolv lönespecar" : "saknas" },
      commuteDeduction: { value: kr(commute ?? 0), from: commute === undefined ? "inga pass" : "Reseavdragets prognos" },
      iskStandardIncome: { value: kr(isk.standardIncomeOre ?? 0), from: isk.standardIncomeOre === null ? "ISK-skatten saknar årets ränta: 0" : "ISK-skattens uppskattning" },
      capitalIncome: { value: kr(lastReturn?.boxes.capitalIncome ?? 0), from: lastReturn ? `som ${lastReturn.incomeYear} (rad 7.2)` : "0" },
      capitalExpenses: { value: kr(lastReturn?.boxes.capitalExpenses ?? 0), from: lastReturn ? `som ${lastReturn.incomeYear} (rad 8.1)` : "0" },
    };
  }
  const values = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v.value])) as unknown as FinalTaxInput;
  let tax: FinalTax | null = null;
  let missing: string | null = null;
  try {
    tax = finalTax(values, rules);
  } catch (e) {
    if (!(e instanceof MissingRatesError)) throw e;
    missing = e.message;
  }
  const pre = preliminary(db, incomeYear, today);
  if (pre) {
    pre.bank = Math.floor(values.capitalIncome * TAX_CONSTANTS.capitalRate);
    pre.total += pre.bank;
  }
  return {
    incomeYear,
    payDate,
    basis: ret ? "return" : "forecast",
    input,
    finalTax: tax,
    missing,
    preliminary: pre,
    refund: tax && pre ? pre.total - tax.total : null,
    paid: paidRefund(db, incomeYear, today),
    estimated: true,
  };
}

/**
 * The refunds worth showing: last year's before its pay day (until it is
 * paid) and this year's. Kassaflöde takes one whose day is within its 90
 * days; Framåt says the others.
 */
export function upcomingRefunds(db: Db, today: string): TaxRefund[] {
  const year = Number(today.slice(0, 4));
  return [year - 1, year]
    .map((y) => estimateTaxRefund(db, y, today))
    .filter((r) => r.payDate >= today && !r.paid && r.refund !== null && r.refund !== 0);
}
