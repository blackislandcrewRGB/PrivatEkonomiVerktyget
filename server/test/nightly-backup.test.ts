import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { backupDatabase, KEEP_NIGHTLY_BACKUPS, KEEP_START_BACKUPS, PART_SUFFIX } from "../src/db/backup.js";
import { openDb, runMigrations } from "../src/db/client.js";
import {
  NIGHTLY_BACKUP_CRON,
  NIGHTLY_BACKUP_TIMEZONE,
  nightlyBackupProblem,
  nightlyBackupStatus,
  runNightlyBackup,
  scheduleNightlyBackup,
} from "../src/db/nightlyBackup.js";
import { buildOverview } from "../src/overview/overview.js";
import { setSetting } from "../src/settings.js";
import { freshDb } from "./helpers.js";

/**
 * Nattkopian: a checked, finished copy for restic every night, pruned by
 * itself, and a failure that shows in Att göra — not only in the log.
 */

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pk-natt-"));
  const file = path.join(dir, "finance.db");
  const db = openDb(file);
  runMigrations(db);
  return { dir, file, db };
}
const backups = (dir: string) => fs.readdirSync(path.join(dir, "backups")).filter((f) => f.endsWith(".db") || f.includes(".db")).sort();
const at = (day: number, hour = 3) => new Date(Date.UTC(2026, 8, day, hour, 45));

describe("the copy", () => {
  it("holds what is still in the WAL, stands alone and passes integrity_check", async () => {
    const { dir, file, db } = tempDb();
    // Written, not checkpointed: in finance.db-wal, not yet in finance.db.
    db.$client.prepare("insert into settings (key, value) values ('natt-prov', '\"ja\"')").run();
    expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0);

    const copy = (await backupDatabase(file, "natt", at(23)))!;
    expect(path.basename(copy)).toBe("finance-2026-09-23T03-45-00-natt.db");
    // Finished: renamed from .part, nothing of it left, no -wal of its own.
    expect(backups(dir)).toEqual(["finance-2026-09-23T03-45-00-natt.db"]);
    const read = new Database(copy, { readonly: true });
    expect(read.pragma("journal_mode", { simple: true })).toBe("delete");
    expect(read.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(read.prepare("select value from settings where key = 'natt-prov'").get()).toEqual({ value: '"ja"' });
    read.close();
    db.$client.close();
  });

  it("is never left behind half-made: a copy that fails the check is removed and the error thrown", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pk-natt-trasig-"));
    const file = path.join(dir, "finance.db");
    // A database with a damaged table page: it opens, but integrity_check finds it.
    const raw = new Database(file);
    raw.pragma("journal_mode = DELETE");
    raw.exec("create table t (id integer primary key, x text); create index t_x on t (x);");
    const insert = raw.prepare("insert into t (x) values (?)");
    for (let i = 0; i < 2000; i++) insert.run(`rad ${i} ${"x".repeat(40)}`);
    raw.close();
    const bytes = fs.readFileSync(file);
    const pageSize = bytes.readUInt16BE(16);
    bytes.fill(0x55, pageSize * 5 + 100, pageSize * 5 + 400);
    fs.writeFileSync(file, bytes);

    await expect(backupDatabase(file, "natt", at(23))).rejects.toThrow("Kopian klarade inte integrity_check");
    // Neither the finished name nor the .part: nothing for restic to take.
    expect(fs.readdirSync(path.join(dir, "backups")).filter((f) => f.includes(".db"))).toEqual([]);
  });

  it("is written as .part first, a name nothing lists or prunes", async () => {
    const { dir, file, db } = tempDb();
    // A .part left by a crash mid-copy is not a backup: pruning and the list pass it by.
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
    const stray = path.join(dir, "backups", `finance-2026-09-01T03-45-00-natt.db${PART_SUFFIX}`);
    fs.writeFileSync(stray, "halv");
    for (let d = 2; d <= 12; d++) await backupDatabase(file, "natt", at(d));
    expect(fs.existsSync(stray)).toBe(true);
    db.$client.close();
  });
});

describe("pruning", () => {
  it("keeps the newest seven nightly copies, and touches no other kind", async () => {
    const { dir, file, db } = tempDb();
    for (let d = 1; d <= KEEP_START_BACKUPS + 2; d++) await backupDatabase(file, "start", at(d, 8));
    await backupDatabase(file, "fore-migrering", at(1, 9));
    await backupDatabase(file, "fore-migrering", at(2, 9));
    await backupDatabase(file, "manuell", at(3, 10));
    for (let d = 1; d <= 10; d++) await backupDatabase(file, "natt", at(d));

    const kinds = (kind: string) => backups(dir).filter((f) => new RegExp(`-${kind}(-\\d+)?\\.db$`).test(f));
    expect(kinds("natt")).toHaveLength(KEEP_NIGHTLY_BACKUPS);
    expect(kinds("natt")[0]).toBe("finance-2026-09-04T03-45-00-natt.db");
    expect(kinds("start")).toHaveLength(KEEP_START_BACKUPS);
    expect(kinds("fore-migrering")).toHaveLength(2);
    expect(kinds("manuell")).toHaveLength(1);

    // And a start backup prunes starts only: the nightly ones stay.
    await backupDatabase(file, "start", at(20, 8));
    expect(kinds("natt")).toHaveLength(KEEP_NIGHTLY_BACKUPS);
    expect(kinds("fore-migrering")).toHaveLength(2);
    db.$client.close();
  });
});

describe("the nightly run", () => {
  it("records how it went, and keeps the last good one across a failure", async () => {
    const { file, db } = tempDb();
    const ok = await runNightlyBackup(db, file, at(22));
    expect(ok).toMatchObject({ ok: true, file: "finance-2026-09-22T03-45-00-natt.db" });
    expect(nightlyBackupStatus(db)).toEqual(ok);

    const failed = await runNightlyBackup(db, path.join(path.dirname(file), "saknas.db"), at(23));
    expect(failed).toMatchObject({ ok: false, error: "Databasen finns inte.", lastOkAt: ok.lastOkAt });
    expect(nightlyBackupStatus(db)).toEqual(failed);
    db.$client.close();
  });

  it("runs at 03:45 UTC, between the reboot at 03:00 and restic at 04:00, summer and winter", () => {
    expect(NIGHTLY_BACKUP_CRON).toBe("45 3 * * *");
    expect(NIGHTLY_BACKUP_TIMEZONE).toBe("UTC");
  });

  it("is scheduled in the real instance, never in the test instance", () => {
    const calls: [string, { timezone: string }][] = [];
    const schedule = (expression: string, _job: () => void, options: { timezone: string }) => calls.push([expression, options]);
    const db = freshDb();
    expect(scheduleNightlyBackup(schedule, db, "test", ":memory:")).toBe(false);
    expect(calls).toEqual([]);
    expect(scheduleNightlyBackup(schedule, db, "main", ":memory:")).toBe(true);
    expect(calls).toEqual([["45 3 * * *", { timezone: "UTC" }]]);
  });
});

describe("in Att göra", () => {
  const status = (db: ReturnType<typeof freshDb>, s: object) => setSetting(db, "nightly_backup", s);
  const now = new Date("2026-09-23T08:00:00Z");

  it("says nothing where the copy has never run: the test instance, a new database", () => {
    expect(nightlyBackupProblem(freshDb(), now)).toBeNull();
  });

  it("says nothing the morning after a copy that worked", () => {
    const db = freshDb();
    status(db, { at: "2026-09-23T03:45:02Z", ok: true, file: "x.db", lastOkAt: "2026-09-23T03:45:02Z" });
    expect(nightlyBackupProblem(db, now)).toBeNull();
  });

  it("says a copy failed, with the error", () => {
    const db = freshDb();
    status(db, { at: "2026-09-23T03:45:02Z", ok: false, error: "Kopian klarade inte integrity_check: …", lastOkAt: "2026-09-22T03:45:01Z" });
    expect(nightlyBackupProblem(db, now)).toEqual({
      id: "nightly_backup:failed:2026-09-23T03:45:02Z",
      text: "Nattkopian av databasen misslyckades 23/9: Kopian klarade inte integrity_check: …",
    });
  });

  it("says when no copy has been taken for two days: the job stopped running", () => {
    const db = freshDb();
    status(db, { at: "2026-09-21T03:45:02Z", ok: true, file: "x.db", lastOkAt: "2026-09-21T03:45:02Z" });
    expect(nightlyBackupProblem(db, now)).toEqual({ id: "nightly_backup:stale:2026-09-21T03:45:02Z", text: "Ingen nattkopia av databasen sedan 21/9" });
  });

  it("is a task of its own on the overview", () => {
    const db = freshDb({ seeded: true });
    status(db, { at: "2026-09-23T03:45:02Z", ok: false, error: "disken är full" });
    const task = buildOverview(db, "2026-09-23").tasks.find((t) => t.kind === "backup");
    expect(task).toMatchObject({ kind: "backup", text: "Nattkopian av databasen misslyckades 23/9: disken är full" });
  });
});
