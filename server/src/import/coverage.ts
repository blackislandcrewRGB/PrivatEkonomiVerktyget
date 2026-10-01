import { desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, bankAccounts, bankConnections, imports, statements, transactions } from "../db/schema.js";

export interface AccountCoverage {
  accountId: number;
  name: string;
  kind: "bank" | "credit_card";
  source: "swedbank" | "norwegian" | "mastercard" | "csv" | null;
  /** The latest period end of an import that put rows on the account. */
  importedTo: string | null;
  importedAt: string | null;
  /** How the account gets its rows: fetched from the bank, or files brought in by hand. */
  via: "enable_banking" | "file";
  /** The last successful bank fetch (Enable Banking): a sync with nothing new leaves no import, but the account is still up to date. */
  syncedAt: string | null;
  /** The latest invoice's period end (credit cards)… */
  lastInvoiceTo: string | null;
  /** …and where it says the next one ends, when it says. */
  nextInvoiceTo: string | null;
}

/**
 * Per account: up to which date it is imported and how it gets its rows
 * (Importer's account cards). An account fed by a bank connection that is
 * still there (active, expired or failing, not removed) counts as Enable
 * Banking.
 */
export function importCoverage(db: Db): AccountCoverage[] {
  const imported = db
    .select({
      accountId: transactions.accountId,
      importedTo: sql<string | null>`max(${imports.periodTo})`,
      importedAt: sql<string | null>`max(${imports.importedAt})`,
    })
    .from(transactions)
    .innerJoin(imports, eq(imports.id, transactions.importId))
    .groupBy(transactions.accountId)
    .all();
  const links = db
    .select({ accountId: bankAccounts.accountId, lastSyncAt: bankAccounts.lastSyncAt, status: bankConnections.status })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccounts.connectionId))
    .all()
    .filter((l) => l.accountId !== null && l.status !== "pending" && l.status !== "revoked");
  // The latest invoice per account (by period), with the next period's end if it gives it.
  const invoices = db
    .select({ accountId: statements.accountId, to: statements.periodTo, next: statements.nextPeriodTo })
    .from(statements)
    .where(isNotNull(statements.periodTo))
    .orderBy(desc(statements.periodTo))
    .all();
  return db
    .select()
    .from(accounts)
    .orderBy(accounts.id)
    .all()
    .map((a) => {
      const mine = links.filter((l) => l.accountId === a.id);
      const synced = mine.map((l) => l.lastSyncAt).filter((x): x is string => !!x).sort();
      const r = imported.find((x) => x.accountId === a.id);
      return {
        accountId: a.id,
        name: a.name,
        kind: a.kind,
        source: a.source,
        importedTo: r?.importedTo ?? null,
        importedAt: r?.importedAt ?? null,
        via: mine.length ? "enable_banking" : "file",
        syncedAt: synced.at(-1) ?? null,
        lastInvoiceTo: invoices.find((i) => i.accountId === a.id)?.to ?? null,
        nextInvoiceTo: invoices.find((i) => i.accountId === a.id)?.next ?? null,
      };
    });
}
