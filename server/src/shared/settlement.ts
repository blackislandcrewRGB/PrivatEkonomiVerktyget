import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { perGeneration } from "../db/generation.js";
import { accounts, categories, imports, recurringExpenses, settlements, statements, transactions, IMPORT_SOURCES } from "../db/schema.js";
import { accountFor, activeIn, counts, skippedPeriods } from "../recurring/changes.js";
import { chargePeriod, expectedAmounts } from "../recurring/amounts.js";
import { chargeOwnerId, chargeShare, partsByOwner } from "../recurring/parts.js";
import { occurrenceFor } from "../recurring/schedule.js";
import { DAY_TOLERANCE, patternMatches } from "../recurring/link.js";
import { getOwnName, getPartnerName, getSettlementStart } from "../settings.js";
import { addDays, addMonths, daysBetween, daysInMonth, dueDateIn, monthOf } from "../overview/dates.js";
import { lastBankDayOfMonth } from "../calendar/bankDays.js";

/**
 * The shared economy per month, by the day money actually leaves my account:
 *
 *   result = carry in + (shared I paid − shared the partner paid) / 2
 *            + hers that I paid − mine that she paid − (from partner − to partner)
 *
 * Positive: the partner pays me. A Bank Norwegian purchase counts when the
 * invoice it is on is paid (invoice period 16th–15th, paid the 25th), a fixed
 * expense on its charge day, a Swedbank row on its booking day. So on the
 * 25th, rent and the card bill land in the same month as the partner's Swish
 * for them. Items paid after today are shown as coming and left out of the
 * result 'so far'.
 *
 * Carry in is the previous month's result (locked if reconciled) from the
 * start month on.
 */

/** Bank Norwegian: the invoice period ends on this day (unless an imported invoice says otherwise)… */
const DEFAULT_CARD_CUTOFF_DAY = 15;
/** …and the invoice is paid on this day of the same month. */
const CARD_PAY_DAY = 25;
/** A payment to the card this many days after the period end counts as paying that invoice. */
const PAYMENT_WINDOW_DAYS = 25;

export interface SharedRow {
  id: number | null;
  /** Purchase or charge date. */
  date: string;
  /** When the money leaves (or left) my account: decides the month and 'paid so far'. */
  payDate: string;
  paid: boolean;
  description: string;
  /** Positive öre = cost (a refund is negative). */
  amount: number;
  /** Fixed expenses: 'dragen' (linked charges) or 'förväntat' (not drawn, expected amount). */
  status?: "dragen" | "forvantat";
  recurringExpenseId?: number;
  /** The row's category (a fixed expense: the expense's), for the chip. */
  categoryId?: number | null;
}

export interface SharedGroup {
  key: string;
  kind: "norwegian" | "mastercard" | "recurring" | "swedbank" | "manual";
  label: string;
  /** For a card invoice: its pay date and the last purchase day it covers. */
  payDate?: string;
  periodEnd?: string;
  total: number;
  paidTotal: number;
  rows: SharedRow[];
}

export interface Figures {
  iPaid: number;
  partnerPaid: number;
  /** Wholly the partner's, paid by me: she owes all of it. */
  iPaidForPartner: number;
  /** Wholly mine, paid by the partner: I owe all of it. */
  partnerPaidForMe: number;
  fromPartner: number;
  toPartner: number;
  carryIn: number;
  /** (iPaid − partnerPaid) / 2, rounded to whole öre. */
  half: number;
  result: number;
}

const GROUP_LABEL = { swedbank: "Swedbank", manual: "Manuellt inlagda", recurring: "Fasta utgifter" } as const;

const txDate = sql<string>`coalesce(${transactions.transactionDate}, ${transactions.bookingDate})`;

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}` };
}

// ---------- Card invoices: when is a purchase paid? ----------

interface CardCycle {
  accountId: number;
  source: "norwegian" | "mastercard";
  label: string;
  /** Purchases before this day count on their charge day (months already settled that way). */
  from: string | null;
  cutoffDay: number;
  /** Bank-side payments to the card, booking dates ascending. */
  payments: string[];
  invoices: { periodFrom: string | null; periodTo: string; dueDate: string }[];
}

/**
 * Mastercard's shared purchases counted on their charge day up to September
 * 2026, a month before the invoice is paid; from October they count when it
 * is paid, like Bank Norwegian's (the card invoices belong to the next
 * salary). The months already settled stay as they were.
 */
export const MASTERCARD_SHARED_FROM = "2026-10-01";

/**
 * Invoice cycles for the cards whose shared purchases count when the invoice
 * is paid: Bank Norwegian, and Mastercard from MASTERCARD_SHARED_FROM (its
 * imported invoices, and the next one to the period end the latest names).
 */
// Kept until the database changes: a request asks for them again and again (the last 12 invoices ask once each).
const loadCardCycles = perGeneration(readCardCycles);

function readCardCycles(db: Db): Map<number, CardCycle> {
  const out = new Map<number, CardCycle>();
  for (const a of db.select().from(accounts).where(and(eq(accounts.kind, "credit_card"), eq(accounts.source, "mastercard"))).all()) {
    const invoices = db
      .select({ periodFrom: statements.periodFrom, periodTo: statements.periodTo, dueDate: statements.dueDate, nextPeriodTo: statements.nextPeriodTo })
      .from(statements)
      .where(and(eq(statements.accountId, a.id), sql`${statements.periodTo} is not null`))
      .orderBy(statements.periodTo)
      .all() as (CardCycle["invoices"][number] & { nextPeriodTo: string | null })[];
    const latest = invoices.at(-1);
    if (!latest) continue;
    const cycle = invoices.map(({ periodFrom, periodTo, dueDate }) => ({ periodFrom, periodTo, dueDate }));
    if (latest.nextPeriodTo) cycle.push({ periodFrom: addDays(latest.periodTo, 1), periodTo: latest.nextPeriodTo, dueDate: lastBankDayOfMonth(monthOf(latest.nextPeriodTo)) });
    const payments = db
      .select({ date: transactions.bookingDate })
      .from(transactions)
      .where(and(eq(transactions.counterAccountId, a.id), sql`${transactions.amount} < 0`, isNull(transactions.deletedAt)))
      .orderBy(transactions.bookingDate)
      .all()
      .map((p) => p.date);
    out.set(a.id, { accountId: a.id, source: "mastercard", label: a.name, from: MASTERCARD_SHARED_FROM, cutoffDay: Number(latest.periodTo.slice(8, 10)), payments, invoices: cycle });
  }
  for (const a of db.select().from(accounts).where(and(eq(accounts.kind, "credit_card"), eq(accounts.source, "norwegian"))).all()) {
    const invoices = db
      .select({ periodFrom: statements.periodFrom, periodTo: statements.periodTo, dueDate: statements.dueDate })
      .from(statements)
      .where(and(eq(statements.accountId, a.id), sql`${statements.periodTo} is not null`))
      .orderBy(statements.periodTo)
      .all() as CardCycle["invoices"];
    const payments = db
      .select({ date: transactions.bookingDate })
      .from(transactions)
      .where(and(eq(transactions.counterAccountId, a.id), sql`${transactions.amount} < 0`, isNull(transactions.deletedAt)))
      .orderBy(transactions.bookingDate)
      .all()
      .map((p) => p.date);
    const latest = invoices.at(-1);
    out.set(a.id, { accountId: a.id, source: "norwegian", label: "Bank Norwegian", from: null, cutoffDay: latest ? Number(latest.periodTo.slice(8, 10)) : DEFAULT_CARD_CUTOFF_DAY, payments, invoices });
  }
  return out;
}

/**
 * The invoice a card purchase is on and when it is paid: the first payment to
 * the card after the period ends, else the 25th of that month (never after the
 * due date). `date` is the day the bank posted the purchase: the invoice period
 * goes by that, not by the purchase day.
 */
function cardPayDate(cycle: CardCycle, date: string): { payDate: string; periodEnd: string } {
  const invoice = cycle.invoices.find((i) => (i.periodFrom ?? "") <= date && date <= i.periodTo);
  let periodEnd: string;
  let due: string;
  if (invoice) {
    periodEnd = invoice.periodTo;
    due = invoice.dueDate;
  } else {
    const month = Number(date.slice(8, 10)) <= cycle.cutoffDay ? monthOf(date) : addMonths(monthOf(date), 1);
    periodEnd = dueDateIn(month, cycle.cutoffDay);
    due = dueDateIn(month, 28);
  }
  const payment = cycle.payments.find((p) => p > periodEnd && p <= addDays(periodEnd, PAYMENT_WINDOW_DAYS));
  const planned = dueDateIn(monthOf(periodEnd), CARD_PAY_DAY);
  return { payDate: payment ?? (planned > periodEnd && planned < due ? planned : due), periodEnd };
}

/**
 * The Bank Norwegian invoice whose period ends in `month` ('YYYY-MM'): its
 * period by posting day (an imported invoice's own period, else the 16th–15th)
 * and the day it is (or will be) paid. Null without a Norwegian card account.
 */
export function cardInvoicePeriod(db: Db, month: string) {
  const cycle = [...loadCardCycles(db).values()].find((c) => c.source === "norwegian");
  if (!cycle) return null;
  const invoice = cycle.invoices.find((i) => monthOf(i.periodTo) === month);
  const to = invoice?.periodTo ?? dueDateIn(month, cycle.cutoffDay);
  const from = invoice?.periodFrom ?? addDays(dueDateIn(addMonths(month, -1), cycle.cutoffDay), 1);
  return { month, accountId: cycle.accountId, from, to, payDate: cardPayDate(cycle, to).payDate };
}

/** The last `count` Norwegian invoices, newest first, starting with the one still open today. */
export function cardInvoicePeriods(db: Db, today: string, count = 12) {
  const first = cardInvoicePeriod(db, monthOf(today));
  if (!first) return [];
  const open = first.to < today ? addMonths(monthOf(today), 1) : monthOf(today);
  return Array.from({ length: count }, (_, i) => cardInvoicePeriod(db, addMonths(open, -i))!);
}

/** SQL for the day a card row was posted: its BookDate, else the day after the purchase. */
export const postedDaySql = sql<string>`coalesce(${transactions.postedDate}, date(coalesce(${transactions.transactionDate}, ${transactions.bookingDate}), '+1 day'))`;

// ---------- One month ----------

type Cols = { id: number; date: string; bookingDate: string; label: string | null; descriptionClean: string; amount: number; categoryId: number | null };

/**
 * The day a card purchase was posted: the export's BookDate when known, else
 * the day after the purchase (what Bank Norwegian does; rows imported before
 * posting days were stored, or only from a PDF invoice).
 */
const posted = (r: { date: string; postedDate: string | null }) => r.postedDate ?? addDays(r.date, 1);

/** Everything for one month (by pay date), with 'paid so far' as of today. */
function monthRows(db: Db, month: string, today: string, cycles: Map<number, CardCycle>) {
  const { from, to } = monthRange(month);
  const inMonth = (d: string) => d >= from && d <= to;
  const describe = (r: Cols) => r.label ?? r.descriptionClean;
  /** The card's cycle for a purchase on `date`, when it counts by its invoice (Mastercard from October 2026). */
  const cycleFor = (accountId: number | null, date: string) => {
    const cycle = accountId !== null ? cycles.get(accountId) : undefined;
    return cycle && (!cycle.from || date >= cycle.from) ? cycle : undefined;
  };
  const payOn = (date: string, accountId: number | null) => {
    const cycle = cycleFor(accountId, date);
    return cycle ? cardPayDate(cycle, date) : { payDate: date, periodEnd: undefined };
  };
  /** An imported row: on a card by its posting day's invoice, otherwise on its booking day. */
  const payOnRow = (r: { date: string; bookingDate: string; postedDate: string | null }, accountId: number | null) => {
    const cycle = cycleFor(accountId, r.date);
    return cycle ? cardPayDate(cycle, posted(r)) : { payDate: r.bookingDate, periodEnd: undefined };
  };

  // A paused (cancelled) one up to its last draw: that charge is still shared.
  const sharedExpenses = db.select().from(recurringExpenses).where(eq(recurringExpenses.shared, true)).all().filter(counts);
  // The charges they are counted from (a part's is its owner's).
  const sharedExpenseIds = new Set(sharedExpenses.map((e) => chargeOwnerId(e)));

  // Shared rows I paid. Card purchases are paid up to two months later, so look back that far.
  const cols = {
    id: transactions.id,
    date: txDate,
    bookingDate: transactions.bookingDate,
    postedDate: transactions.postedDate,
    label: transactions.label,
    descriptionClean: transactions.descriptionClean,
    amount: transactions.amount,
    source: transactions.source,
    accountId: transactions.accountId,
    recurringExpenseId: transactions.recurringExpenseId,
    categoryId: transactions.categoryId,
    shared: transactions.shared,
    forOther: transactions.forOther,
    settlementExcluded: transactions.settlementExcluded,
    isSettlement: categories.isSettlement,
  };
  const candidates = db
    .select(cols)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.bookingDate, `${addMonths(month, -2)}-01`),
        lte(transactions.bookingDate, to),
        isNull(transactions.deletedAt),
        eq(transactions.private, false),
        eq(transactions.isTransfer, false),
        sql`(${transactions.shared} = 1 or ${transactions.forOther} = 1)`,
        isNull(transactions.returnGroupId),
        eq(transactions.paidBy, "me"),
      ),
    )
    .orderBy(txDate, transactions.id)
    .all()
    .filter((r) => !r.isSettlement && !(r.shared && r.recurringExpenseId !== null && sharedExpenseIds.has(r.recurringExpenseId)));

  const cardGroups = new Map<string, SharedGroup>();
  const plain: Record<"swedbank" | "manual", SharedRow[]> = { swedbank: [], manual: [] };
  const forPartner: SharedRow[] = [];
  for (const r of candidates) {
    const cycle = cycleFor(r.accountId, r.date);
    if (r.forOther) {
      const { payDate } = payOnRow(r, r.accountId);
      if (inMonth(payDate)) forPartner.push({ id: r.id, date: r.date, payDate, paid: payDate <= today, description: describe(r), amount: -r.amount, categoryId: r.categoryId });
    } else if (cycle) {
      const { payDate, periodEnd } = cardPayDate(cycle, posted(r));
      if (!inMonth(payDate)) continue;
      const key = `${cycle.source}:${payDate}`;
      const g = cardGroups.get(key) ?? ({ key, kind: cycle.source, label: cycle.label, payDate, periodEnd, total: 0, paidTotal: 0, rows: [] } as SharedGroup);
      g.rows.push({ id: r.id, date: r.date, payDate, paid: payDate <= today, description: describe(r), amount: -r.amount, categoryId: r.categoryId });
      cardGroups.set(key, g);
    } else if (inMonth(r.bookingDate)) {
      plain[r.source === "manual" ? "manual" : "swedbank"].push({
        id: r.id,
        date: r.date,
        payDate: r.bookingDate,
        paid: r.bookingDate <= today,
        description: describe(r),
        amount: -r.amount,
        categoryId: r.categoryId,
      });
    }
  }

  // Shared fixed expenses: the charge for each period (or the expected amount), paid on the charge day or with the card invoice.
  const expected = expectedAmounts(db);
  const parts = partsByOwner(db);
  const skipped = skippedPeriods(db);
  const recurring: SharedRow[] = [];
  const warnings: string[] = [];
  // For the warnings: shared rows I paid that no fixed expense has, around the charges expected this month.
  let unlinkedRows: { accountId: number | null; date: string; amount: number; label: string | null; descriptionClean: string }[] | undefined;
  const unlinkedShared = () =>
    (unlinkedRows ??= db
      .select({ accountId: transactions.accountId, date: txDate, amount: transactions.amount, label: transactions.label, descriptionClean: transactions.descriptionClean })
      .from(transactions)
      .where(
        and(
          gte(transactions.bookingDate, addDays(`${addMonths(month, -2)}-01`, -DAY_TOLERANCE)),
          lte(transactions.bookingDate, addDays(to, DAY_TOLERANCE)),
          isNull(transactions.deletedAt),
          isNull(transactions.recurringExpenseId),
          isNull(transactions.returnGroupId),
          eq(transactions.shared, true),
          eq(transactions.private, false),
          eq(transactions.isTransfer, false),
          eq(transactions.paidBy, "me"),
          sql`${transactions.amount} < 0`,
        ),
      )
      .all());
  let accountNameMap: Map<number, string> | undefined;
  const accountNames = () => (accountNameMap ??= new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name])));
  for (const e of sharedExpenses) {
    const linked = db
      .select({
        id: transactions.id,
        date: txDate,
        bookingDate: transactions.bookingDate,
        transactionDate: transactions.transactionDate,
        postedDate: transactions.postedDate,
        amount: transactions.amount,
        shared: transactions.shared,
        accountId: transactions.accountId,
      })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, chargeOwnerId(e)), isNull(transactions.deletedAt), eq(transactions.private, false)))
      .all();
    // Next month's too: a charge drawn days before its month (a yearly one due 1/10 drawn 28/9) counts when the money left.
    for (const period of [addMonths(month, -1), month, addMonths(month, 1)]) {
      if (!activeIn(e, period)) continue;
      const charges = linked.filter((t) => chargePeriod(e, t) === period);
      // Of next month only what is already drawn: the charge expected then is that month's.
      if (period > month && !charges.length) continue;
      if (charges.length) {
        for (const t of charges) {
          // The charge is shared like the expense, unless that one row was made own.
          if (!t.shared) continue;
          // Paid with the invoice of the card it was drawn on (the old one before a move).
          const { payDate } = payOnRow(t, t.accountId);
          if (inMonth(payDate)) {
            // Drawn together with others: its share (a part its amount, the owner the rest).
            const amount = chargeShare(e, parts, expected, -t.amount, period);
            recurring.push({ id: t.id, date: t.date, payDate, paid: payDate <= today, description: e.name, amount, status: "dragen", recurringExpenseId: e.id, categoryId: e.categoryId });
          }
        }
      } else if (skipped.has(`${e.id}|${period}`)) {
        // Not drawn that period (paused for a while): nothing to share.
        continue;
      } else if (e.billingCycle === "monthly" || occurrenceFor(e, period)) {
        // A yearly one only in its month.
        const date = occurrenceFor(e, period) ?? dueDateIn(period, 1);
        const accountId = accountFor(e, period);
        const { payDate } = payOn(date, accountId);
        if (!inMonth(payDate)) continue;
        recurring.push({ id: null, date, payDate, paid: payDate <= today, description: e.name, amount: expected(e, period), status: "forvantat", recurringExpenseId: e.id, categoryId: e.categoryId });
        // On an imported card without match text: a shared purchase on the same invoice with the
        // expense's name and about the same amount is probably this charge, counted twice.
        const amount = expected(e, period);
        const name = e.name.toLocaleUpperCase("sv").split(/\s+/)[0];
        const twin =
          accountId !== null && cycleFor(accountId, date) && !e.matchPattern && name.length >= 3
            ? cardGroups
                .get(`${cycleFor(accountId, date)!.source}:${payDate}`)
                ?.rows.find((r) => r.description.toLocaleUpperCase("sv").includes(name) && Math.abs(r.amount - amount) <= Math.max(100, amount * 0.2))
            : undefined;
        if (twin) {
          warnings.push(
            `${e.name} räknas troligen dubbelt: som förväntad fast utgift och som köpet "${twin.description}" ${twin.date} på kortet. Lägg till matchningstexten "${name}" under Fasta utgifter så kopplas dragningen.`,
          );
          continue;
        }
        // Drawn from another account than the period's (a new card without the move saved): that
        // row isn't linked, so it counts as a shared purchase of its own besides the expected charge.
        const moved = unlinkedShared().find(
          (r) =>
            r.accountId !== accountId &&
            Math.abs(daysBetween(date, r.date)) <= DAY_TOLERANCE &&
            Math.abs(-r.amount - amount) <= Math.max(100, amount * 0.2) &&
            (patternMatches(e.matchPattern, r.descriptionClean) || (name.length >= 3 && r.descriptionClean.toLocaleUpperCase("sv").includes(name))),
        );
        if (moved) {
          const on = (id: number | null) => (id !== null ? accountNames().get(id) : undefined) ?? "ett annat konto";
          warnings.push(
            `${e.name} räknas troligen dubbelt: som förväntad fast utgift på ${on(accountId)} och som köpet "${moved.label ?? moved.descriptionClean}" ${moved.date} på ${on(moved.accountId)}. Har den bytt konto? Ange det tidigare kontot under Fasta utgifter så kopplas dragningen dit.`,
          );
        }
      }
    }
  }

  const groups: SharedGroup[] = [];
  const sumOf = (rows: SharedRow[]) => rows.reduce((s, r) => s + r.amount, 0);
  const finish = (g: Omit<SharedGroup, "total" | "paidTotal">): SharedGroup => ({
    ...g,
    total: sumOf(g.rows),
    paidTotal: sumOf(g.rows.filter((r) => r.paid)),
  });
  for (const g of [...cardGroups.values()].sort((a, b) => a.payDate!.localeCompare(b.payDate!))) groups.push(finish(g));
  if (recurring.length) {
    groups.push(finish({ key: "recurring", kind: "recurring", label: GROUP_LABEL.recurring, rows: recurring.sort((a, b) => a.payDate.localeCompare(b.payDate)) }));
  }
  for (const kind of ["swedbank", "manual"] as const) {
    if (plain[kind].length) groups.push(finish({ key: kind, kind, label: GROUP_LABEL[kind], rows: plain[kind] }));
  }

  // What the partner paid, and the Swish between us: by booking day.
  const byDay = (rows: Cols[], sign: 1 | -1): SharedRow[] =>
    rows.map((r) => ({ id: r.id, date: r.date, payDate: r.bookingDate, paid: r.bookingDate <= today, description: describe(r), amount: sign * r.amount, categoryId: r.categoryId }));
  const partnerAll = db
    .select(cols)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(gte(transactions.bookingDate, from), lte(transactions.bookingDate, to), isNull(transactions.deletedAt), eq(transactions.paidBy, "partner")))
    .orderBy(transactions.bookingDate, transactions.id)
    .all();
  const partnerRows = byDay(partnerAll.filter((r) => !r.forOther), -1);
  const forMe = byDay(partnerAll.filter((r) => r.forOther), -1);
  const settlementRows = db
    .select(cols)
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.bookingDate, from),
        lte(transactions.bookingDate, to),
        isNull(transactions.deletedAt),
        eq(transactions.private, false),
        eq(categories.isSettlement, true),
      ),
    )
    .orderBy(transactions.bookingDate, transactions.id)
    .all();
  // Swish marked 'räkna inte' settled something on its own: listed, not counted.
  const counted = settlementRows.filter((r) => !r.settlementExcluded);
  const fromRows = byDay(counted.filter((r) => r.amount > 0), 1);
  const toRows = byDay(counted.filter((r) => r.amount < 0), -1);
  const excludedFrom = byDay(settlementRows.filter((r) => r.settlementExcluded && r.amount > 0), 1);
  const excludedTo = byDay(settlementRows.filter((r) => r.settlementExcluded && r.amount < 0), -1);

  const totals = (onlyPaid: boolean) => {
    const pick = (rows: SharedRow[]) => sumOf(onlyPaid ? rows.filter((r) => r.paid) : rows);
    return {
      iPaid: groups.reduce((s, g) => s + (onlyPaid ? g.paidTotal : g.total), 0),
      partnerPaid: pick(partnerRows),
      iPaidForPartner: pick(forPartner),
      partnerPaidForMe: pick(forMe),
      fromPartner: pick(fromRows),
      toPartner: pick(toRows),
    };
  };
  return {
    groups,
    partnerRows,
    forPartner: forPartner.sort((a, b) => a.payDate.localeCompare(b.payDate)),
    forMe,
    fromRows,
    toRows,
    excludedFrom,
    excludedTo,
    full: totals(false),
    sofar: totals(true),
    warnings: [...new Set(warnings)],
  };
}

type Totals = Omit<Figures, "carryIn" | "half" | "result">;

function figures(t: Totals, carryIn: number): Figures {
  const half = Math.round((t.iPaid - t.partnerPaid) / 2);
  const { iPaid, partnerPaid, iPaidForPartner, partnerPaidForMe, fromPartner, toPartner } = t;
  return {
    iPaid,
    partnerPaid,
    iPaidForPartner,
    partnerPaidForMe,
    fromPartner,
    toPartner,
    carryIn,
    half,
    result: carryIn + half + iPaidForPartner - partnerPaidForMe - (fromPartner - toPartner),
  };
}

type Locked = typeof settlements.$inferSelect;

/**
 * Results month by month from the start month up to `month`: each month's
 * result is its locked result if reconciled, else the live one for the whole month.
 */
function chain(db: Db, start: string, month: string, today: string) {
  const cycles = loadCardCycles(db);
  const locked = new Map(db.select().from(settlements).all().map((s) => [s.month, s]));
  let carry = 0;
  type CarryFrom = { month: string; reconciled: boolean; settledEven: boolean } | null;
  let carryFrom: CarryFrom = null;
  let last: { live: Figures; sofar: Figures; rows: ReturnType<typeof monthRows>; locked: Locked | null; carryFrom: CarryFrom } | null = null;
  const history: SettlementHistoryEntry[] = [];
  const first = month < start ? month : start;
  for (let m = first; m <= month; m = addMonths(m, 1)) {
    const carryIn = m <= start ? 0 : carry;
    const rows = monthRows(db, m, today, cycles);
    const live = figures(rows.full, carryIn);
    const lock = locked.get(m) ?? null;
    history.push({
      month: m,
      result: lock ? lock.result : live.result,
      status: lock ? (lock.carryForward ? "carried" : "even") : "open",
      note: lock?.note ?? null,
      deviates: !!lock && lock.result !== live.result,
    });
    if (m === month) last = { live, sofar: figures(rows.sofar, carryIn), rows, locked: lock, carryFrom: m <= start ? null : carryFrom };
    // A month reconciled as 'kvitt' carries nothing: its difference was settled or written off.
    carry = lock ? (lock.carryForward ? lock.result : 0) : live.result;
    carryFrom = { month: m, reconciled: !!lock, settledEven: !!lock && !lock.carryForward };
  }
  return { ...last!, history };
}

/** A month in 'the last six months': its result (locked if reconciled) and how it was settled. */
export interface SettlementHistoryEntry {
  month: string;
  /** Positive: the partner pays me. */
  result: number;
  /** 'even' = kvitt, 'carried' = fört över, 'open' = not reconciled. */
  status: "even" | "carried" | "open";
  note: string | null;
  deviates: boolean;
}

/**
 * Sources whose latest import ends before the month does (so rows may be
 * missing). For the running month: before yesterday, since today can't be exported yet.
 */
function incompleteImports(db: Db, month: string, today: string) {
  const end = monthRange(month).to;
  const yesterday = addDays(today, -1);
  const to = end < yesterday ? end : yesterday;
  const out: { source: (typeof IMPORT_SOURCES)[number]; importedTo: string | null }[] = [];
  for (const source of IMPORT_SOURCES) {
    const any = db.select({ id: imports.id }).from(imports).where(eq(imports.source, source)).get();
    if (!any) continue;
    const latest = db
      .select({ to: sql<string | null>`max(${imports.periodTo})` })
      .from(imports)
      .where(eq(imports.source, source))
      .get()?.to ?? null;
    if (!latest || latest < to) out.push({ source, importedTo: latest });
  }
  return out;
}

export function sharedMonth(db: Db, month: string, today: string) {
  const start = getSettlementStart(db, today);
  const { live, sofar, rows, locked, carryFrom, history } = chain(db, start, month, today);
  const lockedFigures: Figures | null = locked
    ? {
        iPaid: locked.iPaid,
        partnerPaid: locked.partnerPaid,
        iPaidForPartner: locked.iPaidForPartner,
        partnerPaidForMe: locked.partnerPaidForMe,
        fromPartner: locked.fromPartner,
        toPartner: locked.toPartner,
        carryIn: locked.carryIn,
        half: Math.round((locked.iPaid - locked.partnerPaid) / 2),
        result: locked.result,
      }
    : null;
  const deviates =
    !!lockedFigures &&
    (["iPaid", "partnerPaid", "iPaidForPartner", "partnerPaidForMe", "fromPartner", "toPartner", "carryIn"] as const).some((k) => lockedFigures[k] !== live[k]);
  const upcoming = rows.groups.flatMap((g) => g.rows).filter((r) => !r.paid);

  return {
    month,
    today,
    partnerName: getPartnerName(db),
    ownName: getOwnName(db),
    startMonth: start,
    beforeStart: month < start,
    carryFrom,
    iPaid: { total: live.iPaid, groups: rows.groups },
    partnerPaid: { total: live.partnerPaid, rows: rows.partnerRows },
    forPartner: { total: live.iPaidForPartner, rows: rows.forPartner },
    forMe: { total: live.partnerPaidForMe, rows: rows.forMe },
    swishCandidates: swishCandidates(db, rows.fromRows),
    transfers: {
      fromPartner: { total: live.fromPartner, rows: rows.fromRows, excluded: rows.excludedFrom },
      toPartner: { total: live.toPartner, rows: rows.toRows, excluded: rows.excludedTo },
    },
    /** The whole month, including what is still to be paid. */
    live,
    /** Only what has been paid up to today. Same as live once the month's pay days have passed. */
    sofar,
    /** The next day something is paid, if any. */
    nextPayDate: upcoming.map((r) => r.payDate).sort()[0] ?? null,
    /** The month's bill day: when the card invoice is paid (the 25th), when we settle. */
    payDay: rows.groups.find((g) => g.kind === "norwegian")?.payDate ?? dueDateIn(month, CARD_PAY_DAY),
    settlement: locked ? { ...lockedFigures!, note: locked.note, settledAt: locked.settledAt, carryForward: locked.carryForward } : null,
    deviates,
    monthNotOver: monthRange(month).to >= today,
    incompleteImports: incompleteImports(db, month, today),
    warnings: rows.warnings,
    /** The last six months up to this one (from the start month): result and how each was settled. */
    history: history.slice(-6),
  };
}

/**
 * For each Swish from the partner: my purchases from three weeks before to a
 * few days after whose amount is about the Swish (probably hers alone) or
 * about twice it (probably shared). A purchase already marked shared is only
 * suggested as hers.
 */
function swishCandidates(db: Db, swishes: SharedRow[]) {
  const out: Record<
    number,
    { id: number; date: string; description: string; amount: number; account: string | null; current: "own" | "shared"; suggest: "shared" | "partner" }[]
  > = {};
  for (const sw of swishes) {
    if (sw.id === null || sw.amount <= 0) continue;
    const rows = db
      .select({
        id: transactions.id,
        date: txDate,
        label: transactions.label,
        descriptionClean: transactions.descriptionClean,
        amount: transactions.amount,
        shared: transactions.shared,
        account: accounts.name,
        isSettlement: categories.isSettlement,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          sql`${txDate} >= ${addDays(sw.date, -21)}`,
          sql`${txDate} <= ${addDays(sw.date, 3)}`,
          sql`${transactions.amount} < 0`,
          isNull(transactions.deletedAt),
          eq(transactions.private, false),
          eq(transactions.isTransfer, false),
          eq(transactions.forOther, false),
          eq(transactions.paidBy, "me"),
          isNull(transactions.returnGroupId),
        ),
      )
      .all()
      .filter((r) => !r.isSettlement);
    const scored = rows
      .map((r) => {
        const ratio = -r.amount / sw.amount;
        const suggest =
          Math.abs(ratio - 1) <= 0.1 ? ("partner" as const) : !r.shared && Math.abs(ratio - 2) <= 0.2 ? ("shared" as const) : null;
        const closeness = suggest === "partner" ? Math.abs(ratio - 1) : Math.abs(ratio - 2) / 2;
        return { r, suggest, closeness };
      })
      .filter((x) => x.suggest !== null)
      .sort((a, b) => a.closeness - b.closeness)
      .slice(0, 5);
    out[sw.id] = scored.map(({ r, suggest }) => ({
      id: r.id,
      date: r.date,
      description: r.label ?? r.descriptionClean,
      amount: -r.amount,
      account: r.account,
      current: r.shared ? ("shared" as const) : ("own" as const),
      suggest: suggest!,
    }));
  }
  return out;
}

/**
 * Lock a month with its figures for the whole month. With carryForward false
 * ('vi är kvitt') the result is considered settled and next month starts at 0.
 */
export function settleMonth(db: Db, month: string, today: string, note: string | null, carryForward = true) {
  const { live } = chain(db, getSettlementStart(db, today), month, today);
  const values = {
    iPaid: live.iPaid,
    partnerPaid: live.partnerPaid,
    iPaidForPartner: live.iPaidForPartner,
    partnerPaidForMe: live.partnerPaidForMe,
    fromPartner: live.fromPartner,
    toPartner: live.toPartner,
    carryIn: live.carryIn,
    result: live.result,
    carryForward,
    note: note?.trim() || null,
    settledAt: new Date().toISOString(),
  };
  return db
    .insert(settlements)
    .values({ month, ...values })
    .onConflictDoUpdate({ target: settlements.month, set: values })
    .returning()
    .get();
}

export function unsettleMonth(db: Db, month: string): boolean {
  return db.delete(settlements).where(eq(settlements.month, month)).returning().all().length > 0;
}

/**
 * What the partner is to pay me this month (negative: what I owe her): the
 * running result for the whole month, i.e. what she swishes on the 25th.
 * Shown next to the forecast but never counted in it.
 */
export function partnerOutstanding(db: Db, today: string) {
  const month = monthOf(today);
  const start = getSettlementStart(db, today);
  const { live, locked } = chain(db, start, month, today);
  const latest = db.select().from(settlements).orderBy(desc(settlements.month)).get();
  const amount = locked ? (locked.carryForward ? locked.result : 0) : live.result;
  return { amount, partnerName: getPartnerName(db), month, latestSettled: latest?.month ?? null };
}
