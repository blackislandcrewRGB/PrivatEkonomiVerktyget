import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, statements, transactions } from "../db/schema.js";
import { assignOccurrenceIndexes } from "./fingerprint.js";
import { ImportError, runImport, type CoreResult } from "./importCore.js";
import { parseNorwegianPdf, type NorwegianInvoice, type NorwegianStatement } from "./norwegian.js";
import { parseNorwegianXlsx, type NorwegianXlsxFile } from "./norwegianXlsx.js";

export interface NorwegianImportResult extends CoreResult {
  dryRun: boolean;
  source: "norwegian";
  format: "pdf";
  filename: string;
  period: { from: string; to: string };
  account: { id: number; name: string };
  statement: NorwegianStatement & { alreadyImported: boolean; updatesBalance: boolean };
}

export interface NorwegianXlsxImportResult extends CoreResult {
  dryRun: boolean;
  source: "norwegian";
  format: "xlsx";
  filename: string;
  period: { from: string; to: string } | null;
  account: { id: number; name: string };
  reserved: { count: number; amount: number };
  otherTypes: string[];
  /** Existing rows that got their posting day (BookDate) from this file. */
  postedDatesAdded: number;
}


export async function importNorwegianPdf(
  db: Db,
  bytes: Uint8Array,
  filename: string,
  opts: { dryRun?: boolean } = {},
): Promise<NorwegianImportResult> {
  // PDF parsing is async; everything touching the database happens in one
  // synchronous transaction afterwards.
  return importNorwegianInvoice(db, await parseNorwegianPdf(bytes), filename, opts);
}

export function importNorwegianInvoice(
  db: Db,
  invoice: NorwegianInvoice,
  filename: string,
  opts: { dryRun?: boolean } = {},
): NorwegianImportResult {
  const dryRun = opts.dryRun ?? false;
  const s = invoice.statement;
  const rows = assignOccurrenceIndexes(invoice.rows);
  const period = { from: s.periodFrom, to: s.periodTo };

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const account = norwegianAccount(tx);

    const core = runImport(tx, {
      source: "norwegian",
      filename,
      period,
      dryRun,
      rows: rows.map((r) => ({
        accountId: account.id,
        // Norwegian rows use the transaction date as booking date whatever the
        // source (the invoice has no other date), so a purchase lands on the
        // same day no matter which file imported it first.
        bookingDate: r.date,
        transactionDate: r.date,
        descriptionRaw: r.descriptionRaw,
        descriptionClean: r.descriptionClean,
        counterparty: r.isPayment ? "Bank Norwegian" : r.descriptionClean,
        amount: r.amount,
        currency: "SEK",
        cardMasked: r.cardMasked,
        merchantArea: r.merchantArea,
        fingerprint: r.fingerprint,
        occurrenceIndex: r.occurrenceIndex,
        // Shared card: purchases are shared unless a rule says otherwise.
        defaultShared: true,
        forced: r.isPayment ? { categoryKey: "card_payment", isTransfer: true, shared: false } : undefined,
      })),
    });

    const existingStatement = tx
      .select({ id: statements.id })
      .from(statements)
      .where(and(eq(statements.accountId, account.id), eq(statements.periodFrom, s.periodFrom), eq(statements.periodTo, s.periodTo)))
      .get();
    // The debt only replaces the balance if this invoice is newer than whatever
    // set the balance last (an older invoice or a later manual update wins).
    const asOf = s.invoiceDate ?? s.periodTo;
    const updatesBalance = !account.balanceUpdatedAt || asOf > account.balanceUpdatedAt.slice(0, 10);

    if (!dryRun) {
      if (!existingStatement) {
        tx.insert(statements)
          .values({
            accountId: account.id,
            periodFrom: s.periodFrom,
            periodTo: s.periodTo,
            dueDate: s.dueDate,
            amountDue: s.totalDebt,
            minPayment: s.minPayment,
            source: "pdf",
            importId: core.importId,
          })
          .run();
      }
      if (updatesBalance) {
        tx.update(accounts).set({ balance: -s.totalDebt, balanceUpdatedAt: asOf }).where(eq(accounts.id, account.id)).run();
      }
    }

    return {
      dryRun,
      source: "norwegian" as const,
      format: "pdf" as const,
      filename,
      period,
      account: { id: account.id, name: account.name },
      statement: { ...s, alreadyImported: !!existingStatement, updatesBalance },
      ...core,
    };
  });
}

/**
 * Bank Norwegian transaction export (XLSX, one calendar month). Same account and
 * fingerprints as the PDF invoice, so a purchase already imported from either
 * file is skipped. 'Reserverat' rows are not imported.
 */
export async function importNorwegianXlsx(
  db: Db,
  bytes: Uint8Array,
  filename: string,
  opts: { dryRun?: boolean } = {},
): Promise<NorwegianXlsxImportResult> {
  return importNorwegianXlsxFile(db, await parseNorwegianXlsx(bytes), filename, opts);
}

export function importNorwegianXlsxFile(
  db: Db,
  file: NorwegianXlsxFile,
  filename: string,
  opts: { dryRun?: boolean } = {},
): NorwegianXlsxImportResult {
  const dryRun = opts.dryRun ?? false;
  const rows = assignOccurrenceIndexes(file.rows);

  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const account = norwegianAccount(tx);
    const core = runImport(tx, {
      source: "norwegian",
      filename,
      period: file.period,
      dryRun,
      rows: rows.map((r) => ({
        accountId: account.id,
        bookingDate: r.transactionDate, // see importNorwegianInvoice
        transactionDate: r.transactionDate,
        postedDate: r.bookDate,
        descriptionRaw: r.descriptionRaw,
        descriptionClean: r.descriptionClean,
        counterparty: r.isPayment ? "Bank Norwegian" : r.descriptionClean,
        amount: r.amount,
        currency: "SEK",
        cardMasked: null,
        merchantCategory: r.merchantCategory,
        merchantArea: r.merchantArea,
        fingerprint: r.fingerprint,
        occurrenceIndex: r.occurrenceIndex,
        defaultShared: true,
        forced: r.isPayment ? { categoryKey: "card_payment", isTransfer: true, shared: false } : undefined,
      })),
    });
    // Rows already imported (from the PDF or an older import) get the posting day now.
    // That is worth importing the file for, even with no new rows. (New rows got
    // theirs on insert, so only existing rows are counted.)
    let postedDatesAdded = 0;
    for (const r of rows) {
      if (!r.bookDate) continue;
      postedDatesAdded += tx
        .update(transactions)
        .set({ postedDate: r.bookDate })
        .where(and(eq(transactions.fingerprint, r.fingerprint), eq(transactions.occurrenceIndex, r.occurrenceIndex), isNull(transactions.postedDate)))
        .returning({ id: transactions.id })
        .all().length;
    }
    return {
      dryRun,
      source: "norwegian" as const,
      format: "xlsx" as const,
      filename,
      period: file.period,
      account: { id: account.id, name: account.name },
      reserved: file.reserved,
      otherTypes: file.otherTypes,
      postedDatesAdded,
      ...core,
    };
  });
}

function norwegianAccount(tx: Db) {
  const candidates = tx.select().from(accounts).where(eq(accounts.source, "norwegian")).all();
  if (candidates.length !== 1) {
    throw new ImportError(
      candidates.length === 0
        ? 'Det finns inget konto för Bank Norwegian. Kör "npm run db:seed" eller skapa kontot.'
        : "Det finns flera konton för Bank Norwegian. Ta bort det som inte används.",
    );
  }
  return candidates[0];
}
