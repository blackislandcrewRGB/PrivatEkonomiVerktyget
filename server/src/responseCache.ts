import type { MiddlewareHandler } from "hono";
import type { Db } from "./db/client.js";
import { generation } from "./db/generation.js";
import { nightlyBackupHealth } from "./db/nightlyBackup.js";
import { todayLocal } from "./overview/dates.js";

/**
 * Where the heavy answers are worked out from the database and the date
 * alone: Översikt, the menu's review count, the digest, net worth, the cash
 * flow, Analys, Fasta utgifter, Lön and Sparande efter inflation. Their GETs are kept until the
 * database changes.
 */
export const CACHED_PATHS = [
  "/api/overview",
  "/api/review/counts",
  "/api/digest",
  "/api/networth",
  "/api/cashflow",
  "/api/analysis",
  "/api/recurring-expenses",
  "/api/salary",
  "/api/savings/real",
];

const MAX_ENTRIES = 100;
/** A refresh works out again at most this many answers, the most recently asked for first… */
const MAX_REFRESHED = 12;
/** …among those asked for within this long. */
const REFRESH_WITHIN_MS = 12 * 3_600_000;
/** The request a refresh sends itself: it works the answer out again and isn't someone using the tool. */
const REFRESH_HEADER = "X-Cache-Refresh";

type Fetch = (request: Request) => Response | Promise<Response>;

export interface ResponseCache {
  middleware: MiddlewareHandler;
  /**
   * Works out again the kept answers that no longer hold, the most recently
   * asked for first, stopping as soon as someone asks for something. Returns
   * how many it did.
   */
  refresh(fetch: Fetch): Promise<number>;
  /** Refreshes whenever the server has been left alone for `idleMs`, looking every `everyMs`. Returns a stop. */
  startRefreshing(fetch: Fetch, opts?: { everyMs?: number; idleMs?: number }): () => void;
}

/**
 * Keeps the answers to GETs under CACHED_PATHS, per address, until the
 * database's generation, the date or the nightly copy's state changes – the
 * only thing in them that follows the clock (a copy counts as missing after
 * 48 hours). The server answers one request at a time, so an answer of 1 s
 * held up every other request as well; a kept one takes a millisecond. With
 * startRefreshing, what a bank sync, a price fetch or an edit made stale is
 * worked out again while nobody is waiting.
 */
export function responseCache(db: Db, opts: { now?: () => number } = {}): ResponseCache {
  const now = opts.now ?? Date.now;
  const kept = new Map<string, { key: string; body: string; status: number; type: string; askedAt: number }>();
  let lastAsked = 0;
  const keyOf = () => `${generation(db)}|${todayLocal(new Date(now()))}|${JSON.stringify(nightlyBackupHealth(db, new Date(now())))}`;

  const middleware: MiddlewareHandler = async (c, next) => {
    const refreshing = c.req.header(REFRESH_HEADER) === "1";
    if (!refreshing) lastAsked = now();
    const path = c.req.path;
    if (c.req.method !== "GET" || !CACHED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return next();
    const url = c.req.url;
    const hit = kept.get(url);
    if (hit && !refreshing && hit.key === keyOf()) {
      hit.askedAt = now();
      return c.body(hit.body, hit.status as 200, { "Content-Type": hit.type, "X-Cache": "hit" });
    }
    await next();
    if (c.res.status !== 200) return;
    const body = await c.res.clone().text();
    // Taken after the answer: a GET that writes (a mark, a seed) is then kept as it left the database.
    kept.delete(url);
    kept.set(url, {
      key: keyOf(),
      body,
      status: c.res.status,
      type: c.res.headers.get("Content-Type") ?? "application/json",
      // A refresh isn't someone asking: it keeps the answer's place among the most recently asked for.
      askedAt: hit && refreshing ? hit.askedAt : now(),
    });
    if (kept.size > MAX_ENTRIES) kept.delete(kept.keys().next().value!);
  };

  const refresh = async (fetch: Fetch) => {
    const started = now();
    const current = keyOf();
    const stale = [...kept]
      .filter(([, e]) => e.key !== current && started - e.askedAt < REFRESH_WITHIN_MS)
      .sort((a, b) => b[1].askedAt - a[1].askedAt)
      .slice(0, MAX_REFRESHED);
    let done = 0;
    for (const [url] of stale) {
      // Someone asked for something meanwhile: leave the rest for the next quiet moment.
      if (lastAsked > started) break;
      await fetch(new Request(url, { headers: { [REFRESH_HEADER]: "1" } }));
      done++;
      // Let a request that came in during the work go first.
      await new Promise((r) => setTimeout(r, 0));
    }
    return done;
  };

  const startRefreshing = (fetch: Fetch, o: { everyMs?: number; idleMs?: number } = {}) => {
    const idleMs = o.idleMs ?? 3_000;
    let running = false;
    const timer = setInterval(() => {
      if (running || now() - lastAsked < idleMs) return;
      running = true;
      refresh(fetch)
        .catch((e) => console.error(`Sparade svar kunde inte räknas om: ${(e as Error).message}`))
        .finally(() => (running = false));
    }, o.everyMs ?? 30_000);
    timer.unref();
    return () => clearInterval(timer);
  };

  return { middleware, refresh, startRefreshing };
}
