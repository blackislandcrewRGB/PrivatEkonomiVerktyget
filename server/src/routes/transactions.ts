import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { randomUUID } from "node:crypto";
import { accounts, categories, contacts, duplicateDismissals, merchantRules, recurringExpenses, transactions, TRANSACTION_SOURCES } from "../db/schema.js";
import { linkRecurring } from "../recurring/link.js";
import { WatchChargeError, makeRecurring, recurringDraft, watchCharge } from "../recurring/watchCharge.js";
import { planCandidates } from "../recurring/planCandidates.js";
import { RuleError, previewRule, ruleExamples, saveRule, suggestRule, undoRule, updateRule, type RuleSpec } from "../categorize/ruleService.js";
import { isIsoDate } from "../import/text.js";
import { cardInvoicePeriod, postedDaySql } from "../shared/settlement.js";
import { ReturnError, markReturned, refundCandidates, unmarkReturned } from "../returns.js";
import { noteSuggestions } from "../notes.js";
import { suggestLabelRule } from "../categorize/labelRules.js";
import { categorySuggestions } from "../categorySuggestions.js";
import { transactionDetails } from "../transactionDetails.js";
import { restoreRows, snapshotRows } from "../undo.js";
import { iconResolver } from "../icons/icons.js";
import { MAX_SPLIT_PARTS, SplitError, clearSplits, clearSplitsFor, loadSplits, setSplits, type SplitPart } from "../splits.js";
import { itemsByTransaction } from "../items/items.js";
import { receiptsByTransaction } from "../receipts/receipts.js";
import { todayLocal } from "../overview/dates.js";

const MAX_ROWS = 10_000;

const listColumns = {
  id: transactions.id,
  source: transactions.source,
  accountId: transactions.accountId,
  bookingDate: transactions.bookingDate,
  transactionDate: transactions.transactionDate,
  descriptionClean: transactions.descriptionClean,
  label: transactions.label,
  counterparty: transactions.counterparty,
  counterpartyName: contacts.name,
  merchantArea: transactions.merchantArea,
  cardMasked: transactions.cardMasked,
  amount: transactions.amount,
  currency: transactions.currency,
  categoryId: transactions.categoryId,
  categorySource: transactions.categorySource,
  shared: transactions.shared,
  private: transactions.private,
  paidBy: transactions.paidBy,
  forOther: transactions.forOther,
  settlementExcluded: transactions.settlementExcluded,
  returnGroupId: transactions.returnGroupId,
  isTransfer: transactions.isTransfer,
  isSettlement: sql<boolean>`coalesce(${categories.isSettlement}, 0)`.mapWith(Boolean),
  occurrenceIndex: transactions.occurrenceIndex,
  importId: transactions.importId,
  counterAccountId: transactions.counterAccountId,
  transferPairId: transactions.transferPairId,
  recurringIncomeId: transactions.recurringIncomeId,
  recurringExpenseId: transactions.recurringExpenseId,
  recurringExpenseName: recurringExpenses.name,
  note: transactions.note,
  manuallyEditedAt: transactions.manuallyEditedAt,
  deletedAt: transactions.deletedAt,
};

/**
 * Rows whose split has one of these categories (or a subcategory of one): a
 * split purchase is found under every category it was divided into, not only
 * the one on the row. The ids are already whole numbers.
 */
const splitIn = (ids: number[]): SQL => {
  const list = ids.join(",");
  return sql.raw(
    `exists (select 1 from transaction_splits ts join categories tc on tc.id = ts.category_id ` +
      `where ts.transaction_id = transactions.id and (ts.category_id in (${list}) or tc.parent_id in (${list})))`,
  );
};

function listQuery(db: Db, where: SQL | undefined, oldestFirst = false) {
  return db
    .select(listColumns)
    .from(transactions)
    .leftJoin(contacts, eq(contacts.counterparty, transactions.counterparty))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(recurringExpenses, eq(recurringExpenses.id, transactions.recurringExpenseId))
    .where(where)
    .orderBy(...(oldestFirst ? [asc(transactions.bookingDate), asc(transactions.id)] : [desc(transactions.bookingDate), desc(transactions.id)]));
}

type Row = Awaited<ReturnType<ReturnType<typeof listQuery>["all"]>>[number];

/**
 * The rows as the list needs them: the merchant's icon (brand or uploaded
 * image), the split into categories, the prylar the row was the payment for
 * and whether it has a receipt — all resolved once for the whole list instead
 * of per row.
 */
function withIcons<T extends Pick<Row, "id" | "descriptionClean" | "amount">>(db: Db, rows: T[]) {
  const icon = iconResolver(db);
  const ids = rows.map((r) => r.id);
  const splits = loadSplits(db, ids);
  const items = itemsByTransaction(db, ids);
  const receipts = receiptsByTransaction(db, ids);
  return rows.map((r) => ({
    ...r,
    icon: icon(r.descriptionClean, r.amount),
    splits: splits.get(r.id) ?? null,
    items: items.get(r.id) ?? null,
    receipt: receipts.get(r.id) ?? null,
  }));
}

/**
 * Free text: description, merchant, contact name, city, note, or the amount ('1250', '-45,50').
 * A private row never matches while private rows are hidden: a hit would reveal what it is.
 */
function matchesText(r: Row, q: string, showPrivate: boolean): boolean {
  if (r.private && !showPrivate) return false;
  const needle = q.toLocaleLowerCase("sv").trim();
  if (!needle) return true;
  const hay = [r.label, r.descriptionClean, r.counterparty, r.counterpartyName, r.merchantArea, r.note, r.recurringExpenseName]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("sv");
  if (hay.includes(needle)) return true;
  const n = Number(needle.replace(/\s/g, "").replace(",", ".").replace(/^[-−]/, ""));
  return Number.isFinite(n) && n > 0 && Math.abs(r.amount) === Math.round(n * 100);
}

export function transactionRoutes(db: Db) {
  const app = new Hono();

  /**
   * Filters (all optional): from, to (booking date), accountId, categoryId
   * (a main category includes its subcategories; 'none' = uncategorised),
   * with includeUnknown=1 also Övrigt › Okänt), source, shared ('shared' | 'own'),
   * transfers=1 (include transfers), q, deleted=1 (only deleted rows instead),
   * showPrivate=1 (let the text search match private rows), limit (at most
   * this many rows, newest first; totals still cover every match),
   * categoryIds=1,2 (any of them, each with its subcategories), amountMin /
   * amountMax (öre, on the absolute amount), private=only (only private rows),
   * recurring=1 (linked to a fixed expense or a recurring income), receipt=1
   * (with a receipt), order=asc (oldest first; the default is newest first).
   */
  app.get("/", (c) => {
    const p = c.req.query();
    // A forgotten row is nowhere, not even among the deleted ones (see POST /:id/forget).
    const where: (SQL | undefined)[] = [
      p.deleted === "1" ? and(isNotNull(transactions.deletedAt), isNull(transactions.forgottenAt)) : isNull(transactions.deletedAt),
    ];
    if (p.from && isIsoDate(p.from)) where.push(gte(transactions.bookingDate, p.from));
    if (p.to && isIsoDate(p.to)) where.push(lte(transactions.bookingDate, p.to));
    if (p.accountId) where.push(eq(transactions.accountId, Number(p.accountId)));
    // invoice=YYYY-MM: the rows on the Bank Norwegian invoice whose period ends that month (by posting day).
    if (p.invoice && /^\d{4}-\d{2}$/.test(p.invoice)) {
      const inv = cardInvoicePeriod(db, p.invoice);
      if (inv) where.push(eq(transactions.accountId, inv.accountId), sql`${postedDaySql} >= ${inv.from}`, sql`${postedDaySql} <= ${inv.to}`);
      else where.push(sql`0`);
    }
    if (p.source && TRANSACTION_SOURCES.includes(p.source as never)) where.push(eq(transactions.source, p.source as never));
    if (p.shared === "shared") where.push(eq(transactions.shared, true));
    if (p.shared === "own") where.push(and(eq(transactions.shared, false), eq(transactions.forOther, false)));
    if (p.shared === "other") where.push(eq(transactions.forOther, true));
    // The categories filtered on, if any: a purchase split across categories counts in the sums with its parts in them only.
    let filterIds: number[] | null = null;
    if (p.categoryId === "none") {
      where.push(p.includeUnknown === "1" ? or(isNull(transactions.categoryId), eq(categories.systemKey, "unknown")) : isNull(transactions.categoryId));
    }
    else if (p.categoryId) {
      const id = Number(p.categoryId);
      filterIds = [id];
      where.push(or(eq(transactions.categoryId, id), eq(categories.parentId, id), splitIn([id])));
    }
    if (p.categoryIds) {
      const ids = p.categoryIds.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length) {
        filterIds = [...(filterIds ?? []), ...ids];
        where.push(or(inArray(transactions.categoryId, ids), inArray(categories.parentId, ids), splitIn(ids)));
      }
    }
    if (p.amountMin && Number.isFinite(Number(p.amountMin))) where.push(sql`abs(${transactions.amount}) >= ${Number(p.amountMin)}`);
    if (p.amountMax && Number.isFinite(Number(p.amountMax))) where.push(sql`abs(${transactions.amount}) <= ${Number(p.amountMax)}`);
    if (p.private === "only") where.push(eq(transactions.private, true));
    if (p.recurring === "1") where.push(or(isNotNull(transactions.recurringExpenseId), isNotNull(transactions.recurringIncomeId)));
    if (p.receipt === "1") where.push(sql`exists (select 1 from receipts rc where rc.transaction_id = ${transactions.id} and rc.deleted_at is null)`);
    if (p.transfers !== "1" && p.deleted !== "1") where.push(eq(transactions.isTransfer, false));

    let rows = listQuery(db, and(...where), p.order === "asc").all();
    if (p.q) rows = rows.filter((r) => matchesText(r, p.q!, p.showPrivate === "1"));

    // Sums exclude transfers, partner settlement money and returned purchases with their refunds, like the statistics.
    const counted = rows.filter((r) => !r.isTransfer && !r.isSettlement && r.returnGroupId === null);
    // With a category filter, a split purchase counts with its parts in those
    // categories (and their subcategories), as in Analys: not its whole amount.
    let amounts = counted.map((r) => r.amount);
    let partial = 0;
    if (filterIds) {
      const wanted = new Set(filterIds);
      const parentOf = new Map(db.select({ id: categories.id, parentId: categories.parentId }).from(categories).all().map((c) => [c.id, c.parentId]));
      const inFilter = (id: number | null) => id !== null && (wanted.has(id) || wanted.has(parentOf.get(id) ?? -1));
      const splits = loadSplits(db, counted.map((r) => r.id));
      amounts = counted.map((r) => {
        const parts = splits.get(r.id);
        if (!parts) return r.amount;
        const part = parts.filter((x) => inFilter(x.categoryId)).reduce((s, x) => s + x.amount, 0);
        if (part !== r.amount) partial++;
        return part;
      });
    }
    // Ut per booking day, from the same amounts: the days add up to out exactly, also past the limit.
    const outByDay: Record<string, number> = {};
    counted.forEach((r, i) => {
      if (amounts[i] < 0) outByDay[r.bookingDate] = (outByDay[r.bookingDate] ?? 0) + amounts[i];
    });
    const limit = Math.min(Number(p.limit) > 0 ? Math.floor(Number(p.limit)) : MAX_ROWS, MAX_ROWS);
    return c.json({
      rows: withIcons(db, rows.slice(0, limit)),
      truncated: rows.length > limit,
      totals: {
        count: rows.length,
        in: amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0),
        out: amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0),
        /** Split purchases counted with only their parts in the filtered categories. */
        partial,
        /** Ut per booking day (öre, negative); days without any are left out. */
        outByDay,
      },
    });
  });

  /**
   * A transaction entered by hand (a gift, a refund, cash). With updateBalance
   * the amount is added to the account's balance at once.
   */
  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as {
      bookingDate?: string;
      amount?: number;
      accountId?: number | null;
      categoryId?: number | null;
      label?: string;
      note?: string | null;
      shared?: boolean;
      updateBalance?: boolean;
      paidBy?: "me" | "partner";
      forOther?: boolean;
    };
    const label = b.label?.trim();
    // Paid by the partner from her own account: shared, no account, never in my balances.
    const byPartner = b.paidBy === "partner";
    if (b.paidBy !== undefined && b.paidBy !== "me" && !byPartner) return c.json({ error: "Ogiltig betalare." }, 400);
    if (byPartner && (b.accountId || b.updateBalance)) return c.json({ error: "Det partnern betalat hör inte till något av mina konton." }, 400);
    if (!label) return c.json({ error: "Beskrivning krävs." }, 400);
    if (!b.bookingDate || !isIsoDate(b.bookingDate)) return c.json({ error: "Datum ska vara ÅÅÅÅ-MM-DD." }, 400);
    if (!Number.isInteger(b.amount) || b.amount === 0) return c.json({ error: "Beloppet ska vara ett antal öre skilt från noll." }, 400);
    const account = b.accountId ? db.select().from(accounts).where(eq(accounts.id, b.accountId)).get() : undefined;
    if (b.accountId && !account) return c.json({ error: "Kontot finns inte." }, 400);
    if (b.updateBalance && !account) return c.json({ error: "Välj konto för att uppdatera saldot." }, 400);
    const category = b.categoryId ? db.select().from(categories).where(eq(categories.id, b.categoryId)).get() : undefined;
    if (b.categoryId && !category) return c.json({ error: "Kategorin finns inte." }, 400);

    const now = new Date().toISOString();
    const row = db.transaction((txn) => {
      const tx = txn as unknown as Db;
      const created = tx
        .insert(transactions)
        .values({
          source: "manual",
          accountId: account?.id ?? null,
          bookingDate: b.bookingDate!,
          transactionDate: b.bookingDate!,
          descriptionRaw: label,
          descriptionClean: label,
          label,
          amount: b.amount!,
          categoryId: category?.id ?? null,
          categorySource: category ? "manual" : "none",
          isTransfer: !!category?.isTransfer,
          // From the partner: shared, or (forOther) wholly mine.
          shared: byPartner ? !b.forOther : category?.isTransfer || category?.isSettlement ? false : !!b.shared,
          forOther: byPartner && !!b.forOther,
          paidBy: byPartner ? "partner" : "me",
          note: b.note?.trim() || null,
          // Unique: manual rows are never deduplicated against imports.
          fingerprint: `manual:${randomUUID()}`,
          manuallyEditedAt: now,
        })
        .returning()
        .get();
      if (b.updateBalance && account) {
        tx.update(accounts).set({ balance: account.balance + b.amount!, balanceUpdatedAt: now }).where(eq(accounts.id, account.id)).run();
      }
      linkRecurring(tx);
      return created;
    });
    return c.json(row);
  });

  /**
   * Edit category, shared flag, note or label. Amount and date only for manual
   * rows: imported rows keep the bank's values. A category change returns a rule suggestion.
   */
  app.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as {
      categoryId?: number | null;
      shared?: boolean;
      note?: string | null;
      label?: string | null;
      amount?: number;
      bookingDate?: string;
      private?: boolean;
      forOther?: boolean;
      settlementExcluded?: boolean;
    };
    const current = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!current) return c.json({ error: "Hittades inte." }, 404);

    const set: Partial<typeof transactions.$inferInsert> = { manuallyEditedAt: new Date().toISOString() };
    if ("amount" in b || "bookingDate" in b) {
      if (current.source !== "manual") return c.json({ error: "Belopp och datum kan bara ändras på manuella rader." }, 400);
      if ("amount" in b) {
        if (!Number.isInteger(b.amount) || b.amount === 0) return c.json({ error: "Ogiltigt belopp." }, 400);
        set.amount = b.amount;
      }
      if ("bookingDate" in b) {
        if (!b.bookingDate || !isIsoDate(b.bookingDate)) return c.json({ error: "Datum ska vara ÅÅÅÅ-MM-DD." }, 400);
        set.bookingDate = b.bookingDate;
        set.transactionDate = b.bookingDate;
      }
    }
    if ("label" in b) {
      const label = typeof b.label === "string" && b.label.trim() ? b.label.trim() : null;
      // A manual row's text is its label; it can't be emptied.
      if (current.source === "manual") {
        if (!label) return c.json({ error: "Beskrivning krävs." }, 400);
        set.descriptionRaw = label;
        set.descriptionClean = label;
      }
      set.label = label;
    }
    const byPartner = current.paidBy === "partner";
    if (byPartner && b.private) return c.json({ error: "Det partnern betalat kan inte vara privat." }, 400);
    if (byPartner && "shared" in b && b.shared === false && b.forOther !== true) {
      return c.json({ error: "Det partnern betalat är antingen delat eller helt ditt." }, 400);
    }
    if ("private" in b) {
      if (typeof b.private !== "boolean") return c.json({ error: "Privat ska vara sant/falskt." }, 400);
      set.private = b.private;
      // A private row is never shared (and so never in the settlement).
      if (b.private) {
        set.shared = false;
        set.forOther = false;
      }
    }
    if ("forOther" in b) {
      if (typeof b.forOther !== "boolean") return c.json({ error: "forOther ska vara sant/falskt." }, 400);
      if (b.forOther && (set.private ?? current.private)) return c.json({ error: "En privat rad ingår aldrig i avstämningen." }, 400);
      if (b.forOther && current.isTransfer) return c.json({ error: "En överföring kan inte vara partnerns." }, 400);
      set.forOther = b.forOther;
      if (b.forOther) set.shared = false;
      else if (byPartner) set.shared = true;
    }
    if ("shared" in b) {
      if (typeof b.shared !== "boolean") return c.json({ error: "Delad ska vara sant/falskt." }, 400);
      if (b.shared && (set.private ?? current.private)) return c.json({ error: "En privat rad kan inte vara delad." }, 400);
      set.shared = b.shared;
      if (b.shared) set.forOther = false;
    }
    let categoryChanged = false;
    if ("categoryId" in b) {
      const category = b.categoryId === null ? null : db.select().from(categories).where(eq(categories.id, b.categoryId!)).get();
      if (b.categoryId !== null && !category) return c.json({ error: "Kategorin finns inte." }, 400);
      categoryChanged = b.categoryId !== current.categoryId;
      set.categoryId = b.categoryId ?? null;
      set.categorySource = b.categoryId === null ? "none" : "manual";
      set.isTransfer = !!category?.isTransfer;
      // Transfers and partner money are never shared expenses, whatever else was asked.
      if (category?.isTransfer || category?.isSettlement) {
        if (byPartner) return c.json({ error: "Det partnern betalat kan inte vara en överföring eller avstämning." }, 400);
        set.shared = false;
        set.forOther = false;
      }
    }
    if ("settlementExcluded" in b) {
      if (typeof b.settlementExcluded !== "boolean") return c.json({ error: "settlementExcluded ska vara sant/falskt." }, 400);
      set.settlementExcluded = b.settlementExcluded;
    }
    if ("note" in b) set.note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;

    const updated = db.update(transactions).set(set).where(eq(transactions.id, id)).returning().get();
    // A new category applies to the whole amount: the old uppdelning is gone.
    const splitCleared = categoryChanged && clearSplits(db, id);
    const renamed = "label" in b && updated.label !== current.label;
    return c.json({
      transaction: updated,
      splitCleared,
      ruleSuggestion: categoryChanged ? suggestRule(db, updated) : null,
      labelRuleSuggestion: renamed ? suggestLabelRule(db, updated) : null,
    });
  });

  /**
   * Categorise several rows at once (a merchant group in 'Att granska').
   * With `rule`, the rule is saved and applied to every uncategorised row it
   * matches; rows it doesn't match are set by hand.
   */
  app.post("/categorize", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as {
      ids?: number[];
      categoryId?: number;
      rule?: Omit<RuleSpec, "categoryId"> | null;
    };
    if (!Array.isArray(b.ids) || b.ids.length === 0 || !Number.isInteger(b.categoryId)) {
      return c.json({ error: "Rader och kategori krävs." }, 400);
    }
    const category = db.select().from(categories).where(eq(categories.id, b.categoryId!)).get();
    if (!category) return c.json({ error: "Kategorin finns inte." }, 400);
    try {
      return c.json(
        db.transaction((txn) => {
          const tx = txn as unknown as Db;
          // What 'Ångra' needs: the rows as they were, and the rule's own undo.
          const before = snapshotRows(tx, b.ids!);
          const saved = b.rule ? saveRule(tx, { ...b.rule, categoryId: b.categoryId! }) : null;
          const byRule = saved?.applied ?? 0;
          const rest = tx
            .update(transactions)
            .set({
              categoryId: b.categoryId!,
              categorySource: "manual",
              isTransfer: category.isTransfer,
              ...(category.isTransfer || category.isSettlement ? { shared: false } : {}),
              manuallyEditedAt: new Date().toISOString(),
            })
            .where(and(inArray(transactions.id, b.ids!), isNull(transactions.categoryId)))
            .returning({ id: transactions.id })
            .all().length;
          return {
            byRule,
            manual: rest,
            undo: {
              rows: before,
              rule: saved ? { id: saved.rule.id, previousCategoryId: saved.previousCategoryId, before: saved.before } : null,
            },
          };
        }),
      );
    } catch (e) {
      if (e instanceof RuleError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /**
   * Change several rows at once: a name, a note, a category, private, or own/shared/
   * the partner's ('shared' = true/false is still accepted). Rows that can't
   * be shared or hers (transfers, partner money, private rows) are skipped,
   * as are the partner's rows made 'own'.
   */
  app.post("/bulk", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as {
      ids?: number[];
      shared?: boolean;
      owner?: "own" | "shared" | "partner";
      categoryId?: number;
      private?: boolean;
      note?: string | null;
      label?: string | null;
    };
    const owner = b.owner ?? (b.shared === true ? "shared" : b.shared === false ? "own" : undefined);
    const hasCategory = "categoryId" in b;
    const hasPrivate = typeof b.private === "boolean";
    const hasNote = "note" in b;
    const hasLabel = "label" in b;
    if (!Array.isArray(b.ids) || b.ids.length === 0 || (!owner && !hasCategory && !hasPrivate && !hasNote && !hasLabel)) {
      return c.json({ error: "Rader och en ändring (eget/delat/partnerns, kategori, privat, anteckning eller namn) krävs." }, 400);
    }
    if (hasNote && b.note !== null && typeof b.note !== "string") return c.json({ error: "Anteckningen ska vara text." }, 400);
    if (hasLabel && b.label !== null && typeof b.label !== "string") return c.json({ error: "Namnet ska vara text." }, 400);
    const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
    const label = typeof b.label === "string" && b.label.trim() ? b.label.trim() : null;
    if (owner && !["own", "shared", "partner"].includes(owner)) return c.json({ error: "Okänt värde för vems." }, 400);
    const category = hasCategory ? db.select().from(categories).where(eq(categories.id, Number(b.categoryId))).get() : undefined;
    if (hasCategory && !category) return c.json({ error: "Kategorin finns inte." }, 400);

    const rows = db
      .select({
        id: transactions.id,
        shared: transactions.shared,
        forOther: transactions.forOther,
        private: transactions.private,
        paidBy: transactions.paidBy,
        isTransfer: transactions.isTransfer,
        isSettlement: categories.isSettlement,
        categoryId: transactions.categoryId,
        note: transactions.note,
        label: transactions.label,
        source: transactions.source,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(inArray(transactions.id, b.ids.slice(0, 10_000)))
      .all();

    type Row = (typeof rows)[number];
    let eligible: Row[];
    let want: Partial<typeof transactions.$inferInsert>;
    let differs: (r: Row) => boolean;
    let skipReason: string | null = null;
    if (hasLabel) {
      // The same name on every row; empty shows the bank's text again. A manual
      // row's text is its name, so it can't be emptied.
      eligible = rows.filter((r) => label !== null || r.source !== "manual");
      want = { label };
      differs = (r) => r.label !== label;
      skipReason = "en manuell rad måste ha ett namn";
    } else if (hasNote) {
      // The same note on every row ('' or null removes it).
      eligible = rows;
      want = { note };
      differs = (r) => r.note !== note;
    } else if (category) {
      const neverShared = category.isTransfer || category.isSettlement;
      // What the partner paid can't be a transfer or settlement money.
      eligible = rows.filter((r) => !(neverShared && r.paidBy === "partner"));
      want = {
        categoryId: category.id,
        categorySource: "manual",
        isTransfer: category.isTransfer,
        ...(neverShared ? { shared: false, forOther: false } : {}),
      };
      differs = (r) => r.categoryId !== category.id;
    } else if (hasPrivate) {
      eligible = rows.filter((r) => r.paidBy !== "partner");
      want = b.private ? { private: true, shared: false, forOther: false } : { private: false };
      differs = (r) => r.private !== b.private;
      skipReason = "det partnern betalat kan inte vara privat";
    } else {
      eligible = rows.filter((r) =>
        owner === "own" ? r.paidBy !== "partner" : !r.private && !r.isTransfer && !r.isSettlement && (owner === "shared" || r.paidBy !== "partner"),
      );
      want = { shared: owner === "shared", forOther: owner === "partner" };
      differs = (r) => r.shared !== want.shared || r.forOther !== want.forOther;
    }
    const change = eligible.filter(differs).map((r) => r.id);
    const before = snapshotRows(db, change);
    const now = new Date().toISOString();
    // A manual row's name is also its text (as when it is renamed on its own).
    const manual = hasLabel && label ? new Set(eligible.filter((r) => r.source === "manual").map((r) => r.id)) : new Set<number>();
    db.transaction((txn) => {
      for (let i = 0; i < change.length; i += 500) {
        txn.update(transactions).set({ ...want, manuallyEditedAt: now }).where(inArray(transactions.id, change.slice(i, i + 500))).run();
      }
      const texts = change.filter((id) => manual.has(id));
      if (texts.length) txn.update(transactions).set({ descriptionRaw: label!, descriptionClean: label! }).where(inArray(transactions.id, texts)).run();
    });
    // The new category applies to the whole amount of every row it touched.
    const splitsCleared = category ? clearSplitsFor(db, change) : 0;
    return c.json({
      changed: change.length,
      unchanged: eligible.length - change.length,
      skipped: rows.length - eligible.length,
      skipReason: rows.length > eligible.length ? skipReason : null,
      splitsCleared,
      before,
    });
  });

  /**
   * Splits one purchase across categories: the parts must have the row's sign
   * and add up to its amount. Sending them again replaces the whole split;
   * DELETE puts the amount back on the row's own category.
   */
  app.put("/:id/splits", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as { parts?: { categoryId?: unknown; amount?: unknown }[] };
    if (!Array.isArray(b.parts)) return c.json({ error: "Delar krävs." }, 400);
    if (b.parts.length > MAX_SPLIT_PARTS) return c.json({ error: `Högst ${MAX_SPLIT_PARTS} delar går på ett köp.` }, 400);
    const parts: SplitPart[] = b.parts.map((p) => ({ categoryId: Number(p.categoryId), amount: Number(p.amount) }));
    try {
      const splits = setSplits(db, id, parts);
      return c.json({ splits, transaction: db.select().from(transactions).where(eq(transactions.id, id)).get() });
    } catch (e) {
      if (e instanceof SplitError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  app.delete("/:id/splits", (c) => {
    const id = Number(c.req.param("id"));
    return c.json({ removed: clearSplits(db, id), splits: [] });
  });

  /**
   * Notes written before, for autocomplete. for=<id> ranks the ones used on
   * the same merchant and category first; showPrivate=1 includes private rows' notes.
   */
  app.get("/notes", (c) => {
    const forId = Number(c.req.query("for"));
    return c.json(noteSuggestions(db, { forId: forId > 0 ? forId : undefined, showPrivate: c.req.query("showPrivate") === "1" }));
  });

  /** Categories to offer first in the picker for these rows (?ids=1,2,3): rule, Norwegian merchant category, same merchant before. */
  app.get("/category-suggestions", (c) => {
    const ids = (c.req.query("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return c.json(categorySuggestions(db, ids));
  });

  /** The detail panel: raw text, import, same merchant for 12 months, matching rules. */
  app.get("/:id/details", (c) => {
    const d = transactionDetails(db, Number(c.req.param("id")), todayLocal());
    return d ? c.json(d) : c.json({ error: "Hittades inte." }, 404);
  });

  /**
   * Deletes several rows: imported ones softly (they can be restored with
   * /undo and the returned snapshot), manual ones for real.
   */
  app.post("/bulk-delete", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { ids?: number[] };
    if (!Array.isArray(b.ids) || b.ids.length === 0) return c.json({ error: "Rader krävs." }, 400);
    const rows = db.select({ id: transactions.id, source: transactions.source }).from(transactions)
      .where(and(inArray(transactions.id, b.ids.slice(0, 10_000)), isNull(transactions.deletedAt))).all();
    const soft = rows.filter((r) => r.source !== "manual").map((r) => r.id);
    const hard = rows.filter((r) => r.source === "manual").map((r) => r.id);
    const before = snapshotRows(db, soft);
    const now = new Date().toISOString();
    db.transaction((txn) => {
      for (let i = 0; i < soft.length; i += 500) txn.update(transactions).set({ deletedAt: now }).where(inArray(transactions.id, soft.slice(i, i + 500))).run();
      for (let i = 0; i < hard.length; i += 500) txn.delete(transactions).where(inArray(transactions.id, hard.slice(i, i + 500))).run();
    });
    return c.json({ soft: soft.length, hard: hard.length, before });
  });

  /** 'Ångra' after a bulk change: puts the rows back as in the snapshot the change returned. */
  app.post("/undo", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { rows?: unknown };
    try {
      return c.json({ restored: restoreRows(db, b.rows) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  /** Refunds that may belong to a purchase (same account and merchant, within 120 days). */
  app.get("/:id/refunds", (c) => {
    try {
      return c.json(refundCandidates(db, Number(c.req.param("id"))));
    } catch (e) {
      if (e instanceof ReturnError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /** 'Returnerad': the purchase and its refunds cancel out and leave every sum. */
  app.post("/:id/return", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { refundIds?: number[] };
    try {
      return c.json(markReturned(db, Number(c.req.param("id")), Array.isArray(b.refundIds) ? b.refundIds : []));
    } catch (e) {
      if (e instanceof ReturnError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  app.delete("/:id/return", (c) => c.json({ unmarked: unmarkReturned(db, Number(c.req.param("id"))) }));

  /** Imported rows are soft-deleted (the fingerprint stays so re-import won't bring them back); manual rows are deleted. */
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!row) return c.json({ error: "Hittades inte." }, 404);
    if (row.source === "manual") {
      db.delete(transactions).where(eq(transactions.id, id)).run();
      return c.json({ deleted: "hard" });
    }
    db.update(transactions).set({ deletedAt: new Date().toISOString() }).where(eq(transactions.id, id)).run();
    return c.json({ deleted: "soft" });
  });

  /**
   * 'Glöm': the row leaves the tool altogether — it isn't among the deleted
   * rows either, and nothing anywhere counts it. It is kept in the table for
   * one reason only: its fingerprint (and entry reference) is what stops the
   * next import from fetching the purchase again. There is no way back from
   * inside the tool.
   *
   * A manual row has no import to come back from, so forgetting one is simply
   * deleting it, the way DELETE already does.
   */
  /**
   * 'Remind me before this draws again': the charge's subscription becomes a
   * fixed expense that the Vakt asks about before every draw, so a temporary
   * one can be cancelled in time. Already a fixed expense — then it is only
   * marked as watched.
   */
  app.post("/:id/watch-charge", (c) => {
    try {
      return c.json(watchCharge(db, Number(c.req.param("id"))));
    } catch (e) {
      if (e instanceof WatchChargeError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /** 'Gör till fast utgift…': the draft the form starts from, and making it (monthly or yearly). */
  app.get("/:id/recurring-draft", (c) => {
    try {
      return c.json(recurringDraft(db, Number(c.req.param("id"))));
    } catch (e) {
      if (e instanceof WatchChargeError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
  /** 'Byt plan för …': the fixed expenses this purchase may be a new plan of (changing it is POST /recurring-expenses/:id/change-plan). */
  app.get("/:id/plan-candidates", (c) => c.json(planCandidates(db, Number(c.req.param("id")))));
  app.post("/:id/make-recurring", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; cycle?: unknown; pattern?: unknown };
    if (typeof b.name !== "string" || typeof b.pattern !== "string" || (b.cycle !== "monthly" && b.cycle !== "yearly")) {
      return c.json({ error: "Ange namn, bankens text och om den betalas månads- eller årsvis." }, 400);
    }
    try {
      return c.json(makeRecurring(db, Number(c.req.param("id")), { name: b.name, cycle: b.cycle, pattern: b.pattern }));
    } catch (e) {
      if (e instanceof WatchChargeError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  app.post("/:id/forget", (c) => {
    const id = Number(c.req.param("id"));
    const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!row) return c.json({ error: "Hittades inte." }, 404);
    if (row.source === "manual") {
      db.delete(transactions).where(eq(transactions.id, id)).run();
      return c.json({ forgotten: true });
    }
    const now = new Date().toISOString();
    db.update(transactions).set({ deletedAt: row.deletedAt ?? now, forgottenAt: now }).where(eq(transactions.id, id)).run();
    return c.json({ forgotten: true });
  });

  app.post("/:id/restore", (c) => {
    const id = Number(c.req.param("id"));
    const row = db.update(transactions).set({ deletedAt: null, forgottenAt: null }).where(eq(transactions.id, id)).returning().get();
    return row ? c.json(row) : c.json({ error: "Hittades inte." }, 404);
  });

  return app;
}

export function ruleRoutes(db: Db) {
  const app = new Hono();

  app.post("/preview", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Partial<RuleSpec> & { excludeId?: number; examples?: boolean };
    if (!b.pattern) return c.json(b.examples ? { matches: 0, total: 0, uncategorized: 0, rows: [] } : { matches: 0 });
    const spec = { pattern: b.pattern, matchType: b.matchType ?? "contains", direction: b.direction ?? "any" };
    const matches = previewRule(db, spec, b.excludeId);
    // 'Testa mönster': every row it would match, not only the uncategorised ones.
    return c.json(b.examples ? { matches, ...ruleExamples(db, spec) } : { matches });
  });

  /** Change pattern, type, direction or category; uncategorised rows it now matches get the category. */
  app.patch("/:id", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Partial<RuleSpec>;
    try {
      return c.json(updateRule(db, Number(c.req.param("id")), b));
    } catch (e) {
      if (e instanceof RuleError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /** Deletes a rule (rows keep their categories) and returns it, for Ångra (POST /restore). */
  app.delete("/:id", (c) => {
    const rule = db.delete(merchantRules).where(eq(merchantRules.id, Number(c.req.param("id")))).returning().get();
    return rule ? c.json(rule) : c.json({ error: "Regeln finns inte." }, 404);
  });

  /**
   * 'Rensa oanvända': deletes the rules with these ids, all or none, and
   * returns them for Ångra (POST /restore with the list). Rows keep their
   * categories. Ids that aren't rules are left out.
   */
  app.post("/delete", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is number => Number.isInteger(x)) : [];
    if (ids.length === 0) return c.json({ error: "Inga regler valda." }, 400);
    const deleted = db.transaction((tx) => tx.delete(merchantRules).where(inArray(merchantRules.id, ids)).returning().all());
    return c.json(deleted);
  });

  type StoredRule = typeof merchantRules.$inferSelect;
  /** A rule put back as it was, or why not. */
  const restore = (tx: Db, b: Partial<StoredRule>): StoredRule | { error: string; status: 400 | 409 } => {
    if (!Number.isInteger(b.id) || !b.pattern || !Number.isInteger(b.categoryId)) return { error: "Ogiltig regel.", status: 400 };
    if (!tx.select().from(categories).where(eq(categories.id, b.categoryId!)).get()) return { error: "Kategorin finns inte längre.", status: 400 };
    const rule = tx
      .insert(merchantRules)
      .values({
        id: b.id,
        pattern: b.pattern,
        matchType: b.matchType ?? "contains",
        categoryId: b.categoryId!,
        sharedDefault: b.sharedDefault ?? null,
        isTransfer: b.isTransfer ?? false,
        counterAccountId: b.counterAccountId ?? null,
        direction: b.direction ?? "any",
        createdFrom: b.createdFrom ?? "manual",
        hits: b.hits ?? 0,
        brandSlug: b.brandSlug ?? null,
        iconPath: b.iconPath ?? null,
        ...(b.createdAt ? { createdAt: b.createdAt } : {}),
      })
      .onConflictDoNothing()
      .returning()
      .get();
    return rule ?? { error: "Regeln finns redan.", status: 409 };
  };

  /**
   * Puts back rules just deleted, as they were (same id, origin and hits):
   * one rule, or a list from 'Rensa oanvända' (those that can't come back,
   * say their category is gone, are left out).
   */
  app.post("/restore", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Partial<StoredRule> | Partial<StoredRule>[];
    if (Array.isArray(b)) {
      const restored = db.transaction((tx) => b.map((r) => restore(tx as unknown as Db, r)).filter((r): r is StoredRule => !("error" in r)));
      return c.json(restored);
    }
    const r = restore(db, b);
    return "error" in r ? c.json({ error: r.error }, r.status) : c.json(r);
  });

  /** Undoes a rule just saved: its rows go back as they were, and the rule is removed or gets its old category. */
  app.post("/:id/undo", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { previousCategoryId?: number | null; before?: unknown };
    try {
      return c.json({ restored: undoRule(db, Number(c.req.param("id")), b.previousCategoryId ?? null, b.before) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Partial<RuleSpec>;
    if (!b.pattern || !Number.isInteger(b.categoryId)) return c.json({ error: "Mönster och kategori krävs." }, 400);
    try {
      return c.json(saveRule(db, { pattern: b.pattern, matchType: b.matchType ?? "contains", direction: b.direction ?? "any", categoryId: b.categoryId! }));
    } catch (e) {
      if (e instanceof RuleError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  return app;
}

export function reviewRoutes(db: Db) {
  const app = new Hono();

  /**
   * Uncategorised rows grouped by merchant (for Swish: the number) and
   * direction, most rows first, so a whole group can be categorised at once.
   * Private rows are left out (only counted) unless showPrivate=1.
   */
  app.get("/groups", (c) => {
    const showPrivate = c.req.query("showPrivate") === "1";
    const all = listQuery(
      db,
      and(isNull(transactions.deletedAt), isNull(transactions.categoryId), eq(transactions.isTransfer, false)),
    ).all();
    const rows = showPrivate ? all : all.filter((r) => !r.private);
    const groups = new Map<
      string,
      { key: string; merchant: string; name: string | null; direction: "in" | "out"; isSwish: boolean; count: number; sum: number; first: string; last: string; accountIds: number[]; ids: number[]; examples: string[] }
    >();
    for (const r of rows) {
      const merchant = r.counterparty ?? r.descriptionClean;
      const direction = r.amount > 0 ? "in" : "out";
      const key = `${direction}|${merchant}`;
      const g =
        groups.get(key) ??
        { key, merchant, name: r.counterpartyName, direction, isSwish: /^Swish\b/i.test(r.descriptionClean), count: 0, sum: 0, first: r.bookingDate, last: r.bookingDate, accountIds: [], ids: [], examples: [] };
      g.count++;
      g.sum += r.amount;
      if (r.bookingDate < g.first) g.first = r.bookingDate;
      if (r.bookingDate > g.last) g.last = r.bookingDate;
      if (r.accountId !== null && !g.accountIds.includes(r.accountId)) g.accountIds.push(r.accountId);
      if (!g.examples.includes(r.descriptionClean) && g.examples.length < 3) g.examples.push(r.descriptionClean);
      g.ids.push(r.id);
      groups.set(key, g);
    }
    const icon = iconResolver(db);
    const firstRow = new Map(rows.map((r) => [r.id, r]));
    return c.json({
      groups: [...groups.values()]
        .map((g) => {
          const r = firstRow.get(g.ids[0])!;
          return { ...g, icon: icon(r.descriptionClean, r.amount) };
        })
        .sort((a, b) => b.count - a.count || Math.abs(b.sum) - Math.abs(a.sum)),
      privateHidden: all.length - rows.length,
    });
  });

  /**
   * Quick picks for Att granska: six categories per group (rule, Norwegian
   * category, same merchant before, similar merchants, most used). Body:
   * { groups: [{ key, ids }] } -> { [key]: suggestions }.
   */
  app.post("/quick-picks", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { groups?: { key: string; ids: number[] }[] };
    const out: Record<string, ReturnType<typeof categorySuggestions>> = {};
    for (const g of (b.groups ?? []).slice(0, 200)) {
      if (typeof g.key === "string" && Array.isArray(g.ids)) out[g.key] = categorySuggestions(db, g.ids.filter(Number.isInteger), { fill: 6 });
    }
    return c.json(out);
  });

  /** Rows of a group, for expanding it. */
  app.post("/rows", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { ids?: number[] };
    if (!Array.isArray(b.ids) || b.ids.length === 0) return c.json([]);
    return c.json(withIcons(db, listQuery(db, inArray(transactions.id, b.ids.slice(0, 1000))).all()));
  });

  /**
   * Possible duplicates: two rows from different imports with the same account,
   * transaction date, amount and text but different booking dates. Identical
   * rows within one export are genuine (the bank doesn't change a row within a
   * file). Pairs the user kept are not shown again.
   */
  app.get("/duplicates", (c) => c.json(findDuplicatePairs(db)));

  app.post("/duplicates/dismiss", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { olderId?: number; newerId?: number };
    if (!Number.isInteger(b.olderId) || !Number.isInteger(b.newerId)) return c.json({ error: "Ogiltigt par." }, 400);
    db.insert(duplicateDismissals).values({ olderId: b.olderId!, newerId: b.newerId! }).onConflictDoNothing().run();
    return c.json({ ok: true });
  });

  app.get("/counts", (c) => {
    const uncategorized =
      db
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(and(isNull(transactions.deletedAt), isNull(transactions.categoryId), eq(transactions.isTransfer, false)))
        .get()?.n ?? 0;
    const deleted =
      db
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(and(isNotNull(transactions.deletedAt), isNull(transactions.forgottenAt)))
        .get()?.n ?? 0;
    return c.json({ uncategorized, duplicates: findDuplicatePairs(db).length, deleted });
  });

  return app;
}

export function findDuplicatePairs(db: Db) {
  const pairs = db.$client
    .prepare(
      `select a.id as olderId, b.id as newerId
         from transactions a
         join transactions b
           on b.account_id = a.account_id
          and b.transaction_date = a.transaction_date
          and b.amount = a.amount
          and b.description_clean = a.description_clean
          and b.booking_date <> a.booking_date
          and b.id > a.id
          and coalesce(b.import_id, -1) <> coalesce(a.import_id, -2)
        where a.deleted_at is null and b.deleted_at is null
          and not exists (select 1 from duplicate_dismissals d where d.older_id = a.id and d.newer_id = b.id)
        order by a.transaction_date desc`,
    )
    .all() as { olderId: number; newerId: number }[];
  if (pairs.length === 0) return [];
  const ids = [...new Set(pairs.flatMap((p) => [p.olderId, p.newerId]))];
  const byId = new Map(listQuery(db, inArray(transactions.id, ids)).all().map((r) => [r.id, r]));
  return pairs.map((p) => ({ older: byId.get(p.olderId)!, newer: byId.get(p.newerId)! }));
}
