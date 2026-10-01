import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  accounts,
  bankAccounts,
  categories,
  contacts,
  duplicateDismissals,
  imports,
  recurringExpenseMarks,
  recurringExpenses,
  transactions,
  watchFindings,
  WATCH_KINDS,
} from "../db/schema.js";
import { chargePeriod, expectedAmounts } from "../recurring/amounts.js";
import { chargeShare, partsByOwner } from "../recurring/parts.js";
import { accountFor } from "../recurring/changes.js";
import { nextOccurrence, occurrenceFor, YEARLY_LATE_DAYS } from "../recurring/schedule.js";
import { addDays, addMonths, daysBetween, monthOf } from "../overview/dates.js";
import { getSetting, setSetting } from "../settings.js";
import { loadSplits } from "../splits.js";
import { sendNtfy } from "../notify.js";
import { maybeItems, returnDeadlines, warrantiesEnding } from "../items/itemWatch.js";
import { valuePortfolio } from "../savings/portfolio.js";
import { lastFetchAt, lastFetchByInstrument } from "../savings/prices/sync.js";
import { bufferParts, endurance, monthStartParts } from "../networth/endurance.js";
import { pensionOverview } from "../networth/pension.js";
import { listManualBalances } from "../networth/manualBalances.js";
import { iskOverview } from "../tax/isk.js";
import { taxReturnDue } from "../tax/taxReturnDue.js";

/**
 * Vakt: after every sync and import, what looks off in the data.
 * - price_drift: a fixed expense, or a merchant charging like a subscription
 *   (three earlier charges a month or so apart at the same price, ±3 %), whose
 *   latest charge is more than 3 % off the median of the earlier ones (after
 *   'acceptera nytt belopp': off the accepted amount and what came after it).
 *   A fixed expense whose amount already is the new one isn't asked about.
 * - double_charge: the same account, merchant and amount within 2 days.
 * - unusual_amount: a variable purchase over 500 kr and over 3 × the median
 *   purchase in its category the 6 months before.
 * - new_merchant: the first purchase ever at a merchant, over 300 kr.
 * - missed_charge: a fixed expense whose day passed 3 days ago without a
 *   charge, when the account's data reaches that far.
 * - subscription_stopped: a fixed expense not charged for two periods in a row.
 * - warranty_ending / return_deadline: a pryl whose warranty runs out within
 *   30 days, or whose right of return runs out within 3.
 * - maybe_item: a purchase over the threshold (500 kr) in a category that is
 *   usually things, not linked to any pryl: 'is this a thing?'.
 * - yearly_renewal: a yearly expense whose date is within its reminder days
 *   (14 unless set; 0 = never) and not yet paid: 'förnyas 20/6 – behålla?',
 *   or for an invoice 'ska vara betald senast 30/6'. A yearly one missed is a
 *   missed_charge 10 days after its date (bills are paid ahead), for 90 days.
 * - charge_coming: a subscription marked 'remind me before it draws' (the
 *   temporary ones, started for a while and meant to be cancelled in time),
 *   3 days before its next charge unless the expense says otherwise.
 * - bet_zone_over: the bet zone above the 25 % the policy allows, once a
 *   month rather than once a sync.
 * - prices_stale: no price has been *fetched* for 3 days (a Friday close read
 *   on a Monday is not stale; a fetch that keeps failing is).
 * - fx_missing: a holding that can't be valued because its currency rate
 *   never arrived.
 * Purchases are looked at for the last 30 days (older ones were seen by then).
 * Findings are computed from the data each time; watch_findings remembers
 * which were notified, dismissed (never shown again) or accepted.
 */

export type WatchKind = (typeof WATCH_KINDS)[number];

export const WATCH_DAYS = 30;
export const DRIFT_LIMIT = 0.03;
const DOUBLE_DAYS = 2;
const UNUSUAL_FACTOR = 3;
const UNUSUAL_MIN = 50_000;
const UNUSUAL_MONTHS = 6;
/** A category needs this many purchases for its median to say anything. */
const UNUSUAL_SAMPLES = 5;
const NEW_MERCHANT_MIN = 30_000;
const MISSED_GRACE_DAYS = 3;
/** A merchant's charges this far apart are a subscription's (a month, give or take). */
const SUBSCRIPTION_GAP = [20, 40] as const;

export const WATCH_LABELS: Record<WatchKind, string> = {
  price_drift: "Prisdrift",
  double_charge: "Dubbeldebitering",
  unusual_amount: "Ovanligt belopp",
  new_merchant: "Ny handlare",
  missed_charge: "Utebliven dragning",
  subscription_stopped: "Abonnemang som inte dras",
  yearly_renewal: "Årsvis förnyelse snart",
  charge_coming: "Bevakad dragning snart",
  bet_zone_over: "Bet-zonen över 25 %",
  prices_stale: "Kurser hämtas inte",
  fx_missing: "Valutakurs saknas",
  buffer_low: "Bufferten under 3 månader",
  pension_stale: "Pensionsvärden äldre än 12 mån",
  pension_forecast_stale: "Pensionsprognos äldre än 12 mån",
  warranty_ending: "Garanti går ut",
  return_deadline: "Ångerrätt går ut",
  maybe_item: "Kan vara en pryl",
  isk_allowance: "ISK närmar sig fribeloppet",
  tax_return_missing: "Deklarationen saknas",
};

/** Days before a yearly expense's date its reminder shows, unless the expense says otherwise. */
export const YEARLY_REMIND_DAYS = 14;
/**
 * Days before a watched charge its reminder shows. Short on purpose: it is
 * there to be acted on ('say it up before Thursday'), and a warning two weeks
 * out is forgotten by the time it matters.
 */
export const CHARGE_REMIND_DAYS = 3;
/** A buffer thinner than this many months of spending is worth saying so. */
const BUFFER_MIN_MONTHS = 3;

/** No price fetched for this many days is worth saying something about. */
const PRICE_STALE_DAYS = 3;

/** A yearly draw missed is shown this long after its date. */
const YEARLY_MISSED_DAYS = 90;

export interface Finding {
  key: string;
  kind: WatchKind;
  text: string;
  /** The day it is about (a charge, or the missed draw). */
  date: string;
  accountId?: number | null;
  transactionId?: number;
  otherTransactionId?: number;
  expenseId?: number;
  period?: string;
  series?: string;
  /** Price drift: the usual amount and the new one (öre, positive). */
  oldAmount?: number;
  newAmount?: number;
  amount?: number;
  merchant?: string;
  /** A yearly expense's (its missed draw can be paused, its reminder is for a bill or a renewal). */
  yearly?: boolean;
  /** Yearly renewal: paid by invoice (a transfer), not drawn by itself. */
  invoice?: boolean;
  /** Prylar: the thing a warranty or a return deadline is about. */
  itemId?: number;
}

// ---------- Settings ----------

const SETTING = "watch_kinds";

/** Which kinds are on (all by default). */
export function watchKinds(db: Db): Record<WatchKind, boolean> {
  const stored = getSetting<Partial<Record<WatchKind, boolean>>>(db, SETTING, {});
  return Object.fromEntries(WATCH_KINDS.map((k) => [k, stored[k] !== false])) as Record<WatchKind, boolean>;
}

export function setWatchKinds(db: Db, kinds: Partial<Record<string, unknown>>): Record<WatchKind, boolean> {
  const next = watchKinds(db);
  for (const k of WATCH_KINDS) if (typeof kinds[k] === "boolean") next[k] = kinds[k] as boolean;
  setSetting(db, SETTING, next);
  return next;
}

// ---------- Helpers ----------

const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const monthName = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1];

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const off = (value: number, ref: number) => ref > 0 && Math.abs(value - ref) / ref > DRIFT_LIMIT;

/**
 * The merchant a row is from, the same across a merchant's varying texts: a
 * Swish number as it is, else the first two words of letters ('GOOGLE*CLOUD
 * KLM' and 'GOOGLE*CLOUD PQR' are 'google cloud', 'Podme 4F8-2A61C9' 'podme').
 */
export function merchantKey(t: { counterparty: string | null; descriptionClean: string }): string {
  const base = (t.counterparty ?? t.descriptionClean).trim();
  if (/^\+\d{6,}$/.test(base)) return base;
  const words = base
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2);
  return words.slice(0, 2).join(" ") || base.toLowerCase();
}

interface Row {
  id: number;
  accountId: number | null;
  date: string;
  bookingDate: string;
  amount: number;
  merchant: string;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  /** The purchase's amount in its own category: the whole row, or its largest part when it is split. */
  categoryAmount: number;
  recurringExpenseId: number | null;
}

/**
 * Purchases: money out, not a transfer, savings or money between us, not a
 * returned purchase, not the partner's own payment. Sorted by date, then id.
 */
function purchases(db: Db): Row[] {
  const splits = loadSplits(db);
  const rows = db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      transactionDate: transactions.transactionDate,
      bookingDate: transactions.bookingDate,
      amount: transactions.amount,
      counterparty: transactions.counterparty,
      descriptionClean: transactions.descriptionClean,
      label: transactions.label,
      contactName: contacts.name,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      catTransfer: categories.isTransfer,
      catSettlement: categories.isSettlement,
      recurringExpenseId: transactions.recurringExpenseId,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(contacts, eq(contacts.counterparty, transactions.counterparty))
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.isTransfer, false),
        isNull(transactions.returnGroupId),
        eq(transactions.paidBy, "me"),
        sql`${transactions.amount} < 0`,
      ),
    )
    .all();
  return rows
    .filter((r) => !r.catTransfer && !r.catSettlement)
    .map((r) => ({
      id: r.id,
      accountId: r.accountId,
      date: r.transactionDate ?? r.bookingDate,
      bookingDate: r.bookingDate,
      amount: -r.amount,
      merchant: merchantKey(r),
      name: r.label ?? r.contactName ?? r.counterparty ?? r.descriptionClean,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      // What the purchase put in its own category: the whole amount, or the
      // largest part when it is split across categories (that part is the
      // row's category). Only the category comparisons use it.
      categoryAmount: -(splits.get(r.id)?.find((p: { categoryId: number }) => p.categoryId === r.categoryId)?.amount ?? r.amount),
      recurringExpenseId: r.recurringExpenseId,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/** How far an account's data reaches: its latest row, the latest import period on it, or its latest bank sync. */
export function coveredUntil(db: Db, accountId: number): string | null {
  const latestRow = db
    .select({ d: sql<string | null>`max(${transactions.bookingDate})` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .get()?.d;
  const latestImport = db
    .select({ d: sql<string | null>`max(${imports.periodTo})` })
    .from(imports)
    .innerJoin(transactions, eq(transactions.importId, imports.id))
    .where(eq(transactions.accountId, accountId))
    .get()?.d;
  const latestSync = db
    .select({ d: sql<string | null>`max(${bankAccounts.lastSyncAt})` })
    .from(bankAccounts)
    .where(eq(bankAccounts.accountId, accountId))
    .get()?.d;
  return [latestRow, latestImport, latestSync?.slice(0, 10)].filter((d): d is string => !!d).sort().at(-1) ?? null;
}

/**
 * 'Varierar – fråga inte': a price series whose amount varies on purpose
 * (Parkster with extra parking) isn't watched for drift. Inställningar › Vakt
 * lists them and can watch them again.
 */
const MUTED = "watch_muted_series";

export function mutedSeries(db: Db): { series: string; name: string }[] {
  return getSetting<{ series: string; name: string }[]>(db, MUTED, []);
}

export function muteSeries(db: Db, key: string, today: string): void {
  const f = findings(db, today).find((x) => x.key === key);
  if (!f?.series) throw new Error("Fyndet finns inte längre.");
  const name = f.text.split(":")[0];
  setSetting(db, MUTED, [...mutedSeries(db).filter((m) => m.series !== f.series), { series: f.series, name }]);
}

export function unmuteSeries(db: Db, series: string): void {
  setSetting(db, MUTED, mutedSeries(db).filter((m) => m.series !== series));
}

/** The latest accepted amount of each price series. */
function baselines(db: Db): Map<string, { amount: number; date: string }> {
  const out = new Map<string, { amount: number; date: string }>();
  const rows = db.select().from(watchFindings).where(isNotNull(watchFindings.acceptedAt)).orderBy(watchFindings.acceptedAt).all();
  for (const r of rows) if (r.series && r.amount !== null && r.date) out.set(r.series, { amount: r.amount, date: r.date });
  return out;
}

// ---------- The rules ----------

function priceDrift(db: Db, rows: Row[], since: string): Finding[] {
  const out: Finding[] = [];
  const base = baselines(db);
  const expected = expectedAmounts(db);
  const parts = partsByOwner(db);

  const check = (series: string, charges: { id: number; date: string; amount: number; accountId: number | null }[], needStable: boolean) => {
    const latest = charges.at(-1);
    if (!latest || latest.date < since) return null;
    const before = charges.slice(0, -1);
    const accepted = base.get(series);
    let ref: number;
    if (accepted) {
      if (latest.date <= accepted.date) return null;
      ref = median([accepted.amount, ...before.filter((c) => c.date > accepted.date).map((c) => c.amount)]);
    } else {
      const prior = before.slice(-3);
      if (prior.length < 3) return null;
      if (needStable) {
        // A subscription: a month or so apart, the same price, and the new charge a month on too.
        const dates = [...prior.map((c) => c.date), latest.date];
        const gapsOk = dates.slice(1).every((d, i) => {
          const gap = daysBetween(dates[i], d);
          return gap >= SUBSCRIPTION_GAP[0] && gap <= SUBSCRIPTION_GAP[1];
        });
        const m = median(prior.map((c) => c.amount));
        if (!gapsOk || prior.some((c) => off(c.amount, m))) return null;
      }
      ref = median(prior.map((c) => c.amount));
    }
    return off(latest.amount, ref) ? { latest, ref } : null;
  };

  const quiet = new Set(mutedSeries(db).map((m) => m.series));
  for (const e of db.select().from(recurringExpenses).where(and(eq(recurringExpenses.paused, false), isNull(recurringExpenses.partOfId))).all()) {
    if (quiet.has(`expense:${e.id}`)) continue;
    const linked = db
      .select({ id: transactions.id, bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate, amount: transactions.amount, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, e.id), isNull(transactions.deletedAt)))
      .orderBy(transactions.bookingDate, transactions.id)
      .all();
    const series = `expense:${e.id}`;
    const hit = check(series, linked.map((t) => ({ id: t.id, date: t.bookingDate, amount: Math.abs(t.amount), accountId: t.accountId })), false);
    if (!hit) continue;
    // The expense already says the new amount (changed by hand, or a month planned with its own, like CSN): nothing to accept.
    const period = chargePeriod(e, linked.at(-1)!);
    if (Math.abs(chargeShare(e, parts, expected, hit.latest.amount, period) - expected(e, period)) <= 100) continue;
    out.push(driftFinding(series, e.name, hit.latest, hit.ref, { expenseId: e.id }));
  }

  const byMerchant = new Map<string, Row[]>();
  for (const r of rows) if (r.recurringExpenseId === null) byMerchant.set(r.merchant, [...(byMerchant.get(r.merchant) ?? []), r]);
  for (const [merchant, list] of byMerchant) {
    const series = `merchant:${merchant}`;
    if (quiet.has(series)) continue;
    const hit = check(series, list, true);
    if (hit) out.push(driftFinding(series, list.at(-1)!.name, hit.latest, hit.ref, { merchant }));
  }
  return out;
}

function driftFinding(
  series: string,
  name: string,
  latest: { id: number; date: string; amount: number; accountId: number | null },
  ref: number,
  extra: Partial<Finding>,
): Finding {
  const pct = Math.round(((latest.amount - ref) / ref) * 100);
  return {
    key: `price_drift:${series}:${latest.id}`,
    kind: "price_drift",
    text: `${name}: ${kr(latest.amount)} i stället för ${kr(ref)} (${pct > 0 ? "+" : ""}${pct} %)`,
    date: latest.date,
    accountId: latest.accountId,
    transactionId: latest.id,
    series,
    oldAmount: ref,
    newAmount: latest.amount,
    ...extra,
  };
}

function doubleCharges(db: Db, rows: Row[], since: string): Finding[] {
  const kept = new Set(db.select().from(duplicateDismissals).all().map((d) => `${d.olderId}:${d.newerId}`));
  const out: Finding[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.accountId === null) continue;
    const k = `${r.accountId}|${r.merchant}|${r.amount}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const list of groups.values()) {
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      if (b.date < since || daysBetween(a.date, b.date) > DOUBLE_DAYS) continue;
      const [older, newer] = a.id < b.id ? [a, b] : [b, a];
      if (kept.has(`${older.id}:${newer.id}`)) continue;
      out.push({
        key: `double_charge:${older.id}:${newer.id}`,
        kind: "double_charge",
        text: `${b.name}: ${kr(b.amount)} dragen två gånger (${dm(a.date)} och ${dm(b.date)})`,
        date: b.date,
        accountId: b.accountId,
        transactionId: older.id,
        otherTransactionId: newer.id,
        amount: b.amount,
        merchant: b.merchant,
      });
    }
  }
  return out;
}

function unusualAmounts(rows: Row[], since: string): Finding[] {
  const out: Finding[] = [];
  const variable = rows.filter((r) => r.recurringExpenseId === null && r.categoryId !== null);
  for (const r of variable) {
    if (r.date < since || r.amount <= UNUSUAL_MIN) continue;
    const from = `${addMonths(monthOf(r.date), -UNUSUAL_MONTHS)}${r.date.slice(7)}`;
    // Compared per category, so a split purchase is judged on the part that
    // landed in the category, not on the whole receipt.
    const sample = variable.filter((x) => x.categoryId === r.categoryId && x.id !== r.id && x.date >= from && x.date < r.date).map((x) => x.categoryAmount);
    if (sample.length < UNUSUAL_SAMPLES) continue;
    const m = median(sample);
    if (r.categoryAmount <= UNUSUAL_FACTOR * m) continue;
    out.push({
      key: `unusual_amount:${r.id}`,
      kind: "unusual_amount",
      text: `${r.name}: ${kr(r.categoryAmount)} ${dm(r.date)}, ${Math.round(r.categoryAmount / m)} gånger det vanliga för ${r.categoryName} (${kr(m)})`,
      date: r.date,
      accountId: r.accountId,
      transactionId: r.id,
      amount: r.amount,
      merchant: r.merchant,
    });
  }
  return out;
}

function newMerchants(rows: Row[], since: string): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const r of rows) {
    const first = !seen.has(r.merchant);
    seen.add(r.merchant);
    if (!first || r.date < since || r.amount <= NEW_MERCHANT_MIN || r.recurringExpenseId !== null) continue;
    out.push({
      key: `new_merchant:${r.id}`,
      kind: "new_merchant",
      text: `${r.name}: första köpet, ${kr(r.amount)} ${dm(r.date)}`,
      date: r.date,
      accountId: r.accountId,
      transactionId: r.id,
      amount: r.amount,
      merchant: r.merchant,
    });
  }
  return out;
}

/** Missed draws and subscriptions no longer drawn (a stopped one's missed months aren't repeated). */
function missedCharges(db: Db, today: string): Finding[] {
  const out: Finding[] = [];
  const marks = new Set(db.select().from(recurringExpenseMarks).all().map((m) => `${m.recurringExpenseId}|${m.period}`));
  const expected = expectedAmounts(db);
  const cover = new Map<number, string | null>();
  const covered = (accountId: number) => {
    if (!cover.has(accountId)) cover.set(accountId, coveredUntil(db, accountId));
    return cover.get(accountId);
  };
  const names = new Map(db.select().from(accounts).all().map((a) => [a.id, a.name]));
  // Where a charge pays down a debt kept by hand, the missing draw has a
  // second consequence: the balance stops going down. It is said on this
  // finding rather than on a second one about the same event — one thing to
  // put right, one task.
  const paysDown = new Map(
    listManualBalances(db)
      .filter((b) => b.recurringExpenseId !== null && b.kind === "debt")
      .map((b) => [b.recurringExpenseId!, b.name]),
  );
  const alsoStalls = (expenseId: number) => (paysDown.has(expenseId) ? `. ${paysDown.get(expenseId)}-saldot räknas inte ned förrän den syns` : "");
  for (const e of db.select().from(recurringExpenses).where(and(eq(recurringExpenses.paused, false), isNull(recurringExpenses.partOfId))).all()) {
    const yearly = e.billingCycle === "yearly";
    if ((yearly && !e.anchorMonth) || !e.matchPattern || e.accountId === null) continue;
    const accountId = e.accountId;
    // The card a period is drawn on: the old one before a move (and its data reaching that far).
    const accountOf = (period: string) => accountFor(e, period) ?? accountId;
    const linked = db
      .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, e.id), isNull(transactions.deletedAt)))
      .orderBy(transactions.bookingDate)
      .all();
    const charged = new Set(linked.map((t) => chargePeriod(e, t)));
    // Passed with the grace days, the account's data reaching that far, not drawn, not ticked off.
    const missed = (period: string) => {
      const due = occurrenceFor(e, period);
      if (!due) return null;
      const late = addDays(due, yearly ? YEARLY_LATE_DAYS : MISSED_GRACE_DAYS);
      const c = covered(accountOf(period));
      if (late >= today || !c || c < late) return null;
      return charged.has(period) || marks.has(`${e.id}|${period}`) ? null : due;
    };

    // Yearly: last year's and this year's draw, once there has been one; no 'avslutat?' (a missed year says it).
    if (yearly) {
      const first = linked.length ? [...charged].sort()[0] : null;
      const y = Number(today.slice(0, 4));
      for (const period of [y - 1, y].map((year) => `${year}-${String(e.anchorMonth).padStart(2, "0")}`)) {
        if (!first || period < first) continue;
        const due = missed(period);
        if (!due || daysBetween(due, today) > YEARLY_MISSED_DAYS) continue;
        out.push({
          key: `missed_charge:${e.id}:${period}`,
          kind: "missed_charge",
          text: `${e.name} (${kr(expected(e, period))} per år) skulle dragits ${dm(due)} från ${names.get(accountOf(period)) ?? "kontot"} men syns inte${alsoStalls(e.id)}`,
          date: due,
          accountId: accountOf(period),
          expenseId: e.id,
          period,
          amount: expected(e, period),
          yearly: true,
        });
      }
      continue;
    }

    const lastPeriod = linked.length ? [...charged].sort().at(-1)! : null;
    if (lastPeriod) {
      const [p1, p2] = [addMonths(lastPeriod, 1), addMonths(lastPeriod, 2)];
      if (missed(p1) && missed(p2)) {
        out.push({
          key: `subscription_stopped:${e.id}:${lastPeriod}`,
          kind: "subscription_stopped",
          text: `${e.name} har inte dragits sedan ${monthName(lastPeriod)} – avslutat? Pausa den i verktyget`,
          date: missed(p2)!,
          accountId,
          expenseId: e.id,
          period: lastPeriod,
        });
        continue;
      }
    }
    // Last month and this; an expense with charges only from its first one on.
    const first = linked.length ? [...charged].sort()[0] : monthOf(today);
    for (const period of [addMonths(monthOf(today), -1), monthOf(today)]) {
      if (period < first) continue;
      const due = missed(period);
      if (!due) continue;
      out.push({
        key: `missed_charge:${e.id}:${period}`,
        kind: "missed_charge",
        text: `${e.name} (${kr(expected(e, period))}) skulle dragits ${dm(due)} från ${names.get(accountOf(period)) ?? "kontot"} men syns inte${alsoStalls(e.id)}`,
        date: due,
        accountId: accountOf(period),
        expenseId: e.id,
        period,
        amount: expected(e, period),
      });
    }
  }
  return out;
}

/** Yearly expenses coming up within their reminder days and not yet paid (see yearly_renewal). */
function renewals(db: Db, today: string): Finding[] {
  const marks = new Set(db.select().from(recurringExpenseMarks).all().map((m) => `${m.recurringExpenseId}|${m.period}`));
  const expected = expectedAmounts(db);
  const out: Finding[] = [];
  for (const e of db.select().from(recurringExpenses).where(and(eq(recurringExpenses.paused, false), eq(recurringExpenses.billingCycle, "yearly"))).all()) {
    const days = e.remindDays ?? YEARLY_REMIND_DAYS;
    const next = days > 0 ? nextOccurrence(e, today) : null;
    if (!next) continue;
    const left = daysBetween(today, next.date);
    if (left > days) continue;
    const paid = db
      .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, e.id), isNull(transactions.deletedAt)))
      .all()
      .some((t) => chargePeriod(e, t) === next.period);
    if (paid || marks.has(`${e.id}|${next.period}`)) continue;
    const amount = expected(e, next.period);
    const when = left === 0 ? "i dag" : left === 1 ? "i morgon" : `om ${left} dagar`;
    const invoice = e.paymentMethod === "transfer";
    out.push({
      key: `yearly_renewal:${e.id}:${next.period}`,
      kind: "yearly_renewal",
      text: invoice
        ? `${e.name} (${kr(amount)}) ska vara betald senast ${dm(next.date)}, ${when}`
        : `${e.name} förnyas ${dm(next.date)} (${kr(amount)}), ${when} – behålla den?`,
      date: next.date,
      accountId: e.accountId,
      expenseId: e.id,
      period: next.period,
      amount,
      yearly: true,
      invoice,
    });
  }
  return out;
}

/**
 * Subscriptions being watched, drawing within their reminder days.
 *
 * This is the temporary subscription: started for a month to watch one thing,
 * and to be cancelled before it draws again. The tool can't cancel anything —
 * what it can do is ask in time, every period, until the expense is paused.
 * Yearly ones are asked about by `renewals` instead.
 */
function comingCharges(db: Db, today: string): Finding[] {
  const marks = new Set(db.select().from(recurringExpenseMarks).all().map((m) => `${m.recurringExpenseId}|${m.period}`));
  const expected = expectedAmounts(db);
  const out: Finding[] = [];
  const watched = db
    .select()
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.paused, false), eq(recurringExpenses.remindBeforeCharge, true), ne(recurringExpenses.billingCycle, "yearly")))
    .all();
  for (const e of watched) {
    const days = e.remindDays ?? CHARGE_REMIND_DAYS;
    if (days <= 0) continue;
    const next = nextOccurrence(e, today);
    if (!next) continue;
    const left = daysBetween(today, next.date);
    if (left > days) continue;
    // Already drawn for that period, or ticked off by hand: nothing to warn about.
    const charged = db
      .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, e.id), isNull(transactions.deletedAt)))
      .all()
      .some((t) => chargePeriod(e, t) === next.period);
    if (charged || marks.has(`${e.id}|${next.period}`)) continue;
    const amount = expected(e, next.period);
    const when = left === 0 ? "i dag" : left === 1 ? "i morgon" : `om ${left} dagar`;
    out.push({
      key: `charge_coming:${e.id}:${next.period}`,
      kind: "charge_coming",
      text: `${e.name} dras ${dm(next.date)} (${kr(amount)}), ${when} – säga upp den innan dess?`,
      date: next.date,
      accountId: e.accountId,
      expenseId: e.id,
      period: next.period,
      amount,
    });
  }
  return out;
}

/**
 * Sparandet: the three things about a portfolio worth interrupting for.
 *
 * None of them is a price movement. A holding that fell 4 % today is not news
 * — it is Tuesday. What is news is that the policy's ceiling has been passed,
 * that the prices stopped arriving, or that something can't be valued at all.
 */
function portfolioFindings(db: Db, today: string): Finding[] {
  const value = valuePortfolio(db, today);
  if (value.holdings.length === 0) return [];
  const out: Finding[] = [];

  if (value.policy.state === "over") {
    // Keyed by the month: said once, not once a sync, and asked again next
    // month if it is still over.
    out.push({
      key: `bet_zone_over:${monthOf(today)}`,
      kind: "bet_zone_over",
      text: value.policy.text,
      date: today,
      amount: value.policy.trimOre ?? undefined,
    });
  }

  const fetched = lastFetchAt(db);
  const fetchedDay = fetched?.slice(0, 10) ?? null;
  if (fetchedDay && daysBetween(fetchedDay, today) >= PRICE_STALE_DAYS) {
    out.push({
      key: `prices_stale:${fetchedDay}`,
      kind: "prices_stale",
      text: `Kurserna har inte kunnat hämtas sedan ${dm(fetchedDay)}. Innehaven värderas med de kurser som finns.`,
      date: fetchedDay,
    });
  } else if (fetchedDay) {
    // The others arrive, one doesn't: it would go on being valued at its last
    // price without a word. One finding per instrument and stall.
    const byInstrument = lastFetchByInstrument(db);
    for (const i of value.instruments) {
      const day = byInstrument.get(i.instrumentId)?.slice(0, 10);
      if (!day || daysBetween(day, today) < PRICE_STALE_DAYS) continue;
      const priceDate = value.holdings.find((h) => h.instrumentId === i.instrumentId)?.priceDate;
      out.push({
        key: `prices_stale:${i.instrumentId}:${day}`,
        kind: "prices_stale",
        text: `Kursen för ${i.name} har inte kunnat hämtas sedan ${dm(day)}, fast de andra kurserna kommer. Innehavet värderas med kursen${priceDate ? ` från ${dm(priceDate)}` : " som finns"}.`,
        date: day,
      });
    }
  }

  const noRate = value.missing.filter((h) => h.missing === "rate");
  const pairs = [...new Set(noRate.map((h) => `${h.currency}/SEK`))];
  for (const pair of pairs) {
    const names = noRate.filter((h) => `${h.currency}/SEK` === pair).map((h) => h.name);
    out.push({
      key: `fx_missing:${pair}`,
      kind: "fx_missing",
      text: `Valutakursen ${pair} saknas, så ${names.join(", ")} kan inte värderas.`,
      date: today,
    });
  }
  return out;
}

/**
 * Ekonomisk situation: the two things about a balance sheet worth saying.
 *
 * Neither is a movement. A net worth that fell this month is not news — the
 * market moved. What is news is that the buffer would not carry three months,
 * and that a pension figure has gone a year without anybody looking at it.
 */
function situationFindings(db: Db, today: string): Finding[] {
  const out: Finding[] = [];

  const e = endurance(db, today);
  // Against what would have to be paid, as Uthållighet counts.
  const months = e.essential.buffer.months;
  if (months !== null && months < BUFFER_MIN_MONTHS) {
    // Keyed by the month: said once, not once an overview is opened.
    const { bufferAccount, bufferOre, cash, cashOre, deposited, liquidOre, monthStart } = e.capital;
    const parts = monthStart ? monthStartParts(monthStart, cashOre) : bufferParts(bufferAccount, bufferOre, cash, deposited);
    out.push({
      key: `buffer_low:${monthOf(today)}`,
      kind: "buffer_low",
      text: `Bufferten räcker ${months.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} månader — under ${BUFFER_MIN_MONTHS}. ${parts[0].toUpperCase()}${parts.slice(1)} mot det nödvändiga ${kr(e.cost.essentialsOre)}/mån.`,
      date: today,
      amount: Math.max(0, BUFFER_MIN_MONTHS * e.cost.essentialsOre - liquidOre),
    });
  }

  // One per entry, keyed by the value it is stale at: a new figure clears it,
  // and the same old figure is never asked about twice.
  const pension = pensionOverview(db, today);
  // Keyed by the forecast it is stale at: a new one clears it.
  if (pension.forecasts.stale) {
    const f = pension.forecasts.stale;
    out.push({
      key: `pension_forecast_stale:${f.madeOn}`,
      kind: "pension_forecast_stale",
      text: `Senaste pensionsprognosen är från ${dm(f.madeOn)} ${f.madeOn.slice(0, 4)} — ${f.monthsOld} månader gammal. Gör en ny på minpension.se och skriv av den.`,
      date: f.madeOn,
    });
  }
  for (const row of pension.stale) {
    out.push({
      key: `pension_stale:${row.id}:${row.valueDate}`,
      kind: "pension_stale",
      text: `${row.name} har ett värde från ${dm(row.valueDate)} — över ett år gammalt. Skriv av ett nytt från minpension.se.`,
      date: row.valueDate,
    });
  }
  return out;
}

/** The ISK's value at this share of the allowance is worth a word: over it, the rest is taxed. */
export const ISK_ALLOWANCE_SHARE = 0.9;

/**
 * Deklaration: the ISK (holdings and cash) above 90 % of this year's
 * tax-free allowance, said once a month.
 */
function iskFindings(db: Db, today: string): Finding[] {
  const { today: now, current } = iskOverview(db, today);
  if (now.share === null || now.share < ISK_ALLOWANCE_SHARE) return [];
  const over = now.valueOre > now.allowanceOre;
  return [
    {
      key: `isk_allowance:${monthOf(today)}`,
      kind: "isk_allowance",
      text: over
        ? `ISK:t är värt ${kr(now.valueOre)}, över fribeloppet ${kr(now.allowanceOre)} för ${current.year}: det som ligger över ger schablonskatt.`
        : `ISK:t är värt ${kr(now.valueOre)}, ${Math.round(now.share * 100)} % av fribeloppet ${kr(now.allowanceOre)} för ${current.year}. Över det ger kapitalunderlaget schablonskatt.`,
      date: today,
      amount: now.valueOre,
    },
  ];
}

/** After 2 May: last year's return not read in. Keyed by the income year, so it is said once. */
function taxReturnFindings(db: Db, today: string): Finding[] {
  const due = taxReturnDue(db, today);
  if (!due.inUse || due.state !== "late" || today.slice(5) < "05-03") return [];
  return [
    {
      key: `tax_return_missing:${due.incomeYear}`,
      kind: "tax_return_missing",
      text: `Deklarationen för ${due.incomeYear} saknas: ingen kvittens är inläst. Hämta den på Skatteverkets Mina sidor och dra den till Importer.`,
      date: today,
    },
  ];
}

// ---------- Running ----------

/** Every finding of the kinds that are on, not dismissed, newest first. */
export function findings(db: Db, today: string): Finding[] {
  const on = watchKinds(db);
  const since = addDays(today, -(WATCH_DAYS - 1));
  const rows = purchases(db);
  const all = [
    ...(on.price_drift ? priceDrift(db, rows, since) : []),
    ...(on.double_charge ? doubleCharges(db, rows, since) : []),
    ...(on.unusual_amount ? unusualAmounts(rows, since) : []),
    ...(on.new_merchant ? newMerchants(rows, since) : []),
    ...(on.missed_charge || on.subscription_stopped ? missedCharges(db, today).filter((f) => on[f.kind]) : []),
    ...(on.yearly_renewal ? renewals(db, today) : []),
    ...(on.charge_coming ? comingCharges(db, today) : []),
    // Sparandet: the ceiling passed, prices not arriving, a rate missing.
    ...portfolioFindings(db, today).filter((f) => on[f.kind]),
    // Ekonomisk situation: a buffer too thin, a pension value gone stale.
    ...situationFindings(db, today).filter((f) => on[f.kind]),
    // Deklaration: the ISK close to the tax-free allowance.
    ...(on.isk_allowance ? iskFindings(db, today) : []),
    ...(on.tax_return_missing ? taxReturnFindings(db, today) : []),
    // Prylar: warranties and return deadlines running out, and purchases that
    // look like things but aren't written down as any.
    ...(on.warranty_ending ? warrantiesEnding(db, today) : []),
    ...(on.return_deadline ? returnDeadlines(db, today) : []),
    ...(on.maybe_item ? maybeItems(db, today) : []),
  ];
  const dismissed = new Set(db.select({ key: watchFindings.key }).from(watchFindings).where(isNotNull(watchFindings.dismissedAt)).all().map((r) => r.key));
  return all.filter((f) => !dismissed.has(f.key)).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

/** One notification per run: the title and at most 8 lines. */
export function notification(found: Finding[]): { title: string; message: string } {
  const lines = found.slice(0, 8).map((f) => `• ${f.text}`);
  if (found.length > 8) lines[7] = `• … och ${found.length - 7} till`;
  return { title: found.length === 1 ? "Vakt: 1 nytt fynd" : `Vakt: ${found.length} nya fynd`, message: lines.join("\n") };
}

/**
 * After a sync or an import: the findings not seen before are remembered and
 * sent together in one notification (when there is a topic).
 */
export async function runWatch(db: Db, today: string, ntfyTopic = ""): Promise<{ findings: Finding[]; fresh: Finding[]; notified: boolean }> {
  const found = findings(db, today);
  const known = new Set(db.select({ key: watchFindings.key }).from(watchFindings).all().map((r) => r.key));
  const fresh = found.filter((f) => !known.has(f.key));
  for (const f of fresh) db.insert(watchFindings).values({ key: f.key, kind: f.kind, series: f.series ?? null }).onConflictDoNothing().run();
  let notified = false;
  if (fresh.length && ntfyTopic) notified = await sendNtfy(ntfyTopic, { ...notification(fresh), tags: ["eyes"] });
  return { findings: found, fresh, notified };
}

/** Never shown again. A double charge dismissed is 'behåll båda': also off the possible duplicates. */
export function dismissFinding(db: Db, key: string, today: string): void {
  const f = findings(db, today).find((x) => x.key === key);
  const kind = (f?.kind ?? key.split(":")[0]) as WatchKind;
  if (!WATCH_KINDS.includes(kind)) throw new Error("Okänt fynd.");
  const at = new Date().toISOString();
  db.insert(watchFindings)
    .values({ key, kind, series: f?.series ?? null, dismissedAt: at })
    .onConflictDoUpdate({ target: watchFindings.key, set: { dismissedAt: at } })
    .run();
  if (kind === "double_charge") {
    const [, a, b] = key.split(":").map(Number);
    if (a && b) db.insert(duplicateDismissals).values({ olderId: Math.min(a, b), newerId: Math.max(a, b) }).onConflictDoNothing().run();
  }
}

/** Undo a dismissal (right after it, from the toast). */
export function restoreFinding(db: Db, key: string): void {
  db.update(watchFindings).set({ dismissedAt: null }).where(and(eq(watchFindings.key, key), isNull(watchFindings.acceptedAt))).run();
  if (key.startsWith("double_charge:")) {
    const [, a, b] = key.split(":").map(Number);
    db.delete(duplicateDismissals).where(and(eq(duplicateDismissals.olderId, Math.min(a, b)), eq(duplicateDismissals.newerId, Math.max(a, b)))).run();
  }
}

/**
 * 'Acceptera nytt belopp': the new amount is the series' price from now on,
 * and a fixed expense's amount becomes the charge's (as 'Använd' does).
 */
export function acceptFinding(db: Db, key: string, today: string): Finding {
  const f = findings(db, today).find((x) => x.key === key);
  if (!f || f.kind !== "price_drift") throw new Error("Fyndet finns inte längre.");
  const at = new Date().toISOString();
  db.insert(watchFindings)
    .values({ key, kind: f.kind, series: f.series, amount: f.newAmount, date: f.date, dismissedAt: at, acceptedAt: at })
    .onConflictDoUpdate({ target: watchFindings.key, set: { series: f.series, amount: f.newAmount, date: f.date, dismissedAt: at, acceptedAt: at } })
    .run();
  if (f.expenseId !== undefined) {
    const others = (partsByOwner(db).get(f.expenseId) ?? []).reduce((s, p) => s + p.amount, 0);
    db.update(recurringExpenses)
      .set({ amount: f.newAmount! - others, manuallyEditedAt: at })
      .where(eq(recurringExpenses.id, f.expenseId))
      .run();
  }
  return f;
}
