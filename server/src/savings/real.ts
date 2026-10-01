import { and, eq, gt, gte, isNull, lte, min } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, transactions } from "../db/schema.js";
import { getBufferAccount } from "../networth/endurance.js";
import { accountBalanceOn } from "../networth/history.js";
import { addDays, addMonths, daysBetween, monthOf } from "../overview/dates.js";
import { pointsOf, seriesByKey } from "../prices/series.js";
import { KPI_TOTAL } from "../salary/annualIncome.js";
import { iskDeclared, iskTax, iskValueOn, listQuarterValues } from "../tax/isk.js";
import { savingsFlows } from "./savings.js";
import { avanzaLedger, listAvanzaStatements, type AvanzaLedger, type StatementSummary } from "./avanzaStatement.js";

/**
 * Sparande efter inflation: what the savings on Avanza (the whole ISK,
 * securities and cash) have given once the money is counted in today's
 * purchasing power, and what the buffer on the e-savings account lost to
 * prices beyond its interest.
 *
 * The price level is SCB's whole consumer price index (KPI, 2020=100), the
 * one Lön › Årsinkomst uses. A month SCB hasn't published yet (the current
 * one, and the one before until about the 15th) is at the newest published
 * month's level, which is what "today's money" can mean.
 *
 * A value is at the start of its day, so its price level is the day before's
 * month: the ISK's value on 1 January is December's prices. Money moved on a
 * day is at that day's month.
 */

/** KPI by month ('YYYY-MM'), from the whole index. */
export interface PriceLevel {
  first: string;
  latest: string;
  /** The month's index, the newest published after it, null before the series begins. */
  of(month: string): number | null;
}

export function priceLevel(db: Db): PriceLevel | null {
  const series = seriesByKey(db, KPI_TOTAL);
  if (!series) return null;
  const byMonth = new Map(pointsOf(db, series).map((p) => [p.date.slice(0, 7), p.value]));
  const months = [...byMonth.keys()].sort();
  if (months.length === 0) return null;
  const first = months[0];
  const latest = months.at(-1)!;
  return { first, latest, of: (month) => (month > latest ? byMonth.get(latest)! : (byMonth.get(month) ?? null)) };
}

/** A value's month: the day before's, since a value is at the start of its day. */
const valueMonth = (date: string) => monthOf(addDays(date, -1));

export interface ValuePoint {
  date: string;
  valueOre: number;
  /** Entered from Avanza, worked out from the holdings and prices, or today's. */
  source: "entered" | "computed" | "today";
}

/** A value with what it had to be to keep up with prices (see keepUp). */
export interface RealPoint extends ValuePoint {
  keepOre: number | null;
  /** Avanza's value before the debt: the ISK's (for an entered quarter, without a negative cash balance, as Avanza counts it). */
  grossOre: number;
  /** The credit's debt and a negative cash balance on the ISK that day (0 or less): valueOre is grossOre plus this. */
  debtOre: number;
}

/**
 * The values less the debt, where Avanza's statements tell it: the credit's
 * balance that day, and for a quarter entered from Avanza a negative cash
 * balance on the ISK too, which Avanza's quarter value leaves out. After the
 * statements the credit is at its last balance.
 */
export function netOfDebt(points: ValuePoint[], ledger: AvanzaLedger | null): (ValuePoint & { grossOre: number; debtOre: number })[] {
  return points.map((p) => {
    if (!ledger) return { ...p, grossOre: p.valueOre, debtOre: 0 };
    const covered = p.date >= ledger.coverage.from && p.date <= addDays(ledger.coverage.to, 1);
    const cash = p.source === "entered" && covered ? Math.min(0, ledger.iskCashAt(p.date) ?? 0) : 0;
    const debt = ledger.creditAt(p.date) + cash;
    return { ...p, valueOre: p.valueOre + debt, grossOre: p.valueOre, debtOre: debt };
  });
}

/** The money put in and taken out: Avanza's own where its statements reach, the bank's Sparande transfers elsewhere. */
export function ownFlows(bank: Flow[], ledger: AvanzaLedger | null): Flow[] {
  if (!ledger) return bank;
  const { from, to } = ledger.coverage;
  return [...bank.filter((f) => f.date < from || f.date > to), ...ledger.ownFlows].sort((a, b) => a.date.localeCompare(b.date));
}

export interface Flow {
  date: string;
  /** Into the savings positive, out of them negative. */
  amount: number;
}

export interface RealPeriod {
  from: string;
  to: string;
  startOre: number;
  /** Put in less taken out during the period. */
  netOre: number;
  endOre: number;
  /** Return on the money in it (Modified Dietz), as a fraction. Null when nothing was in it. */
  nominal: number | null;
  /** The change in the price level over the period. Null where KPI doesn't reach. */
  inflation: number | null;
  real: number | null;
  /** Ends today, at today's prices. */
  ongoing: boolean;
}

export interface RealYear {
  year: number;
  nominal: number | null;
  inflation: number | null;
  real: number | null;
  /**
   * The ISK tax for the year: the return's, or worked out for a year still
   * going. Paid through the final tax the year after, not from the account:
   * a cost beside the value, not in it.
   */
  iskTaxOre: number | null;
  iskTaxEstimated: boolean;
}

export interface RealTotals {
  since: string;
  /** The last value's day. */
  until: string;
  startOre: number;
  endOre: number;
  netOre: number;
  deposited: number;
  withdrawn: number;
  /** The start and the money put in since, less what was taken out, each at today's prices. */
  netTodayOre: number | null;
  /** The value less the start and the money put in: what the account shows. */
  nominalGainOre: number;
  /** The value less the same at today's prices: what was gained in purchasing power. */
  realGainOre: number | null;
  /** What of the nominal gain only kept up with prices. */
  inflationOre: number | null;
  nominal: number | null;
  inflation: number | null;
  real: number | null;
  /** The ISK tax for the time since the start: each year's by the share of it covered. Null when a year's isn't known. */
  iskTaxOre: number | null;
  /** The real gain less that tax. */
  realGainAfterTaxOre: number | null;
  /** Interest paid on the credit over the span (Avanza's statements); already in the value, as a bigger debt. */
  creditInterestOre: number | null;
}

/** Periods between the value points, with the money moved in each. A flow on a value's day comes after the value, except today's. */
export function realPeriods(points: ValuePoint[], flows: Flow[], level: PriceLevel | null): RealPeriod[] {
  const periods: RealPeriod[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ongoing = b.source === "today";
    const inside = flows.filter((f) => f.date >= a.date && (ongoing ? f.date <= b.date : f.date < b.date));
    const net = inside.reduce((s, f) => s + f.amount, 0);
    const days = daysBetween(a.date, b.date);
    const weighted = inside.reduce((s, f) => s + (f.amount * daysBetween(f.date, b.date)) / days, 0);
    const invested = a.valueOre + weighted;
    const nominal = invested > 0 ? (b.valueOre - a.valueOre - net) / invested : null;
    const p0 = level?.of(valueMonth(a.date)) ?? null;
    const p1 = level?.of(ongoing ? monthOf(b.date) : valueMonth(b.date)) ?? null;
    const inflation = p0 && p1 ? p1 / p0 - 1 : null;
    periods.push({
      from: a.date,
      to: b.date,
      startOre: a.valueOre,
      netOre: net,
      endOre: b.valueOre,
      nominal,
      inflation,
      real: nominal !== null && inflation !== null ? (1 + nominal) / (1 + inflation) - 1 : null,
      ongoing,
    });
  }
  return periods;
}

/**
 * At each value: the start and the money moved since, each carried to that
 * day's prices – what the savings had to be worth to have kept their
 * purchasing power. Above it they beat inflation. Null where KPI doesn't reach.
 */
export function keepUp(points: ValuePoint[], flows: Flow[], level: PriceLevel | null): (number | null)[] {
  const start = points[0];
  return points.map((pt, i) => {
    const then = level?.of(i === points.length - 1 && pt.source === "today" ? monthOf(pt.date) : valueMonth(pt.date)) ?? null;
    const parts = [
      { ore: start.valueOre, month: valueMonth(start.date) },
      ...flows.filter((f) => f.date >= start.date && (pt.source === "today" ? f.date <= pt.date : f.date < pt.date)).map((f) => ({ ore: f.amount, month: monthOf(f.date) })),
    ];
    if (!then) return null;
    let sum = 0;
    for (const p of parts) {
      const at = level!.of(p.month);
      if (!at) return null;
      sum += (p.ore * then) / at;
    }
    return Math.round(sum);
  });
}

/** Linked over periods: (1 + r₁)(1 + r₂)… − 1, null if any is unknown. */
const chain = (rates: (number | null)[]) => (rates.some((r) => r === null) ? null : rates.reduce<number>((p, r) => p * (1 + r!), 1) - 1);
const realOf = (nominal: number | null, inflation: number | null) => (nominal !== null && inflation !== null ? (1 + nominal) / (1 + inflation) - 1 : null);

/** Since the first value: the kronor, and the return linked over the periods. */
export function realTotals(points: ValuePoint[], flows: Flow[], periods: RealPeriod[], level: PriceLevel | null): RealTotals {
  const start = points[0];
  const end = points.at(-1)!;
  const inside = flows.filter((f) => f.date >= start.date && f.date <= end.date);
  const netOre = inside.reduce((s, f) => s + f.amount, 0);
  const today = level?.of(monthOf(end.date)) ?? null;
  // What a krona then is worth in today's money.
  const factor = (month: string) => {
    const then = level?.of(month) ?? null;
    return today && then ? today / then : null;
  };
  const parts = [{ ore: start.valueOre, f: factor(valueMonth(start.date)) }, ...inside.map((f) => ({ ore: f.amount, f: factor(monthOf(f.date)) }))];
  const netTodayOre = parts.some((p) => p.f === null) ? null : Math.round(parts.reduce((s, p) => s + p.ore * p.f!, 0));
  const nominal = chain(periods.map((p) => p.nominal));
  const p0 = level?.of(valueMonth(start.date)) ?? null;
  const inflation = p0 && today ? today / p0 - 1 : null;
  return {
    since: start.date,
    until: end.date,
    startOre: start.valueOre,
    endOre: end.valueOre,
    netOre,
    deposited: inside.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0),
    withdrawn: -inside.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0),
    netTodayOre,
    nominalGainOre: end.valueOre - start.valueOre - netOre,
    realGainOre: netTodayOre === null ? null : end.valueOre - netTodayOre,
    inflationOre: netTodayOre === null ? null : netTodayOre - start.valueOre - netOre,
    nominal,
    inflation,
    real: realOf(nominal, inflation),
    iskTaxOre: null,
    realGainAfterTaxOre: null,
    creditInterestOre: null,
  };
}

/** The ISK tax over [from, to]: each year's tax by the share of its days the span covers. */
export function taxOver(from: string, to: string, tax: (year: number) => { ore: number | null }): number | null {
  let sum = 0;
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const a = from > `${y}-01-01` ? from : `${y}-01-01`;
    const b = to < `${y + 1}-01-01` ? to : `${y + 1}-01-01`;
    const share = daysBetween(a, b) / daysBetween(`${y}-01-01`, `${y + 1}-01-01`);
    if (share <= 0) continue;
    const t = tax(y).ore;
    if (t === null) return null;
    sum += t * share;
  }
  return Math.round(sum);
}

/** Per calendar year: its periods linked (a period belongs to the year it ends in, counting a 1 January end as the year before). */
export function realYears(periods: RealPeriod[], tax: (year: number) => { ore: number | null; estimated: boolean }): RealYear[] {
  const byYear = new Map<number, RealPeriod[]>();
  for (const p of periods) {
    const year = Number((p.ongoing ? p.to : addDays(p.to, -1)).slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), p]);
  }
  return [...byYear].map(([year, ps]) => {
    const nominal = chain(ps.map((p) => p.nominal));
    const inflation = chain(ps.map((p) => p.inflation));
    const t = tax(year);
    return { year, nominal, inflation, real: realOf(nominal, inflation), iskTaxOre: t.ore, iskTaxEstimated: t.estimated };
  });
}

/**
 * The ISK's values: those entered from Avanza (1/1, 1/4, 1/7, 1/10), the
 * quarters the tool can work out from the holdings since they were entered,
 * and today's. Oldest first.
 */
export function valuePoints(db: Db, today: string): ValuePoint[] {
  const entered = listQuarterValues(db).filter((q) => q.date <= today);
  const byDate = new Map<string, ValuePoint>(entered.map((q) => [q.date, { date: q.date, valueOre: q.valueOre, source: "entered" }]));
  const firstYear = Number((entered[0]?.date ?? today).slice(0, 4));
  for (let y = firstYear; y <= Number(today.slice(0, 4)); y++) {
    for (const q of iskTax(db, y, today).quarters) {
      if (q.source === "computed" && q.date <= today && !byDate.has(q.date)) byDate.set(q.date, { date: q.date, valueOre: q.valueOre, source: "computed" });
    }
  }
  if (!byDate.has(today)) byDate.set(today, { date: today, valueOre: iskValueOn(db, today), source: "today" });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- The buffer ----------

export interface BufferYear {
  year: number;
  /** The mean of the balances at the start and at each month's end. */
  averageOre: number;
  interestOre: number;
  /** Interest ÷ the average balance. Null for an empty account. */
  rate: number | null;
  /** December to December. */
  inflation: number | null;
  real: number | null;
  /** The average × inflation less the interest: what prices took beyond what the interest paid. Negative when the interest beat them. */
  lostOre: number | null;
}

export interface RealBuffer {
  accountId: number;
  name: string;
  balanceOre: number;
  /** The newest twelve months' change in prices, for today. */
  inflation12: { from: string; to: string; change: number } | null;
  years: BufferYear[];
}

const INTEREST = /r[äa]nta/i;

/** The e-savings account's whole calendar years since its rows begin: its balance, its interest and the prices. */
export function realBuffer(db: Db, today: string, level: PriceLevel | null): RealBuffer | null {
  const buffer = getBufferAccount(db);
  if (!buffer) return null;
  const account = db.select().from(accounts).where(eq(accounts.id, buffer.id)).get();
  if (!account) return null;
  const balanceDate = (account.balanceUpdatedAt ?? today).slice(0, 10);
  const firstRow = db
    .select({ d: min(transactions.bookingDate) })
    .from(transactions)
    .where(and(eq(transactions.accountId, account.id), isNull(transactions.deletedAt)))
    .get()?.d;
  const balanceOn = (on: string) => accountBalanceOn(db, account.id, on, account.balance, balanceDate);
  const years: BufferYear[] = [];
  if (firstRow) {
    // A year counts when the rows cover all of it: from the year after the first row.
    for (let y = Number(firstRow.slice(0, 4)) + 1; y < Number(today.slice(0, 4)); y++) {
      const ends = [`${y - 1}-12-31`, ...Array.from({ length: 12 }, (_, i) => addDays(`${addMonths(`${y}-${String(i + 1).padStart(2, "0")}`, 1)}-01`, -1))];
      const averageOre = Math.round(ends.reduce((s, d) => s + balanceOn(d), 0) / ends.length);
      const interestOre = db
        .select({ amount: transactions.amount, text: transactions.descriptionClean })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, account.id),
            isNull(transactions.deletedAt),
            gt(transactions.amount, 0),
            gte(transactions.bookingDate, `${y}-01-01`),
            lte(transactions.bookingDate, `${y}-12-31`),
          ),
        )
        .all()
        .filter((r) => INTEREST.test(r.text))
        .reduce((s, r) => s + r.amount, 0);
      const d0 = level?.of(`${y - 1}-12`) ?? null;
      const d1 = level?.of(`${y}-12`) ?? null;
      const inflation = d0 && d1 && `${y}-12` <= level!.latest ? d1 / d0 - 1 : null;
      const rate = averageOre > 0 ? interestOre / averageOre : null;
      years.push({
        year: y,
        averageOre,
        interestOre,
        rate,
        inflation,
        real: realOf(rate, inflation),
        lostOre: inflation === null ? null : Math.round(averageOre * inflation - interestOre),
      });
    }
  }
  const to = level?.latest ?? null;
  const from = to ? addMonths(to, -12) : null;
  const p0 = from ? level!.of(from) : null;
  const p1 = to ? level!.of(to) : null;
  return {
    accountId: account.id,
    name: account.name,
    balanceOre: balanceOn(today),
    inflation12: from && to && p0 && p1 && from >= level!.first ? { from, to, change: p1 / p0 - 1 } : null,
    years,
  };
}

// ---------- All of it ----------

export interface RealSavings {
  /** The newest month KPI reaches; null without the index. */
  kpiMonth: string | null;
  points: RealPoint[];
  /** Null with fewer than two values: there is nothing to measure yet. */
  totals: RealTotals | null;
  periods: RealPeriod[];
  years: RealYear[];
  buffer: RealBuffer | null;
  /** Avanza's statements read in, and the days the ISK's cover. Null without any. */
  avanza: { coverage: { from: string; to: string } | null; statements: StatementSummary[] } | null;
}

/** The credit's interest over the totals' span, from Avanza's statements. */
const withInterest = (t: RealTotals, ledger: AvanzaLedger | null): RealTotals => ({ ...t, creditInterestOre: ledger ? ledger.interestBetween(t.since, t.until) : null });

/** The totals with the ISK tax for their span taken off the real gain. */
const withTax = (t: RealTotals, tax: (year: number) => { ore: number | null }): RealTotals => {
  const iskTaxOre = taxOver(t.since, t.until, tax);
  return { ...t, iskTaxOre, realGainAfterTaxOre: iskTaxOre === null || t.realGainOre === null ? null : t.realGainOre - iskTaxOre };
};

export function realSavings(db: Db, today: string): RealSavings {
  const level = priceLevel(db);
  const ledger = avanzaLedger(db);
  const net = netOfDebt(valuePoints(db, today), ledger);
  const points: ValuePoint[] = net;
  const flows = ownFlows(savingsFlows(db), ledger);
  const periods = realPeriods(points, flows, level);
  const declared = new Map(iskDeclared(db).map((d) => [d.year, d.taxOre]));
  const tax = (year: number) => {
    if (declared.has(year)) return { ore: declared.get(year)!, estimated: false };
    if (year === Number(today.slice(0, 4))) return { ore: iskTax(db, year, today).taxOre, estimated: true };
    return { ore: null, estimated: false };
  };
  const keep = keepUp(points, flows, level);
  return {
    kpiMonth: level?.latest ?? null,
    points: net.map((p, i) => ({ ...p, keepOre: keep[i] })),
    totals: points.length >= 2 ? withInterest(withTax(realTotals(points, flows, periods, level), tax), ledger) : null,
    periods,
    years: realYears(periods, tax),
    buffer: realBuffer(db, today, level),
    avanza: (() => {
      const statements = listAvanzaStatements(db);
      return statements.length ? { coverage: ledger?.coverage ?? null, statements } : null;
    })(),
  };
}
