import { Hono } from "hono";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { expenseEstimates, setFoodEstimate } from "../recurring/estimates.js";
import {
  BANK_DAY_RULES,
  BILLING_CYCLES,
  DATE_BASES,
  EXPENSE_CURRENCIES,
  PAYMENT_METHODS,
  SCHEDULE_TYPES,
  accounts,
  categories,
  recurringExpenseAmounts,
  recurringExpenseMarks,
  recurringExpenses,
  transactions,
} from "../db/schema.js";
import { chargeDate, describeSchedule, nextOccurrence, occurrenceFor, suggestSchedule, addMonthsToPeriod, ON_SCHEDULE_DAYS, nearestOccurrence } from "../recurring/schedule.js";
import { addMonths, monthOf, todayLocal } from "../overview/dates.js";
import { expenseOccurrences } from "../overview/overview.js";
import { applyExpenseShared, linkRecurring } from "../recurring/link.js";
import { chargePeriod, expectedAmounts, latestChargeCheck, monthsOfYear } from "../recurring/amounts.js";
import { foreignPrice, priceInKronor } from "../recurring/foreignPrice.js";
import { applyPriceChanges } from "../recurring/priceChange.js";
import { chargeOwnerId, FOLLOWED_FIELDS, followOwner, groupShared, partsByOwner } from "../recurring/parts.js";
import { ImportParseError } from "../import/swedbank.js";
import { iconResolver, iconUrl } from "../icons/icons.js";
import { isIsoDate } from "../import/text.js";
import { accountFor, periodMonth } from "../recurring/changes.js";

type Expense = typeof recurringExpenses.$inferSelect;
type Patch = Partial<Omit<Expense, "id" | "manuallyEditedAt">>;

/** Validates a create/update body. Returns the clean patch or an error message. */
function validate(db: Db, b: Record<string, unknown>, creating: boolean): Patch | string {
  const out: Patch = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (has("name") || creating) {
    if (typeof b.name !== "string" || !b.name.trim()) return "Namn krävs.";
    out.name = b.name.trim();
  }
  // Priced in a currency, a new one may leave the kronor to the rate.
  if (has("amount") || (creating && !(b.currency && b.foreignAmount))) {
    if (!Number.isInteger(b.amount) || (b.amount as number) <= 0) return "Beloppet ska vara ett positivt antal öre.";
    out.amount = b.amount as number;
  }
  if (has("anchorDay")) {
    if (b.anchorDay !== null && (!Number.isInteger(b.anchorDay) || (b.anchorDay as number) < 1 || (b.anchorDay as number) > 31)) return "Dag ska vara 1–31.";
    out.anchorDay = b.anchorDay as number | null;
  }
  if (has("scheduleType")) {
    if (!SCHEDULE_TYPES.includes(b.scheduleType as never)) return "Okänd schematyp.";
    out.scheduleType = b.scheduleType as Expense["scheduleType"];
  }
  if (has("bankDayRule")) {
    if (!BANK_DAY_RULES.includes(b.bankDayRule as never)) return "Okänd bankdagsregel.";
    out.bankDayRule = b.bankDayRule as Expense["bankDayRule"];
  }
  if (has("dateBasis")) {
    if (!DATE_BASES.includes(b.dateBasis as never)) return "Okänd datumgrund.";
    out.dateBasis = b.dateBasis as Expense["dateBasis"];
  }
  if (has("paymentMethod") || creating) {
    if (!PAYMENT_METHODS.includes(b.paymentMethod as never)) return "Okänt betalsätt.";
    out.paymentMethod = b.paymentMethod as Expense["paymentMethod"];
  }
  if (has("remindDays")) {
    if (b.remindDays !== null && (!Number.isInteger(b.remindDays) || (b.remindDays as number) < 0 || (b.remindDays as number) > 90)) return "Påminnelsen ska vara 0–90 dagar före.";
    out.remindDays = b.remindDays as number | null;
  }
  if (has("anchorMonth")) {
    if (b.anchorMonth !== null && (!Number.isInteger(b.anchorMonth) || (b.anchorMonth as number) < 1 || (b.anchorMonth as number) > 12)) return "Månad ska vara 1–12.";
    out.anchorMonth = b.anchorMonth as number | null;
  }
  if (has("billingCycle")) {
    if (!BILLING_CYCLES.includes(b.billingCycle as never)) return "Okänd betalningsperiod.";
    out.billingCycle = b.billingCycle as Expense["billingCycle"];
  }
  if (has("accountId")) {
    if (b.accountId !== null && !db.select().from(accounts).where(eq(accounts.id, b.accountId as number)).get()) return "Kontot finns inte.";
    out.accountId = b.accountId as number | null;
  }
  if (has("previousAccountId")) {
    if (b.previousAccountId !== null && !db.select().from(accounts).where(eq(accounts.id, b.previousAccountId as number)).get()) return "Det tidigare kontot finns inte.";
    out.previousAccountId = b.previousAccountId as number | null;
  }
  for (const k of ["accountFrom", "lastPeriod"] as const) {
    if (has(k)) {
      if (b[k] !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b[k]))) return "Månaden ska vara ÅÅÅÅ-MM.";
      out[k] = b[k] as string | null;
    }
  }
  if (has("categoryId")) {
    if (b.categoryId !== null && !db.select().from(categories).where(eq(categories.id, b.categoryId as number)).get()) return "Kategorin finns inte.";
    out.categoryId = b.categoryId as number | null;
  }
  if (has("boundUntil")) {
    if (b.boundUntil !== null && b.boundUntil !== "" && !isIsoDate(String(b.boundUntil))) return "Bunden till ska vara ett datum (ÅÅÅÅ-MM-DD).";
    out.boundUntil = b.boundUntil ? String(b.boundUntil) : null;
  }
  for (const k of ["shared", "paused", "yearlyAvailable", "remindBeforeCharge"] as const) {
    if (has(k)) {
      if (typeof b[k] !== "boolean") return `${k} ska vara sant/falskt.`;
      out[k] = b[k] as boolean;
    }
  }
  for (const k of ["matchPattern", "link", "note"] as const) {
    if (has(k)) out[k] = typeof b[k] === "string" && (b[k] as string).trim() ? (b[k] as string).trim() : null;
  }
  if (has("currency")) {
    if (b.currency !== null && !EXPENSE_CURRENCIES.includes(b.currency as never)) return "Valutan ska vara EUR eller USD (eller ingen, kronor).";
    out.currency = b.currency as Expense["currency"];
  }
  if (has("foreignAmount")) {
    if (b.foreignAmount !== null && (!Number.isInteger(b.foreignAmount) || (b.foreignAmount as number) <= 0)) return "Priset i valutan ska vara ett positivt antal hundradelar.";
    out.foreignAmount = b.foreignAmount as number | null;
  }
  if (has("vatPercent")) {
    if (b.vatPercent !== null && (!Number.isInteger(b.vatPercent) || (b.vatPercent as number) < 0 || (b.vatPercent as number) > 50)) return "Momsen ska vara 0–50 %.";
    out.vatPercent = b.vatPercent as number | null;
  }
  // A new price from a period on: its month, and the kronor or (priced in a currency) the new price before VAT.
  if (has("nextFrom")) {
    if (b.nextFrom !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.nextFrom))) return "Månaden för det nya priset ska vara ÅÅÅÅ-MM.";
    out.nextFrom = b.nextFrom as string | null;
    if (b.nextFrom === null) Object.assign(out, { nextAmount: null, nextForeignAmount: null });
  }
  for (const k of ["nextAmount", "nextForeignAmount"] as const) {
    if (has(k) && b.nextFrom !== null) {
      if (b[k] !== null && (!Number.isInteger(b[k]) || (b[k] as number) <= 0)) return "Det nya priset ska vara ett positivt belopp.";
      out[k] = b[k] as number | null;
    }
  }
  if (has("partOfId")) {
    if (b.partOfId === null) out.partOfId = null;
    else {
      const owner = Number.isInteger(b.partOfId) ? db.select().from(recurringExpenses).where(eq(recurringExpenses.id, b.partOfId as number)).get() : undefined;
      if (!owner) return "Utgiften den ska ingå i finns inte.";
      if (owner.partOfId !== null) return `${owner.name} ingår själv i en annan dragning.`;
      out.partOfId = owner.id;
    }
  }
  return out;
}

/** Changing these changes what an expense priced in a currency comes to in kronor. */
const PRICE_FIELDS = ["currency", "foreignAmount", "vatPercent", "accountId", "nextForeignAmount"] as const;

/** Changing these changes which transactions belong to the expense: its links are rebuilt. */
const LINK_FIELDS = ["matchPattern", "scheduleType", "anchorDay", "anchorMonth", "bankDayRule", "dateBasis", "billingCycle"] as const;
/**
 * These hold from a month (see recurring/changes.ts): only the links that no
 * longer fit are undone, so the charges already drawn keep theirs.
 */
const FROM_MONTH_FIELDS = ["accountId", "previousAccountId", "accountFrom", "paused", "lastPeriod"] as const;

/**
 * A move to another account holds from the next draw (the one before keeps the
 * periods before it); a cancellation after the latest charge. Set unless the
 * patch says otherwise; 'previousAccountId: null' is a correction (the account
 * was wrong all along).
 */
function fromMonthDefaults(db: Db, before: Expense, v: Patch, today: string): void {
  if ("accountId" in v && v.accountId !== before.accountId && !("previousAccountId" in v)) {
    const move = before.accountId !== null && v.accountId !== null;
    v.previousAccountId = move ? before.accountId : null;
    if (move && !("accountFrom" in v)) v.accountFrom = periodMonth(before, nextOccurrence(before, today)?.period ?? monthOf(today));
  }
  if ("previousAccountId" in v) {
    if (v.previousAccountId === null) v.accountFrom = null;
    else if (!("accountFrom" in v) && !before.accountFrom) v.accountFrom = periodMonth(before, nextOccurrence(before, today)?.period ?? monthOf(today));
  }
  if ("paused" in v) {
    if (!v.paused) v.lastPeriod = null;
    else if (!before.paused && !("lastPeriod" in v)) {
      const latest = db
        .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate })
        .from(transactions)
        .where(and(eq(transactions.recurringExpenseId, chargeOwnerId(before)), isNull(transactions.deletedAt)))
        .all()
        .map((t) => periodMonth(before, chargePeriod(before, t)))
        .sort()
        .at(-1);
      v.lastPeriod = latest ?? null;
    }
  }
}

/** Undoes the links a from-month change no longer allows: on another account than their period's, or after the last draw. */
function unlinkMisfits(db: Db, e: Expense): void {
  const linked = db
    .select({ id: transactions.id, accountId: transactions.accountId, bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate })
    .from(transactions)
    .where(and(eq(transactions.recurringExpenseId, e.id), isNull(transactions.deletedAt)))
    .all();
  for (const t of linked) {
    const period = chargePeriod(e, t);
    // Before a move only the move's own periods are looked at: older links (an earlier card) stay.
    const wrongAccount = t.accountId !== accountFor(e, period) && (e.previousAccountId === null || e.accountFrom === null || periodMonth(e, period) >= e.accountFrom);
    const afterLast = e.paused && e.lastPeriod !== null && periodMonth(e, period) > e.lastPeriod;
    if (wrongAccount || afterLast) db.update(transactions).set({ recurringExpenseId: null }).where(eq(transactions.id, t.id)).run();
  }
}

export function recurringExpenseRoutes(db: Db) {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = db.select().from(recurringExpenses).orderBy(asc(recurringExpenses.anchorDay), asc(recurringExpenses.name)).all();
    const today = todayLocal();
    const charges = db
      .select({
        expenseId: transactions.recurringExpenseId,
        bookingDate: transactions.bookingDate,
        transactionDate: transactions.transactionDate,
        postedDate: transactions.postedDate,
      })
      .from(transactions)
      .where(and(sql`${transactions.recurringExpenseId} is not null`, isNull(transactions.deletedAt)))
      .all();
    const stats = db
      .select({ id: transactions.recurringExpenseId, n: sql<number>`count(*)` })
      .from(transactions)
      .where(and(sql`${transactions.recurringExpenseId} is not null`, isNull(transactions.deletedAt)))
      .groupBy(transactions.recurringExpenseId)
      .all();
    const countById = new Map(stats.map((s) => [s.id, s.n]));
    const expected = expectedAmounts(db);
    const parts = partsByOwner(db);
    const withMonths = new Set(
      db.select({ id: recurringExpenseAmounts.recurringExpenseId }).from(recurringExpenseAmounts).all().map((r) => r.id),
    );
    // The icon: its own image, else what its latest charge (or its pattern) resolves to.
    const icon = iconResolver(db);
    const chargeText = new Map(
      db
        .select({ id: transactions.recurringExpenseId, text: transactions.descriptionClean, amount: transactions.amount })
        .from(transactions)
        .where(and(sql`${transactions.recurringExpenseId} is not null`, isNull(transactions.deletedAt)))
        .orderBy(asc(transactions.bookingDate))
        .all()
        .map((t) => [t.id, t]),
    );
    const iconOf = (r: (typeof rows)[number]) => {
      if (r.iconPath) return { image: iconUrl(r.iconPath) };
      const charge = chargeText.get(r.id);
      return charge ? icon(charge.text, charge.amount) : icon(r.matchPattern, -1);
    };
    // A yearly one: this year's draw and its status (thisMonth is only the month it falls in).
    const allMarks = db.select().from(recurringExpenseMarks).orderBy(asc(recurringExpenseMarks.period)).all();
    const marks = new Set(allMarks.filter((m) => m.kind === "paid").map((m) => `${m.recurringExpenseId}|${m.period}`));
    // The periods it wasn't drawn (paused for a while).
    const skippedOf = (id: number) => allMarks.filter((m) => m.kind === "skipped" && m.recurringExpenseId === id).map((m) => m.period);
    const linkedCharges = db
      .select({ id: transactions.id, expenseId: transactions.recurringExpenseId, bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate, amount: transactions.amount })
      .from(transactions)
      .where(and(sql`${transactions.recurringExpenseId} is not null`, isNull(transactions.deletedAt)))
      .all();
    const thisYearOf = (r: (typeof rows)[number]) => {
      if (r.billingCycle !== "yearly" || !r.anchorMonth) return null;
      const period = `${today.slice(0, 4)}-${String(r.anchorMonth).padStart(2, "0")}`;
      const dueDate = occurrenceFor(r, period);
      if (!dueDate) return null;
      const t = linkedCharges.find((c) => c.expenseId === r.id && chargePeriod(r, c) === period);
      const status = t ? "dragen" : marks.has(`${r.id}|${period}`) ? "markerad_betald" : dueDate >= today ? "kommande" : "passerad";
      return { period, dueDate, status, amount: expected(r, period), transaction: t ? { id: t.id, bookingDate: t.bookingDate, amount: t.amount } : null };
    };
    // The rule its charges match: where 'all purchases there' puts an uploaded picture.
    const iconRuleOf = (r: (typeof rows)[number]) => {
      const charge = chargeText.get(r.id);
      const rule = charge ? icon.rule(charge.text, charge.amount) : icon.rule(r.matchPattern, -1);
      return rule ? { id: rule.id, pattern: rule.pattern, hasImage: rule.iconPath !== null } : null;
    };
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // This month's draw and its status, as on Översikten (none for paused and yearly ones).
    const occurrence = new Map(
      expenseOccurrences(db, today, null)
        .filter((o) => o.period === monthOf(today))
        .map((o) => [o.expenseId, { period: o.period, dueDate: o.dueDate, status: o.status, amount: o.amount, transaction: o.transaction }]),
    );
    return c.json(
      rows.map((r) => {
        const check = latestChargeCheck(db, r, expected, parts);
        // A part has no charges of its own: no schedule to suggest from them.
        const dates = r.partOfId === null ? charges.filter((t) => t.expenseId === r.id).map((t) => chargeDate(r, t)) : [];
        const suggestion = r.billingCycle === "monthly" ? suggestSchedule(r, dates) : null;
        const next = nextOccurrence(r, today);
        return {
          ...r,
          scheduleText: describeSchedule(r),
          nextDate: next?.date ?? null,
          // The month of the next draw's period: where a new price starts by default.
          nextPeriod: next ? periodMonth(r, next.period) : null,
          // Linked charges more than ±2 days from the predicted draw ('avvek från schemat').
          offSchedule: r.billingCycle === "yearly" ? 0 : dates.filter((d) => (nearestOccurrence(r, d)?.distance ?? 0) > ON_SCHEDULE_DAYS).length,
          // A schedule that predicts more of the linked charges than the current one (never applied by itself).
          suggestion:
            suggestion && suggestion.matches > suggestion.currentMatches
              ? { ...suggestion, text: describeSchedule(suggestion) }
              : null,
          linkedCount: countById.get(chargeOwnerId(r)) ?? 0,
          // Drawn together: the one it is part of, or the ones part of it.
          partOfName: r.partOfId !== null ? (rows.find((x) => x.id === r.partOfId)?.name ?? null) : null,
          partNames: (parts.get(r.id) ?? []).map((p) => p.name),
          latestCharge: check.latest,
          // The bank charged something else than expected for that month, last time.
          amountChanged: check.changed,
          latestExpected: check.expected,
          // Priced in a currency: the price with VAT against the charge's foreign amount.
          latestForeign: check.foreign,
          // Has amounts set per month, and this month's expected amount.
          variesByMonth: withMonths.has(r.id),
          thisMonthAmount: expected(r, thisMonth),
          thisMonth: occurrence.get(r.id) ?? null,
          icon: iconOf(r),
          iconRule: iconRuleOf(r),
          thisYear: thisYearOf(r),
          skippedPeriods: skippedOf(r.id),
          // Priced in a currency: the price, VAT, rate and markup its kronor amount comes from.
          foreignPrice: foreignPrice(db, r),
        };
      }),
    );
  });

  /** Uppskattat: food (entered, with the average as a suggestion) and fuel (Pendling's forecast), household and my part. */
  app.get("/estimates", (c) => c.json(expenseEstimates(db, todayLocal())));
  app.put("/estimates", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { food?: unknown };
    try {
      setFoodEstimate(db, b.food ?? null);
      return c.json(expenseEstimates(db, todayLocal()));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  /**
   * The predicted draws that fall in a month (?month=YYYY-MM): a draw moved in
   * from the month before (28 Feb -> 2 Mar) is listed on its date, for its month.
   */
  app.get("/calendar", (c) => {
    const month = c.req.query("month") ?? todayLocal().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "Månad ska vara ÅÅÅÅ-MM." }, 400);
    const out: { expenseId: number; period: string; date: string }[] = [];
    for (const e of db.select().from(recurringExpenses).where(eq(recurringExpenses.paused, false)).all()) {
      // A yearly one only has a draw in its month (occurrenceFor gives none in the others).
      for (const period of [addMonthsToPeriod(month, -1), month, addMonthsToPeriod(month, 1)]) {
        const date = occurrenceFor(e, period);
        if (date && date.slice(0, 7) === month) out.push({ expenseId: e.id, period, date });
      }
    }
    return c.json(out.sort((a, b) => a.date.localeCompare(b.date)));
  });

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validate(db, body, true);
    if (typeof v === "string") return c.json({ error: v }, 400);
    if (v.amount === undefined) {
      const p = foreignPrice(db, { currency: v.currency ?? null, foreignAmount: v.foreignAmount ?? null, vatPercent: v.vatPercent ?? null, accountId: v.accountId ?? null });
      if (!p) return c.json({ error: `Ingen kurs för ${v.currency} är hämtad än. Fyll i beloppet i kronor också.` }, 400);
      v.amount = p.amount;
    }
    const created = db.transaction((tx) => {
      const row = tx.insert(recurringExpenses).values(v as typeof recurringExpenses.$inferInsert).returning().get();
      priceInKronor(tx as unknown as Db, row);
      if (row.partOfId !== null) followOwner(tx as unknown as Db, row.partOfId);
      linkRecurring(tx as unknown as Db);
      return tx.select().from(recurringExpenses).where(eq(recurringExpenses.id, row.id)).get()!;
    });
    return c.json(created);
  });

  app.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validate(db, body, false);
    if (typeof v === "string") return c.json({ error: v }, 400);
    if (v.partOfId != null) {
      if (v.partOfId === id) return c.json({ error: "En utgift kan inte ingå i sin egen dragning." }, 400);
      if (db.select().from(recurringExpenses).where(eq(recurringExpenses.partOfId, id)).get()) {
        return c.json({ error: "Andra utgifter ingår i den här dragningen, så den kan inte ingå i en annan." }, 400);
      }
    }
    const before = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get();
    // A part follows its owner's day and account, and has no text of its own to match.
    if (before?.partOfId != null && v.partOfId !== null) for (const k of [...FOLLOWED_FIELDS, "matchPattern"] as const) delete v[k];
    if (before) fromMonthDefaults(db, before, v, todayLocal());
    const updated = db.transaction((txn) => {
      const tx = txn as unknown as Db;
      const row = tx
        .update(recurringExpenses)
        .set({ ...v, manuallyEditedAt: new Date().toISOString() })
        .where(eq(recurringExpenses.id, id))
        .returning()
        .get();
      if (row && PRICE_FIELDS.some((k) => k in v)) priceInKronor(tx, row);
      // A new price from a period already drawn is the price at once.
      if (row && "nextFrom" in v) applyPriceChanges(tx);
      if (row && LINK_FIELDS.some((k) => k in v)) {
        tx.update(transactions).set({ recurringExpenseId: null }).where(eq(transactions.recurringExpenseId, id)).run();
        linkRecurring(tx);
      } else if (row && FROM_MONTH_FIELDS.some((k) => k in v)) {
        unlinkMisfits(tx, row);
        linkRecurring(tx);
      }
      if (row && "partOfId" in v) {
        if (row.partOfId !== null) {
          // Now part of another charge: none of its own, the other one's day and account.
          tx.update(transactions).set({ recurringExpenseId: null }).where(eq(transactions.recurringExpenseId, id)).run();
          followOwner(tx, row.partOfId);
          linkRecurring(tx);
        }
        for (const owner of new Set([row.partOfId, before?.partOfId].filter((x): x is number => x != null))) applyExpenseShared(tx, owner, groupShared(tx, owner));
      }
      // Its parts follow the day and account.
      if (row && row.partOfId === null && FOLLOWED_FIELDS.some((k) => k in v)) followOwner(tx, id);
      // 'Delad' on the expense: its charges follow (shared when it or any expense drawn with it is).
      if (row && "shared" in v) applyExpenseShared(tx, chargeOwnerId(row), groupShared(tx, chargeOwnerId(row)));
      return row && tx.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get();
    });
    return updated ? c.json(updated) : c.json({ error: "Hittades inte." }, 404);
  });

  // "Beloppet har ändrats": take the latest charge as the new amount. Only on request.
  app.post("/:id/accept-latest-amount", (c) => {
    const id = Number(c.req.param("id"));
    const e = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get();
    if (e?.partOfId != null) return c.json({ error: "Beloppet för en utgift som ingår i en annan dragning ändras för hand." }, 400);
    // Drawn with others: its share is what is left when theirs is taken off.
    const others = (partsByOwner(db).get(id) ?? []).reduce((s, p) => s + p.amount, 0);
    const latest = db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, id), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .get();
    if (!latest) return c.json({ error: "Ingen kopplad dragning att ta beloppet från." }, 400);
    // Priced in a currency: the new price from the charge's foreign amount, before VAT; the kronor follow.
    const charge = db
      .select({ foreignAmount: transactions.foreignAmount, foreignCurrency: transactions.foreignCurrency })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, id), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .get();
    if (e?.currency && charge?.foreignAmount && charge.foreignCurrency === e.currency) {
      const price = Math.round(Math.abs(charge.foreignAmount) / (1 + (e.vatPercent ?? 0) / 100));
      const row = db.update(recurringExpenses).set({ foreignAmount: price, manuallyEditedAt: new Date().toISOString() }).where(eq(recurringExpenses.id, id)).returning().get();
      priceInKronor(db, row);
      return c.json(db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get());
    }
    const row = db
      .update(recurringExpenses)
      .set({ amount: Math.abs(latest.amount) - others, manuallyEditedAt: new Date().toISOString() })
      .where(eq(recurringExpenses.id, id))
      .returning()
      .get();
    return row ? c.json(row) : c.json({ error: "Hittades inte." }, 404);
  });

  /** The months of a year (?year=, default this year): own amount, expected and charged. */
  app.get("/:id/months", (c) => {
    const e = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, Number(c.req.param("id")))).get();
    if (!e) return c.json({ error: "Hittades inte." }, 404);
    const year = Number(c.req.query("year")) || new Date().getFullYear();
    return c.json(monthsOfYear(db, e, year));
  });

  /**
   * The last 12 months up to this one (own amount, expected, charged) and the
   * linked charges, newest first: the panel's history.
   */
  app.get("/:id/history", (c) => {
    const e = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, Number(c.req.param("id")))).get();
    if (!e) return c.json({ error: "Hittades inte." }, 404);
    const last = monthOf(todayLocal());
    const first = addMonths(last, -11);
    const years = [...new Set([first.slice(0, 4), last.slice(0, 4)])].map(Number);
    const months = years.flatMap((y) => monthsOfYear(db, e, y)).filter((m) => m.month >= first && m.month <= last);
    const charges = db
      .select({
        id: transactions.id,
        bookingDate: transactions.bookingDate,
        transactionDate: transactions.transactionDate,
        amount: transactions.amount,
        descriptionClean: transactions.descriptionClean,
        accountId: transactions.accountId,
      })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, chargeOwnerId(e)), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .all();
    return c.json({ months, charges });
  });

  /** Set (öre) or clear (null) the amount for one month. */
  app.put("/:id/amounts/:month", async (c) => {
    const id = Number(c.req.param("id"));
    const month = c.req.param("month");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: "Månaden ska vara ÅÅÅÅ-MM." }, 400);
    if (!db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get()) return c.json({ error: "Hittades inte." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { amount?: number | null };
    const where = and(eq(recurringExpenseAmounts.recurringExpenseId, id), eq(recurringExpenseAmounts.month, month));
    if (b.amount === null || b.amount === undefined) {
      db.delete(recurringExpenseAmounts).where(where).run();
    } else {
      if (!Number.isInteger(b.amount) || b.amount <= 0) return c.json({ error: "Beloppet ska vara ett positivt antal öre." }, 400);
      db.insert(recurringExpenseAmounts)
        .values({ recurringExpenseId: id, month, amount: b.amount })
        .onConflictDoUpdate({ target: [recurringExpenseAmounts.recurringExpenseId, recurringExpenseAmounts.month], set: { amount: b.amount } })
        .run();
    }
    return c.json({ ok: true });
  });

  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    db.transaction((tx) => {
      tx.update(transactions).set({ recurringExpenseId: null }).where(eq(transactions.recurringExpenseId, id)).run();
      tx.delete(recurringExpenses).where(eq(recurringExpenses.id, id)).run();
    });
    return c.json({ ok: true });
  });

  return app;
}
