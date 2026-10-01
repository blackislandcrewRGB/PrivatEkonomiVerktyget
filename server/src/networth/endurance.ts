import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, categories, payslips, recurringExpenses } from "../db/schema.js";
import { getSetting, setSetting } from "../settings.js";
import { expectedAmounts } from "../recurring/amounts.js";
import { variableRows } from "../overview/overview.js";
import { liquidCash, valuePortfolio } from "../savings/portfolio.js";
import { categoryIdByKey } from "../db/seed.js";
import { getFuelSettings } from "../fuel/fuel.js";
import { expenseEstimates } from "../recurring/estimates.js";
import { addMonths, monthOf } from "../overview/dates.js";
import { monthStart } from "../cashflow/cashflow.js";

/**
 * Uthållighet: hur länge pengarna räcker om inkomsten upphör.
 *
 * Three answers to the same question, each with more of the truth in it: the
 * buffer alone, the buffer and the savings, and both of them with the
 * unemployment insurance paying part of the way.
 *
 * Everything is my share, and everything is a month. There is no day rate
 * here and no forecast of what the market might do — only what a month costs,
 * what there is, and how long the division lasts.
 *
 * Every figure the calculation rests on is written out in plain Swedish under
 * the number, because a number of months without its arithmetic is a number
 * nobody can check.
 */

// ---------- What is set, and what it starts as ----------

export interface AkassaStep {
  /** Benefit days at this level. */
  days: number;
  /** The share of the qualifying income it pays. */
  rate: number;
}

export interface AkassaSettings {
  /** The highest income the insurance counts, öre a month. */
  incomeCapOre: number;
  /** Benefit days in a month: five a week. */
  daysPerMonth: number;
  /** 80 % for the first hundred days, then 70, then 65. */
  steps: AkassaStep[];
  /** Preliminary tax on the benefit. Null: the rate the payslips actually show. */
  taxRate: number | null;
  /** How many months of payslips the qualifying income is averaged over. */
  incomeMonths: number;
}

/**
 * The rules as they have stood since the insurance became income-based on 1
 * October 2025. They are settings rather than constants because they are a
 * political decision, not a law of arithmetic: the ceiling has moved twice in
 * two years and will again.
 */
export const AKASSA_DEFAULTS: AkassaSettings = {
  incomeCapOre: 3_400_000,
  daysPerMonth: 22,
  steps: [
    { days: 100, rate: 0.8 },
    { days: 100, rate: 0.7 },
    { days: 100, rate: 0.65 },
  ],
  taxRate: null,
  incomeMonths: 12,
};

const AKASSA_KEY = "networth_akassa";
const BUFFER_KEY = "networth_buffer_account";

export function getAkassaSettings(db: Db): AkassaSettings {
  const stored = getSetting<Partial<AkassaSettings>>(db, AKASSA_KEY, {});
  const steps = Array.isArray(stored.steps) && stored.steps.length > 0 ? stored.steps : AKASSA_DEFAULTS.steps;
  return {
    incomeCapOre: positive(stored.incomeCapOre) ?? AKASSA_DEFAULTS.incomeCapOre,
    daysPerMonth: positive(stored.daysPerMonth) ?? AKASSA_DEFAULTS.daysPerMonth,
    steps: steps.map((s) => ({ days: positive(s.days) ?? 0, rate: share(s.rate) ?? 0 })).filter((s) => s.days > 0 && s.rate > 0),
    taxRate: stored.taxRate === null || stored.taxRate === undefined ? null : (share(stored.taxRate) ?? null),
    incomeMonths: positive(stored.incomeMonths) ?? AKASSA_DEFAULTS.incomeMonths,
  };
}

const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : undefined);

export function setAkassaSettings(db: Db, patch: Partial<AkassaSettings>): AkassaSettings {
  const next = { ...getAkassaSettings(db), ...patch };
  if (next.steps.some((s) => !(s.days > 0) || !(s.rate > 0 && s.rate <= 1))) {
    throw new Error("Varje nivå behöver ett antal dagar över noll och en andel mellan 0 och 1.");
  }
  if (!(next.daysPerMonth > 0)) throw new Error("Ersättningsdagar per månad ska vara fler än noll.");
  if (!(next.incomeCapOre > 0)) throw new Error("Taket ska vara ett antal öre över noll.");
  if (next.taxRate !== null && !(next.taxRate > 0 && next.taxRate <= 1)) throw new Error("Skattesatsen ska vara mellan 0 och 1, eller tom för lönespecarnas egen.");
  setSetting(db, AKASSA_KEY, next);
  return getAkassaSettings(db);
}

/**
 * The account the buffer stands on.
 *
 * Which one it is has to be said, not guessed from a name every time: the
 * savings account is the buffer and the current account is this month's
 * money, and an account can be renamed. Unset, the one that looks like a
 * savings account is suggested — once, as a starting point.
 */
export function getBufferAccount(db: Db): { id: number; name: string } | null {
  const banks = db.select().from(accounts).where(and(eq(accounts.kind, "bank"), eq(accounts.trackBalance, true))).all();
  const chosen = getSetting<number | null>(db, BUFFER_KEY, null);
  const row = chosen === null ? banks.find((a) => /spar/i.test(a.name)) : banks.find((a) => a.id === chosen);
  return row ? { id: row.id, name: row.name } : null;
}

export function setBufferAccount(db: Db, id: number | null): void {
  setSetting(db, BUFFER_KEY, id);
}

// ---------- What a month costs ----------

export interface MonthlyCost {
  variableOre: number;
  fixedOre: number;
  totalOre: number;
  /** The whole months the variable average was taken over. */
  from: string;
  to: string;
  months: number;
  fixedCount: number;
  /**
   * Fuel, kept out of the variable average and added back on its own.
   *
   * Where there are shifts entered, the forecast is what the month will cost
   * — and when the shifts stop, so does the fuel, without anyone having to
   * remember a setting. `source` says which of the two it is.
   */
  fuel: { ore: number; source: "forecast" | "spending"; shifts: number | null };
  /** Groceries only, my share, over the same months. */
  groceriesOre: number;
  /**
   * What a month costs when nothing is optional: the standing expenses and
   * the food, and nothing else. No fuel — the driving that was commuting
   * stops with the job.
   */
  essentialsOre: number;
}

/**
 * My share of the standing monthly expenses.
 *
 * The planned amount, not what happened to be charged: the question is what a
 * month costs from here on. A yearly charge is spread over twelve, a month
 * with its own amount uses it, and a shared expense counts half — the same
 * arithmetic as the cards at the top of Fasta utgifter.
 */
export function monthlyFixed(db: Db, today: string): { ore: number; count: number } {
  const expected = expectedAmounts(db);
  const month = monthOf(today);
  const rows = db.select().from(recurringExpenses).where(eq(recurringExpenses.paused, false)).all();
  let ore = 0;
  for (const e of rows) {
    const full = e.billingCycle === "yearly" ? Math.round(e.amount / 12) : expected(e, month);
    ore += e.shared ? Math.round(full / 2) : full;
  }
  return { ore, count: rows.length };
}

/**
 * My share of what a month costs: the variable spending averaged over whole
 * months, plus the standing expenses.
 *
 * Whole months only, so a half-finished September doesn't halve the average.
 * The variable rows already leave out everything tied to a fixed expense, so
 * nothing here is counted twice — and food and fuel are in the variable half,
 * never the estimates shown in Fasta utgifter, which exist only to be looked
 * at.
 *
 * Spending, not spending less what came back. An insurance payment or a
 * reimbursement made one month cheaper; it is no reason to expect the next
 * one to be. Flöde per månad nets them off, because that is what happened,
 * and writes out the difference so the two figures can be told apart.
 */
export function monthlyCost(db: Db, today: string, months = 3): MonthlyCost {
  const lastWhole = addMonths(monthOf(today), -1);
  const first = addMonths(lastWhole, -(months - 1));
  const from = `${first}-01`;
  const to = `${addMonths(lastWhole, 1)}-01`;

  // Fuel has a forecast of its own when there are shifts, and then it is
  // taken out of the average rather than counted twice — the same rule
  // Kassaflödet follows.
  const estimate = expenseEstimates(db, today).fuel;
  const forecast = estimate.source === "forecast" && estimate.mine !== null ? { ore: estimate.mine, shifts: estimate.shifts } : null;
  const fuelCategory = getFuelSettings(db).fuelCategoryId;
  const groceries = categoryIdByKey(db, "groceries") ?? null;
  const children = new Map(db.select({ id: categories.id, parentId: categories.parentId }).from(categories).all().map((c) => [c.id, c.parentId]));
  const under = (categoryId: number | null, top: number | null) =>
    top !== null && categoryId !== null && (categoryId === top || children.get(categoryId) === top);

  const rows = variableRows(db, from, to, "mine").filter((r) => r.amount < 0 && r.bookingDate < to);
  let spent = 0;
  let fuelSpent = 0;
  let groceriesSpent = 0;
  for (const r of rows) {
    for (const part of r.parts) {
      const ore = -part.amount;
      if (under(part.categoryId, fuelCategory)) {
        fuelSpent += ore;
        // Left out of the average when a forecast will speak for it.
        if (forecast) continue;
      }
      if (under(part.categoryId, groceries)) groceriesSpent += ore;
      spent += ore;
    }
  }

  const variableOre = Math.round(spent / months) + (forecast?.ore ?? 0);
  const fixed = monthlyFixed(db, today);
  const groceriesOre = Math.round(groceriesSpent / months);
  return {
    variableOre,
    fixedOre: fixed.ore,
    totalOre: variableOre + fixed.ore,
    from,
    to: `${lastWhole}-31`,
    months,
    fixedCount: fixed.count,
    fuel: forecast ? { ore: forecast.ore, source: "forecast", shifts: forecast.shifts } : { ore: Math.round(fuelSpent / months), source: "spending", shifts: null },
    groceriesOre,
    essentialsOre: fixed.ore + groceriesOre,
  };
}

// ---------- The unemployment insurance ----------

export interface Akassa {
  /** The average gross salary the benefit is worked out from. */
  grossOre: number;
  payslips: number;
  /** What the insurance counts: the average, or the ceiling when it is lower. */
  qualifyingOre: number;
  cappedByCeiling: boolean;
  taxRate: number;
  taxFromPayslips: boolean;
  /** Per step: the days, the rate, and what a whole month of it pays after tax. */
  steps: { days: number; rate: number; monthlyNetOre: number }[];
  totalDays: number;
  /** The benefit days as months, at five days a week. */
  months: number;
}

/** The rate the payslips actually show: tax over gross, across all of them. */
export function payslipTaxRate(db: Db): number | null {
  const rows = db.select({ gross: payslips.gross, tax: payslips.tax }).from(payslips).all();
  const gross = rows.reduce((s, r) => s + r.gross, 0);
  if (gross <= 0) return null;
  return rows.reduce((s, r) => s + r.tax, 0) / gross;
}

/**
 * What the insurance would pay, month by month.
 *
 * Null when there is no payslip to work it out from: a benefit guessed from
 * nothing is worse than a level the interface admits it can't reach.
 */
export function akassa(db: Db, today: string, settings = getAkassaSettings(db)): Akassa | null {
  const since = `${addMonths(monthOf(today), -settings.incomeMonths)}-01`;
  const rows = db
    .select({ gross: payslips.gross, payDate: payslips.payDate })
    .from(payslips)
    .all()
    .filter((p) => p.payDate >= since && p.payDate <= today);
  if (rows.length === 0) return null;

  const grossOre = Math.round(rows.reduce((s, r) => s + r.gross, 0) / rows.length);
  const qualifyingOre = Math.min(grossOre, settings.incomeCapOre);
  const fromPayslips = settings.taxRate === null;
  const taxRate = settings.taxRate ?? payslipTaxRate(db) ?? 0;

  const steps = settings.steps.map((s) => ({
    days: s.days,
    rate: s.rate,
    // A whole month at this level: the qualifying income times the rate, less
    // preliminary tax. The benefit is taxed like a salary, and an untaxed
    // figure compared with expenses paid in net kronor would flatter every
    // month that follows.
    monthlyNetOre: Math.round(qualifyingOre * s.rate * (1 - taxRate)),
  }));
  const totalDays = steps.reduce((s, x) => s + x.days, 0);

  return {
    grossOre,
    payslips: rows.length,
    qualifyingOre,
    cappedByCeiling: grossOre > settings.incomeCapOre,
    taxRate,
    taxFromPayslips: fromPayslips,
    steps,
    totalDays,
    months: totalDays / settings.daysPerMonth,
  };
}

// ---------- How long it lasts ----------

export interface Level {
  /** Months, or null when it can't be worked out. */
  months: number | null;
  /** Why not, when it is null. */
  missing: string | null;
  /** The arithmetic, spelled out. */
  formula: string;
  /** Of those months, how many the insurance is paying for. */
  akassaMonths?: number;
}

/** The three levels at one rate of spending. */
export interface Levels {
  /** What a month costs at this rate. */
  monthlyOre: number;
  buffer: Level;
  withSavings: Level;
  withAkassa: Level;
}

export interface Endurance {
  on: string;
  cost: MonthlyCost;
  /**
   * bufferOre: the buffer account's balance. cash: the cash on the trade
   * accounts (Avanza), which can be moved any day and so counts as buffer.
   * portfolioOre: the securities only.
   *
   * liquidOre, what the buffer is: Kvar vid månadsskiftet (the cash flow's
   * balance when this month's bills are paid, the cash on Avanza in it), not
   * today's balance — the day before the salary the account is at its
   * emptiest, and that says nothing about what is over. Without a forecast,
   * the buffer account and the cash.
   */
  capital: {
    liquidOre: number;
    monthStart: { date: string; balance: number } | null;
    bufferOre: number;
    bufferAccount: { id: number; name: string } | null;
    cash: { account: string; name: string; ore: number; date: string }[];
    /** Moved to Avanza after the cash was entered (net); in cashOre. */
    deposited: { ore: number; since: string | null };
    /** The cash on Avanza: entered plus moved there since (liquidCash). */
    cashOre: number;
    portfolioOre: number;
  };
  akassa: Akassa | null;
  /** At the rate of the last three months: what is actually being spent. */
  current: Levels;
  /**
   * Fixed expenses and groceries, nothing else.
   *
   * A different question from the one above, and the one that matters when
   * the income stops: not what is spent out of habit, but what would still
   * have to be. No fuel in it — the driving that was commuting ends with the
   * job.
   */
  essential: Levels;
}

const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
const months1 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 1 });

/** A capital divided by what a month costs, with the division written out. */
const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/**
 * 'Swedbank e-sparkonto 790 kr + likvida på ISK 12 480 kr (18/9) + insatt
 * sedan dess 2 000 kr': what the buffer is made of.
 */
export function bufferParts(
  account: { name: string } | null,
  accountOre: number,
  cash: { name: string; ore: number; date: string }[],
  deposited: { ore: number; since: string | null } = { ore: 0, since: null },
): string {
  const parts = [...(account ? [`${account.name} ${kr(accountOre)}`] : []), ...cash.map((c) => `likvida på ${c.name} ${kr(c.ore)} (${dm(c.date)})`)].join(" + ");
  if (!deposited.ore || !deposited.since) return parts;
  const text = `${deposited.ore > 0 ? "insatt" : "uttaget"} på Avanza sedan ${dm(deposited.since)} ${kr(Math.abs(deposited.ore))}`;
  return parts ? `${parts} ${deposited.ore > 0 ? "+" : "−"} ${text}` : text;
}

/** 'kvar vid månadsskiftet 1/10 19 123 kr (varav 4 260 kr på ISK)'. */
export function monthStartParts(start: { date: string; balance: number }, cashOre: number): string {
  return `kvar vid månadsskiftet ${dm(start.date)} ${kr(start.balance)}${cashOre ? ` (varav ${kr(cashOre)} på ISK)` : ""}`;
}

function divide(capitalOre: number, costOre: number, text: string): Level {
  if (costOre <= 0) return { months: null, missing: "Ingen månadsutgift att räkna på än.", formula: text };
  return { months: capitalOre / costOre, missing: null, formula: `${text} = ${months1(capitalOre / costOre)} månader` };
}

/**
 * The third level: the capital drawn down month by month while the insurance
 * pays part of the way.
 *
 * A closed formula can't do it — the benefit steps down twice and stops
 * altogether after 300 days — so the months are counted one at a time until
 * what is left reaches zero, which is also how it is explained.
 */
export function withAkassaMonths(capitalOre: number, costOre: number, a: Akassa, daysPerMonth: number): { months: number; akassaMonths: number } | null {
  if (costOre <= 0) return null;
  const remaining = a.steps.map((s) => ({ ...s, left: s.days }));
  let capital = capitalOre;
  let months = 0;
  let paidMonths = 0;
  // Twelve hundred months is a hundred years: long enough to mean 'never runs
  // out', short enough not to be a loop with no way out.
  for (let i = 0; i < 1200; i++) {
    let days = daysPerMonth;
    let income = 0;
    for (const step of remaining) {
      if (days <= 0 || step.left <= 0) continue;
      const use = Math.min(days, step.left);
      income += Math.round((step.monthlyNetOre / daysPerMonth) * use);
      step.left -= use;
      days -= use;
    }
    if (income > 0) paidMonths += (daysPerMonth - days) / daysPerMonth;
    const change = income - costOre;
    if (change >= 0) {
      months += 1;
      capital += change;
      continue;
    }
    if (capital + change <= 0) return { months: months + capital / -change, akassaMonths: paidMonths };
    capital += change;
    months += 1;
  }
  return null;
}

export function endurance(db: Db, today: string): Endurance {
  const cost = monthlyCost(db, today);
  const settings = getAkassaSettings(db);
  const bufferAccount = getBufferAccount(db);
  const bufferOre = bufferAccount ? (db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, bufferAccount.id)).get()?.balance ?? 0) : 0;
  const portfolio = valuePortfolio(db, today);
  const portfolioOre = portfolio.accounts.reduce((s, a) => s + a.securitiesOre, 0);
  const liquid = liquidCash(db, today);
  const cash = liquid.accounts;
  const cashOre = liquid.totalOre;
  const deposited = { ore: liquid.depositedOre, since: liquid.since };
  const start = monthStart(db, today);
  const liquidOre = start ? Math.max(0, start.balance) : bufferOre + cashOre;
  const a = akassa(db, today, settings);
  const parts = start ? monthStartParts(start, cashOre) : bufferParts(bufferAccount, bufferOre, cash, deposited);

  const levels = (monthlyOre: number): Levels => {
    const buffer =
      start || bufferAccount || cash.length || deposited.ore > 0
        ? divide(liquidOre, monthlyOre, `${!start && (parts.includes(" + ") || parts.includes(" − ")) ? `(${parts})` : parts} ÷ ${kr(monthlyOre)}/mån`)
        : { months: null, missing: "Inget buffertkonto är valt i Inställningar.", formula: "" };
    const withSavings = divide(liquidOre + portfolioOre, monthlyOre, `(${kr(liquidOre)} + ${kr(portfolioOre)}) ÷ ${kr(monthlyOre)}/mån`);

    let withAkassa: Level;
    if (!a) {
      withAkassa = { months: null, missing: "Ingen lönespec att räkna ersättningsgrundande inkomst från.", formula: "" };
    } else {
      const run = withAkassaMonths(liquidOre + portfolioOre, monthlyOre, a, settings.daysPerMonth);
      const steps = a.steps.map((s) => `${Math.round(s.rate * 100)} % i ${s.days} dagar`).join(", ");
      const formula = `${kr(a.qualifyingOre)}/mån ${a.cappedByCeiling ? "(taket)" : "i snitt"}, ${steps}, minus ${Math.round(a.taxRate * 1000) / 10} % skatt — ${kr(liquidOre + portfolioOre)} räcker tills det tar slut`;
      withAkassa = run
        ? { months: run.months, missing: null, formula: `${formula} = ${months1(run.months)} månader`, akassaMonths: run.akassaMonths }
        : { months: null, missing: "Ersättningen täcker utgifterna — kapitalet tar inte slut.", formula };
    }
    return { monthlyOre, buffer, withSavings, withAkassa };
  };

  return {
    on: today,
    cost,
    capital: { liquidOre, monthStart: start ? { date: start.date, balance: start.balance } : null, bufferOre, bufferAccount, cash, cashOre, deposited, portfolioOre },
    akassa: a,
    current: levels(cost.totalOre),
    essential: levels(cost.essentialsOre),
  };
}
