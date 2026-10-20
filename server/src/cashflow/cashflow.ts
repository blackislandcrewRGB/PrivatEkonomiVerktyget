import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, categories, plannedItems, recurringIncome, recurringIncomeOverrides, statements, transactions } from "../db/schema.js";
import { cardInvoices, expenseOccurrences, mainIncome, spendingPace, upcomingInvoices, type Occurrence } from "../overview/overview.js";
import { salaryForecasts, type SalaryForecast } from "../salary/salary.js";
import { addDays, addMonths, daysBetween, daysInMonth, dueDateIn, monthOf } from "../overview/dates.js";
import { lastBankDayOfMonth } from "../calendar/bankDays.js";
import { nearestDue } from "../recurring/link.js";
import { cardInvoicePeriod, postedDaySql } from "../shared/settlement.js";
import { getFuelSettings, monthForecast, shiftsByMonth } from "../fuel/fuel.js";
import { getPartnerName, getSetting, setSetting } from "../settings.js";
import { partnerOutstanding } from "../shared/settlement.js";
import { categoryIdByKey } from "../db/seed.js";
import { liquidCash } from "../savings/portfolio.js";
import { estimateTaxRefund, refundSettings } from "../tax/refund.js";

/**
 * Kassaflöde: the bank accounts whose balance is followed (Privatkonto and
 * e-sparkonto) and the cash on Avanza, day by day, 90 days ahead. The cash
 * can be moved to the bank any day, and money moved to Avanza stays in the
 * same pot (a transfer, never in the pace), so it is safe to spend as well.
 * From today's balances:
 * - recurring incomes on their day (the month's expected amount, else the
 *   estimate), unless already in; a salary up to 5 days late still comes today;
 *   the salary by Löneprognos (its net and pay day) for months with hours entered;
 * - fixed expenses on the bank accounts by their schedule, unless drawn;
 * - card invoices on their pay day: an imported unpaid invoice (exact);
 *   Mastercard's next one and the ones after it, and Bank Norwegian's per
 *   period, as bought so far + the card's fixed still to come + the card's
 *   share of the spending pace for the rest of the period (the food bought
 *   on the card leaves the bank with its invoice, not day by day);
 * - variable spending at the pace of the last 30 days every day, counted as
 *   paid (shared purchases in full: Mio's half comes back in her payments,
 *   so 'my part' here would count it twice), fuel instead by Pendling &
 *   bränsle's month forecast when there is one; with 'bara mat' on (a
 *   setting), only the food in the pace (and fuel) — a month of spending on
 *   nothing else, after a big purchase;
 * - planned items (a scenario saved): on their day from a bank account, on
 *   the card invoice's pay day when bought on a card (see purchasePayDay),
 *   and a shared one's half back with Mio's next payment;
 * - what Mio swishes each month (optional, see partnerFlows).
 * The pace is split by the account it was paid from over the last 30 days:
 * a card with a known invoice cycle takes its share to its invoices, the rest
 * is drawn every day. Fixed expenses are never in the pace (their charges are
 * linked), so a subscription on the card is counted once, in its invoice.
 */

export const CASHFLOW_DAYS = 90;
export const DEFAULT_BUFFER = 200_000;
const LATE_INCOME_DAYS = 5;
const BUFFER_KEY = "cashflow_buffer";
const FOOD_ONLY_KEY = "cashflow_food_only";

/** 'Räkna bara med mat': the pace counts only the food (fuel is always counted). */
export const getFoodOnly = (db: Db): boolean => getSetting<boolean>(db, FOOD_ONLY_KEY, false) === true;

export function setFoodOnly(db: Db, on: boolean): boolean {
  if (typeof on !== "boolean") throw new Error("foodOnly ska vara sant/falskt.");
  setSetting(db, FOOD_ONLY_KEY, on);
  return on;
}

/** Mat: the main category Livsmedel is under (found by its key, so a rename doesn't break it). */
function foodCategory(db: Db): number | null {
  const groceries = categoryIdByKey(db, "groceries");
  if (groceries === undefined) return null;
  return db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, groceries)).get()?.parentId ?? groceries;
}

export function getBuffer(db: Db): number {
  const v = getSetting<number>(db, BUFFER_KEY, DEFAULT_BUFFER);
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_BUFFER;
}

export function setBuffer(db: Db, ore: number): number {
  if (!Number.isInteger(ore) || ore < 0) throw new Error("Bufferten ska vara ett antal öre, 0 eller mer.");
  setSetting(db, BUFFER_KEY, ore);
  return ore;
}

export interface CashEvent {
  date: string;
  kind: "income" | "fixed" | "invoice" | "planned" | "partner";
  name: string;
  /** Öre, signed: negative = out. */
  amount: number;
  /** An estimate rather than a known amount (a coming invoice). */
  estimate?: boolean;
  plannedId?: number;
  /** A card invoice: how much of it is the card's share of the pace still to come (öre, positive). */
  paced?: number;
  /** The tax refund (or kvarskatt) for this income year: its arithmetic is at /api/tax/refund/<year>. */
  taxRefundYear?: number;
}

/**
 * The tax refund on its pay day (a setting, 10 June by default) when that
 * day is within the forecast: last year's until Skatteverket has paid it,
 * this year's when the horizon reaches next June. Kvarskatt goes out the same
 * way. Estimated only when a pay day is in range, since it takes the whole
 * year's salary and tax.
 */
export function taxRefundEvents(db: Db, today: string, horizon: string): CashEvent[] {
  const day = refundSettings(db).payoutDay;
  const year = Number(today.slice(0, 4));
  return [year - 1, year].flatMap((y): CashEvent[] => {
    const date = `${y + 1}-${day}`;
    if (date < today || date > horizon) return [];
    const r = estimateTaxRefund(db, y, today);
    if (r.refund === null || r.refund === 0 || r.paid) return [];
    return [
      {
        date,
        kind: r.refund > 0 ? "income" : "fixed",
        name: r.refund > 0 ? `Skatteåterbäring ${y} (uppskattad)` : `Kvarskatt ${y} (uppskattad)`,
        amount: r.refund * 100,
        estimate: true,
        taxRefundYear: y,
      },
    ];
  });
}

/** A planned item as the forecast counts it: when it leaves the bank, and a shared one's half when it comes back. */
export interface PlannedPayment {
  /** The invoice's pay day for a card purchase, else the day itself. */
  payDate: string;
  /** Paid with a card: its name. */
  card: string | null;
  /** Shared: the partner's half (öre, positive) and the day it comes back. */
  partnerHalf: number;
  partnerDate: string | null;
}

export interface CashDay {
  date: string;
  /** At the end of the day. */
  balance: number;
  /** Variable spending and fuel this day (öre, positive). */
  variable: number;
  events: CashEvent[];
}

// ---------- Incomes ----------

const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** 'prognos, 145 tim' (and the vacation left when it is paid with it), or 'enligt lönespec' once the payslip is in. */
const forecastText = (f: SalaryForecast) =>
  f.fromSpec ? "enligt lönespec" : `prognos, ${f.assumed ? "vanlig månad" : `${f.hours.toLocaleString("sv-SE")} tim`}${f.vacationPayout ? " + outtagen semester" : ""}`;

function incomes(db: Db, today: string, horizon: string, bankIds: Set<number>): CashEvent[] {
  const out: CashEvent[] = [];
  // The salary: Löneprognos's net and pay day for months with hours entered.
  const main = mainIncome(db);
  const forecasts = salaryForecasts(db, today);
  // The day each account's balance is from: an income booked for a later day isn't in it yet.
  const balanceDay = new Map(db.select({ id: accounts.id, at: accounts.balanceUpdatedAt }).from(accounts).all().map((a) => [a.id, a.at?.slice(0, 10) ?? null]));
  for (const i of db.select().from(recurringIncome).where(eq(recurringIncome.active, true)).all()) {
    if (i.accountId !== null && !bankIds.has(i.accountId)) continue;
    const rows = db
      .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, amount: transactions.amount, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.recurringIncomeId, i.id), isNull(transactions.deletedAt)))
      .all();
    const got = rows.map((t) => nearestDue(t.bookingDate, i.dayOfMonth).month);
    // Booked but not yet in the balance: Swedbank books the salary the day
    // before with the pay day as its transaction day, and the available
    // balance has it only from then. It comes in on that day, with its amount.
    for (const t of rows) {
      const from = t.accountId === null ? null : balanceDay.get(t.accountId);
      if (!t.transactionDate || t.transactionDate <= t.bookingDate || !from || t.transactionDate <= from || t.amount <= 0 || !bankIds.has(t.accountId!)) continue;
      const date = t.transactionDate < today ? today : t.transactionDate;
      if (date <= horizon) out.push({ date, kind: "income", name: `${i.name} (bokförd ${dm(t.bookingDate)}, i saldot ${dm(t.transactionDate)})`, amount: t.amount });
    }
    const overrides = new Map(
      db.select().from(recurringIncomeOverrides).where(eq(recurringIncomeOverrides.recurringIncomeId, i.id)).all().map((o) => [o.month, o.amount]),
    );
    for (let m = addMonths(monthOf(today), -1); m <= monthOf(horizon); m = addMonths(m, 1)) {
      if (got.includes(m)) continue;
      const f = i.id === main?.id ? forecasts.get(m) : undefined;
      let date = f?.payDate ?? dueDateIn(m, i.dayOfMonth);
      if (date < today) {
        if (daysBetween(date, today) > LATE_INCOME_DAYS) continue;
        date = today;
      }
      if (date > horizon) continue;
      out.push(f ? { date, kind: "income", name: `${i.name} (${forecastText(f)})`, amount: f.net } : { date, kind: "income", name: i.name, amount: overrides.get(m) ?? i.amount, estimate: true });
    }
  }
  return out;
}

// ---------- Money between us ----------

/** Mio settles the month around the 25th. */
const PARTNER_DAY = 25;
const PARTNER_MONTHS = 3;

/**
 * What Mio swishes each month (the shared economy's result), on the 25th:
 * this month what Delad ekonomi says she owes now, later months the average
 * of the last three whole months' money between us. An estimate, and one the
 * view can leave out: 'kvar att leva på' never counts it.
 */
function partnerFlows(db: Db, today: string, horizon: string): CashEvent[] {
  const out: CashEvent[] = [];
  const name = `Från ${getPartnerName(db)}`;
  const now = partnerOutstanding(db, today);
  const thisDay = dueDateIn(monthOf(today), PARTNER_DAY);
  if (now.amount !== 0) out.push({ date: thisDay < today ? today : thisDay, kind: "partner", name, amount: now.amount, estimate: true });
  const keys = (["from_partner", "to_partner"] as const).map((k) => categoryIdByKey(db, k)).filter((id): id is number => id !== undefined);
  const from = `${addMonths(monthOf(today), -PARTNER_MONTHS)}-01`;
  const to = addDays(`${monthOf(today)}-01`, -1);
  const net =
    db
      .select({ s: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(inArray(transactions.categoryId, keys), isNull(transactions.deletedAt), gte(transactions.bookingDate, from), lte(transactions.bookingDate, to)))
      .get()?.s ?? 0;
  const average = Math.round(net / PARTNER_MONTHS);
  if (average === 0) return out;
  for (let m = addMonths(monthOf(today), 1); m <= monthOf(horizon); m = addMonths(m, 1)) {
    const date = dueDateIn(m, PARTNER_DAY);
    if (date <= horizon) out.push({ date, kind: "partner", name, amount: average, estimate: true });
  }
  return out;
}

// ---------- Card invoices ----------

/** Fixed expenses on a card still to come between two days (inclusive). */
const cardFixed = (occ: Occurrence[], accountId: number, from: string, to: string) =>
  occ.filter((o) => o.accountId === accountId && o.status === "kommande" && o.dueDate >= from && o.dueDate <= to).reduce((s, o) => s + o.amount, 0);

/**
 * Mastercard is paid on the 25th of the month its invoice is due, with the
 * salary, rather than on the due date at the end of the month (sometimes
 * earlier: then the payment is seen and the invoice is paid). A due date
 * before the 25th stays.
 */
const MASTERCARD_PAY_DAY = 25;
export const mastercardPayDay = (dueDate: string) => {
  const day = dueDateIn(monthOf(dueDate), MASTERCARD_PAY_DAY);
  return day < dueDate ? day : dueDate;
};

/** Days from `from` to `to`, both included; none when `to` is before `from`. */
const daysIn = (from: string, to: string) => (to < from ? 0 : daysBetween(from, to) + 1);

/**
 * The cards whose invoices carry their share of the pace: Mastercard with an
 * imported invoice to go from, Bank Norwegian with its invoice periods.
 */
export function cardsWithCycle(db: Db, today: string): Set<number> {
  const out = new Set(upcomingInvoices(db, today).map((u) => u.accountId));
  const norwegian = cardInvoicePeriod(db, monthOf(today));
  if (norwegian) out.add(norwegian.accountId);
  return out;
}

function invoices(db: Db, today: string, horizon: string, occ: Occurrence[], cardPace: Map<number, number> = new Map()): CashEvent[] {
  const out: CashEvent[] = [];
  const tomorrow = addDays(today, 1);
  // The card's spending still to come in a period: its share of the pace, from tomorrow.
  const paced = (accountId: number, from: string, to: string) => Math.round((cardPace.get(accountId) ?? 0) * daysIn(from < tomorrow ? tomorrow : from, to));

  // Imported invoices not paid yet (one overdue is due now).
  const mastercards = new Set(db.select({ id: accounts.id }).from(accounts).where(eq(accounts.source, "mastercard")).all().map((a) => a.id));
  for (const i of cardInvoices(db, today)) {
    if (i.status === "paid") continue;
    const pay = mastercards.has(i.accountId) ? mastercardPayDay(i.dueDate) : i.dueDate;
    const date = pay < today ? today : pay;
    if (date <= horizon) out.push({ date, kind: "invoice", name: `${i.accountName}: faktura`, amount: -(i.amountDue - i.paidAmount) });
  }

  // Mastercard: the next invoice, then one per cycle after it (the card's fixed and its share of the pace).
  for (const u of upcomingInvoices(db, today)) {
    const next = mastercardPayDay(u.dueDate);
    if (next <= horizon) {
      const coming = paced(u.accountId, tomorrow, u.periodTo);
      out.push({ date: next < today ? today : next, kind: "invoice", name: `${u.accountName}: nästa faktura`, amount: -(u.estimate + coming), estimate: true, ...(coming ? { paced: coming } : {}) });
    }
    const cutoff = Number(u.periodTo.slice(8, 10));
    for (let to = u.periodTo; ; ) {
      const from = addDays(to, 1);
      to = dueDateIn(addMonths(monthOf(to), 1), cutoff);
      const due = mastercardPayDay(lastBankDayOfMonth(monthOf(to)));
      if (due > horizon) break;
      const coming = paced(u.accountId, from, to);
      const amount = cardFixed(occ, u.accountId, from < tomorrow ? tomorrow : from, to) + coming;
      if (amount) out.push({ date: due, kind: "invoice", name: `${u.accountName}: faktura`, amount: -amount, estimate: true, ...(coming ? { paced: coming } : {}) });
    }
  }

  // Bank Norwegian: per period, what is bought so far in it plus the card's fixed still to come.
  for (let m = addMonths(monthOf(today), -1); m <= addMonths(monthOf(horizon), 1); m = addMonths(m, 1)) {
    const p = cardInvoicePeriod(db, m);
    if (!p || p.payDate < today || p.payDate > horizon) continue;
    // An imported invoice for the period is counted above (when unpaid).
    if (db.select({ id: statements.id }).from(statements).where(and(eq(statements.accountId, p.accountId), eq(statements.periodTo, p.to))).get()) continue;
    const account = db.select().from(accounts).where(eq(accounts.id, p.accountId)).get()!;
    const bought = p.from <= today
      ? -(
          db
            .select({ s: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
            .from(transactions)
            .where(
              and(
                eq(transactions.accountId, p.accountId),
                isNull(transactions.deletedAt),
                eq(transactions.isTransfer, false),
                sql`${postedDaySql} between ${p.from} and ${p.to < today ? p.to : today}`,
              ),
            )
            .get()?.s ?? 0
        )
      : 0;
    const fixed = cardFixed(occ, p.accountId, p.from < tomorrow ? tomorrow : p.from, p.to);
    const coming = paced(p.accountId, p.from, p.to);
    // Paid from a bank account since the period closed (on the pay day or before
    // it): that is already out of the balance, so only what is left is to come.
    const paid =
      p.to < today
        ? -(
            db
              .select({ s: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
              .from(transactions)
              .innerJoin(accounts, eq(accounts.id, transactions.accountId))
              .where(
                and(
                  eq(accounts.kind, "bank"),
                  eq(transactions.counterAccountId, p.accountId),
                  eq(transactions.isTransfer, true),
                  isNull(transactions.deletedAt),
                  sql`${transactions.amount} < 0`,
                  sql`${transactions.bookingDate} > ${p.to}`,
                  sql`${transactions.bookingDate} <= ${today}`,
                ),
              )
              .get()?.s ?? 0
          )
        : 0;
    const amount = Math.max(0, Math.max(0, bought) + fixed + coming - paid);
    if (amount) {
      out.push({ date: p.payDate, kind: "invoice", name: `${account.name}: faktura`, amount: -amount, estimate: p.to >= today || fixed > 0 || coming > 0, ...(coming ? { paced: coming } : {}) });
    }
  }
  return out;
}

// ---------- Planned purchases ----------

/**
 * When a purchase made on `date` with an account leaves the bank: a bank
 * account on the day; a card on the pay day of the invoice it lands on, by
 * the posting day (the purchase day + 1, as for rows without one). Bank
 * Norwegian by its invoice periods (Delad ekonomi's), Mastercard by its next
 * invoice and a cycle a month after it (as the forecast's invoices). A card
 * without a known cycle: the day itself.
 */
export function purchasePayDay(db: Db, accountId: number | null, date: string, today: string): { payDate: string; card: string | null } {
  const account = accountId !== null ? db.select().from(accounts).where(eq(accounts.id, accountId)).get() : undefined;
  if (!account || account.kind !== "credit_card") return { payDate: date, card: null };
  const payDate = postedPayDay(db, account, addDays(date, 1), today);
  return { payDate: payDate === null || payDate < date ? date : payDate, card: account.name };
}

/** The pay day of the invoice a card row posted on `posted` lands on (see purchasePayDay), or null when the card's cycle is unknown. */
export function postedPayDay(db: Db, account: { id: number; source: string | null }, posted: string, today: string): string | null {
  if (account.source === "norwegian") {
    for (let m = monthOf(posted); m <= addMonths(monthOf(posted), 2); m = addMonths(m, 1)) {
      const p = cardInvoicePeriod(db, m);
      if (p && p.accountId === account.id && p.from <= posted && posted <= p.to) return p.payDate;
    }
    return null;
  }
  const next = upcomingInvoices(db, today).find((u) => u.accountId === account.id);
  return next ? mastercardCyclePayDay(next.periodTo, posted) : null;
}

/** A Mastercard row posted on `posted`, on or after the period ending `periodTo`: the pay day of the invoice it lands on, a period a month on per cycle. */
export function mastercardCyclePayDay(periodTo: string, posted: string): string {
  const cutoff = Number(periodTo.slice(8, 10));
  let to = periodTo;
  while (posted > to) to = dueDateIn(addMonths(monthOf(to), 1), cutoff);
  return mastercardPayDay(lastBankDayOfMonth(monthOf(to)));
}

/** A planned item's payment: its pay day, and a shared one's half back on Mio's next day on or after it. */
export function plannedPayment(db: Db, p: { date: string; amount: number; accountId: number | null; shared: boolean }, today: string): PlannedPayment {
  const { payDate, card } = purchasePayDay(db, p.accountId, p.date, today);
  if (!p.shared || p.amount >= 0) return { payDate, card, partnerHalf: 0, partnerDate: null };
  const thisMonth = dueDateIn(monthOf(payDate), PARTNER_DAY);
  return { payDate, card, partnerHalf: Math.round(-p.amount / 2), partnerDate: thisMonth >= payDate ? thisMonth : dueDateIn(addMonths(monthOf(payDate), 1), PARTNER_DAY) };
}

// ---------- Variable spending and fuel ----------

/** Fuel per day by the month forecast (this month what is left, later months their whole cost), or null without one. */
function fuelPerDay(db: Db, today: string, horizon: string): ((date: string) => number) | null {
  const now = monthForecast(db, monthOf(today), today).forecast;
  if (!now) return null;
  const perMonth = new Map<string, number>();
  const shifts = shiftsByMonth(db);
  const daysLeft = daysBetween(today, `${monthOf(today)}-${String(daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)))).padStart(2, "0")}`);
  perMonth.set(monthOf(today), daysLeft > 0 ? (now.remaining + now.expectedCongestion) / daysLeft : 0);
  for (let m = addMonths(monthOf(today), 1); m <= monthOf(horizon); m = addMonths(m, 1)) {
    const f = monthForecast(db, m, today, shifts.get(m) ?? now.shifts).forecast!;
    perMonth.set(m, (f.expectedFuel + f.expectedCongestion) / daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7))));
  }
  return (date) => perMonth.get(monthOf(date)) ?? 0;
}

// ---------- The forecast ----------

export function cashflow(db: Db, today: string, opts: { days?: number; partner?: boolean } = {}) {
  const days = opts.days ?? CASHFLOW_DAYS;
  const horizon = addDays(today, days);
  const bank = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.kind, "bank"), eq(accounts.trackBalance, true)))
    .orderBy(accounts.id)
    .all();
  const bankIds = new Set(bank.map((a) => a.id));
  const liquid = liquidCash(db, today);
  const start = bank.reduce((s, a) => s + a.balance, 0) + liquid.totalOre;

  // Variable spending: fuel by its own forecast when there is one (and then left out of the pace).
  const fuel = fuelPerDay(db, today, horizon);
  const fuelCategory = getFuelSettings(db).fuelCategoryId;
  const excluded = fuel && fuelCategory !== null ? new Set([fuelCategory]) : new Set<number>();
  const fullPace = spendingPace(db, today, "paid", excluded);
  // Bara mat: the food, and the fuel when it has no forecast of its own (it is always counted).
  const foodOnly = getFoodOnly(db);
  const food = foodCategory(db);
  const only = new Set([food, !fuel ? fuelCategory : null].filter((id): id is number => id !== null));
  const pace = foodOnly ? spendingPace(db, today, "paid", excluded, only) : fullPace;
  // A card with an invoice cycle pays its share of the pace with its invoices; the rest leaves every day.
  const cycles = cardsWithCycle(db, today);
  const onCards = (p: ReturnType<typeof spendingPace>) =>
    new Map([...p.perDayByAccount].filter((e): e is [number, number] => e[0] !== null && cycles.has(e[0])));
  const fromBank = (p: ReturnType<typeof spendingPace>) => Math.max(0, p.perDay - [...onCards(p).values()].reduce((s, v) => s + v, 0));
  const cardPace = onCards(pace);
  // Bara mat: the food on the cards (with their invoices), and from the bank only the fuel — the food
  // bought with the bank card varies too much to count on. With a fuel forecast that is drawn below.
  const bankPerDay = !foodOnly
    ? fromBank(pace)
    : !fuel && fuelCategory !== null
      ? fromBank(spendingPace(db, today, "paid", new Set(), new Set([fuelCategory])))
      : 0;
  const pacePerDay = Math.round(bankPerDay + [...cardPace.values()].reduce((s, v) => s + v, 0));
  const cardNames = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));

  const occ = expenseOccurrences(db, today, null, horizon);
  const fixed: CashEvent[] = occ
    .filter((o) => o.status === "kommande" && o.dueDate >= today && o.dueDate <= horizon && o.accountId !== null && bankIds.has(o.accountId))
    .map((o) => ({ date: o.dueDate, kind: "fixed", name: o.name, amount: -o.amount }));
  const planned = db
    .select()
    .from(plannedItems)
    .where(and(gte(plannedItems.date, today), lte(plannedItems.date, horizon)))
    .orderBy(asc(plannedItems.date))
    .all();
  const partnerName = getPartnerName(db);
  const plannedOut = planned.map((p) => ({ ...p, ...plannedPayment(db, p, today) }));
  const plannedEvents = plannedOut.flatMap((p): CashEvent[] => [
    { date: p.payDate, kind: "planned", name: p.card ? `${p.description} (${p.card}, köpt ${Number(p.date.slice(8, 10))}/${Number(p.date.slice(5, 7))})` : p.description, amount: p.amount, plannedId: p.id },
    ...(p.partnerDate && opts.partner !== false
      ? [{ date: p.partnerDate, kind: "partner" as const, name: `Från ${partnerName}: halva ${p.description}`, amount: p.partnerHalf, estimate: true, plannedId: p.id }]
      : []),
  ]);
  const events = [
    ...incomes(db, today, horizon, bankIds),
    ...fixed,
    ...invoices(db, today, horizon, occ, cardPace),
    ...(opts.partner === false ? [] : partnerFlows(db, today, horizon)),
    ...plannedEvents.filter((e) => e.date <= horizon),
    ...taxRefundEvents(db, today, horizon),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);


  const out: CashDay[] = [];
  let balance = start;
  let variableTotal = 0;
  let fuelTotal = 0;
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const todays = events.filter((e) => e.date === date);
    // Today's spending has (mostly) happened already: the pace starts tomorrow.
    const f = i === 0 || !fuel ? 0 : fuel(date);
    const v = i === 0 ? 0 : bankPerDay + f;
    variableTotal += i === 0 ? 0 : pace.perDay;
    fuelTotal += f;
    balance += todays.reduce((s, e) => s + e.amount, 0) - v;
    out.push({ date, balance: Math.round(balance), variable: Math.round(v), events: todays });
  }
  const lowest = out.reduce((lo, d) => (d.balance < lo.balance ? d : lo), out[0]);
  const buffer = getBuffer(db);
  return {
    today,
    horizon,
    partner: opts.partner !== false,
    partnerName,
    start,
    accounts: bank.map((a) => ({ id: a.id, name: a.name, balance: a.balance, updatedAt: a.balanceUpdatedAt })),
    /** In `start`: the cash on Avanza (entered, plus moved there since). */
    liquid,
    buffer,
    days: out,
    events,
    lowest: { date: lowest.date, balance: lowest.balance },
    safeToSpend: lowest.balance - buffer,
    variable: {
      perDay: pacePerDay,
      total: Math.round(variableTotal),
      fuel: fuel ? Math.round(fuelTotal) : null,
      fullPerDay: fullPace.perDay,
      /** Drawn from the bank day by day; the cards' shares go with their invoices. */
      bankPerDay: Math.round(bankPerDay),
      cards: [...cardPace].sort((a, b) => a[0] - b[0]).map(([accountId, perDay]) => ({ accountId, name: cardNames.get(accountId) ?? "Kort", perDay: Math.round(perDay) })),
    },
    /** Räkna bara med mat: the pace is the food (and fuel) only. */
    foodOnly,
    planned: plannedOut,
  };
}

export type Cashflow = ReturnType<typeof cashflow>;

/**
 * Kvar vid månadsskiftet: what the cash flow says is left when the month is
 * over (at the end of its last day) — this month's salary, bills and card
 * invoices paid, next month's not yet, the spending from the bank drawn up
 * to then. The day it stands for is the 1st of the next month.
 */
/** Every month end in the forecast, as Kvar vid månadsskiftet for the 1st after it. */
export function monthStarts(flow: Pick<Cashflow, "days">): { date: string; month: string; balance: number }[] {
  return flow.days.filter((d) => addDays(d.date, 1).endsWith("-01")).map((d) => ({ date: addDays(d.date, 1), month: monthOf(d.date), balance: d.balance }));
}

export interface MonthStartTerm {
  /** income: the salary and other incomes; partner: the settlement with the partner; bills: fixed expenses, card invoices, planned items and the spending from the bank. */
  key: "income" | "partner" | "bills";
  label: string;
  /** Öre, signed. */
  amount: number;
  /** The days it falls on. */
  from: string;
  to: string;
  /** Some part only estimated (a coming invoice, the partner's settlement, the pace). */
  estimate: boolean;
  items: { date: string; name: string; amount: number; estimate: boolean }[];
}

/** "Lön (bokförd 24/9, i saldot 25/9)" → "Lön". */
const bare = (name: string) => name.replace(/\s*\(.*\)$/, "");

/**
 * The way to the 1st as terms: the money now plus each term is the balance
 * on the month's last day, to the öre. The pace and fuel drawn from the bank
 * are what is left over, so the rounding of the daily amounts can't put it
 * a few öre off.
 */
export function monthStartTerms(flow: Cashflow, last: string, balance: number): MonthStartTerm[] {
  const events = flow.days.filter((d) => d.date <= last).flatMap((d) => d.events);
  const item = (e: CashEvent) => ({ date: e.date, name: e.name, amount: e.amount, estimate: !!e.estimate });
  const variable = balance - flow.start - events.reduce((s, e) => s + e.amount, 0);
  const paced = flow.days.filter((d) => d.date <= last && d.variable > 0);
  const variableItem =
    variable !== 0
      ? [
          {
            date: paced[0]?.date ?? last,
            name: flow.variable.bankPerDay === 0 ? "Bränsle kvar att tanka" : flow.variable.fuel ? "Rörligt från banken och bränsle" : "Rörligt från banken",
            amount: variable,
            estimate: true,
          },
        ]
      : [];
  const term = (key: MonthStartTerm["key"], label: string, items: MonthStartTerm["items"]): MonthStartTerm[] =>
    items.length
      ? [
          {
            key,
            label,
            amount: items.reduce((s, i) => s + i.amount, 0),
            from: items.reduce((d, i) => (i.date < d ? i.date : d), items[0].date),
            to: items.reduce((d, i) => (i.date > d ? i.date : d), items[0].date),
            estimate: items.some((i) => i.estimate),
            items,
          },
        ]
      : [];
  const incomes = events.filter((e) => e.kind === "income").map(item);
  const partner = events.filter((e) => e.kind === "partner").map(item);
  const bills = [...events.filter((e) => e.kind === "fixed" || e.kind === "invoice" || e.kind === "planned").map(item), ...variableItem].sort(
    (a, b) => a.date.localeCompare(b.date) || a.amount - b.amount,
  );
  const toPartner = partner.reduce((s, i) => s + i.amount, 0) < 0;
  return [
    ...term("income", incomes.length === 1 ? bare(incomes[0].name) : "Inkomster", incomes),
    ...term("partner", `${toPartner ? "Till" : "Från"} ${flow.partnerName}`, partner),
    ...term("bills", "Räkningar", bills),
  ];
}

export function monthStart(db: Db, today: string, flow: Cashflow = cashflow(db, today)) {
  const last = dueDateIn(monthOf(today), 31);
  const day = flow.days.find((d) => d.date === last);
  if (!day) return null;
  return {
    date: addDays(last, 1),
    balance: day.balance,
    /** Where it starts: the bank accounts and the cash on Avanza, as in Pengar nu. */
    start: flow.start,
    /** start + the terms' amounts = balance. */
    terms: monthStartTerms(flow, last, day.balance),
    /** In the balance: the cash on Avanza (it can be moved to the bank any day). */
    cashOre: flow.liquid.totalOre,
    /** The month whose bills are paid by then. */
    month: monthOf(today),
    foodOnly: flow.foodOnly,
    partner: flow.partner,
  };
}
