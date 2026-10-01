import { desc } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { imports } from "../db/schema.js";
import { importUndoStatus } from "./undoImport.js";

/** Imports per page, at least: a page always ends at a day's end, so a day is never split. */
export const HISTORY_PAGE = 20;

export type HistoryVia = "file" | "enable_banking";

/** The Swedish day an import was made: the history is grouped by it. */
export const swedishDay = (ts: string) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

/**
 * Importer's history, newest first, a page at a time: whole days (Swedish
 * time) until at least 20 imports, before `before` (a day) when given, only
 * files or only bank syncs when `via` says so. With 'Ångra' status, counted
 * for the page only. `older` tells what is left: from which day, and how many.
 */
export function importHistory(db: Db, opts: { before?: string; via?: HistoryVia; pageSize?: number } = {}) {
  const size = opts.pageSize ?? HISTORY_PAGE;
  const all = db
    .select()
    .from(imports)
    .orderBy(desc(imports.importedAt), desc(imports.id))
    .all()
    .map((i) => ({ ...i, day: swedishDay(i.importedAt) }))
    .filter((i) => (!opts.via || i.via === opts.via) && (!opts.before || i.day < opts.before));
  let end = Math.min(size, all.length);
  while (end < all.length && all[end].day === all[end - 1].day) end++;
  const page = all.slice(0, end);
  const rest = all.slice(end);
  return {
    imports: page.map(({ day: _day, ...i }) => {
      const s = importUndoStatus(db, i.id);
      return { ...i, undo: s.ok ? { ok: true as const, rows: s.rows, statement: s.statement } : { ok: false as const, reason: s.reason } };
    }),
    older: rest.length ? { before: page.at(-1)!.day, from: rest[0].day, count: rest.length } : null,
  };
}
