import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { config } from "../config.js";
import { runDataMigrations } from "./dataMigrations.js";
import { syncReferenceBudgets, type ReferenceBudgetSync } from "../referenceBudget/load.js";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Opens (and creates if needed) a database. Use ':memory:' in tests. */
export function openDb(file: string = config.databasePath): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema }) as Db;
}

/**
 * The schema, the data migrations, and then Konsumentverkets referensbudget
 * from its year files — reference data that lives in the repository, so a
 * new or corrected year arrives with a restart. Returns what that last step
 * did, for the caller to log.
 */
export function runMigrations(db: Db): ReferenceBudgetSync {
  migrate(db, { migrationsFolder: config.migrationsDir });
  runDataMigrations(db);
  return syncReferenceBudgets(db);
}

/** The reference budget's sync as log lines: nothing when nothing happened. */
export function referenceBudgetLog(r: ReferenceBudgetSync): string[] {
  return [
    ...r.loaded.map((l) => `Referensbudget ${l.year}: ${l.replaced ? "filen har ändrats, året är ersatt" : "inläst"}`),
    ...r.errors.map((e) => `Referensbudget: kunde inte läsas, ${e}`),
    ...r.withoutFile.map((y) => `Referensbudget ${y}: finns i databasen men har ingen fil i server/reference-budget/ (lämnas orört)`),
  ];
}
