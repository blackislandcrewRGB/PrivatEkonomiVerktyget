import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, statements, transactions } from "../db/schema.js";
import { assignOccurrenceIndexes } from "./fingerprint.js";
import { ImportError, runImport, type CoreResult, type ImportRow } from "./importCore.js";
import { normalizeMastercardDescription, type MastercardInvoice, type MastercardList, type MastercardRow, type MastercardStatement } from "./mastercard.js";

/** A row from another Mastercard source within this many days (same amount and text) is the same purchase. */
export const MASTERCARD_MATCH_DAYS = 3;

interface MastercardResultBase extends CoreResult {
  dryRun: boolean;
  source: "mastercard";
  filename: string;
  period: { from: string; to: string };
  account: { id: number; name: string };
  /** Rows already imported from the other source (within ±3 days) that were not added again. */
  matchedNearby: number;
  /** Existing rows that got details from this file (posting day, city, other currency, card). */
  enriched: number;
}

export interface MastercardInvoiceImportResult extends MastercardResultBase {
  format: "invoice";
  statement: MastercardStatement & { alreadyImported: boolean; replacesManual: boolean; updatesBalance: boolean };
}

export interface MastercardListImportResult extends MastercardResultBase {
  format: "list";
  printedAt: string;
  /** 'Utnyttjad kredit' against the latest invoice plus everything after its period. */
  debtCheck: { usedCredit: number; invoiceDebt: number; invoicePeriodTo: string; after: number; ok: true };
  incomplete: MastercardList["incomplete"];
  updatesBalance: boolean;
}

export function mastercardAccount(tx: Db) {
  const candidates = tx.select().from(accounts).where(eq(accounts.source, "mastercard")).all();
  if (candidates.length !== 1) {
    throw new ImportError(
      candidates.length === 0
        ? "Det finns inget konto för Mastercard Guld (källa mastercard)."
        : "Det finns flera konton med källan Mastercard. Ta bort det som inte används.",
    );
  }
  return candidates[0];
}

const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Splits rows into new ones and ones that already exist, and gives existing
 * rows what they lack from this file (posting day, city, other currency,
 * card), never changing them otherwise.
 *
 * An invoice row has a posting day, a row from the internet bank's list has
 * none, and invoices never overlap by posting day. So:
 * - an invoice row is the existing row with its fingerprint and the same
 *   posting day (the same invoice again), or one from the list that has no
 *   posting day yet (same purchase day, or within ±3 days with the same
 *   amount and text). Never a row another invoice brought: two identical
 *   purchases on one day that land on two invoices are two purchases.
 * - a list row is the existing row with its fingerprint and occurrence, or an
 *   invoice row within ±3 days (same amount and text).
 * New rows are numbered after the existing ones with their fingerprint, so a
 * second identical purchase is not taken for the first.
 */
function matchExisting(tx: Db, accountId: number, rows: (MastercardRow & { occurrenceIndex: number })[], dryRun: boolean) {
  const existing = tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.source, "mastercard")))
    .all();
  const byFp = new Map<string, typeof existing>();
  for (const e of existing) byFp.set(e.fingerprint, [...(byFp.get(e.fingerprint) ?? []), e]);
  const used = new Set<number>();
  const fresh: typeof rows = [];
  let matchedNearby = 0;
  let enriched = 0;
  const day = (e: (typeof existing)[number]) => dayNo(e.transactionDate ?? e.bookingDate);
  for (const r of rows) {
    const invoiceRow = r.postedDate !== null;
    const sameFp = (byFp.get(r.fingerprint) ?? []).filter((e) => !used.has(e.id));
    let hit = invoiceRow
      ? (sameFp.find((e) => e.postedDate === r.postedDate) ?? sameFp.find((e) => e.postedDate === null))
      : sameFp.find((e) => e.occurrenceIndex === r.occurrenceIndex);
    if (!hit) {
      const key = normalizeMastercardDescription(r.description);
      hit = existing
        .filter(
          (e) =>
            !used.has(e.id) &&
            // The other format only: a list row for an invoice row, and the other way round.
            (invoiceRow ? e.postedDate === null : e.postedDate !== null) &&
            e.amount === r.amount &&
            normalizeMastercardDescription(e.descriptionClean) === key &&
            Math.abs(day(e) - dayNo(r.transactionDate)) <= MASTERCARD_MATCH_DAYS &&
            !rows.some((o) => o !== r && o.fingerprint === e.fingerprint),
        )
        .sort((a, b) => Math.abs(day(a) - dayNo(r.transactionDate)) - Math.abs(day(b) - dayNo(r.transactionDate)))[0];
      if (hit) matchedNearby++;
    }
    if (!hit) {
      fresh.push(r);
      continue;
    }
    used.add(hit.id);
    const patch: Partial<typeof transactions.$inferInsert> = {};
    if (!hit.postedDate && r.postedDate) patch.postedDate = r.postedDate;
    if (!hit.merchantArea && r.merchantArea) patch.merchantArea = r.merchantArea;
    if (hit.foreignAmount === null && r.foreignAmount !== null) patch.foreignAmount = r.foreignAmount;
    if (!hit.foreignCurrency && r.foreignCurrency) patch.foreignCurrency = r.foreignCurrency;
    if (hit.exchangeRate === null && r.exchangeRate !== null) patch.exchangeRate = r.exchangeRate;
    if (!hit.cardMasked && r.cardMasked) patch.cardMasked = r.cardMasked;
    if (Object.keys(patch).length) {
      enriched++;
      if (!dryRun) tx.update(transactions).set(patch).where(eq(transactions.id, hit.id)).run();
    }
  }
  // Numbered after what is there, so the import takes them as new.
  const next = new Map<string, number>();
  for (const e of existing) next.set(e.fingerprint, Math.max(next.get(e.fingerprint) ?? 0, e.occurrenceIndex));
  const numbered = fresh.map((r) => {
    const n = (next.get(r.fingerprint) ?? 0) + 1;
    next.set(r.fingerprint, n);
    return { ...r, occurrenceIndex: n };
  });
  return { fresh: numbered, matchedNearby, enriched };
}

function toImportRows(accountId: number, rows: (MastercardRow & { occurrenceIndex: number })[]): ImportRow[] {
  return rows.map((r) => ({
    accountId,
    // Like Bank Norwegian: the purchase day is the row's date whichever file it
    // came from; the invoice's posting day is kept as posted_date.
    bookingDate: r.transactionDate,
    transactionDate: r.transactionDate,
    postedDate: r.postedDate,
    descriptionRaw: r.description,
    descriptionClean: r.description,
    counterparty: r.isPayment ? "Mastercard Guld" : r.description,
    amount: r.amount,
    currency: "SEK",
    foreignAmount: r.foreignAmount,
    foreignCurrency: r.foreignCurrency,
    exchangeRate: r.exchangeRate,
    cardMasked: r.cardMasked,
    merchantArea: r.merchantArea,
    fingerprint: r.fingerprint,
    occurrenceIndex: r.occurrenceIndex,
    // My own card: purchases are mine unless a rule says otherwise.
    defaultShared: false,
    forced: r.isPayment ? { categoryKey: "card_payment", isTransfer: true, shared: false } : undefined,
  }));
}

function importRows(
  tx: Db,
  accountId: number,
  rows: MastercardRow[],
  filename: string,
  period: { from: string; to: string },
  dryRun: boolean,
) {
  const indexed = assignOccurrenceIndexes(rows);
  const { fresh, matchedNearby, enriched } = matchExisting(tx, accountId, indexed, dryRun);
  const core = runImport(tx, { source: "mastercard", filename, period, dryRun, rows: toImportRows(accountId, fresh) });
  // The rows recognised here count as skipped, like fingerprint duplicates.
  return {
    ...core,
    rowsTotal: rows.length,
    rowsSkipped: rows.length - core.rowsNew,
    matchedNearby,
    enriched,
  };
}

/**
 * The monthly invoice: its rows, the statement (a manual one for the same due
 * date is replaced) and the account balance (-debt, if newer than what set
 * it last).
 */
export function importMastercardInvoice(db: Db, invoice: MastercardInvoice, filename: string, opts: { dryRun?: boolean } = {}): MastercardInvoiceImportResult {
  const dryRun = opts.dryRun ?? false;
  const s = invoice.statement;
  const period = { from: s.periodFrom, to: s.periodTo };
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const account = mastercardAccount(tx);
    const result = importRows(tx, account.id, invoice.rows, filename, period, dryRun);

    const existing = tx
      .select({ id: statements.id })
      .from(statements)
      .where(and(eq(statements.accountId, account.id), eq(statements.periodFrom, s.periodFrom), eq(statements.periodTo, s.periodTo)))
      .get();
    // An invoice entered by hand for the same due date is this one.
    const manual = existing
      ? undefined
      : tx
          .select({ id: statements.id })
          .from(statements)
          .where(and(eq(statements.accountId, account.id), eq(statements.source, "manual"), eq(statements.dueDate, s.dueDate)))
          .get();
    const asOf = s.invoiceDate ?? s.periodTo;
    const updatesBalance = !account.balanceUpdatedAt || asOf > account.balanceUpdatedAt.slice(0, 10);

    if (!dryRun) {
      const values = {
        accountId: account.id,
        periodFrom: s.periodFrom,
        periodTo: s.periodTo,
        dueDate: s.dueDate,
        amountDue: s.totalDebt,
        minPayment: s.minPayment,
        source: "pdf" as const,
        importId: result.importId,
        nextPeriodTo: s.nextPeriodTo,
      };
      if (manual) tx.update(statements).set(values).where(eq(statements.id, manual.id)).run();
      else if (!existing) tx.insert(statements).values(values).run();
      if (updatesBalance) tx.update(accounts).set({ balance: -s.totalDebt, balanceUpdatedAt: asOf }).where(eq(accounts.id, account.id)).run();
    }
    return {
      dryRun,
      source: "mastercard" as const,
      format: "invoice" as const,
      filename,
      period,
      account: { id: account.id, name: account.name },
      statement: { ...s, alreadyImported: !!existing, replacesManual: !!manual, updatesBalance },
      ...result,
    };
  });
}

/**
 * The internet bank's transaction list (a one-off backfill). Imported only if
 * 'Utnyttjad kredit' equals the latest imported invoice's debt plus every row
 * dated after that invoice's period; otherwise nothing is imported.
 */
export function importMastercardList(db: Db, list: MastercardList, filename: string, opts: { dryRun?: boolean } = {}): MastercardListImportResult {
  const dryRun = opts.dryRun ?? false;
  const dates = list.rows.map((r) => r.transactionDate).sort();
  const period = { from: dates[0], to: list.printedAt };
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const account = mastercardAccount(tx);
    const invoice = tx
      .select()
      .from(statements)
      .where(and(eq(statements.accountId, account.id), isNotNull(statements.periodTo)))
      .orderBy(desc(statements.periodTo))
      .get();
    if (!invoice) {
      throw new ImportError("Importera minst en Mastercard-faktura först: utskriften stäms av mot den senaste fakturans skuld.");
    }
    const after = list.rows.filter((r) => r.transactionDate > invoice.periodTo!).reduce((t, r) => t + r.amount, 0);
    const expected = invoice.amountDue - after;
    if (expected !== list.usedCredit) {
      const kr = (ore: number) => `${(ore / 100).toFixed(2).replace(".", ",")} kr`;
      throw new ImportError("Utskriften stämmer inte med den senaste fakturan. Inget importerades.", [
        `Utnyttjad kredit i utskriften: ${kr(list.usedCredit)}.`,
        `Fakturan t.o.m. ${invoice.periodTo}: ${kr(invoice.amountDue)}, plus raderna efter den: ${kr(-after)}, blir ${kr(expected)}.`,
      ]);
    }
    const result = importRows(tx, account.id, list.rows, filename, period, dryRun);
    const updatesBalance = !account.balanceUpdatedAt || list.printedAt > account.balanceUpdatedAt.slice(0, 10);
    if (!dryRun && updatesBalance) {
      tx.update(accounts).set({ balance: -list.usedCredit, balanceUpdatedAt: list.printedAt }).where(eq(accounts.id, account.id)).run();
    }
    return {
      dryRun,
      source: "mastercard" as const,
      format: "list" as const,
      filename,
      period,
      account: { id: account.id, name: account.name },
      printedAt: list.printedAt,
      debtCheck: { usedCredit: list.usedCredit, invoiceDebt: invoice.amountDue, invoicePeriodTo: invoice.periodTo!, after: -after, ok: true as const },
      incomplete: list.incomplete,
      updatesBalance,
      ...result,
    };
  });
}
