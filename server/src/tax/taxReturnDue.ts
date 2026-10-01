import type { Db } from "../db/client.js";
import { payslips } from "../db/schema.js";
import { taxReturnsByYear, type TaxReturn } from "../taxReturns/taxReturns.js";

/** The last day to file (the receipt is overdue after it): 2 May. */
export const FILING_DEADLINE = "05-02";
/** From this day the spring's return is due soon: 1 March. */
export const FILING_OPENS = "03-01";

export interface TaxReturnDue {
  /** The income year whose return this spring is about. */
  incomeYear: number;
  latest: TaxReturn | null;
  /** Filed and read in; soon (March to 2 May); late after 2 May; none read in at all. */
  state: "done" | "soon" | "late" | "never";
  /** Whether the tool has reason to ask: a payslip or a return read in. */
  inUse: boolean;
}

/**
 * This spring's return: for the year before. It is done once its receipt is
 * read in; from March it is due, and after 2 May it is late. Before March
 * last spring's is what counts.
 */
export function taxReturnDue(db: Db, today: string): TaxReturnDue {
  const year = Number(today.slice(0, 4));
  const returns = taxReturnsByYear(db);
  const latest = [...returns.values()].sort((a, b) => b.incomeYear - a.incomeYear)[0] ?? null;
  const inUse = returns.size > 0 || !!db.select({ id: payslips.id }).from(payslips).limit(1).get();
  const md = today.slice(5);
  // Before March the spring's return isn't due yet: last spring's is the one to have.
  const incomeYear = md < FILING_OPENS ? year - 2 : year - 1;
  const state = returns.has(incomeYear) ? "done" : returns.size === 0 && md < FILING_OPENS ? "never" : md > FILING_DEADLINE || md < FILING_OPENS ? "late" : "soon";
  return { incomeYear, latest, state, inUse };
}
