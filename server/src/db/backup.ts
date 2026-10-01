import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { backupIcons } from "../icons/upload.js";

/** Start backups kept; older ones are removed. Backups taken before a migration are always kept. */
export const KEEP_START_BACKUPS = 14;
/** Nightly backups kept (the copy restic takes each night; restic keeps its own history). */
export const KEEP_NIGHTLY_BACKUPS = 7;

export type BackupKind = "start" | "fore-migrering" | "manuell" | "natt";

/** How many of a kind are kept. A kind not here is never removed. */
const KEEP: Partial<Record<BackupKind, number>> = { start: KEEP_START_BACKUPS, natt: KEEP_NIGHTLY_BACKUPS };

/** The copy being written, until it has been checked: never a name the backups list or pruning counts. */
export const PART_SUFFIX = ".part";

const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/:/g, "-");

/** The backups folder next to the database: data/backups for data/finance.db. */
export function backupDir(dbFile: string): string {
  return path.join(path.dirname(dbFile), "backups");
}

/**
 * Copies the database with SQLite's online backup (consistent even while in
 * use) to backups/<name>-<UTC time>-<kind>.db. Returns the path, or null when
 * there is nothing to back up (a database that doesn't exist yet).
 *
 * The copy is written as <name>.db.part, checked with integrity_check and
 * made a single file (journal_mode DELETE, no -wal beside it), and only then
 * renamed: whatever reads the folder — restic at night, the list in
 * Inställningar — sees a finished copy or none. A copy that fails the check
 * is removed and the error thrown.
 */
export async function backupDatabase(dbFile: string, kind: BackupKind, now = new Date()): Promise<string | null> {
  if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) return null;
  const dir = backupDir(dbFile);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(dbFile, path.extname(dbFile));
  let target = path.join(dir, `${base}-${stamp(now)}-${kind}.db`);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${base}-${stamp(now)}-${kind}-${n}.db`);
  const part = `${target}${PART_SUFFIX}`;
  try {
    const source = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      await source.backup(part);
    } finally {
      source.close();
    }
    checkCopy(part);
    fs.renameSync(part, target);
  } catch (e) {
    for (const f of [part, `${part}-wal`, `${part}-shm`, `${part}-journal`]) fs.rmSync(f, { force: true });
    throw e;
  }
  const keep = KEEP[kind];
  if (keep !== undefined) pruneBackups(dbFile, kind, keep);
  // The merchant icons live next to the database; the backup keeps every one it has seen.
  backupIcons(path.join(path.dirname(dbFile), "icons"), dir);
  return target;
}

/**
 * The copy is whole and stands on its own: integrity_check says ok, and it
 * keeps no -wal of its own (the source's WAL mode is in the copied header).
 */
function checkCopy(file: string) {
  const copy = new Database(file, { fileMustExist: true });
  try {
    const rows = copy.pragma("integrity_check") as { integrity_check: string }[];
    const result = rows.map((r) => r.integrity_check);
    if (result.length !== 1 || result[0] !== "ok") throw new Error(`Kopian klarade inte integrity_check: ${result.slice(0, 3).join("; ")}`);
    copy.pragma("journal_mode = DELETE");
  } finally {
    copy.close();
  }
}

/** Removes all but the newest KEEP_START_BACKUPS start backups of this database. */
export function pruneStartBackups(dbFile: string, keep = KEEP_START_BACKUPS): string[] {
  return pruneBackups(dbFile, "start", keep);
}

/**
 * Removes all but the newest `keep` backups of one kind. Only names of exactly
 * that kind are touched: a start backup never removes a nightly one, and a
 * backup taken before a migration is never a kind anything prunes.
 */
export function pruneBackups(dbFile: string, kind: BackupKind, keep: number): string[] {
  const dir = backupDir(dbFile);
  if (!fs.existsSync(dir)) return [];
  const base = path.basename(dbFile, path.extname(dbFile));
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-${kind}(-\\d+)?\\.db$`);
  const matching = fs
    .readdirSync(dir)
    .filter((f) => pattern.test(f))
    .sort(); // the UTC stamp sorts oldest first
  const remove = matching.slice(0, Math.max(0, matching.length - keep));
  for (const f of remove) fs.rmSync(path.join(dir, f));
  return remove;
}

/**
 * Whether opening this database would run migrations: SQL migrations not yet
 * applied (drizzle's journal against __drizzle_migrations), or code-based data
 * migrations not yet recorded.
 */
export function hasPendingMigrations(dbFile: string, migrationsDir: string, dataMigrationNames: string[]): boolean {
  if (!fs.existsSync(dbFile)) return false;
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8")) as { entries: unknown[] };
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const has = (table: string) => !!db.prepare("select 1 from sqlite_master where type='table' and name=?").get(table);
    if (!has("__drizzle_migrations")) return has("transactions") || journal.entries.length > 0;
    const applied = (db.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number }).n;
    if (applied < journal.entries.length) return true;
    if (!has("data_migrations")) return dataMigrationNames.length > 0;
    const done = new Set((db.prepare("select name from data_migrations").all() as { name: string }[]).map((r) => r.name));
    return dataMigrationNames.some((n) => !done.has(n));
  } finally {
    db.close();
  }
}
