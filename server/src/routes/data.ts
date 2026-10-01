import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { asc, getTableColumns, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { backupDatabase, backupDir } from "../db/backup.js";
import { getCategoryPathMap } from "../db/seed.js";
import { loadSplits } from "../splits.js";
import { todayLocal } from "../overview/dates.js";

const BACKUP_NAME = /^(.+)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(start|fore-migrering|manuell|[a-z-]+?)(-\d+)?\.db$/;

/** Backups of this database, newest first: file name, kind, UTC time and size. */
export function listBackups(dbFile: string) {
  const dir = backupDir(dbFile);
  if (!fs.existsSync(dir)) return [];
  const base = path.basename(dbFile, path.extname(dbFile));
  return fs
    .readdirSync(dir)
    .map((name) => ({ name, m: BACKUP_NAME.exec(name) }))
    .filter((x) => x.m && x.m[1] === base)
    .map(({ name, m }) => ({
      name,
      kind: m![6],
      createdAt: `${m![2]}T${m![3]}:${m![4]}:${m![5]}Z`,
      size: fs.statSync(path.join(dir, name)).size,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const kronor = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");

/**
 * Inställningar › Data: the backups (list, 'Skapa nu') and export of
 * everything, as JSON (every table) or the transactions as CSV (semicolon,
 * decimal comma, for Excel).
 */
export function dataRoutes(db: Db, info: { databasePath: string }) {
  const app = new Hono();

  app.get("/backups", (c) => c.json({ dir: backupDir(info.databasePath), backups: listBackups(info.databasePath) }));

  app.post("/backups", async (c) => {
    const file = await backupDatabase(info.databasePath, "manuell");
    if (!file) return c.json({ error: "Det finns ingen databasfil att kopiera." }, 400);
    return c.json({ name: path.basename(file), backups: listBackups(info.databasePath) });
  });

  app.get("/export", (c) => {
    const format = c.req.query("format") === "csv" ? "csv" : "json";
    const stamp = todayLocal();
    if (format === "json") {
      const tables = {
        accounts: schema.accounts,
        categories: schema.categories,
        merchantRules: schema.merchantRules,
        merchantCategoryMap: schema.merchantCategoryMap,
        transactions: schema.transactions,
        transactionSplits: schema.transactionSplits,
        items: schema.items,
        itemTransactions: schema.itemTransactions,
        itemAttachments: schema.itemAttachments,
        receipts: schema.receipts,
        receiptLines: schema.receiptLines,
        productGroups: schema.productGroups,
        products: schema.products,
        productAliases: schema.productAliases,
        instruments: schema.instruments,
        trades: schema.trades,
        priceSnapshots: schema.priceSnapshots,
        fxRates: schema.fxRates,
        cashBalances: schema.cashBalances,
        recurringExpenses: schema.recurringExpenses,
        recurringExpenseAmounts: schema.recurringExpenseAmounts,
        recurringExpenseMarks: schema.recurringExpenseMarks,
        recurringIncome: schema.recurringIncome,
        recurringIncomeOverrides: schema.recurringIncomeOverrides,
        statements: schema.statements,
        imports: schema.imports,
        contacts: schema.contacts,
        settlements: schema.settlements,
        manualBalances: schema.manualBalances,
        pensionEntries: schema.pensionEntries,
        pensionFunds: schema.pensionFunds,
        taxReturns: schema.taxReturns,
        settings: schema.settings,
      };
      // Rent notices without their PDFs (those are in the database file itself).
      const { pdf: _pdf, ...rentNoticeColumns } = getTableColumns(schema.rentNotices);
      const body = {
        exportedAt: new Date().toISOString(),
        ...Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, db.select().from(t).all()])),
        rentNotices: db.select(rentNoticeColumns).from(schema.rentNotices).all(),
      };
      c.header("Content-Disposition", `attachment; filename="privatekonomi-${stamp}.json"`);
      return c.json(body);
    }
    const accountName = new Map(db.select().from(schema.accounts).all().map((a) => [a.id, a.name]));
    const categoryPath = new Map([...getCategoryPathMap(db)].map(([p, id]) => [id, p.replace("/", " › ")]));
    const rows = db.select().from(schema.transactions).where(isNull(schema.transactions.deletedAt)).orderBy(asc(schema.transactions.bookingDate), asc(schema.transactions.id)).all();
    // A purchase split across categories gets one line per part, each with its
    // own category and amount, so a sum per category adds up in a spreadsheet.
    // 'Del' says which part it is ('1 av 2'), and is empty for a whole row.
    const splits = loadSplits(db);
    const header = ["Bokföringsdag", "Transaktionsdag", "Konto", "Beskrivning", "Etikett", "Kategori", "Belopp", "Valuta", "Delad", "Privat", "Anteckning", "Källa", "Del"];
    const lines = rows.flatMap((r) => {
      const parts = splits.get(r.id);
      const cells = (categoryId: number | null, amount: number, part: string) =>
        [
          r.bookingDate,
          r.transactionDate ?? "",
          r.accountId !== null ? (accountName.get(r.accountId) ?? "") : "",
          r.descriptionClean,
          r.label ?? "",
          r.isTransfer && categoryId === null ? "Överföring" : categoryId !== null ? (categoryPath.get(categoryId) ?? "") : "",
          kronor(amount),
          r.currency,
          r.shared ? "ja" : "",
          r.private ? "ja" : "",
          r.note ?? "",
          r.source,
          part,
        ]
          .map(csvCell)
          .join(";");
      return parts ? parts.map((p, i) => cells(p.categoryId, p.amount, `${i + 1} av ${parts.length}`)) : [cells(r.categoryId, r.amount, "")];
    });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="transaktioner-${stamp}.csv"`);
    return c.body(`﻿${[header.join(";"), ...lines].join("\r\n")}\r\n`);
  });

  return app;
}
