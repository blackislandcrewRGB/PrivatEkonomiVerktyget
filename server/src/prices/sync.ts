import type { Db } from "../db/client.js";
import { addDays, addMonths, monthOf, todayLocal } from "../overview/dates.js";
import { clearPause, humanWait, noteRefusal, pausedForMs } from "../savings/prices/backoff.js";
import { PriceError, type IndexProvider, type IndexSchedule } from "./provider.js";
import { ensureSeries, latestPoint, mondayOf, putPoints } from "./series.js";

/**
 * Att hämta index och rikssnitt.
 *
 * Three rules, and the whole file is them:
 *
 * **Ask only when there can be something new.** These sources publish once a
 * month or once a week. A tool that asked every six hours would be asking the
 * same question eighty times for one answer, which is how a public API gets
 * closed to people like us.
 *
 * **A refusal is answered by waiting**, on the same ladder as the quote
 * sources and out of the same stored state: 30 minutes, an hour, two, four,
 * six, and a successful fetch pays it all off. The pause is per source, so a
 * quiet SCB never silences anything else.
 *
 * **The whole history the first time, a short overlap after that.** Published
 * statistics are revised, so the last couple of periods are asked for again
 * every time; a revision replaces the period it belongs to, and nothing else
 * moves.
 */

/** Periods asked for again every time, so a revision at the source lands. */
export const OVERLAP_PERIODS = 2;

export interface SourceOutcome {
  source: string;
  ok: boolean;
  /** Set when nothing was asked, and says why in Swedish. */
  skipped?: string;
  error?: string;
  added: number;
  revised: number;
  unchanged: number;
  /** When the source itself says it last published. */
  publishedAt?: string | null;
}

export interface IndexSyncResult {
  at: string;
  sources: SourceOutcome[];
}

export interface IndexSyncOptions {
  today?: string;
  now?: Date;
  log?: (message: string) => void;
  /** Hämta nu: ask even when nothing new is expected. A pause still holds. */
  force?: boolean;
}

/**
 * The newest period a source can be expected to have published by `today`.
 *
 * Monthly: the previous month once the publishing day has passed, the one
 * before it until then — SCB publishes August in mid-September. Weekly: the
 * Monday of the week that ended long enough ago for the figures to be out.
 */
export function expectedPeriod(schedule: IndexSchedule, today: string): string {
  if (schedule.frequency === "monthly") {
    const published = Number(today.slice(8, 10)) >= (schedule.publishDay ?? 15);
    return `${addMonths(monthOf(today), published ? -1 : -2)}-01`;
  }
  return mondayOf(addDays(today, -(schedule.publishLagDays ?? 7)));
}

/** One period back, for whichever rhythm the source keeps. */
const previousPeriod = (schedule: IndexSchedule, date: string, n: number): string =>
  schedule.frequency === "monthly" ? `${addMonths(date.slice(0, 7), -n)}-01` : addDays(date, -7 * n);

export interface Plan {
  /** The first period to ask for, or null when there is nothing to ask. */
  from: string | null;
  why: string;
}

/**
 * Whether to ask a source today, and from when.
 *
 * The first run takes the whole history from the schedule's own start. After
 * that it asks from a couple of periods back — far enough for a revision,
 * short enough that a monthly job stays a monthly job. A source whose newest
 * stored period is already the one expected is left alone, and the sentence
 * says so rather than leaving a silent skip.
 */
export function plan(db: Db, provider: IndexProvider, today: string, force = false): Plan {
  const stored = provider.series.map((def) => latestPoint(db, ensureSeries(db, def))?.date ?? null);
  if (stored.some((d) => d === null)) return { from: provider.schedule.from, why: "första hämtningen: hela historiken" };

  const oldest = stored.reduce((a, b) => (a! < b! ? a : b))!;
  const expected = expectedPeriod(provider.schedule, today);
  const behind = oldest < expected;
  if (!behind && !force) return { from: null, why: `inget nytt publicerat sedan ${oldest}` };
  return {
    from: previousPeriod(provider.schedule, oldest, OVERLAP_PERIODS),
    why: behind ? `saknar perioder efter ${oldest}` : "hämtat på begäran",
  };
}

/**
 * Fetches what is due, from every source handed in.
 *
 * Each source is caught on its own: one that has gone quiet costs the others
 * nothing. The result always says what happened per source, including the
 * ones that were deliberately left alone.
 */
export async function syncIndexes(db: Db, providers: IndexProvider[], opts: IndexSyncOptions = {}): Promise<IndexSyncResult> {
  const now = opts.now ?? new Date();
  const today = opts.today ?? todayLocal(now);
  const log = opts.log ?? ((m: string) => console.log(m));
  const sources: SourceOutcome[] = [];

  for (const provider of providers) {
    const empty = { source: provider.name, added: 0, revised: 0, unchanged: 0 };
    const pausedMs = pausedForMs(db, provider.name, now.getTime());
    if (pausedMs !== null) {
      sources.push({ ...empty, ok: false, skipped: `${provider.name} är pausad efter en spärr — nästa försök om ${humanWait(pausedMs)}.` });
      continue;
    }

    const { from, why } = plan(db, provider, today, opts.force);
    if (from === null) {
      sources.push({ ...empty, ok: true, skipped: why });
      continue;
    }

    try {
      const fetched = await provider.fetch(from, today);
      const totals = { added: 0, revised: 0, unchanged: 0 };
      for (const s of fetched.series) {
        const series = ensureSeries(db, s.def);
        const r = putPoints(db, series, s.points, now.toISOString());
        totals.added += r.added;
        totals.revised += r.revised;
        totals.unchanged += r.unchanged;
      }
      clearPause(db, provider.name);
      sources.push({ source: provider.name, ok: true, ...totals, publishedAt: fetched.publishedAt });
      log(`${provider.name}: ${totals.added} nya perioder, ${totals.revised} reviderade (${why}).`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (e instanceof PriceError && e.status === 429) {
        const waitMs = noteRefusal(db, provider.name, e.retryAfterMs, now.getTime());
        log(`Priskällan ${provider.name} spärrade (429). Väntar ${humanWait(waitMs)} — nästa försök ${new Date(now.getTime() + waitMs).toISOString()}.`);
      } else {
        log(`Priskällan ${provider.name} svarade inte som väntat: ${error}`);
      }
      sources.push({ ...empty, ok: false, error });
    }
  }
  return { at: now.toISOString(), sources };
}
