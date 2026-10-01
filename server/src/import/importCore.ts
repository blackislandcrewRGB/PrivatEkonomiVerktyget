import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, imports, merchantCategoryMap, merchantRules, transactions, type CategoryKey } from "../db/schema.js";
import { categorize, loadCategorizeContext, recategorizeUncategorized } from "../categorize/categorize.js";
import { labelFor, loadLabelRules } from "../categorize/labelRules.js";
import { pairTransfers, resolveCounterAccounts } from "../transfers/transfers.js";
import { linkRecurring } from "../recurring/link.js";
import { merchantCategoryKey } from "./norwegianKey.js";
import { matchKey, normalizeForMatch, pairByMatch } from "./matchKey.js";

export type ImportSource = "swedbank" | "norwegian" | "mastercard" | "csv";

/** A parsed row ready for import, independent of source. */
export interface ImportRow {
  /** null only in a dry run where the account isn't chosen yet. */
  accountId: number | null;
  bookingDate: string;
  transactionDate: string | null;
  /** Card purchases: the bank's posting day (decides the invoice). */
  postedDate?: string | null;
  descriptionRaw: string;
  descriptionClean: string;
  counterparty: string;
  amount: number; // öre
  currency: string;
  /** Paid in another currency (Mastercard): amount in hundredths, currency, rate. */
  foreignAmount?: number | null;
  foreignCurrency?: string | null;
  exchangeRate?: number | null;
  cardMasked: string | null;
  /** Bank's own merchant category (Bank Norwegian XLSX), as exported. */
  merchantCategory?: string | null;
  merchantArea?: string | null;
  /** Masked counterpart account from the bank reference ('80000-••5678'). */
  counterRef?: string | null;
  fingerprint: string;
  occurrenceIndex: number;
  /** Shared flag when no rule says otherwise. */
  defaultShared: boolean;
  /** Set by the parser for rows whose meaning is known (card bill payments). */
  forced?: { categoryKey: CategoryKey; isTransfer: true; shared: false };
  /** Enable Banking: the bank's entry reference and the whole transaction (JSON). */
  entryReference?: string | null;
  bankRaw?: string | null;
}

export interface PreviewRow {
  bookingDate: string;
  descriptionClean: string;
  amount: number;
  category: string | null;
  isTransfer: boolean;
  shared: boolean;
}

/**
 * A new row that looks like an existing row the bank has since changed:
 * same account, transaction date, amount and description, different booking
 * date. It is imported anyway; the user decides.
 */
export interface PossibleDuplicate {
  transactionDate: string;
  descriptionClean: string;
  amount: number;
  newBookingDate: string;
  existing: { id: number; bookingDate: string };
}

export interface CoreResult {
  rowsTotal: number;
  rowsNew: number;
  rowsSkipped: number;
  /** Of the skipped: rows found from the other kind of source (file ↔ bank API) and linked instead. */
  rowsLinked: number;
  rowsUncategorized: number;
  newRowsPreview: PreviewRow[];
  possibleDuplicates: PossibleDuplicate[];
  /** Merchant categories in the new rows that aren't mapped to a category yet. */
  unmappedMerchantCategories: { label: string; rows: number }[];
  /** New rows that are transfers between my own accounts (counter account known). */
  internalTransfers: number;
  /** Transfer pairs completed by this import (both sides now in the database). */
  transferPairs: number;
  /** New links to recurring income/expenses made after this import. */
  recurringLinked: number;
  /** Earlier uncategorised rows that got a category after this import. */
  recategorized: number;
  importId: number | null;
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ImportError";
  }
}

const PREVIEW_ROWS = 15;

/**
 * Dedupe, categorise and (unless dry run) insert. Must run inside a transaction.
 *
 * Dedupe: a row with occurrence index k is new iff the database holds fewer than
 * k rows with its fingerprint. Soft-deleted rows count, so they never come back.
 * MAX (not COUNT) keeps the unique key safe even with gaps.
 *
 * Files and the bank's API (via 'enable_banking') see the same transactions
 * with different fields, so a row new by fingerprint is then looked for among
 * the other kind's rows on the same account by match key (see pairByMatch).
 * Found: the existing row is linked (source 'both', the file's fingerprint or
 * the API's entry reference added) and nothing is inserted. Its category,
 * shared flag, name and note are never touched.
 */
export function runImport(
  tx: Db,
  input: {
    source: ImportSource;
    filename: string;
    period: { from: string; to: string } | null;
    rows: ImportRow[];
    dryRun: boolean;
    /** 'enable_banking': rows from the bank's API (their own source, linked to file rows). */
    via?: "file" | "enable_banking";
  },
): CoreResult {
  const { rows } = input;
  const api = input.via === "enable_banking";

  const fingerprints = [...new Set(rows.map((r) => r.fingerprint))];
  const existingMax = new Map<string, number>();
  for (let i = 0; i < fingerprints.length; i += 500) {
    tx.select({ fp: transactions.fingerprint, max: sql<number>`max(${transactions.occurrenceIndex})` })
      .from(transactions)
      .where(inArray(transactions.fingerprint, fingerprints.slice(i, i + 500)))
      .groupBy(transactions.fingerprint)
      .all()
      .forEach((r) => existingMax.set(r.fp, r.max));
  }
  const unseen = rows.filter((r) => r.occurrenceIndex > (existingMax.get(r.fingerprint) ?? 0));
  const { fresh: newRows, links } = findLinks(tx, unseen, api);

  // Categorisation of new rows only (see categorize() for the precedence).
  const ctx = loadCategorizeContext(tx);
  const categorized = newRows.map((row) => ({ row, ...categorize(ctx, row) }));
  const { categoryById, merchantMap } = ctx;

  const unmapped = new Map<string, { label: string; rows: number }>();
  for (const row of newRows) {
    if (!row.merchantCategory) continue;
    const key = merchantCategoryKey(row.merchantCategory);
    if (!key || merchantMap.get(key)?.categoryId) continue;
    const u = unmapped.get(key) ?? { label: row.merchantCategory, rows: 0 };
    u.rows++;
    unmapped.set(key, u);
  }

  const categoryPath = (id: number | null) => {
    const c = id === null ? undefined : categoryById.get(id);
    if (!c) return null;
    const parent = c.parentId ? categoryById.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };

  const result: CoreResult = {
    rowsTotal: rows.length,
    rowsNew: newRows.length,
    rowsSkipped: rows.length - newRows.length,
    rowsLinked: links.length,
    rowsUncategorized: categorized.filter((c) => c.categoryId === null).length,
    newRowsPreview: categorized.slice(0, PREVIEW_ROWS).map((c) => ({
      bookingDate: c.row.bookingDate,
      descriptionClean: c.row.descriptionClean,
      amount: c.row.amount,
      category: categoryPath(c.categoryId),
      isTransfer: c.isTransfer,
      shared: c.shared,
    })),
    possibleDuplicates: findPossibleDuplicates(tx, newRows, new Set(fingerprints), input.period),
    unmappedMerchantCategories: [...unmapped.values()],
    internalTransfers: 0,
    transferPairs: 0,
    recurringLinked: 0,
    recategorized: 0,
    importId: null,
  };
  if (input.dryRun) return result;

  if (newRows.some((r) => r.accountId === null)) throw new ImportError("Konto saknas för importen.");

  for (const { row, existingId } of links) {
    tx.update(transactions)
      .set(
        api
          ? { source: "both", entryReference: row.entryReference ?? null, bankRaw: row.bankRaw ?? null }
          : { source: "both", fingerprint: row.fingerprint, occurrenceIndex: row.occurrenceIndex },
      )
      .where(eq(transactions.id, existingId))
      .run();
    // A card row gets the bank's posting day if it lacked one.
    if (row.postedDate) {
      tx.update(transactions).set({ postedDate: row.postedDate }).where(and(eq(transactions.id, existingId), isNull(transactions.postedDate))).run();
    }
  }

  const importId = tx
    .insert(imports)
    .values({
      source: input.source,
      filename: input.filename,
      periodFrom: input.period?.from ?? null,
      periodTo: input.period?.to ?? null,
      rowsTotal: result.rowsTotal,
      rowsNew: result.rowsNew,
      rowsSkipped: result.rowsSkipped,
      via: api ? "enable_banking" : "file",
    })
    .returning({ id: imports.id })
    .get().id;

  const nameRules = loadLabelRules(tx);
  for (const c of categorized) {
    const r = c.row;
    tx.insert(transactions)
      .values({
        source: api ? "enable_banking" : input.source,
        accountId: r.accountId,
        bookingDate: r.bookingDate,
        transactionDate: r.transactionDate,
        postedDate: r.postedDate ?? null,
        descriptionRaw: r.descriptionRaw,
        descriptionClean: r.descriptionClean,
        // A name rule's name; the bank's text stays as it is.
        label: labelFor(nameRules, r.descriptionClean),
        counterparty: r.counterparty,
        amount: r.amount,
        currency: r.currency,
        foreignAmount: r.foreignAmount ?? null,
        foreignCurrency: r.foreignCurrency ?? null,
        exchangeRate: r.exchangeRate ?? null,
        categoryId: c.categoryId,
        categorySource: c.categoryId === null ? "none" : c.source,
        shared: c.shared,
        isTransfer: c.isTransfer,
        cardMasked: r.cardMasked,
        merchantCategory: r.merchantCategory ?? null,
        merchantArea: r.merchantArea ?? null,
        counterRef: r.counterRef ?? null,
        counterAccountId: c.counterAccountId,
        fingerprint: r.fingerprint,
        occurrenceIndex: r.occurrenceIndex,
        matchKey: matchKey(r),
        entryReference: r.entryReference ?? null,
        bankRaw: r.bankRaw ?? null,
        importId,
      })
      .run();
    if (c.rule) {
      tx.update(merchantRules).set({ hits: sql`${merchantRules.hits} + 1` }).where(eq(merchantRules.id, c.rule.id)).run();
    }
  }

  recordMerchantCategories(tx, newRows);

  // Cross-row work that may involve rows from earlier imports too.
  result.recategorized = recategorizeUncategorized(tx);
  resolveCounterAccounts(tx);
  result.transferPairs = pairTransfers(tx);
  const recurring = linkRecurring(tx);
  result.recurringLinked = recurring.income + recurring.expenses;
  result.internalTransfers =
    tx
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.importId} = ${importId} and ${transactions.counterAccountId} is not null`)
      .get()?.n ?? 0;

  result.importId = importId;
  return result;
}

/**
 * Rows new by fingerprint that the other kind of source already brought in:
 * from the API, a file row without an entry reference; from a file, an
 * API-only row. API rows whose entry reference is already on the account are
 * dropped (they're there). Soft-deleted rows count, so they never come back.
 *
 * The bank can send a transaction again under a new entry reference (Swedbank
 * did on 2026-09-19, in another shape): an API row with an unknown reference
 * that pairs with a row the API already brought (same account, day, amount,
 * and the same text or one text starting like the other) is that row, and is
 * dropped too. Rows whose reference is in this answer are never taken for it.
 */
function findLinks(tx: Db, rows: ImportRow[], api: boolean): { fresh: ImportRow[]; links: { row: ImportRow; existingId: number }[] } {
  let candidates = rows;
  let answerRefs = new Set<string>();
  if (api) {
    const refs = new Set(
      rows.flatMap((r) => (r.entryReference && r.accountId !== null ? [`${r.accountId}|${r.entryReference}`] : [])),
    );
    if (refs.size) {
      const known = new Set(
        tx
          .select({ accountId: transactions.accountId, ref: transactions.entryReference })
          .from(transactions)
          .where(inArray(transactions.entryReference, [...refs].map((k) => k.slice(k.indexOf("|") + 1))))
          .all()
          .map((r) => `${r.accountId}|${r.ref}`),
      );
      candidates = rows.filter((r) => !(r.entryReference && known.has(`${r.accountId}|${r.entryReference}`)));
    }
    answerRefs = new Set(rows.flatMap((r) => (r.entryReference ? [r.entryReference] : [])));
  }
  const links: { row: ImportRow; existingId: number }[] = [];
  const linked = new Set<ImportRow>();
  const byAccount = new Map<number, ImportRow[]>();
  for (const r of candidates) if (r.accountId !== null) byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r]);
  for (const [accountId, list] of byAccount) {
    const dates = list.map((r) => r.bookingDate).sort();
    const existing = tx
      .select({ id: transactions.id, matchKey: transactions.matchKey, bookingDate: transactions.bookingDate, amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          gte(transactions.bookingDate, dates[0]),
          lte(transactions.bookingDate, dates.at(-1)!),
          api
            ? sql`${transactions.entryReference} is null and ${transactions.source} in ('swedbank', 'norwegian', 'mastercard')`
            : eq(transactions.source, "enable_banking"),
        ),
      )
      .all();
    if (!existing.length) continue;
    for (const [i, existingId] of pairByMatch(list, existing)) {
      links.push({ row: list[i], existingId });
      linked.add(list[i]);
    }
  }
  const resent = api ? findResent(tx, candidates.filter((r) => !linked.has(r)), answerRefs) : new Set<ImportRow>();
  return { fresh: candidates.filter((r) => !linked.has(r) && !resent.has(r)), links };
}

/** Texts alike enough to be the same transaction resent: equal, or one starting with the other ('refurbed' / 'refurbedk0784…'). */
function sameText(a: string, b: string): boolean {
  const [x, y] = [normalizeForMatch(a), normalizeForMatch(b)];
  if (!x || !y) return x === y;
  return x.startsWith(y) || y.startsWith(x);
}

/** API rows that are rows the API already brought, under another entry reference (see findLinks). */
function findResent(tx: Db, rows: ImportRow[], answerRefs: Set<string>): Set<ImportRow> {
  const out = new Set<ImportRow>();
  const byAccount = new Map<number, ImportRow[]>();
  for (const r of rows) if (r.accountId !== null) byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r]);
  for (const [accountId, list] of byAccount) {
    const dates = list.map((r) => r.bookingDate).sort();
    const existing = tx
      .select({
        id: transactions.id,
        matchKey: transactions.matchKey,
        bookingDate: transactions.bookingDate,
        amount: transactions.amount,
        descriptionClean: transactions.descriptionClean,
        entryReference: transactions.entryReference,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          gte(transactions.bookingDate, dates[0]),
          lte(transactions.bookingDate, dates.at(-1)!),
          sql`${transactions.entryReference} is not null and ${transactions.source} in ('both', 'enable_banking')`,
        ),
      )
      .all()
      .filter((e) => !answerRefs.has(e.entryReference!));
    if (!existing.length) continue;
    const texts = new Map(existing.map((e) => [e.id, e.descriptionClean]));
    for (const [i, existingId] of pairByMatch(list, existing)) {
      if (sameText(list[i].descriptionClean, texts.get(existingId)!)) out.add(list[i]);
    }
  }
  return out;
}

/** Counts seen merchant categories and logs unknown ones (category NULL) for mapping in the UI. */
function recordMerchantCategories(tx: Db, rows: ImportRow[]): void {
  const seen = new Map<string, { label: string; n: number }>();
  for (const r of rows) {
    if (!r.merchantCategory) continue;
    const key = merchantCategoryKey(r.merchantCategory);
    if (!key) continue;
    const s = seen.get(key) ?? { label: r.merchantCategory, n: 0 };
    s.n++;
    seen.set(key, s);
  }
  const now = new Date().toISOString();
  for (const [key, { label, n }] of seen) {
    tx.insert(merchantCategoryMap)
      .values({ key, label, timesSeen: n, lastSeenAt: now })
      .onConflictDoUpdate({
        target: merchantCategoryMap.key,
        set: { timesSeen: sql`${merchantCategoryMap.timesSeen} + ${n}`, lastSeenAt: now },
      })
      .run();
  }
}

/**
 * Flags new rows matching an existing row on account, transaction date, amount
 * and description but with another booking date. An existing row whose own
 * fingerprint is still in this file is a genuine separate transaction (the bank
 * still reports it), and one outside the file's period can't be judged, so
 * those are not flagged.
 */
function findPossibleDuplicates(
  tx: Db,
  newRows: ImportRow[],
  fileFingerprints: Set<string>,
  period: { from: string; to: string } | null,
): PossibleDuplicate[] {
  const candidates = newRows.filter((r) => r.transactionDate);
  if (candidates.length === 0) return [];
  const dates = candidates.map((r) => r.transactionDate!).sort();
  const existing = tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      bookingDate: transactions.bookingDate,
      transactionDate: transactions.transactionDate,
      descriptionClean: transactions.descriptionClean,
      amount: transactions.amount,
      fingerprint: transactions.fingerprint,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        gte(transactions.transactionDate, dates[0]),
        lte(transactions.transactionDate, dates[dates.length - 1]),
      ),
    )
    .all();
  const byKey = new Map<string, typeof existing>();
  for (const e of existing) {
    const key = `${e.transactionDate}|${e.amount}|${e.descriptionClean}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }

  const out: PossibleDuplicate[] = [];
  for (const r of candidates) {
    const match = (byKey.get(`${r.transactionDate}|${r.amount}|${r.descriptionClean}`) ?? []).find(
      (e) =>
        e.bookingDate !== r.bookingDate &&
        (r.accountId === null || e.accountId === r.accountId) &&
        !fileFingerprints.has(e.fingerprint) &&
        (!period || (e.bookingDate >= period.from && e.bookingDate <= period.to)),
    );
    if (match) {
      out.push({
        transactionDate: r.transactionDate!,
        descriptionClean: r.descriptionClean,
        amount: r.amount,
        newBookingDate: r.bookingDate,
        existing: { id: match.id, bookingDate: match.bookingDate },
      });
    }
  }
  return out;
}
