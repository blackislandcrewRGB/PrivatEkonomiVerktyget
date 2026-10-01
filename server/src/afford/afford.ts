import type { Db } from "../db/client.js";
import { cashflow, monthStarts, plannedPayment, type PlannedPayment } from "../cashflow/cashflow.js";
import { endurance } from "../networth/endurance.js";
import { getSetting, setSetting } from "../settings.js";
import { addDays } from "../overview/dates.js";

/**
 * Har jag råd? One purchase against what the tool already knows: the 90-day
 * cash flow (salaries to come, invoices, Mio's payments, the pace), the
 * buffer, and how long the money would last (Ekonomisk situation). No AI:
 * the verdict follows rules, and says which one decided it.
 *
 * - Green: paid from the cash flow, whose lowest point stays over the buffer,
 *   and there is money on the bank accounts the day it is paid.
 * - Yellow: the lowest point dips under the buffer but not under zero; or
 *   the bank accounts can't pay it that day (wait for the salary); or it is
 *   taken from the savings on ISK (never green).
 * - Red: the cash flow goes under zero; or the savings would last less than
 *   the limit (3 months by default) after it.
 */

export type Funding = "cash" | "savings";
export type Verdict = "green" | "yellow" | "red";

export interface AffordInput {
  /** Öre, positive. */
  amount: number;
  /** The day of the purchase. */
  date: string;
  /** Paid with: null is the bank, a card is paid on its invoice's pay day. */
  accountId: number | null;
  shared: boolean;
  /** Paid from the cash flow, or with money taken from the savings on ISK. */
  funding: Funding;
  /** Count Mio's payments (and her half of a shared purchase). */
  partner: boolean;
}

export interface AffordFigures {
  lowest: { date: string; balance: number };
  /** The last day of the 90: where it lands. */
  end: { date: string; balance: number };
  safeToSpend: number;
  /** Buffer account + cash on Avanza, in months of costs. */
  bufferMonths: number | null;
  /** The same plus the savings on ISK. */
  withSavingsMonths: number | null;
}

export interface Affordability {
  input: AffordInput;
  payment: PlannedPayment;
  /** What it costs me: the amount less the partner's half (when her payments count). */
  netCost: number;
  before: AffordFigures;
  after: AffordFigures;
  verdict: Verdict;
  headline: string;
  reasons: string[];
  /** The bank accounts can't pay it the day it is paid: the first income day they can. */
  waitUntil: string | null;
  /** The next salary the verdict counts on, and whether it is a forecast. */
  salary: { date: string; amount: number; name: string; forecast: boolean } | null;
  /** Red from the cash flow: the verdict with the money taken from ISK instead. */
  alternative: { funding: "savings"; verdict: Verdict; withSavingsMonths: number | null } | null;
  limits: { buffer: number; redBelowMonths: number };
  horizon: string;
  /**
   * Kvar vid månadsskiftet, without and with the purchase: what is over on
   * the 1st when the month's bills are paid (a card purchase belongs to the
   * month its invoice is paid in).
   */
  monthStarts: { date: string; month: string; before: number; after: number }[];
}

const LIMIT_KEY = "afford_red_below_months";
export const DEFAULT_RED_BELOW_MONTHS = 3;

export function getRedBelowMonths(db: Db): number {
  const v = getSetting<number>(db, LIMIT_KEY, DEFAULT_RED_BELOW_MONTHS);
  return typeof v === "number" && v >= 0 && v <= 60 ? v : DEFAULT_RED_BELOW_MONTHS;
}

export function setRedBelowMonths(db: Db, months: number): number {
  if (typeof months !== "number" || !Number.isFinite(months) || months < 0 || months > 60) throw new Error("Gränsen ska vara 0–60 månader.");
  setSetting(db, LIMIT_KEY, months);
  return months;
}

/** How far ahead the next salary is looked for. */
const SALARY_LOOKAHEAD_DAYS = 35;

const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
const months1 = (m: number) => m.toLocaleString("sv-SE", { maximumFractionDigits: 1 });

export function affordability(db: Db, today: string, input: AffordInput): Affordability {
  const flow = cashflow(db, today, { partner: input.partner });
  const payment = plannedPayment(db, { date: input.date, amount: -input.amount, accountId: input.accountId, shared: input.shared }, today);
  const half = input.partner && payment.partnerDate ? payment.partnerHalf : 0;
  const netCost = input.amount - half;
  const limits = { buffer: flow.buffer, redBelowMonths: getRedBelowMonths(db) };

  // The day series with the purchase: out on its pay day (in again at once when ISK pays), the half back later.
  const shift = (d: string, funding: Funding) =>
    (d >= payment.payDate && funding === "cash" ? -input.amount : 0) + (half && d >= payment.partnerDate! ? half : 0);
  const lowestOf = (funding: Funding) =>
    flow.days.reduce(
      (lo, d) => (d.balance + shift(d.date, funding) < lo.balance ? { date: d.date, balance: d.balance + shift(d.date, funding) } : lo),
      { date: flow.days[0].date, balance: flow.days[0].balance + shift(flow.days[0].date, funding) },
    );

  const e = endurance(db, today);
  // What a month without income would cost: only what would have to be paid, as Uthållighet shows it.
  const cost = e.essential.monthlyOre;
  // The buffer as Kvar vid månadsskiftet (see endurance).
  const liquid = e.capital.liquidOre;
  const months = (ore: number) => (cost > 0 ? Math.max(0, ore) / cost : null);
  const last = flow.days.at(-1)!;
  const before: AffordFigures = {
    lowest: flow.lowest,
    end: { date: last.date, balance: last.balance },
    safeToSpend: flow.safeToSpend,
    bufferMonths: e.essential.buffer.months,
    withSavingsMonths: e.essential.withSavings.months,
  };
  const figures = (funding: Funding): AffordFigures => {
    const lowest = lowestOf(funding);
    return {
      lowest,
      end: { date: last.date, balance: last.balance + shift(last.date, funding) },
      safeToSpend: lowest.balance - flow.buffer,
      bufferMonths: before.bufferMonths === null ? null : months(funding === "cash" ? liquid - netCost : liquid),
      withSavingsMonths: before.withSavingsMonths === null ? null : months(liquid + e.capital.portfolioOre - netCost),
    };
  };
  const after = figures(input.funding);
  const starts = monthStarts(flow).map((m) => ({ date: m.date, month: m.month, before: m.balance, after: m.balance + shift(addDays(m.date, -1), input.funding) }));

  // The bank accounts alone (the Avanza cash takes a day to move) the day a bank payment leaves them.
  let waitUntil: string | null = null;
  if (input.funding === "cash" && !payment.card) {
    const bank = (d: (typeof flow.days)[number]) => d.balance - flow.liquid.totalOre;
    const day = flow.days.find((d) => d.date >= payment.payDate);
    if (day && bank(day) - input.amount < 0) {
      waitUntil = flow.days.find((d) => d.date > payment.payDate && d.events.some((x) => x.kind === "income") && bank(d) - input.amount >= 0)?.date ?? null;
    }
  }
  // The next salary: the largest income in the coming month.
  const incomes = flow.events.filter((x) => x.kind === "income" && x.date <= addDays(today, SALARY_LOOKAHEAD_DAYS));
  const main = incomes.length ? incomes.reduce((a, b) => (b.amount > a.amount ? b : a)) : null;
  const salary = main ? { date: main.date, amount: main.amount, name: main.name, forecast: /prognos/.test(main.name) || !!main.estimate } : null;

  const reasons: string[] = [];
  const how = payment.card
    ? `På ${payment.card} dras det ${dm(payment.payDate)}${half ? `, och ${flow.partnerName}s halva ${kr(half)} kommer tillbaka ${dm(payment.partnerDate!)}` : ""}.`
    : half
      ? `${flow.partnerName}s halva ${kr(half)} kommer tillbaka ${dm(payment.partnerDate!)}.`
      : null;
  if (payment.payDate > flow.horizon) reasons.push(`Det dras ${dm(payment.payDate)}, efter de 90 dagarna som prognosen räknar.`);

  const redLimit = limits.redBelowMonths;
  const savingsTooLow = (f: AffordFigures) => f.withSavingsMonths !== null && f.withSavingsMonths < redLimit;
  let verdict: Verdict;
  let alternative: Affordability["alternative"] = null;
  if (savingsTooLow(after)) {
    verdict = "red";
    reasons.push(`Pengarna räcker ${months1(after.withSavingsMonths!)} månader med sparandet efter köpet, under gränsen ${months1(redLimit)} månader.`);
  } else if (input.funding === "savings") {
    verdict = "yellow";
    reasons.push(
      `Tas ${kr(input.amount)} från sparandet på ISK räcker pengarna ${months1(after.withSavingsMonths ?? 0)} månader med sparandet (i dag ${months1(before.withSavingsMonths ?? 0)}).`,
    );
    if (after.lowest.balance < 0) reasons.push(`Kassaflödet går ändå under noll: lägst ${kr(after.lowest.balance)} den ${dm(after.lowest.date)}.`);
  } else if (after.lowest.balance < 0) {
    verdict = "red";
    reasons.push(`Kassaflödet går under noll: lägst ${kr(after.lowest.balance)} den ${dm(after.lowest.date)} (utan köpet ${kr(before.lowest.balance)}).`);
    const alt = figures("savings");
    alternative = { funding: "savings", verdict: savingsTooLow(alt) ? "red" : "yellow", withSavingsMonths: alt.withSavingsMonths };
    if (alternative.verdict === "yellow") {
      reasons.push(`Tas pengarna från sparandet på ISK blir det gult: de räcker då ${months1(alt.withSavingsMonths ?? 0)} månader med sparandet.`);
    }
  } else if (after.safeToSpend < 0) {
    verdict = "yellow";
    reasons.push(`Kassaflödet går under bufferten ${kr(flow.buffer)}: lägst ${kr(after.lowest.balance)} den ${dm(after.lowest.date)}.`);
  } else if (waitUntil) {
    verdict = "yellow";
    reasons.push(`Det ryms, men pengarna finns på bankkontona först ${dm(waitUntil)}.`);
  } else {
    verdict = "green";
    reasons.push(`Kassaflödet håller sig över bufferten: lägst ${kr(after.lowest.balance)} den ${dm(after.lowest.date)}, safe to spend ${kr(after.safeToSpend)} efter köpet.`);
  }
  if (waitUntil && verdict !== "yellow") reasons.push(`Pengarna finns på bankkontona först ${dm(waitUntil)}.`);
  if (how) reasons.push(how);
  // The first 1st the purchase is paid by: what is over then, the way the month is counted.
  const felt = starts.find((m) => m.before !== m.after);
  if (felt) reasons.push(`Kvar vid månadsskiftet ${dm(felt.date)} blir ${kr(felt.after)} (utan köpet ${kr(felt.before)}).`);
  if (before.safeToSpend < 0) reasons.push(`Redan utan köpet är safe to spend ${kr(before.safeToSpend)}.`);
  if (flow.foodOnly) reasons.push(`Av de rörliga utgifterna räknas bara maten på kortet (${kr(flow.variable.perDay)}/dag i stället för ${kr(flow.variable.fullPerDay)}/dag), och bränslet.`);
  if (salary) reasons.push(`Räknar med ${salary.name.replace(/ \(.*\)$/, "").toLowerCase()} ${dm(salary.date)} på ${kr(salary.amount)}${salary.forecast ? ", en prognos" : ""}.`);

  const headline =
    verdict === "green"
      ? "Ja, det ryms"
      : verdict === "yellow"
        ? input.funding === "savings"
          ? "Ja, med pengar från sparandet"
          : waitUntil && after.safeToSpend >= 0
            ? `Ja, efter ${dm(waitUntil)}`
            : "Ja, men det går under bufferten"
        : savingsTooLow(after)
          ? "Nej, sparandet räcker inte"
          : "Nej, inte från kassaflödet";

  return { input, payment, netCost, before, after, verdict, headline, reasons, waitUntil, salary, alternative, limits, horizon: flow.horizon, monthStarts: starts };
}
