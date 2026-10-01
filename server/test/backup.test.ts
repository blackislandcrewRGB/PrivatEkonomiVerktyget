import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDb, runMigrations } from "../src/db/client.js";
import { backupDatabase, hasPendingMigrations, KEEP_START_BACKUPS } from "../src/db/backup.js";
import { DATA_MIGRATION_NAMES } from "../src/db/dataMigrations.js";
import { config } from "../src/config.js";

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pk-backup-"));
  const file = path.join(dir, "finance.db");
  const db = openDb(file);
  runMigrations(db);
  db.$client.close();
  return { dir, file };
}

describe("automatic backups", () => {
  it("copies the database into backups/ with the time in the name, keeping the newest 14 start backups", async () => {
    const { dir, file } = tempDb();
    for (let i = 0; i < KEEP_START_BACKUPS + 3; i++) await backupDatabase(file, "start", new Date(Date.UTC(2026, 8, 1 + i, 8)));
    await backupDatabase(file, "fore-migrering", new Date(Date.UTC(2026, 7, 1, 8)));
    const files = fs.readdirSync(path.join(dir, "backups")).sort();
    const starts = files.filter((f) => f.endsWith("-start.db"));
    expect(starts).toHaveLength(KEEP_START_BACKUPS);
    expect(starts[0]).toBe("finance-2026-09-04T08-00-00-start.db");
    expect(files).toContain("finance-2026-08-01T08-00-00-fore-migrering.db");
    // A real, readable copy.
    const copy = new Database(path.join(dir, "backups", starts.at(-1)!), { readonly: true });
    expect((copy.prepare("select count(*) as n from sqlite_master where name = 'transactions'").get() as { n: number }).n).toBe(1);
    copy.close();
  });

  it("doesn't overwrite a backup taken the same second", async () => {
    const { dir, file } = tempDb();
    const at = new Date(Date.UTC(2026, 8, 18, 12));
    await backupDatabase(file, "start", at);
    await backupDatabase(file, "start", at);
    expect(fs.readdirSync(path.join(dir, "backups")).sort()).toEqual(["finance-2026-09-18T12-00-00-start-2.db", "finance-2026-09-18T12-00-00-start.db"]);
  });

  it("does nothing for a database that doesn't exist yet", async () => {
    expect(await backupDatabase(path.join(os.tmpdir(), "does-not-exist.db"), "start")).toBeNull();
  });

  it("knows when migrations are pending", () => {
    const { file } = tempDb();
    expect(hasPendingMigrations(file, config.migrationsDir, DATA_MIGRATION_NAMES)).toBe(false);
    const raw = new Database(file);
    raw.prepare("delete from data_migrations where name = ?").run(DATA_MIGRATION_NAMES.at(-1));
    raw.close();
    expect(hasPendingMigrations(file, config.migrationsDir, DATA_MIGRATION_NAMES)).toBe(true);
    const raw2 = new Database(file);
    raw2.prepare("delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations)").run();
    raw2.close();
    expect(hasPendingMigrations(file, config.migrationsDir, [])).toBe(true);
  });
});
