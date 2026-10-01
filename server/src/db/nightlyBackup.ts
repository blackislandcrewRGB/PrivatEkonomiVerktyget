import path from "node:path";
import type { Db } from "./client.js";
import { backupDatabase } from "./backup.js";
import { getSetting, setSetting } from "../settings.js";

/**
 * Nattkopian: a checked, finished copy of the database every night, for
 * restic to take.
 *
 * Restic copies the files at 04:00 UTC, and the live database is in WAL mode:
 * a copy of it taken while the tool writes can be torn. The nightly copy is
 * taken with SQLite's backup, checked, and only then given its name (see
 * backupDatabase), so the file restic finds is whole.
 *
 * The time is in UTC on purpose, unlike every other job: it belongs to the
 * server's own schedule, which is UTC. 03:45 is after the automatic reboot at
 * 03:00 and before restic at 04:00, summer and winter alike.
 */
export const NIGHTLY_BACKUP_CRON = "45 3 * * *";
export const NIGHTLY_BACKUP_TIMEZONE = "UTC";

const KEY = "nightly_backup";
/** A night can be missed (the machine was off); two in a row is something to see. */
export const NIGHTLY_BACKUP_STALE_HOURS = 48;

export interface NightlyBackupStatus {
  /** When the last run ended, an ISO instant. */
  at: string;
  ok: boolean;
  /** The copy's file name, when it worked. */
  file?: string;
  error?: string;
  /** The last run that worked, kept across failures. */
  lastOkAt?: string;
}

export function nightlyBackupStatus(db: Db): NightlyBackupStatus | null {
  return getSetting<NightlyBackupStatus | null>(db, KEY, null);
}

/** Takes the copy and records how it went. Never throws: a failure is recorded and returned. */
export async function runNightlyBackup(db: Db, dbFile: string, now = new Date()): Promise<NightlyBackupStatus> {
  const before = nightlyBackupStatus(db);
  let status: NightlyBackupStatus;
  try {
    const file = await backupDatabase(dbFile, "natt", now);
    if (!file) throw new Error("Databasen finns inte.");
    status = { at: new Date().toISOString(), ok: true, file: path.basename(file), lastOkAt: new Date().toISOString() };
  } catch (e) {
    status = { at: new Date().toISOString(), ok: false, error: (e as Error).message, ...(before?.lastOkAt ? { lastOkAt: before.lastOkAt } : {}) };
  }
  try {
    setSetting(db, KEY, status);
  } catch (e) {
    // The database itself may be what failed; the log still has it.
    console.error(`Nattkopians status gick inte att spara: ${(e as Error).message}`);
  }
  return status;
}

export type NightlyBackupHealth = { problem: "failed"; at: string; error: string } | { problem: "stale"; since: string } | null;

/**
 * What is wrong with the nightly copy, if anything: the last run failed, or
 * none has worked for 48 hours (the job stopped running). Att göra and the
 * heartbeat to Uptime Kuma both ask this, so they never disagree. Nothing is
 * wrong where the copy has never run (the test instance, a new database).
 */
export function nightlyBackupHealth(db: Db, now = new Date()): NightlyBackupHealth {
  const status = nightlyBackupStatus(db);
  if (!status) return null;
  if (!status.ok) return { problem: "failed", at: status.at, error: status.error ?? "okänt fel" };
  const last = status.lastOkAt ?? status.at;
  if (now.getTime() - Date.parse(last) > NIGHTLY_BACKUP_STALE_HOURS * 3_600_000) return { problem: "stale", since: last };
  return null;
}

/** A day as '23/9', Swedish time. */
export const dayOf = (iso: string) => new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "numeric", timeZone: "Europe/Stockholm" }).format(new Date(iso));

/** 'Something is wrong with the nightly copy', for Att göra. */
export function nightlyBackupProblem(db: Db, now = new Date()): { id: string; text: string } | null {
  const health = nightlyBackupHealth(db, now);
  if (!health) return null;
  if (health.problem === "failed") return { id: `nightly_backup:failed:${health.at}`, text: `Nattkopian av databasen misslyckades ${dayOf(health.at)}: ${health.error}` };
  return { id: `nightly_backup:stale:${health.since}`, text: `Ingen nattkopia av databasen sedan ${dayOf(health.since)}` };
}

type Schedule = (expression: string, job: () => void, options: { timezone: string }) => unknown;

/**
 * Schedules the nightly copy, in the real instance only: the test instance's
 * database is a copy nobody restores, and its copies would only fill its
 * folder. Returns whether it was scheduled.
 */
export function scheduleNightlyBackup(schedule: Schedule, db: Db, instance: "main" | "test", dbFile: string): boolean {
  if (instance !== "main") return false;
  schedule(
    NIGHTLY_BACKUP_CRON,
    () => {
      runNightlyBackup(db, dbFile).then((r) => (r.ok ? console.log(`Nattkopia: ${r.file}`) : console.error(`Nattkopian misslyckades: ${r.error}`)));
    },
    { timezone: NIGHTLY_BACKUP_TIMEZONE },
  );
  return true;
}
