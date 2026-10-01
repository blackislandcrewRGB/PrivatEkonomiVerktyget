import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { taxReturnsByYear } from "../taxReturns/taxReturns.js";
import type { Db } from "../db/client.js";
import { FUND_REGIONS, payslips, pensionEntries, pensionForecasts, pensionFunds, pensionStatements, type PensionEntry, type PensionFund } from "../db/schema.js";
import { addMonths, monthOf } from "../overview/dates.js";
import { getSetting, setSetting } from "../settings.js";

/**
 * Långsiktigt: pensionen, låst till 65+.
 *
 * Written down by hand from minpension.se, once a year or so. Nothing is
 * fetched: there is no public price source for an occupational pension, and a
 * figure made to look fresh would be worse than one that says how old it is.
 * So every row carries the day it was true and the interface shows the oldest
 * of them.
 *
 * It is shown and never counted. Not in the net worth, not in how long the
 * money would last — it cannot be spent for decades, and mixing it in would
 * answer a question nobody asked with a number nobody can use.
 *
 * Nothing here assumes a return either. The only thing said about the future
 * is what is being paid in, because that is the one part that is known.
 */

export type Region = (typeof FUND_REGIONS)[number];

export interface PensionFundInput {
  fundName: string;
  amountOre: number;
  unitsE4: number;
  navOre: number;
  valueDate: string;
  feePctE4?: number | null;
  region: Region;
}

export interface PensionEntryInput {
  kind: PensionEntry["kind"];
  provider: string;
  name: string;
  amountOre: number;
  valueDate: string;
  placeable?: boolean;
  status?: PensionEntry["status"];
  monthlyPremiumOre?: number | null;
  premiumDate?: string | null;
  payoutFromAge?: number | null;
  note?: string | null;
  funds?: PensionFundInput[];
}

export class PensionError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

function checkEntry(input: Pick<PensionEntryInput, "amountOre" | "valueDate" | "name" | "provider">): void {
  if (!Number.isInteger(input.amountOre) || input.amountOre < 0) throw new PensionError("Beloppet ska vara ett antal öre, 0 eller mer.");
  if (!DATE.test(input.valueDate)) throw new PensionError("Värdedatumet ska vara ÅÅÅÅ-MM-DD.");
  if (!input.name.trim() || !input.provider.trim()) throw new PensionError("Posten behöver både förvaltare och namn.");
}

function checkFund(f: PensionFundInput): void {
  if (!Number.isInteger(f.amountOre) || f.amountOre < 0) throw new PensionError(`${f.fundName}: beloppet ska vara ett antal öre.`);
  if (!Number.isInteger(f.unitsE4) || f.unitsE4 <= 0) throw new PensionError(`${f.fundName}: antalet andelar ska vara fler än noll.`);
  if (!Number.isInteger(f.navOre) || f.navOre <= 0) throw new PensionError(`${f.fundName}: andelskursen ska vara över noll.`);
  if (!DATE.test(f.valueDate)) throw new PensionError(`${f.fundName}: värdedatumet ska vara ÅÅÅÅ-MM-DD.`);
  if (!FUND_REGIONS.includes(f.region)) throw new PensionError(`${f.fundName}: '${f.region}' är ingen känd region.`);
}

// ---------- Reading and writing ----------

export interface PensionEntryWithFunds extends PensionEntry {
  funds: PensionFund[];
}

export function listPensions(db: Db): PensionEntryWithFunds[] {
  const entries = db.select().from(pensionEntries).where(isNull(pensionEntries.deletedAt)).orderBy(asc(pensionEntries.id)).all();
  const funds = db.select().from(pensionFunds).orderBy(asc(pensionFunds.id)).all();
  return entries.map((e) => ({ ...e, funds: funds.filter((f) => f.entryId === e.id) }));
}

export function createPension(db: Db, input: PensionEntryInput): PensionEntryWithFunds {
  checkEntry(input);
  for (const f of input.funds ?? []) checkFund(f);
  return db.transaction((tx) => {
    const entry = tx
      .insert(pensionEntries)
      .values({
        kind: input.kind,
        provider: input.provider.trim(),
        name: input.name.trim(),
        amountOre: input.amountOre,
        valueDate: input.valueDate,
        placeable: input.placeable ?? false,
        status: input.status ?? "active",
        monthlyPremiumOre: input.monthlyPremiumOre ?? null,
        premiumDate: clean(input.premiumDate),
        payoutFromAge: input.payoutFromAge ?? null,
        note: clean(input.note),
      })
      .returning()
      .get();
    for (const f of input.funds ?? []) {
      tx.insert(pensionFunds)
        .values({ entryId: entry.id, fundName: f.fundName.trim(), amountOre: f.amountOre, unitsE4: f.unitsE4, navOre: f.navOre, valueDate: f.valueDate, feePctE4: f.feePctE4 ?? null, region: f.region })
        .run();
    }
    return { ...entry, funds: tx.select().from(pensionFunds).where(eq(pensionFunds.entryId, entry.id)).all() };
  });
}

/** A yearly update: the amount, the day it was true, and the funds as they stand. */
export function updatePension(db: Db, id: number, patch: Partial<PensionEntryInput>): PensionEntryWithFunds {
  const row = db.select().from(pensionEntries).where(eq(pensionEntries.id, id)).get();
  if (!row || row.deletedAt) throw new PensionError("Pensionsposten finns inte.");
  const next = { ...row, ...patch };
  checkEntry(next);
  for (const f of patch.funds ?? []) checkFund(f);

  return db.transaction((tx) => {
    const entry = tx
      .update(pensionEntries)
      .set({
        provider: next.provider.trim(),
        name: next.name.trim(),
        amountOre: next.amountOre,
        valueDate: next.valueDate,
        placeable: next.placeable,
        status: next.status,
        monthlyPremiumOre: next.monthlyPremiumOre ?? null,
        premiumDate: clean(next.premiumDate),
        payoutFromAge: next.payoutFromAge ?? null,
        note: clean(next.note),
        updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      })
      .where(eq(pensionEntries.id, id))
      .returning()
      .get();
    // The funds are given whole or not at all: a statement lists what is held
    // now, and merging it row by row would leave a fund that was sold behind.
    if (patch.funds) {
      tx.delete(pensionFunds).where(eq(pensionFunds.entryId, id)).run();
      for (const f of patch.funds) {
        tx.insert(pensionFunds)
          .values({ entryId: id, fundName: f.fundName.trim(), amountOre: f.amountOre, unitsE4: f.unitsE4, navOre: f.navOre, valueDate: f.valueDate, feePctE4: f.feePctE4 ?? null, region: f.region })
          .run();
      }
    }
    return { ...entry, funds: tx.select().from(pensionFunds).where(eq(pensionFunds.entryId, id)).all() };
  });
}

export function deletePension(db: Db, id: number): boolean {
  const r = db
    .update(pensionEntries)
    .set({ deletedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
    .where(eq(pensionEntries.id, id))
    .returning()
    .all();
  return r.length > 0;
}

// ---------- What it adds up to ----------

export interface RegionShare {
  region: Region;
  amountOre: number;
  share: number;
}

export interface PensionOverview {
  entries: PensionEntryWithFunds[];
  totalOre: number;
  /** Where the funds are chosen, and where they are not. */
  placeableOre: number;
  fixedOre: number;
  /** What is being paid in a month, from the active entries. No assumed return. */
  monthlyPremiumOre: number;
  /** The placeable capital by region, largest first. */
  regions: RegionShare[];
  /** The oldest figure behind the total, and how many months old it is. */
  oldestValueDate: string | null;
  oldestMonths: number | null;
  /** Rows whose value is over a year old. */
  stale: { id: number; name: string; valueDate: string }[];
  /** Neutral observations about the mix, never warnings. */
  notes: string[];
  /** What the salary sets aside each month (null: no payslip to work it out from). */
  inflow: PensionInflow | null;
  /** Årsbeskeden entered, each beside the tool's own figure for the year. */
  statements: PensionStatementCheck[];
  /** minPension's forecasts, the newest per retirement age. */
  forecasts: PensionForecasts;
}

// ---------- What is set aside each month ----------

/**
 * The rules for the allmän pension and the SAF-LO agreement. Law and
 * collective agreement, not assumptions, so they are constants; the one
 * figure that changes every year — the income base amount — is a setting.
 */
export const PENSION_RULES = {
  /** Pensionsgrundande inkomst: the gross less the 7 % allmän pensionsavgift. */
  pensionableShare: 0.93,
  /** The pensionable income counts up to 7,5 income base amounts a year. */
  capBaseAmounts: 7.5,
  incomePensionRate: 0.16,
  premiumPensionRate: 0.025,
  /** SAF-LO: 4,5 % of the gross salary (below 7,5 income base amounts, which is where this salary is). */
  safLoRate: 0.045,
} as const;

export interface IncomeBaseAmount {
  year: number;
  amountOre: number;
  /** Where the figure comes from. */
  source: string;
}

export interface PensionSettings {
  /** Inkomstbasbeloppet per year, as the government sets it each November. */
  incomeBaseAmounts: IncomeBaseAmount[];
  /** How many months of payslips the gross is averaged over. */
  incomeMonths: number;
}

export const PENSION_DEFAULTS: PensionSettings = {
  // Regeringen 2025-11-06, confirmed against Pensionsmyndigheten's own
  // calculation (inkomstindex 228,08): 83 400 kr.
  incomeBaseAmounts: [{ year: 2026, amountOre: 8_340_000, source: "regeringsbeslut 6/11 2025" }],
  incomeMonths: 12,
};

const PENSION_KEY = "pension_settings";

export function getPensionSettings(db: Db): PensionSettings {
  const stored = getSetting<Partial<PensionSettings>>(db, PENSION_KEY, {});
  const amounts = Array.isArray(stored.incomeBaseAmounts) && stored.incomeBaseAmounts.length > 0 ? stored.incomeBaseAmounts : PENSION_DEFAULTS.incomeBaseAmounts;
  return {
    incomeBaseAmounts: [...amounts].sort((a, b) => a.year - b.year),
    incomeMonths: Number.isInteger(stored.incomeMonths) && stored.incomeMonths! > 0 ? stored.incomeMonths! : PENSION_DEFAULTS.incomeMonths,
  };
}

/** Sets one year's income base amount (adding or replacing it). */
export function setIncomeBaseAmount(db: Db, input: IncomeBaseAmount): PensionSettings {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new PensionError("Året ska vara ett årtal.");
  if (!Number.isInteger(input.amountOre) || input.amountOre < 1_000_000 || input.amountOre > 100_000_000) {
    throw new PensionError("Inkomstbasbeloppet ska vara ett belopp i öre, mellan 10 000 och 1 000 000 kr.");
  }
  const source = String(input.source ?? "").trim();
  if (!source) throw new PensionError("Skriv var beloppet kommer ifrån.");
  const current = getPensionSettings(db);
  setSetting(db, PENSION_KEY, {
    ...current,
    incomeBaseAmounts: [...current.incomeBaseAmounts.filter((a) => a.year !== input.year), { year: input.year, amountOre: input.amountOre, source }],
  });
  return getPensionSettings(db);
}

export interface PensionInflow {
  /** Average gross salary a month, and the payslips it is averaged over. */
  grossOre: number;
  payslips: number;
  from: string;
  to: string;
  /** The income base amount used, and the year it was asked for (they differ when this year's isn't entered). */
  baseAmount: IncomeBaseAmount;
  forYear: number;
  /** The yearly ceiling on the pensionable income, and whether it was reached. */
  capOre: number;
  capped: boolean;
  /** Pensionable income a month: gross × 0,93, up to the ceiling. */
  pensionableOre: number;
  incomePensionOre: number;
  premiumPensionOre: number;
  safLoOre: number;
  totalOre: number;
  /** The SAF-LO premium last written down from the insurer, to compare with. */
  safLoLatest: { amountOre: number; date: string | null } | null;
  /** Where new premium pension money goes: the funds held today. */
  premiumFunds: string[];
}

/**
 * What is set aside for the pension each month, worked out from the salary.
 *
 * The allmän pension is credited once a year, in December the year after;
 * SAF-LO is paid in month by month. Nothing is assumed about a return: this
 * is what goes in, not what it will become. Null without a payslip in the
 * period — a contribution worked out from nothing is not one.
 */
export function pensionInflow(db: Db, today: string, settings = getPensionSettings(db)): PensionInflow | null {
  const since = `${addMonths(monthOf(today), -settings.incomeMonths)}-01`;
  const rows = db
    .select({ gross: payslips.gross, payDate: payslips.payDate })
    .from(payslips)
    .all()
    .filter((p) => p.payDate >= since && p.payDate <= today)
    .sort((a, b) => a.payDate.localeCompare(b.payDate));
  if (rows.length === 0) return null;

  const forYear = Number(today.slice(0, 4));
  const baseAmount = baseAmountFor(settings, forYear);

  const R = PENSION_RULES;
  const grossOre = Math.round(rows.reduce((s, r) => s + r.gross, 0) / rows.length);
  const capOre = Math.round(baseAmount.amountOre * R.capBaseAmounts);
  const yearly = Math.round(grossOre * 12 * R.pensionableShare);
  const pensionableYear = Math.min(yearly, capOre);
  const incomePensionOre = Math.round((pensionableYear * R.incomePensionRate) / 12);
  const premiumPensionOre = Math.round((pensionableYear * R.premiumPensionRate) / 12);
  const safLoOre = Math.round(grossOre * R.safLoRate);

  const entries = listPensions(db).filter((e) => e.status === "active");
  const safLo = entries.find((e) => e.kind === "occupational" && e.monthlyPremiumOre);
  const premium = entries.find((e) => e.kind === "premium_pension");

  return {
    grossOre,
    payslips: rows.length,
    from: rows[0].payDate,
    to: rows.at(-1)!.payDate,
    baseAmount,
    forYear,
    capOre,
    capped: yearly > capOre,
    pensionableOre: Math.round(pensionableYear / 12),
    incomePensionOre,
    premiumPensionOre,
    safLoOre,
    totalOre: incomePensionOre + premiumPensionOre + safLoOre,
    safLoLatest: safLo ? { amountOre: safLo.monthlyPremiumOre!, date: safLo.premiumDate } : null,
    premiumFunds: premium?.funds.map((f) => f.fundName) ?? [],
  };
}

// ---------- Årsbesked ----------

export interface PensionStatementInput {
  year: number;
  pensionableIncomeOre: number;
  incomePensionRightOre: number;
  premiumPensionRightOre: number;
}

export type PensionStatement = typeof pensionStatements.$inferSelect;

/** One per income year: entering a year again corrects it. */
export function savePensionStatement(db: Db, input: PensionStatementInput): PensionStatement {
  if (!Number.isInteger(input.year) || input.year < 1960 || input.year > 2100) throw new PensionError("Året ska vara inkomståret beskedet gäller, till exempel 2025.");
  const amounts = [input.pensionableIncomeOre, input.incomePensionRightOre, input.premiumPensionRightOre];
  if (amounts.some((a) => !Number.isInteger(a) || a < 0)) throw new PensionError("Beloppen ska vara ett antal öre, noll eller mer.");
  if (input.incomePensionRightOre + input.premiumPensionRightOre > input.pensionableIncomeOre) {
    throw new PensionError("Pensionsrätterna kan inte vara större än den pensionsgrundande inkomsten. Står beloppen i rätt fält?");
  }
  const values = {
    year: input.year,
    pensionableIncomeOre: input.pensionableIncomeOre,
    incomePensionRightOre: input.incomePensionRightOre,
    premiumPensionRightOre: input.premiumPensionRightOre,
    source: "orange_envelope" as const,
  };
  return db
    .insert(pensionStatements)
    .values(values)
    .onConflictDoUpdate({ target: pensionStatements.year, set: { ...values, enteredAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` } })
    .returning()
    .get();
}

export function deletePensionStatement(db: Db, id: number): boolean {
  return db.delete(pensionStatements).where(eq(pensionStatements.id, id)).run().changes > 0;
}

/** The income base amount for a year: its own, else the nearest earlier one entered, else the earliest. */
function baseAmountFor(settings: PensionSettings, year: number): IncomeBaseAmount {
  const amounts = settings.incomeBaseAmounts;
  return [...amounts].reverse().find((a) => a.year <= year) ?? amounts[0];
}

export interface PensionYearComputed {
  year: number;
  /** Payslips paid out in the year, and their gross together. */
  payslips: number;
  grossOre: number;
  pensionableIncomeOre: number;
  incomePensionRightOre: number;
  premiumPensionRightOre: number;
  capped: boolean;
  baseAmount: IncomeBaseAmount;
}

/**
 * What the tool makes of a year, by the same rules as the monthly inflow,
 * from the payslips paid out in it. Null when there are none: the envelope
 * then stands alone. A year with fewer than twelve says so through
 * `payslips`, and the difference is then expected.
 */
export function computedYear(db: Db, year: number, settings = getPensionSettings(db)): PensionYearComputed | null {
  const rows = db
    .select({ gross: payslips.gross, payDate: payslips.payDate })
    .from(payslips)
    .all()
    .filter((p) => p.payDate.startsWith(`${year}-`));
  if (rows.length === 0) return null;
  const R = PENSION_RULES;
  const baseAmount = baseAmountFor(settings, year);
  const grossOre = rows.reduce((s, r) => s + r.gross, 0);
  const cap = Math.round(baseAmount.amountOre * R.capBaseAmounts);
  const uncapped = Math.round(grossOre * R.pensionableShare);
  const pensionableIncomeOre = Math.min(uncapped, cap);
  return {
    year,
    payslips: rows.length,
    grossOre,
    pensionableIncomeOre,
    incomePensionRightOre: Math.round(pensionableIncomeOre * R.incomePensionRate),
    premiumPensionRightOre: Math.round(pensionableIncomeOre * R.premiumPensionRate),
    capped: uncapped > cap,
    baseAmount,
  };
}

/** The pensionable income a salary gives: less the general pension fee (× 0,93), at most 7,5 income base amounts. */
export function declaredPensionable(salaryOre: number, baseAmountOre: number): number {
  return Math.min(Math.round(salaryOre * PENSION_RULES.pensionableShare), Math.round(baseAmountOre * PENSION_RULES.capBaseAmounts));
}

export interface PensionStatementCheck {
  statement: PensionStatement;
  computed: PensionYearComputed | null;
  /** The envelope less the tool, per figure (null: nothing computed). */
  diff: { pensionableIncomeOre: number; incomePensionRightOre: number; premiumPensionRightOre: number } | null;
  /**
   * The salary declared for the year (1.1), the pensionable income it gives by
   * the same rule (× 0,93, capped) and the envelope's PGI less that; null
   * without a tax return for the year.
   */
  declared: { employmentIncomeOre: number; pensionableIncomeOre: number; diffOre: number } | null;
}

/** The envelopes entered, newest year first, each beside what the tool computes for the same year. */
export function pensionStatementChecks(db: Db): PensionStatementCheck[] {
  const settings = getPensionSettings(db);
  const returns = taxReturnsByYear(db);
  return db
    .select()
    .from(pensionStatements)
    .orderBy(desc(pensionStatements.year))
    .all()
    .map((statement) => {
      const computed = computedYear(db, statement.year, settings);
      const salary = returns.get(statement.year)?.boxes.employmentIncome ?? null;
      const declaredPgi = salary === null ? null : declaredPensionable(salary, baseAmountFor(settings, statement.year).amountOre);
      return {
        statement,
        computed,
        diff: computed && {
          pensionableIncomeOre: statement.pensionableIncomeOre - computed.pensionableIncomeOre,
          incomePensionRightOre: statement.incomePensionRightOre - computed.incomePensionRightOre,
          premiumPensionRightOre: statement.premiumPensionRightOre - computed.premiumPensionRightOre,
        },
        declared:
          salary === null || declaredPgi === null
            ? null
            : { employmentIncomeOre: salary, pensionableIncomeOre: declaredPgi, diffOre: statement.pensionableIncomeOre - declaredPgi },
      };
    });
}

// ---------- Prognos från minPension ----------

export interface PensionForecastInput {
  madeOn: string;
  retirementAge: number;
  monthlyPensionOre: number;
  assumptions: string;
  note?: string | null;
}

export type PensionForecast = typeof pensionForecasts.$inferSelect;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A forecast as minPension showed it. Nothing is computed from it — the
 * figure and its assumptions are minPension's, and they are stored so that
 * both can be shown side by side. One per day and age: entering it again
 * corrects it.
 */
export function savePensionForecast(db: Db, input: PensionForecastInput): PensionForecast {
  if (!ISO_DATE.test(input.madeOn ?? "")) throw new PensionError("Datum ska vara ÅÅÅÅ-MM-DD: dagen prognosen gjordes.");
  if (!Number.isInteger(input.retirementAge) || input.retirementAge < 55 || input.retirementAge > 80) throw new PensionError("Uttagsåldern ska vara ett helt antal år, 55–80.");
  if (!Number.isInteger(input.monthlyPensionOre) || input.monthlyPensionOre <= 0) throw new PensionError("Pensionen ska vara ett belopp i öre per månad, mer än noll.");
  const assumptions = String(input.assumptions ?? "").trim();
  if (!assumptions) throw new PensionError("Skriv antagandena prognosen bygger på, som minPension anger dem (avkastning, löneutveckling).");
  const values = { madeOn: input.madeOn, retirementAge: input.retirementAge, monthlyPensionOre: input.monthlyPensionOre, assumptions, note: input.note?.trim() || null };
  return db
    .insert(pensionForecasts)
    .values(values)
    .onConflictDoUpdate({ target: [pensionForecasts.madeOn, pensionForecasts.retirementAge], set: values })
    .returning()
    .get();
}

export function deletePensionForecast(db: Db, id: number): boolean {
  return db.delete(pensionForecasts).where(eq(pensionForecasts.id, id)).run().changes > 0;
}

export interface PensionForecasts {
  /** The newest forecast for each retirement age, youngest age first. */
  latest: (PensionForecast & { monthsOld: number })[];
  /** The newest forecast of all, when it is a year old or more (null: fresh, or none). */
  stale: { madeOn: string; monthsOld: number } | null;
}

export function pensionForecastsView(db: Db, today: string): PensionForecasts {
  const byAge = new Map<number, PensionForecast>();
  for (const f of db.select().from(pensionForecasts).orderBy(desc(pensionForecasts.madeOn)).all()) {
    if (!byAge.has(f.retirementAge)) byAge.set(f.retirementAge, f);
  }
  const latest = [...byAge.values()].sort((a, b) => a.retirementAge - b.retirementAge).map((f) => ({ ...f, monthsOld: monthsBetween(f.madeOn, today) }));
  const newest = latest.map((f) => f.madeOn).sort().at(-1) ?? null;
  const monthsOld = newest ? monthsBetween(newest, today) : null;
  return { latest, stale: newest && monthsOld !== null && monthsOld >= STALE_MONTHS ? { madeOn: newest, monthsOld } : null };
}

/** Whole months between two days, for saying how old a figure is. */
export function monthsBetween(from: string, to: string): number {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  return Number(to.slice(8, 10)) < Number(from.slice(8, 10)) ? months - 1 : months;
}

/** A value older than this is worth being reminded about. */
export const STALE_MONTHS = 12;

export function pensionOverview(db: Db, today: string): PensionOverview {
  const entries = listPensions(db);
  const totalOre = entries.reduce((s, e) => s + e.amountOre, 0);
  const placeableOre = entries.filter((e) => e.placeable).reduce((s, e) => s + e.amountOre, 0);
  const monthlyPremiumOre = entries.filter((e) => e.status === "active").reduce((s, e) => s + (e.monthlyPremiumOre ?? 0), 0);

  // The regions are worked out from the funds of the placeable entries only:
  // where the funds are not chosen, the region is nobody's decision.
  const byRegion = new Map<Region, number>();
  for (const e of entries.filter((x) => x.placeable)) {
    for (const f of e.funds) byRegion.set(f.region, (byRegion.get(f.region) ?? 0) + f.amountOre);
  }
  const placed = [...byRegion.values()].reduce((s, v) => s + v, 0);
  const regions = [...byRegion.entries()]
    .map(([region, amountOre]) => ({ region, amountOre, share: placed > 0 ? amountOre / placed : 0 }))
    .sort((a, b) => b.amountOre - a.amountOre);

  const dates = entries.flatMap((e) => [e.valueDate, ...e.funds.map((f) => f.valueDate)]).sort();
  const oldestValueDate = dates[0] ?? null;
  const stale = entries.filter((e) => monthsBetween(e.valueDate, today) >= STALE_MONTHS).map((e) => ({ id: e.id, name: `${e.provider} – ${e.name}`, valueDate: e.valueDate }));

  // Neutral, not a warning: a tilt is worth naming, and what to do about a
  // pension fund is not a thing this tool decides.
  const notes: string[] = [];
  const usa = entries.find((e) => e.kind === "premium_pension" && e.funds.some((f) => f.region === "usa"));
  if (usa) notes.push("USA-fonden i premiepensionen är en avvikelse från policyns marknadsvikt.");

  return {
    entries,
    totalOre,
    placeableOre,
    fixedOre: totalOre - placeableOre,
    monthlyPremiumOre,
    regions,
    oldestValueDate,
    oldestMonths: oldestValueDate ? monthsBetween(oldestValueDate, today) : null,
    stale,
    notes,
    inflow: pensionInflow(db, today),
    statements: pensionStatementChecks(db),
    forecasts: pensionForecastsView(db, today),
  };
}

// ---------- What is written down today ----------

/**
 * Example pensions, in the shape minpension.se shows them: the state's
 * income and premium pension and an occupational one. Not seeded into a new
 * database (the figures are nobody's): the demo data and the tests use them,
 * and the household enters its own under Pension. A row that has been deleted
 * does not come back.
 */
export function seedPensions(db: Db): number {
  if (db.select({ id: pensionEntries.id }).from(pensionEntries).all().length > 0) return 0;
  const seeds: PensionEntryInput[] = [
    {
      kind: "income_pension",
      provider: "Pensionsmyndigheten",
      name: "Inkomstpension",
      amountOre: 30_000_000,
      valueDate: "2025-11-28",
      placeable: false,
      status: "active",
      note: "Intjänad pensionsrätt.",
    },
    {
      kind: "premium_pension",
      provider: "Pensionsmyndigheten",
      name: "Premiepension",
      amountOre: 10_000_000,
      valueDate: "2026-09-17",
      placeable: true,
      status: "active",
      payoutFromAge: 66,
      funds: [{ fundName: "Exempelfond USA Index", amountOre: 10_000_000, unitsE4: 1_000_000, navOre: 100_000, valueDate: "2026-09-17", feePctE4: 1_200, region: "usa" }],
    },
    {
      kind: "occupational",
      provider: "Exempelbolaget Pension",
      name: "Tjänstepension, fondförsäkring",
      amountOre: 8_000_000,
      valueDate: "2026-08-21",
      placeable: true,
      status: "active",
      monthlyPremiumOre: 100_000,
      premiumDate: "2026-07-22",
      payoutFromAge: 65,
      note: "Inbetalning pågår sedan 2024-12-11.",
      funds: [
        { fundName: "Exempelfond Global Index", amountOre: 6_000_000, unitsE4: 1_000_000, navOre: 60_000, valueDate: "2026-08-20", region: "global" },
        { fundName: "Exempelfond Sverige Index", amountOre: 2_000_000, unitsE4: 250_000, navOre: 80_000, valueDate: "2026-08-20", region: "sweden" },
      ],
    },
    {
      kind: "occupational",
      provider: "Exempelbolaget Pension",
      name: "Traditionell försäkring, stängd",
      amountOre: 300_000,
      valueDate: "2026-09-17",
      placeable: false,
      status: "closed",
      payoutFromAge: 70,
      note: "Engångsutbetalning vid 70 år.",
    },
  ];
  for (const seed of seeds) createPension(db, seed);
  return seeds.length;
}
