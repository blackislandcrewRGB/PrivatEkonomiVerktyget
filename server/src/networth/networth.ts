import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, statements, transactions } from "../db/schema.js";
import { cardInvoices, type InvoiceStatus } from "../overview/overview.js";
import { cardInvoicePeriods, partnerOutstanding, postedDaySql } from "../shared/settlement.js";
import { valuePortfolio } from "../savings/portfolio.js";
import { addDays, addMonths, dueDateIn, monthOf } from "../overview/dates.js";
import { mastercardCyclePayDay, mastercardPayDay, postedPayDay } from "../cashflow/cashflow.js";
import { currentBalances, type CurrentBalance } from "./manualBalances.js";

/**
 * Balansräkningen — för mig, aldrig för hushållet.
 *
 * What is owned, what is owed, and the difference. Three rules decide the
 * shape of it:
 *
 * A krona appears exactly once. The card debt is the whole invoice, because
 * that is what is owed to the bank, and what Mio owes me stands on its own
 * as a claim. Counting only "my half" of a shared purchase *and* her debt to
 * me would count her half twice.
 *
 * Illiquid is not net worth. A car is worth something, but it is not money
 * until someone buys it, so it is kept out of the totals until the interface
 * is asked to show it — and then on its own line, never mixed in.
 *
 * Nothing unknown is worth zero. A card with no invoice registered and no
 * payments behind it has an unknown debt, and the row says so instead of
 * quietly improving the total.
 *
 * The student loan is a debt like any other, but it is a debt against a
 * lifetime of income rather than against this year's money, so both totals
 * are always shown: with it and without it.
 */

export interface SheetRow {
  key: string;
  name: string;
  /** Öre, positive on both sides. Which side is decided by the list it is in. */
  amountOre: number;
  /** What the figure rests on, in a few words, for the interface to print. */
  basis: string;
  /** The day the figure is from, when that is not today. */
  asOf: string | null;
  /** Nothing is known: the amount is 0 and must not be read as one. */
  unknown: boolean;
  /** A card's debt by the day it leaves the bank: each invoice's pay day and what of the debt is on it, soonest first. */
  payments?: { payDate: string; amountOre: number }[];
}

export interface BalanceSheet {
  on: string;
  liquid: SheetRow[];
  /** Debts other than the student loan. */
  debts: SheetRow[];
  /** Kept apart: it is in one total and not in the other. */
  csn: SheetRow | null;
  /** Shown only when asked for, and never inside the two headline totals. */
  illiquid: SheetRow[];
  totals: {
    /** Pengar totalt: the liquid side without what the partner owes (bank, ISK securities and cash). */
    moneyOre: number;
    liquidOre: number;
    debtsOre: number;
    csnOre: number;
    illiquidOre: number;
    /** The two the interface always shows. */
    netExCsnOre: number;
    netIncCsnOre: number;
    /** The same two once the illiquid side is counted as well. */
    netExCsnWithIlliquidOre: number;
    netIncCsnWithIlliquidOre: number;
  };
  /** Anything that makes a figure softer than it looks. */
  notes: string[];
}

/** A balance older than this is worth saying something about. */
const STALE_BALANCE_DAYS = 7;

const row = (key: string, name: string, amountOre: number, basis: string, asOf: string | null = null): SheetRow => ({
  key,
  name,
  amountOre,
  basis,
  asOf,
  unknown: false,
});

const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;

// ---------- What is owed on a card ----------

/**
 * Purchases posted after a day: what has been spent and not yet settled.
 *
 * By the *posting* day, because that is what decides which invoice a purchase
 * lands on — the same basis the invoice periods in Delad ekonomi use. A card
 * purchase made late on the 15th is posted on the 16th and belongs to the next
 * invoice, and counting it by its purchase day would put it on the one that
 * has already been paid.
 */
function spentAfter(db: Db, accountId: number, from: string, on: string): number {
  const rows = db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        sql`${postedDaySql} > ${from}`,
        sql`${postedDaySql} <= ${on}`,
        eq(transactions.isTransfer, false),
        isNull(transactions.deletedAt),
      ),
    )
    .all();
  // Spending is negative; a refund on the card reduces the debt, which is why
  // this is a signed sum and not a sum of absolute values.
  return rows.reduce((sum, t) => sum - t.amount, 0);
}

/**
 * The debt on each credit card: what is still unpaid on the last invoice, plus
 * everything bought since that invoice's period closed.
 *
 * Without the second half the sheet would show no card debt the day after an
 * invoice is paid, and jump when the next one arrives — a net worth sawing up
 * and down for reasons that are not economic.
 *
 * The two cards reach that figure differently because their data does. The
 * Mastercard has a statement to start from. Bank Norwegian is imported from
 * its own invoices and often has no statement row at all, so the last settled
 * point is the end of the newest invoice period a payment has landed for.
 */
/** A card's debt worked out from its latest invoice: what is still unpaid on it, and what has been bought since. */
export interface InvoiceDebt {
  amountOre: number;
  unpaid: number;
  since: number;
  /** The last day the invoice covers: purchases after it are the next invoice's. */
  settledTo: string;
  dueDate: string;
  /** The end of the period after it, when the invoice says. */
  nextPeriodTo: string | null;
  invoicePaid: boolean;
  /** The newest purchase the tool has for the card after `settledTo` (null: none). */
  lastPurchase: string | null;
}

export function invoiceDebt(db: Db, cardId: number, invoice: InvoiceStatus, on: string): InvoiceDebt {
  const statement = db.select().from(statements).where(eq(statements.id, invoice.statementId)).get()!;
  const settledTo = statement.periodTo ?? addDays(statement.dueDate, -25);
  // Ticked off by hand counts as paid even when no payment row shows it:
  // the money left some account the tool doesn't follow.
  const invoicePaid = invoice.status === "paid";
  const unpaid = invoicePaid ? 0 : Math.max(0, invoice.amountDue - invoice.paidAmount);
  const since = spentAfter(db, cardId, settledTo, on);
  const last = db
    .select({ day: sql<string | null>`max(${postedDaySql})` })
    .from(transactions)
    .where(and(eq(transactions.accountId, cardId), sql`${postedDaySql} > ${settledTo}`, sql`${postedDaySql} <= ${on}`, eq(transactions.isTransfer, false), isNull(transactions.deletedAt)))
    .get();
  return { amountOre: unpaid + since, unpaid, since, settledTo, dueDate: invoice.dueDate, nextPeriodTo: statement.nextPeriodTo, invoicePaid, lastPurchase: last?.day ?? null };
}

/**
 * A card's debt split by the invoice it is paid with: what is unpaid on the
 * last invoice on its pay day, and each purchase since on the pay day of the
 * invoice its posting day lands on (as the cash flow counts them). A
 * Mastercard the cash flow has no next invoice for goes by the invoice's own
 * cycle. A pay day already passed, or a card without a known cycle, is today.
 */
function debtPayments(
  db: Db,
  card: typeof accounts.$inferSelect,
  after: string,
  on: string,
  unpaid: { amountOre: number; dueDate: string; nextPeriodTo: string | null } | null,
) {
  const byDay = new Map<string, number>();
  const add = (payDate: string | null, amountOre: number) => {
    const day = payDate === null || payDate < on ? on : payDate;
    byDay.set(day, (byDay.get(day) ?? 0) + amountOre);
  };
  if (unpaid && unpaid.amountOre > 0) add(card.source === "mastercard" ? mastercardPayDay(unpaid.dueDate) : unpaid.dueDate, unpaid.amountOre);
  const rows = db
    .select({ day: postedDaySql, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.accountId, card.id), sql`${postedDaySql} > ${after}`, sql`${postedDaySql} <= ${on}`, eq(transactions.isTransfer, false), isNull(transactions.deletedAt)))
    .all();
  const payDays = new Map<string, string | null>();
  for (const r of rows) {
    if (!payDays.has(r.day)) {
      const own = unpaid && card.source === "mastercard" ? mastercardCyclePayDay(unpaid.nextPeriodTo ?? dueDateIn(addMonths(monthOf(after), 1), Number(after.slice(8, 10))), r.day) : null;
      payDays.set(r.day, postedPayDay(db, card, r.day, on) ?? own);
    }
    add(payDays.get(r.day)!, -r.amount);
  }
  return [...byDay]
    .filter(([, amountOre]) => amountOre !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([payDate, amountOre]) => ({ payDate, amountOre }));
}

export function cardDebts(db: Db, on: string): SheetRow[] {
  const invoices = new Map(cardInvoices(db, on).map((i) => [i.accountId, i]));
  const cards = db.select().from(accounts).where(eq(accounts.kind, "credit_card")).all();
  const out: SheetRow[] = [];

  for (const card of cards) {
    const invoice = invoices.get(card.id);
    if (invoice) {
      const d = invoiceDebt(db, card.id, invoice, on);
      const parts = [
        d.unpaid > 0 ? `${kr(d.unpaid)} obetalt på fakturan som förfaller ${dm(d.dueDate)}` : `fakturan ${dm(d.dueDate)} är betald`,
        `${kr(d.since)} köpt sedan ${dm(d.settledTo)}`,
      ];
      out.push({ ...row(`card:${card.id}`, card.name, d.amountOre, parts.join(", ")), payments: debtPayments(db, card, d.settledTo, on, { amountOre: d.unpaid, dueDate: d.dueDate, nextPeriodTo: d.nextPeriodTo }) });
      continue;
    }

    // No statement: lean on the invoice cycle instead. A period counts as
    // settled once a payment to the card has landed after it ended.
    const periods = cardInvoicePeriods(db, on).filter((p) => p.accountId === card.id);
    const paidDates = db
      .select({ date: transactions.bookingDate })
      .from(transactions)
      .where(and(eq(transactions.counterAccountId, card.id), sql`${transactions.amount} < 0`, isNull(transactions.deletedAt)))
      .all()
      .map((p) => p.date);
    // Newest first: the first period nobody has paid for is where the debt starts.
    const settled = periods.find((p) => paidDates.some((d) => d > p.to));
    if (!settled) {
      const used = db.select({ n: sql<number>`count(*)` }).from(transactions).where(and(eq(transactions.accountId, card.id), isNull(transactions.deletedAt))).get();
      if (!used?.n) continue;
      out.push({
        key: `card:${card.id}`,
        name: card.name,
        amountOre: 0,
        basis: "ingen faktura registrerad och ingen betalning att räkna från — skulden är okänd",
        asOf: null,
        unknown: true,
      });
      continue;
    }
    const since = spentAfter(db, card.id, settled.to, on);
    out.push({
      ...row(`card:${card.id}`, card.name, since, `köpt sedan fakturaperioden som slutade ${dm(settled.to)} och betalades`),
      payments: debtPayments(db, card, settled.to, on, null),
    });
  }
  return out;
}

// ---------- The sheet ----------

export function balanceSheet(db: Db, on: string): BalanceSheet {
  const notes: string[] = [];
  const liquid: SheetRow[] = [];
  const debts: SheetRow[] = [];
  const illiquid: SheetRow[] = [];

  // Bank accounts, one line each. Every account whose balance is followed —
  // not two names in the code that a rename would break.
  for (const account of db.select().from(accounts).where(and(eq(accounts.kind, "bank"), eq(accounts.trackBalance, true))).all()) {
    const updated = account.balanceUpdatedAt?.slice(0, 10) ?? null;
    const age = updated ? Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${updated}T00:00:00Z`)) / 86400000) : null;
    liquid.push(row(`account:${account.id}`, account.name, account.balance, updated ? `saldo från ${dm(updated)}` : "saldo aldrig ifyllt", updated));
    if (age !== null && age > STALE_BALANCE_DAYS) notes.push(`${account.name} har ett saldo från ${dm(updated!)} — ${age} dagar gammalt.`);
  }

  // The portfolio, per broker account: securities and cash are different
  // things and the reconciliation in Sparande keeps them apart, so they do
  // here too.
  const portfolio = valuePortfolio(db, on);
  const ACCOUNT_NAMES: Record<string, string> = { isk: "ISK", depot: "Depå" };
  for (const account of portfolio.accounts) {
    const name = ACCOUNT_NAMES[account.account] ?? account.account;
    if (account.securitiesOre > 0 || portfolio.missing.length > 0) {
      liquid.push(row(`securities:${account.account}`, `${name} värdepapper`, account.securitiesOre, portfolio.priceDate ? `kurser från ${dm(portfolio.priceDate)}` : "inga kurser hämtade", portfolio.priceDate));
    }
    if (account.cashOre !== null) {
      liquid.push(row(`cash:${account.account}`, `${name} likvider`, account.cashOre, account.cashDate ? `inlagt ${dm(account.cashDate)}` : "inlagt för hand", account.cashDate));
    }
  }
  if (portfolio.missing.length > 0) {
    notes.push(`${portfolio.missing.length} innehav saknar kurs och räknas inte med i värdepapperen.`);
  }

  // What Mio owes me is a claim like any other. Negative means it is the
  // other way round, and then it belongs on the debt side rather than as a
  // negative asset.
  const partner = partnerOutstanding(db, on);
  if (partner && partner.amount > 0) {
    liquid.push(row("partner", `${partner.partnerName} är skyldig dig`, partner.amount, `Delad ekonomi till och med ${partner.month}`));
  } else if (partner && partner.amount < 0) {
    debts.push(row("partner", `Du är skyldig ${partner.partnerName}`, -partner.amount, `Delad ekonomi till och med ${partner.month}`));
  }

  for (const card of cardDebts(db, on)) {
    debts.push(card);
    if (card.unknown) notes.push(`${card.name}: ${card.basis}.`);
  }

  // The manual rows: the student loan on its own, the car among the illiquid.
  let csn: SheetRow | null = null;
  for (const balance of currentBalances(db, on)) {
    const sheetRow = manualRow(balance);
    if (balance.row.key === "csn") csn = sheetRow;
    else if (balance.row.kind === "debt") debts.push(sheetRow);
    else if (balance.row.liquid) liquid.push(sheetRow);
    else illiquid.push(sheetRow);
  }

  const sum = (rows: SheetRow[]) => rows.reduce((total, r) => total + r.amountOre, 0);
  const liquidOre = sum(liquid);
  const debtsOre = sum(debts);
  const csnOre = csn?.amountOre ?? 0;
  const illiquidOre = sum(illiquid);
  const netExCsnOre = liquidOre - debtsOre;
  const netIncCsnOre = netExCsnOre - csnOre;
  // Pengar totalt: what is mine to spend or sell now — the bank accounts, the
  // securities and cash on ISK, other liquid assets — without the debts and
  // without what Mio owes (a claim, not money yet).
  const moneyOre = liquid.filter((r) => r.key !== "partner").reduce((total, r) => total + r.amountOre, 0);

  return {
    on,
    liquid,
    debts,
    csn,
    illiquid,
    totals: {
      moneyOre,
      liquidOre,
      debtsOre,
      csnOre,
      illiquidOre,
      netExCsnOre,
      netIncCsnOre,
      netExCsnWithIlliquidOre: netExCsnOre + illiquidOre,
      netIncCsnWithIlliquidOre: netIncCsnOre + illiquidOre,
    },
    notes,
  };
}

/** A manually kept figure as a line, with what has been paid off written out. */
function manualRow(balance: CurrentBalance): SheetRow {
  const { row: r } = balance;
  const parts: string[] = [`${kr(r.amountOre)} den ${dm(r.valueDate)}`];
  if (balance.charges > 0) parts.push(`${balance.charges} dragning${balance.charges === 1 ? "" : "ar"} sedan dess, ${kr(balance.paidOre)}`);
  if (r.source) parts.push(r.source);
  return {
    key: r.key,
    name: r.name,
    amountOre: balance.amountOre,
    basis: parts.join(" · "),
    asOf: balance.lastChargeDate ?? r.valueDate,
    unknown: false,
  };
}
