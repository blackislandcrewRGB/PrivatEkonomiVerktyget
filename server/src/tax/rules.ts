import type { Db } from "../db/client.js";
import { getSetting, setSetting } from "../settings.js";

/**
 * The rules for the final tax on salary and capital, per income year.
 *
 * The amounts and the job tax credit's coefficients are Skatteverket's, from
 * the year's technical description (SKV 433) and 'Belopp och procent'. The
 * municipal, regional, burial and church rates depend on where one was
 * registered on 1 November the year before, so they are entered per year
 * (Skatteverket's 'Skattesatser kommuner <år>'), with their source.
 */

export class TaxRuleError extends Error {}

export interface JobTaxCredit {
  /** × (AI − 0,91 PBB) between 0,91 and 3,24 PBB. */
  lowRate: number;
  /** Between 3,24 and 8,08 PBB: midBase PBB + midRate × (AI − 3,24 PBB). */
  midBase: number;
  midRate: number;
  /** Above 8,08 PBB. */
  top: number;
  /** A taper above a limit (2024: 3 % of AI over 13,54 PBB); none from 2025. */
  taper: { fromPbb: number; rate: number } | null;
}

export interface TaxYearRules {
  year: number;
  /** Prisbasbelopp and inkomstbasbelopp, öre. */
  pbbOre: number;
  ibbOre: number;
  /** Skiktgräns for the state income tax, öre. */
  stateThresholdOre: number;
  /** The public service fee's ceiling: 1 % of this many IBB. */
  publicServiceIbb: number;
  jobTaxCredit: JobTaxCredit;
  /** Where the amounts come from. */
  source: string;
  /** Percent (18,25 = 18.25); null until entered. Church 0 when not a member. */
  municipalPct: number | null;
  regionPct: number | null;
  burialPct: number | null;
  churchPct: number | null;
  ratesSource: string;
}

/** The same every year since 2021: the basic deduction's brackets, the fees and the capital tax. */
export const TAX_CONSTANTS = {
  stateRate: 0.2,
  /** The state tax is taken when the base is at least this much over the threshold (kr). */
  stateMinimumOver: 200,
  pensionFeeRate: 0.07,
  /** The pension fee's base is capped at 8,07 IBB, and not taken below 0,423 PBB. */
  pensionFeeCapIbb: 8.07,
  pensionFeeFloorPbb: 0.423,
  publicServiceRate: 0.01,
  /** Skattereduktion för förvärvsinkomst: 0,75 % of BFI over 40 000 kr up to 240 000 kr, then 1 500 kr. */
  earnedIncome: { from: 40_000, to: 240_000, rate: 0.0075, max: 1_500 },
  capitalRate: 0.3,
  /** A capital deficit: 30 % back up to 100 000 kr, 21 % of the rest. */
  deficit: { limit: 100_000, rate: 0.3, above: 0.21 },
} as const;

const noRates = { municipalPct: null, regionPct: null, burialPct: null, churchPct: null, ratesSource: "fylls i: Skatteverkets Skattesatser kommuner" } as const;

export const TAX_YEAR_DEFAULTS: TaxYearRules[] = [
  {
    year: 2024,
    pbbOre: 5_730_000,
    ibbOre: 7_620_000,
    stateThresholdOre: 59_850_000,
    publicServiceIbb: 1.6,
    jobTaxCredit: { lowRate: 0.3874, midBase: 1.813, midRate: 0.1643, top: 2.608, taper: { fromPbb: 13.54, rate: 0.03 } },
    source: "Skatteverket, teknisk beskrivning SKV 433 2024 (utgåva 34)",
    ...noRates,
  },
  {
    year: 2025,
    pbbOre: 5_880_000,
    ibbOre: 8_060_000,
    stateThresholdOre: 62_580_000,
    publicServiceIbb: 1.55,
    jobTaxCredit: { lowRate: 0.3874, midBase: 1.813, midRate: 0.199, top: 2.776, taper: null },
    source: "Skatteverket, teknisk beskrivning SKV 433 2025 (utgåva 35)",
    ...noRates,
  },
  {
    year: 2026,
    pbbOre: 5_920_000,
    ibbOre: 8_340_000,
    stateThresholdOre: 64_300_000,
    publicServiceIbb: 1.42,
    jobTaxCredit: { lowRate: 0.3874, midBase: 1.813, midRate: 0.251, top: 3.027, taper: null },
    source: "Skatteverket, teknisk beskrivning SKV 433 2026 (utgåva 36) och Belopp och procent 2026",
    ...noRates,
  },
];

const SETTING = "tax_rules";
/** What can be entered per year; the coefficients stay the code's. */
export type TaxRuleInput = Partial<Pick<TaxYearRules, "pbbOre" | "ibbOre" | "stateThresholdOre" | "source" | "municipalPct" | "regionPct" | "burialPct" | "churchPct" | "ratesSource">>;

export function taxRules(db: Db): TaxYearRules[] {
  const stored = getSetting<Record<string, TaxRuleInput>>(db, SETTING, {});
  return TAX_YEAR_DEFAULTS.map((d) => ({ ...d, ...(stored[String(d.year)] ?? {}) })).sort((a, b) => a.year - b.year);
}

/** A year's rules: its own, else (a later year not yet in the code) the latest year's amounts with no rates. */
export function taxRulesFor(db: Db, year: number): TaxYearRules {
  const all = taxRules(db);
  return all.find((r) => r.year === year) ?? { ...all.filter((r) => r.year < year).at(-1)!, ...noRates, year, source: `${year} saknas: ${all.at(-1)!.year} års belopp används` };
}

const pct = (v: unknown, name: string): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 40) throw new TaxRuleError(`${name} ska vara en procentsats mellan 0 och 40.`);
  return Math.round(n * 1000) / 1000;
};
const amount = (v: unknown, name: string): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new TaxRuleError(`${name} ska vara ett belopp i öre, mer än noll.`);
  return n;
};

export function setTaxRules(db: Db, year: number, input: TaxRuleInput): TaxYearRules[] {
  if (!TAX_YEAR_DEFAULTS.some((d) => d.year === year)) throw new TaxRuleError(`Reglerna för ${year} finns inte i verktyget än.`);
  const next: TaxRuleInput = {
    pbbOre: amount(input.pbbOre, "Prisbasbeloppet"),
    ibbOre: amount(input.ibbOre, "Inkomstbasbeloppet"),
    stateThresholdOre: amount(input.stateThresholdOre, "Skiktgränsen"),
    municipalPct: pct(input.municipalPct, "Kommunalskatten"),
    regionPct: pct(input.regionPct, "Regionskatten"),
    burialPct: pct(input.burialPct, "Begravningsavgiften"),
    churchPct: pct(input.churchPct, "Kyrkoavgiften"),
  };
  if (input.source !== undefined) next.source = String(input.source).trim();
  if (input.ratesSource !== undefined) next.ratesSource = String(input.ratesSource).trim();
  const stored = getSetting<Record<string, TaxRuleInput>>(db, SETTING, {});
  const rates = [next.municipalPct, next.regionPct, next.burialPct, next.churchPct].some((v) => v !== undefined && v !== null);
  if (rates && !(next.ratesSource ?? stored[String(year)]?.ratesSource)) throw new TaxRuleError("Skriv källan till skattesatserna.");
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
  setSetting(db, SETTING, { ...stored, [String(year)]: { ...(stored[String(year)] ?? {}), ...clean } });
  return taxRules(db);
}
