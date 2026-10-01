/**
 * Kontrollsiffror för en databas: what a move to another computer is checked with.
 *
 *   npm run db:check -- data/finance.db
 *   docker exec privatekonomi node_modules/.bin/tsx scripts/db-check.ts /data/finance.db
 *
 * Read only: the file is opened read-only with query_only on, so nothing can
 * be written even by mistake. The output is the same on the Mac and in the
 * container — no paths, no times, sorted — so the two can be compared with
 * diff. Exit code 1 when integrity_check isn't ok.
 */
import fs from "node:fs";
import Database from "better-sqlite3";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Ange databasfilen: npm run db:check -- <fil>");
  process.exit(2);
}

const db = new Database(file, { readonly: true, fileMustExist: true });
db.pragma("query_only = ON");
const one = <T>(q: string, ...params: unknown[]) => db.prepare(q).get(...params) as T;
const all = <T>(q: string, ...params: unknown[]) => db.prepare(q).all(...params) as T[];
const has = (table: string, column?: string) =>
  column
    ? all<{ name: string }>("select name from pragma_table_info(?)", table).some((c) => c.name === column)
    : !!one<{ n: number } | undefined>("select 1 as n from sqlite_master where type = 'table' and name = ?", table);

const out: string[] = [];

// Every table, by name.
const tables = all<{ name: string }>("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").map((t) => t.name);
for (const t of tables) out.push(`rader ${t} ${one<{ n: number }>(`select count(*) as n from "${t}"`).n}`);

// The money: transactions as they count, deleted and forgotten apart, per account.
if (has("transactions")) {
  const forgotten = has("transactions", "forgotten_at");
  const live = `deleted_at is null${forgotten ? " and forgotten_at is null" : ""}`;
  const t = one<{ n: number; sum: number }>(`select count(*) as n, coalesce(sum(amount), 0) as sum from transactions where ${live}`);
  out.push(`transaktioner aktiva ${t.n} summa_ore ${t.sum}`);
  const deleted = one<{ n: number; sum: number }>(`select count(*) as n, coalesce(sum(amount), 0) as sum from transactions where deleted_at is not null${forgotten ? " and forgotten_at is null" : ""}`);
  out.push(`transaktioner borttagna ${deleted.n} summa_ore ${deleted.sum}`);
  if (forgotten) out.push(`transaktioner glomda ${one<{ n: number }>("select count(*) as n from transactions where forgotten_at is not null").n}`);
  for (const a of all<{ account: number | null; n: number; sum: number }>(`select account_id as account, count(*) as n, coalesce(sum(amount), 0) as sum from transactions where ${live} group by account_id order by account_id`)) {
    out.push(`transaktioner konto ${a.account ?? "inget"} ${a.n} summa_ore ${a.sum}`);
  }
}
const sumOf = (label: string, table: string, column: string) => {
  if (has(table, column)) out.push(`summa ${label} ${one<{ s: number }>(`select coalesce(sum(${column}), 0) as s from "${table}"`).s}`);
};
sumOf("uppdelningar_ore", "transaction_splits", "amount");
sumOf("fasta_utgifter_ore", "recurring_expenses", "amount");
sumOf("kontosaldon_ore", "accounts", "balance");
sumOf("kvitton_ore", "receipts", "total_ore");
sumOf("prylar_ore", "items", "price_ore");
sumOf("affarer_andelar_e4", "trades", "quantity_e4");
sumOf("pension_ore", "pension_entries", "amount_ore");

const integrity = all<{ integrity_check: string }>("pragma integrity_check").map((r) => r.integrity_check);
out.push(`integrity_check ${integrity.join("; ")}`);
db.close();

console.log(out.join("\n"));
process.exit(integrity.length === 1 && integrity[0] === "ok" ? 0 : 1);
