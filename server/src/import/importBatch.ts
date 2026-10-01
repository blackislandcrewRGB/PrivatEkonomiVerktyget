import type { Db } from "../db/client.js";
import { ImportError } from "./importCore.js";
import {
  applySwedbankFile,
  bindSwedbankAccounts,
  resolveSwedbankAccounts,
  type AccountMap,
  type FileAccount,
  type SwedbankImportResult,
} from "./importSwedbank.js";
import {
  importNorwegianInvoice,
  importNorwegianXlsxFile,
  type NorwegianImportResult,
  type NorwegianXlsxImportResult,
} from "./importNorwegian.js";
import { looksLikeSwedbankCsv, parseSwedbankCsv, ImportParseError, type SwedbankFile } from "./swedbank.js";
import { looksLikeNorwegianPdf, parseNorwegianLines, type NorwegianInvoice } from "./norwegian.js";
import { extractPdfLines } from "./pdfText.js";
import { detectMastercardPdf, parseMastercardInvoice, parseMastercardList, type MastercardInvoice, type MastercardList } from "./mastercard.js";
import {
  importMastercardInvoice,
  importMastercardList,
  type MastercardInvoiceImportResult,
  type MastercardListImportResult,
} from "./importMastercard.js";
import { looksLikeXlsx, parseNorwegianXlsx, type NorwegianXlsxFile } from "./norwegianXlsx.js";
import { looksLikeRentNotice, parseRentNotice, type RentNotice } from "./rentNotice.js";
import { importRentNotice, type RentNoticeImportResult } from "./importRentNotice.js";
import { looksLikeTaxReturn, parseTaxReturn, type TaxReturnReceipt } from "./taxReturn.js";
import { importTaxReturn, taxReturnFilename, type TaxReturnImportResult } from "./importTaxReturn.js";

export type FileImportResult =
  | SwedbankImportResult
  | NorwegianImportResult
  | NorwegianXlsxImportResult
  | MastercardInvoiceImportResult
  | MastercardListImportResult
  | RentNoticeImportResult
  | TaxReturnImportResult;

export type BatchFileResult =
  | { filename: string; index: number; ok: true; alreadyImported: boolean; result: FileImportResult }
  | { filename: string; index: number; ok: false; error: string; details: string[] };

export interface BatchResult {
  dryRun: boolean;
  /** In import order (by period start). */
  files: BatchFileResult[];
  /** Swedbank accounts across all files: one choice per account, not per file. */
  accounts: FileAccount[];
}

type Parsed =
  | { kind: "swedbank"; file: SwedbankFile }
  | { kind: "norwegian-pdf"; invoice: NorwegianInvoice }
  | { kind: "norwegian-xlsx"; file: NorwegianXlsxFile }
  | { kind: "mastercard-invoice"; invoice: MastercardInvoice }
  | { kind: "mastercard-list"; list: MastercardList }
  | { kind: "rent-notice"; notice: RentNotice; bytes: Uint8Array }
  | { kind: "tax-return"; receipt: TaxReturnReceipt };

type ParsedFile = { filename: string; order: number } & ({ ok: true; parsed: Parsed; periodFrom: string | null } | { ok: false; error: string; details: string[] });

class DryRunRollback extends Error {}

async function parseFile(bytes: Uint8Array): Promise<Parsed> {
  if (looksLikeSwedbankCsv(bytes)) return { kind: "swedbank", file: parseSwedbankCsv(bytes) };
  if (looksLikeNorwegianPdf(bytes)) {
    let lines;
    try {
      lines = await extractPdfLines(bytes);
    } catch (e) {
      throw new ImportParseError("Kunde inte läsa PDF-filen.", [String((e as Error).message)]);
    }
    if (looksLikeTaxReturn(lines)) return { kind: "tax-return", receipt: parseTaxReturn(lines) };
    if (looksLikeRentNotice(lines)) return { kind: "rent-notice", notice: parseRentNotice(lines, bytes), bytes };
    const mastercard = detectMastercardPdf(lines);
    if (mastercard === "invoice") return { kind: "mastercard-invoice", invoice: parseMastercardInvoice(lines) };
    if (mastercard === "list") return { kind: "mastercard-list", list: parseMastercardList(lines) };
    if (lines.length === 0) {
      throw new ImportParseError("PDF:en har ingen text (bara bilder). Spara sidan som PDF från webbläsaren (⌘P) så följer texten med.");
    }
    return { kind: "norwegian-pdf", invoice: parseNorwegianLines(lines) };
  }
  if (looksLikeXlsx(bytes)) return { kind: "norwegian-xlsx", file: await parseNorwegianXlsx(bytes) };
  throw new ImportParseError(
    "Okänt filformat. Förväntade Swedbank-CSV, Bank Norwegian-faktura (PDF), Bank Norwegian-export (XLSX), Mastercard-faktura (PDF), Mastercard-utskrift (PDF), hyresavi (PDF) eller deklarationskvittens (PDF).",
  );
}

function periodFrom(p: Parsed): string | null {
  if (p.kind === "norwegian-pdf" || p.kind === "mastercard-invoice") return p.invoice.statement.periodFrom;
  // The transaction list is checked against the latest invoice: after every invoice in the batch.
  if (p.kind === "mastercard-list") return null;
  if (p.kind === "rent-notice") return `${p.notice.rentMonth}-01`;
  if (p.kind === "tax-return") return `${p.receipt.incomeYear}-01-01`;
  return p.file.period?.from ?? null;
}

function errorOf(e: unknown): { error: string; details: string[] } {
  if (e instanceof ImportParseError || e instanceof ImportError) return { error: e.message, details: e.details };
  if (e instanceof DryRunRollback) throw e;
  // Anything unexpected still only fails this file.
  console.error(e);
  return { error: "Oväntat fel vid import av filen.", details: [e instanceof Error ? e.message : String(e)] };
}

/**
 * Imports several files. Each file is imported on its own (own transaction, own
 * row in `imports`, so each can be undone separately); a broken file only
 * stops itself. Files are imported in date order. Swedbank accounts are chosen
 * once per account across all files.
 *
 * A dry run performs the whole batch inside a transaction that is rolled back,
 * so the preview is exact even when the files overlap each other.
 */
export async function importFiles(
  db: Db,
  files: { name: string; bytes: Uint8Array }[],
  opts: { dryRun?: boolean; accountMap?: AccountMap } = {},
): Promise<BatchResult> {
  const dryRun = opts.dryRun ?? false;

  // Parse everything first (PDF/XLSX parsing is async; database work below is not).
  const parsedFiles: ParsedFile[] = await Promise.all(
    files.map(async (f, order) => {
      const filename = f.name.normalize("NFC");
      try {
        const parsed = await parseFile(f.bytes);
        // A receipt's own name has the personnummer in it: it goes by its income year instead.
        if (parsed.kind === "tax-return") return { filename: taxReturnFilename(parsed.receipt.incomeYear), order, ok: true as const, parsed, periodFrom: periodFrom(parsed) };
        return { filename, order, ok: true as const, parsed, periodFrom: periodFrom(parsed) };
      } catch (e) {
        return { filename, order, ok: false as const, ...errorOf(e) };
      }
    }),
  );
  parsedFiles.sort((a, b) => {
    const pa = a.ok ? (a.periodFrom ?? "9999") : "9999";
    const pb = b.ok ? (b.periodFrom ?? "9999") : "9999";
    return pa.localeCompare(pb) || a.order - b.order;
  });

  const swedbankFiles = parsedFiles.flatMap((f) => (f.ok && f.parsed.kind === "swedbank" ? [f.parsed.file] : []));

  const run = (outer: Db): BatchResult => {
    const accounts = resolveSwedbankAccounts(outer, swedbankFiles, opts.accountMap ?? {});
    // Bind the accounts that are decided (creating 'new' ones) before any file,
    // so transfers between two files in the batch resolve their counter account.
    const accountIdByRef = new Map<string, number | null>(accounts.map((a) => [a.ref, null]));
    const bindErrors = new Map<string, { error: string; details: string[] }>();
    for (const a of accounts.filter((x) => x.accountId !== null)) {
      try {
        const bound = outer.transaction((tx) => bindSwedbankAccounts(tx as unknown as Db, [a]));
        accountIdByRef.set(a.ref, bound.get(a.ref) ?? null);
      } catch (e) {
        bindErrors.set(a.ref, errorOf(e));
      }
    }

    const results: BatchFileResult[] = parsedFiles.map((f) => {
      if (!f.ok) return { filename: f.filename, index: f.order, ok: false, error: f.error, details: f.details };
      if (f.parsed.kind === "swedbank") {
        const refs = new Set(f.parsed.file.rows.map((r) => `••${r.accountNumber.slice(-4)}`));
        const bindError = [...refs].map((r) => bindErrors.get(r)).find(Boolean);
        if (bindError) return { filename: f.filename, index: f.order, ok: false, ...bindError };
      }
      try {
        const result = importOne(outer, f.parsed, f.filename, accountIdByRef, dryRun);
        return { filename: f.filename, index: f.order, ok: true, alreadyImported: isAlreadyImported(result), result };
      } catch (e) {
        return { filename: f.filename, index: f.order, ok: false, ...errorOf(e) };
      }
    });
    return { dryRun, files: results, accounts };
  };

  if (!dryRun) return run(db);

  let preview: BatchResult | undefined;
  try {
    db.transaction((tx) => {
      preview = run(tx as unknown as Db);
      throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  for (const f of preview!.files) {
    if (f.ok) {
      f.result.dryRun = true;
      f.result.importId = null;
    }
  }
  return preview!;
}

function importOne(db: Db, parsed: Parsed, filename: string, accountIdByRef: Map<string, number | null>, dryRun: boolean): FileImportResult {
  switch (parsed.kind) {
    case "swedbank": {
      const unresolved = [...new Set(parsed.file.rows.map((r) => r.accountNumber))]
        .map((n) => `••${n.replace(/\D/g, "").slice(-4)}`)
        .filter((ref) => (accountIdByRef.get(ref) ?? null) === null);
      // In a dry run the rows are imported without account so the numbers can be shown.
      if (unresolved.length && !dryRun) throw new ImportError("Välj vilket konto raderna ska läggas på.", unresolved);
      return applySwedbankFile(db, parsed.file, filename, accountIdByRef);
    }
    case "norwegian-pdf":
      return importNorwegianInvoice(db, parsed.invoice, filename);
    case "norwegian-xlsx":
      return importNorwegianXlsxFile(db, parsed.file, filename);
    case "mastercard-invoice":
      return importMastercardInvoice(db, parsed.invoice, filename);
    case "mastercard-list":
      return importMastercardList(db, parsed.list, filename);
    case "rent-notice":
      return importRentNotice(db, parsed.notice, parsed.bytes, filename);
    case "tax-return":
      return importTaxReturn(db, parsed.receipt, filename);
  }
}

/**
 * Nothing new in the file. A PDF invoice whose rows are all known still counts
 * as new while its statement (debt, due date) isn't recorded.
 */
function isAlreadyImported(r: FileImportResult): boolean {
  if (r.source === "rent_notice") return r.notice.alreadyImported;
  if (r.source === "tax_return") return r.taxReturn.alreadyImported;
  if (r.rowsNew > 0) return false;
  if (r.source === "norwegian" && r.format === "pdf") return r.statement.alreadyImported;
  if (r.source === "mastercard" && r.enriched > 0) return false;
  if (r.source === "mastercard" && r.format === "invoice") return r.statement.alreadyImported;
  // Nothing new, but existing rows get their posting day: still worth importing.
  if (r.source === "norwegian" && r.format === "xlsx" && r.postedDatesAdded > 0) return false;
  return r.rowsTotal > 0;
}
