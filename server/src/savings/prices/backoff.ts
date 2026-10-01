import type { Db } from "../../db/client.js";
import { getSetting, setSetting } from "../../settings.js";

/**
 * Efter en spärr: vänta, och vänta längre för varje gång.
 *
 * A source that answers 429 is not asking to be asked again in a minute — it
 * is saying the opposite. So a refusal pauses that source, and the pause
 * doubles every time it happens again: 30 minutes, an hour, two, four, and
 * never more than six. A single price that arrives pays the whole ladder off.
 *
 * Two rules decide the length:
 *
 * The source's own Retry-After wins when it is longer. It knows when it will
 * answer again and our schedule does not, so being told to wait a day means
 * waiting a day — uncapped, because calling before we were told to is the
 * behaviour that got us blocked in the first place.
 *
 * Nothing ever waits less than the ladder. A Retry-After of ten seconds is
 * still ten seconds, and asking that often is what a rate limit counts.
 *
 * The pause is per source, so Yahoo being blocked never stops the Riksbank
 * from answering — and it is stored, so it survives a restart. A backoff that
 * a dev-server reload forgets would keep asking every save.
 */

const KEY = "price_backoff";

/**
 * The first wait after a refusal, then doubling, then this ceiling: a little
 * under six hours, so the next six-hourly run finds the pause over instead of
 * missing it by the seconds the last run took (and asking every twelve).
 */
export const FIRST_WAIT_MS = 30 * 60_000;
export const MAX_WAIT_MS = 6 * 60 * 60_000 - 10 * 60_000;
/** However long a source asks for: two days at most, so a wrong date can't silence it for good. */
export const MAX_RETRY_AFTER_MS = 48 * 60 * 60_000;

interface Pause {
  /** Epoch milliseconds: nothing is asked of this source before then. */
  until: number;
  /** The ladder's own step, kept apart from a long Retry-After that overrode it. */
  stepMs: number;
}

type State = Record<string, Pause>;

const read = (db: Db): State => getSetting<State>(db, KEY, {});

/** How much longer a source is paused, or null when it may be asked. */
export function pausedForMs(db: Db, source: string, nowMs: number): number | null {
  const pause = read(db)[source];
  if (!pause || pause.until <= nowMs) return null;
  return pause.until - nowMs;
}

/** The next step of the ladder after `previous` (null the first time). */
export const nextStepMs = (previous: number | null): number => (previous === null ? FIRST_WAIT_MS : Math.min(previous * 2, MAX_WAIT_MS));

/**
 * A source refused. Pause it, and say for how long so the caller can log it.
 */
export function noteRefusal(db: Db, source: string, retryAfterMs: number | undefined, nowMs: number): number {
  const state = read(db);
  const stepMs = nextStepMs(state[source]?.stepMs ?? null);
  const waitMs = Math.max(stepMs, Math.min(retryAfterMs ?? 0, MAX_RETRY_AFTER_MS));
  setSetting(db, KEY, { ...state, [source]: { until: nowMs + waitMs, stepMs } });
  return waitMs;
}

/** A price arrived: the ladder starts over. */
export function clearPause(db: Db, source: string): void {
  const state = read(db);
  if (!(source in state)) return;
  const { [source]: _gone, ...rest } = state;
  setSetting(db, KEY, rest);
}

/** When each paused source may be asked again, for the interface to show. */
export function pauses(db: Db, nowMs: number): { source: string; until: string; waitMs: number }[] {
  return Object.entries(read(db))
    .filter(([, p]) => p.until > nowMs)
    .map(([source, p]) => ({ source, until: new Date(p.until).toISOString(), waitMs: p.until - nowMs }));
}

/** A wait as a Swedish sentence fragment: '30 minuter', '1 timme', '4 timmar'. */
export function humanWait(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return minutes === 1 ? "1 minut" : `${minutes} minuter`;
  // Whole hours from three on: the ceiling (5 h 50 min) reads '6 timmar'.
  const hours = minutes >= 180 ? Math.round(minutes / 60) : Math.round(minutes / 6) / 10;
  return hours === 1 ? "1 timme" : `${hours.toLocaleString("sv-SE")} timmar`;
}
