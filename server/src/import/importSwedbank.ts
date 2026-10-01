import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { extractCounterparty } from "../categorize/counterparty.js";
import { counterRefFromReference } from "../transfers/transfers.js";
import { assignOccurrenceIndexes } from "./fingerprint.js";
import { ImportError, runImport, type CoreResult } from "./importCore.js";
import { parseSwedbankCsv, type SwedbankFile, type SwedbankRow } from "./swedbank.js";
import { maskAccountNumber } from "./text.js";

export { ImportError };

/** Per masked account number: which account the rows go to. 'new' creates one. */
export type AccountMap = Record<string, number | "new">;

export interface FileAccount {
  ref: string; // '••1234'
  clearing: string;
  product: string;
  rows: number;
  accountId: number | "new" | null;
  // How accountId was chosen, for the UI.
  resolvedBy: "choice" | "bound" | "hint" | null;
}

export interface SwedbankImportResult extends CoreResult {
  dryRun: boolean;
  source: "swedbank";
  filename: string;
  period: { from: string; to: string } | null;
  accounts: FileAccount[];
}

/** Single-file import: parse, choose accounts, import. */
export function importSwedbankCsv(
  db: Db,
  bytes: Uint8Array,
  filename: string,
  opts: { dryRun?: boolean; accountMap?: AccountMap } = {},
): SwedbankImportResult {
  const dryRun = opts.dryRun ?? false;
  const parsed = parseSwedbankCsv(bytes);
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const fileAccounts = resolveSwedbankAccounts(tx, [parsed], opts.accountMap ?? {});
    if (!dryRun) requireResolved(fileAccounts);
    const accountIdByRef = dryRun ? previewAccountIds(fileAccounts) : bindSwedbankAccounts(tx, fileAccounts);
    return { ...applySwedbankFile(tx, parsed, filename, accountIdByRef, { dryRun }), accounts: fileAccounts };
  });
}

/** Imports one parsed file with accounts already decided (masked ref -> account id, null only in a dry run). */
export function applySwedbankFile(
  db: Db,
  parsed: SwedbankFile,
  filename: string,
  accountIdByRef: Map<string, number | null>,
  opts: { dryRun?: boolean } = {},
): SwedbankImportResult {
  const dryRun = opts.dryRun ?? false;
  const rows = assignOccurrenceIndexes(parsed.rows);
  const fileAccounts = summarizeAccounts(parsed.rows).map((a) => {
    const id = accountIdByRef.get(a.ref) ?? null;
    return { ...a, accountId: id, resolvedBy: id === null ? null : ("bound" as const) };
  });
  return db.transaction((txn) => {
    const tx = txn as unknown as Db;
    const core = runImport(tx, {
      source: "swedbank",
      filename,
      period: parsed.period,
      dryRun,
      rows: rows.map((r) => ({
        accountId: accountIdByRef.get(maskAccountNumber(r.accountNumber)) ?? null,
        bookingDate: r.bookingDate,
        transactionDate: r.transactionDate,
        descriptionRaw: r.descriptionRaw,
        descriptionClean: r.descriptionClean,
        counterparty: extractCounterparty(r.descriptionClean),
        amount: r.amount,
        currency: r.currency,
        cardMasked: null,
        counterRef: counterRefFromReference(r.reference),
        fingerprint: r.fingerprint,
        occurrenceIndex: r.occurrenceIndex,
        defaultShared: false,
      })),
    });
    return { dryRun, source: "swedbank" as const, filename, period: parsed.period, accounts: fileAccounts, ...core };
  });
}

function summarizeAccounts(rows: readonly SwedbankRow[]): Omit<FileAccount, "accountId" | "resolvedBy">[] {
  const groups = new Map<string, Omit<FileAccount, "accountId" | "resolvedBy">>();
  for (const r of rows) {
    const ref = maskAccountNumber(r.accountNumber);
    const g = groups.get(ref);
    if (g) g.rows++;
    else groups.set(ref, { ref, clearing: r.clearing, product: r.product, rows: 1 });
  }
  return [...groups.values()];
}

/**
 * Decides, per account number across all given files, which account its rows
 * belong to: 1. the user's explicit choice, 2. an account already bound to that
 * masked number, 3. an unbound Swedbank account whose import_hint matches 'Produkt'.
 */
export function resolveSwedbankAccounts(db: Db, files: readonly SwedbankFile[], accountMap: AccountMap): FileAccount[] {
  const groups = new Map<string, FileAccount>();
  for (const f of files) {
    for (const a of summarizeAccounts(f.rows)) {
      const g = groups.get(a.ref);
      if (g) g.rows += a.rows;
      else groups.set(a.ref, { ...a, accountId: null, resolvedBy: null });
    }
  }

  const all = db.select().from(accounts).all();
  const hintedTaken = new Set<number>();
  for (const g of groups.values()) {
    const choice = accountMap[g.ref];
    if (choice !== undefined) {
      if (choice !== "new" && !all.some((a) => a.id === choice)) {
        throw new ImportError(`Kontot med id ${choice} finns inte.`);
      }
      g.accountId = choice;
      g.resolvedBy = "choice";
      continue;
    }
    const bound = all.filter((a) => a.accountRef === g.ref);
    if (bound.length === 1) {
      g.accountId = bound[0].id;
      g.resolvedBy = "bound";
      continue;
    }
    const hinted = all.filter(
      (a) =>
        a.source === "swedbank" &&
        !a.accountRef &&
        !hintedTaken.has(a.id) &&
        a.importHint &&
        g.product.toLocaleLowerCase("sv").includes(a.importHint.toLocaleLowerCase("sv")),
    );
    if (hinted.length === 1) {
      g.accountId = hinted[0].id;
      g.resolvedBy = "hint";
      hintedTaken.add(hinted[0].id);
    }
  }
  return [...groups.values()];
}

export function requireResolved(fileAccounts: FileAccount[]): void {
  const unresolved = fileAccounts.filter((a) => a.accountId === null);
  if (unresolved.length) {
    throw new ImportError(
      "Välj vilket konto raderna ska läggas på.",
      unresolved.map((a) => `${a.product || "Okänd produkt"} ${a.ref}`),
    );
  }
}

export function previewAccountIds(fileAccounts: FileAccount[]): Map<string, number | null> {
  return new Map(fileAccounts.map((a) => [a.ref, typeof a.accountId === "number" ? a.accountId : null]));
}

/** Creates accounts chosen as 'new', binds masked number + clearing. Returns ref -> id. */
export function bindSwedbankAccounts(db: Db, fileAccounts: FileAccount[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const fa of fileAccounts) out.set(fa.ref, bindAccount(db, fa));
  return out;
}

function bindAccount(db: Db, fa: FileAccount): number {
  if (fa.accountId === "new") {
    return db
      .insert(accounts)
      .values({ name: `Swedbank ${fa.product || "konto"} ${fa.ref}`, source: "swedbank", accountRef: fa.ref, clearing: fa.clearing || null })
      .returning({ id: accounts.id })
      .get().id;
  }
  const account = db.select().from(accounts).where(eq(accounts.id, fa.accountId!)).get()!;
  if (account.accountRef && account.accountRef !== fa.ref) {
    throw new ImportError(
      `Kontot "${account.name}" är redan kopplat till kontonummer ${account.accountRef}, inte ${fa.ref}. Välj ett annat konto eller skapa ett nytt.`,
    );
  }
  if (!account.accountRef || (!account.clearing && fa.clearing)) {
    db.update(accounts)
      .set({ accountRef: fa.ref, clearing: account.clearing ?? (fa.clearing || null), source: account.source ?? "swedbank" })
      .where(eq(accounts.id, account.id))
      .run();
  }
  return account.id;
}
