import { describe, expect, it } from "vitest";
import { imports } from "../src/db/schema.js";
import { importHistory } from "../src/import/history.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Row = { id: number; filename: string; via: string; undo: { ok: boolean } };
type Page = { imports: Row[]; older: { before: string; from: string; count: number } | null };

/** Imports made at these instants (UTC), files and bank syncs. */
function withHistory() {
  const db = freshDb({ seeded: true });
  const add = (filename: string, importedAt: string, via: "file" | "enable_banking" = "file") =>
    db.insert(imports).values({ source: "swedbank", filename, importedAt, via }).run();
  add("a.csv", "2026-09-20T08:00:00Z");
  add("sync-1", "2026-09-21T04:00:00Z", "enable_banking");
  add("sync-2", "2026-09-21T10:00:00Z", "enable_banking");
  add("b.csv", "2026-09-22T12:00:00Z");
  add("sync-3", "2026-09-22T16:00:00Z", "enable_banking");
  // 00:30 on the 25th in Stockholm, though still the 24th in UTC.
  add("c.csv", "2026-09-24T22:30:00Z");
  return db;
}

describe("Importer's history, a page at a time", () => {
  it("whole days in Swedish time, newest first, until at least the page size", () => {
    const db = withHistory();
    const first = importHistory(db, { pageSize: 2 });
    // The 25th alone is one import; the 22nd has two, so the page takes both.
    expect(first.imports.map((i) => i.filename)).toEqual(["c.csv", "sync-3", "b.csv"]);
    expect(first.older).toEqual({ before: "2026-09-22", from: "2026-09-21", count: 3 });
    const second = importHistory(db, { pageSize: 2, before: first.older!.before });
    expect(second.imports.map((i) => i.filename)).toEqual(["sync-2", "sync-1"]);
    expect(second.older).toEqual({ before: "2026-09-21", from: "2026-09-20", count: 1 });
    expect(importHistory(db, { pageSize: 2, before: second.older!.before })).toMatchObject({ imports: [{ filename: "a.csv" }], older: null });
  });

  it("only files, or only bank syncs, with what is left counted the same way", () => {
    const db = withHistory();
    expect(importHistory(db, { via: "file", pageSize: 2 })).toMatchObject({
      imports: [{ filename: "c.csv" }, { filename: "b.csv" }],
      older: { from: "2026-09-20", count: 1 },
    });
    const syncs = importHistory(db, { via: "enable_banking" });
    expect(syncs.imports.map((i) => i.filename)).toEqual(["sync-3", "sync-2", "sync-1"]);
    expect(syncs.older).toBeNull();
  });

  it("is served at /api/imports with 'Ångra' status, and ignores what it doesn't know", async () => {
    const app = createApp(withHistory(), { databasePath: ":memory:" });
    const get = async (q: string) => (await (await app.request(`/api/imports${q}`)).json()) as Page;
    const all = await get("");
    expect(all.imports).toHaveLength(6);
    expect(all.imports.find((i) => i.filename === "sync-3")!.undo.ok).toBe(false);
    expect((await get("?via=file")).imports.map((i) => i.filename)).toEqual(["c.csv", "b.csv", "a.csv"]);
    expect((await get("?before=2026-09-22")).imports.map((i) => i.filename)).toEqual(["sync-2", "sync-1", "a.csv"]);
    expect((await get("?before=igår&via=allt")).imports).toHaveLength(6);
  });
});
