import { TAX_CONSTANTS as C, type TaxYearRules } from "./rules.js";

/**
 * The final tax for an employee under 66, as Skatteverket's technical
 * description (SKV 433) works it out, in whole kronor with its roundings:
 * the basic deduction up to the hundred, the taxable income down to the
 * hundred, the job tax credit with decimals and then down to the krona,
 * everything else with its öre dropped. An estimate: it knows the boxes it
 * is given and nothing else (no other deductions or reductions).
 */

export interface FinalTaxInput {
  /** 1.1, kronor. */
  salary: number;
  /** 2.1: the commute deduction after its threshold. */
  commuteDeduction: number;
  /** 7.1, 7.2, 8.1. */
  iskStandardIncome: number;
  capitalIncome: number;
  capitalExpenses: number;
}

export interface FinalTax {
  /** Fastställd förvärvsinkomst: the surplus in tjänst (salary less the commute deduction). */
  ffi: number;
  /** Grundavdrag. */
  basicDeduction: number;
  /** Beskattningsbar förvärvsinkomst. */
  bfi: number;
  municipalTax: number;
  burialFee: number;
  churchFee: number;
  stateTax: number;
  pensionFee: number;
  /** The pension fee back as a reduction (all of it, as far as the income taxes reach). */
  pensionFeeReduction: number;
  publicService: number;
  /** Arbetsinkomst (the surplus in tjänst, down to the hundred) and the job tax credit on it. */
  workIncome: number;
  jobTaxCredit: number;
  earnedIncomeReduction: number;
  /** 7.1 + 7.2 − 8.1. */
  capitalSurplus: number;
  capitalTax: number;
  capitalDeficitReduction: number;
  total: number;
  /** KI: municipal + regional rate (fraction), what the job tax credit is multiplied by. */
  ki: number;
}

export class MissingRatesError extends Error {}

const down = (n: number) => Math.floor(n + 1e-9);
const hundredDown = (n: number) => Math.floor(n / 100 + 1e-9) * 100;
const hundredUp = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;
/** To the nearest hundred, 50 down (the pension fee). */
const hundredNearest = (n: number) => {
  const r = n % 100;
  return r > 50 ? n - r + 100 : n - r;
};

/** Grundavdrag for someone under 66: by the income in price base amounts, up to the hundred, never more than the income. */
export function basicDeduction(ffi: number, pbb: number): number {
  let g: number;
  if (ffi <= 0.99 * pbb) g = 0.423 * pbb;
  else if (ffi <= 2.72 * pbb) g = 0.423 * pbb + 0.2 * (ffi - 0.99 * pbb);
  else if (ffi <= 3.11 * pbb) g = 0.77 * pbb;
  else if (ffi <= 7.88 * pbb) g = 0.77 * pbb - 0.1 * (ffi - 3.11 * pbb);
  else g = 0.293 * pbb;
  return Math.min(hundredUp(g), Math.max(0, ffi));
}

/** Skattereduktion för arbetsinkomst (jobbskatteavdrag) for someone under 66, before it is held to the municipal tax. */
export function jobTaxCredit(workIncome: number, basic: number, ki: number, pbb: number, j: TaxYearRules["jobTaxCredit"]): number {
  const ai = workIncome;
  let base: number;
  if (ai <= 0.91 * pbb) base = ai;
  else if (ai <= 3.24 * pbb) base = 0.91 * pbb + j.lowRate * (ai - 0.91 * pbb);
  else if (ai <= 8.08 * pbb) base = j.midBase * pbb + j.midRate * (ai - 3.24 * pbb);
  else base = j.top * pbb;
  let credit = (base - basic) * ki;
  if (j.taper && ai > j.taper.fromPbb * pbb) credit -= j.taper.rate * (ai - j.taper.fromPbb * pbb);
  return Math.max(0, down(credit));
}

export function finalTax(input: FinalTaxInput, rules: TaxYearRules): FinalTax {
  if (rules.municipalPct === null || rules.regionPct === null || rules.burialPct === null) {
    throw new MissingRatesError(`Skattesatserna för ${rules.year} saknas: fyll i dem under Inställningar › Lön.`);
  }
  const pbb = rules.pbbOre / 100;
  const ibb = rules.ibbOre / 100;
  const ki = (rules.municipalPct + rules.regionPct) / 100;

  const ffi = Math.max(0, down(input.salary - input.commuteDeduction));
  const basic = basicDeduction(ffi, pbb);
  const bfi = hundredDown(Math.max(0, ffi - basic));

  const municipalTax = down(bfi * ki);
  const burialFee = down((bfi * rules.burialPct) / 100);
  const churchFee = down((bfi * (rules.churchPct ?? 0)) / 100);
  const over = bfi - rules.stateThresholdOre / 100;
  const stateTax = over >= C.stateMinimumOver ? down(C.stateRate * over) : 0;
  const feeBase = Math.min(input.salary, C.pensionFeeCapIbb * ibb);
  const pensionFee = feeBase < C.pensionFeeFloorPbb * pbb ? 0 : hundredNearest(down(feeBase * C.pensionFeeRate));
  const publicService = down(Math.min(bfi, rules.publicServiceIbb * ibb) * C.publicServiceRate);

  // The reductions in Skatteverket's order: the pension fee against the state
  // and municipal taxes, the job tax credit and the earned income reduction
  // against what is left of the municipal tax.
  const pensionFeeReduction = Math.min(pensionFee, municipalTax + stateTax);
  let municipalLeft = municipalTax - Math.max(0, pensionFeeReduction - stateTax);
  const workIncome = hundredDown(ffi);
  const jobCredit = Math.min(jobTaxCredit(workIncome, basic, ki, pbb, rules.jobTaxCredit), municipalLeft);
  municipalLeft -= jobCredit;
  const e = C.earnedIncome;
  const earned = bfi <= e.from ? 0 : bfi <= e.to ? down((bfi - e.from) * e.rate) : e.max;
  const earnedIncomeReduction = Math.min(earned, municipalLeft);

  const capitalSurplus = input.iskStandardIncome + input.capitalIncome - input.capitalExpenses;
  const capitalTax = capitalSurplus > 0 ? down(capitalSurplus * C.capitalRate) : 0;
  const deficit = Math.max(0, -capitalSurplus);
  const capitalDeficitReduction = down(Math.min(deficit, C.deficit.limit) * C.deficit.rate + Math.max(0, deficit - C.deficit.limit) * C.deficit.above);

  const before = municipalTax + burialFee + churchFee + stateTax + pensionFee + publicService + capitalTax;
  const reductions = pensionFeeReduction + jobCredit + earnedIncomeReduction;
  // A deficit reduction can't take the tax below the fees that aren't reduced.
  const total = before - reductions - Math.min(capitalDeficitReduction, Math.max(0, before - reductions - burialFee - churchFee - publicService));
  return {
    ffi,
    basicDeduction: basic,
    bfi,
    municipalTax,
    burialFee,
    churchFee,
    stateTax,
    pensionFee,
    pensionFeeReduction,
    publicService,
    workIncome,
    jobTaxCredit: jobCredit,
    earnedIncomeReduction,
    capitalSurplus,
    capitalTax,
    capitalDeficitReduction,
    total,
    ki,
  };
}
