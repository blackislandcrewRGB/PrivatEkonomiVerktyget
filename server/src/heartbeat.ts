import { sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { settings } from "./db/schema.js";
import { dayOf, nightlyBackupHealth, nightlyBackupStatus, NIGHTLY_BACKUP_STALE_HOURS } from "./db/nightlyBackup.js";

/**
 * Hjärtslaget till Uptime Kuma: a push every five minutes saying how the
 * tool is.
 *
 * Kuma alarms when the pushes stop (the app is down) and when one says down.
 * Down is sent on every beat for as long as something is wrong, and up only
 * once it is all right again: Kuma alarms once at the change and once when it
 * is solved, instead of flapping every five minutes. Down when
 *   - the database doesn't answer,
 *   - the last nightly copy failed,
 *   - no nightly copy has worked for 48 hours (or none has run in 48 hours
 *     since the start, so a job that never runs is noticed too).
 *
 * The push URL carries Kuma's token: it is a secret, from .env only, and never
 * written to the log — not even in an error. A Kuma that can't be reached
 * never stops the tool, and the log gets one line when the state changes,
 * not one per beat.
 */

export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;
const MAX_MESSAGE = 200;

export interface Report {
  status: "up" | "down";
  message: string;
}

/** How the tool is right now. */
export function healthReport(db: Db, now: Date, startedAt: Date): Report {
  let health: ReturnType<typeof nightlyBackupHealth>;
  let neverRun: boolean;
  try {
    db.select({ n: sql<number>`count(*)` }).from(settings).get();
    health = nightlyBackupHealth(db, now);
    neverRun = nightlyBackupStatus(db) === null;
  } catch (e) {
    return cap({ status: "down", message: `databasen svarar inte: ${(e as Error).message}` });
  }
  const problems: string[] = [];
  if (health?.problem === "failed") problems.push(`nattkopia misslyckad ${dayOf(health.at)}: ${health.error}`);
  if (health?.problem === "stale") problems.push(`ingen lyckad nattkopia sedan ${dayOf(health.since)}`);
  // Never run at all: fine for a while after a start, not for two days.
  if (neverRun && now.getTime() - startedAt.getTime() > NIGHTLY_BACKUP_STALE_HOURS * 3_600_000) {
    problems.push(`ingen nattkopia sedan start ${dayOf(startedAt.toISOString())}`);
  }
  return problems.length ? cap({ status: "down", message: problems.join("; ") }) : { status: "up", message: "OK" };
}

const cap = (r: Report): Report => (r.message.length > MAX_MESSAGE ? { ...r, message: `${r.message.slice(0, MAX_MESSAGE - 1)}…` } : r);

/** Kuma's push address with this beat's status and message; whatever query the pasted URL had is replaced. */
export function pushUrl(base: string, report: Report): string {
  const url = new URL(base);
  url.search = "";
  url.searchParams.set("status", report.status);
  url.searchParams.set("msg", report.message);
  url.searchParams.set("ping", "");
  return url.toString();
}

/** What went wrong reaching Kuma, without the address (it holds the token). */
function reason(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } };
  if (err.name === "TimeoutError" || err.name === "AbortError") return "svarade inte inom 10 s";
  if (err.cause?.code) return err.cause.code;
  return err.name || "okänt fel";
}

export interface HeartbeatDeps {
  db: Db;
  url: string;
  startedAt: Date;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (line: string) => void;
}

/**
 * One heartbeat, and the memory of the last: logs only when the reported state
 * or Kuma's reachability changes. Never throws.
 */
export function createHeartbeat(deps: HeartbeatDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.log(line));
  let lastReport: string | null = null;
  let kumaDown = false;
  let running = false;

  return async function beat(): Promise<Report | null> {
    if (running) return null;
    running = true;
    try {
      const report = healthReport(deps.db, now(), deps.startedAt);
      const key = `${report.status}|${report.message}`;
      if (key !== lastReport) {
        log(report.status === "up" ? "Hjärtslag till Kuma: up" : `Hjärtslag till Kuma: down – ${report.message}`);
        lastReport = key;
      }
      try {
        const res = await doFetch(pushUrl(deps.url, report), { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw Object.assign(new Error(), { name: `HTTP ${res.status}` });
        if (kumaDown) log("Uptime Kuma nås igen.");
        kumaDown = false;
      } catch (e) {
        if (!kumaDown) log(`Uptime Kuma nås inte (${reason(e)}). Försöker igen var femte minut, och loggar när den svarar.`);
        kumaDown = true;
      }
      return report;
    } catch (e) {
      // Nothing in here may stop the tool.
      log(`Hjärtslaget misslyckades: ${(e as Error).name}`);
      return null;
    } finally {
      running = false;
    }
  };
}

/**
 * Starts the heartbeat in the real instance, and only when KUMA_PUSH_URL is
 * set; never in the test instance. Returns whether it started. A URL that
 * isn't one is said once (without its value) and nothing is sent.
 */
export function startHeartbeat(instance: "main" | "test", url: string, deps: Omit<HeartbeatDeps, "url">, every = HEARTBEAT_INTERVAL_MS): (() => void) | null {
  if (instance !== "main" || !url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    (deps.log ?? console.error)("KUMA_PUSH_URL är ingen giltig adress. Inget hjärtslag skickas.");
    return null;
  }
  const beat = createHeartbeat({ ...deps, url });
  void beat();
  const timer = setInterval(() => void beat(), every);
  timer.unref();
  return () => clearInterval(timer);
}
