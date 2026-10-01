import { describe, expect, it } from "vitest";
import { eq, isNotNull, sql } from "drizzle-orm";
import { imports, transactions } from "../src/db/schema.js";
import { importFiles } from "../src/import/importBatch.js";
import { importUndoStatus, undoImport } from "../src/import/undoImport.js";
import { createApp } from "../src/app.js";
import { allSwedbankFiles, freshDb } from "./helpers.js";

const count = (db: ReturnType<typeof freshDb>) => db.select({ n: sql<number>`count(*)` }).from(transactions).get()!.n;

describe("undoing an import", () => {
  it("removes its rows for real, so the same file can be imported again", async () => {
    const db = freshDb({ seeded: true });
    await importFiles(db, allSwedbankFiles());
    const before = count(db);
    const list = db.select().from(imports).all();
    const last = list.at(-1)!;
    const status = importUndoStatus(db, last.id);
    expect(status).toMatchObject({ ok: true, rows: last.rowsNew, statement: false });

    const app = createApp(db, { databasePath: ":memory:" });
    const history = (await (await app.request("/api/imports")).json()) as { imports: { id: number; undo: { ok: boolean } }[] };
    expect(history.imports.find((h) => h.id === last.id)!.undo.ok).toBe(true);

    expect(await (await app.request(`/api/imports/${last.id}`, { method: "DELETE" })).json()).toEqual({ removed: last.rowsNew });
    expect(count(db)).toBe(before - last.rowsNew);
    expect(db.select().from(imports).where(eq(imports.id, last.id)).get()).toBeUndefined();
    // Transfers to rows that are gone aren't left pointing at them.
    const dangling = db.$client.prepare("select count(*) as n from transactions t where t.transfer_pair_id is not null and not exists (select 1 from transactions p where p.id = t.transfer_pair_id)").get() as { n: number };
    expect(dangling.n).toBe(0);

    const file = allSwedbankFiles().find((f) => f.name === last.filename)!;
    const again = await importFiles(db, [file]);
    expect(again.files[0]).toMatchObject({ ok: true });
    expect(count(db)).toBe(before);
  });

  it("is refused after a later import to the same account, and after a row was changed by hand", async () => {
    const db = freshDb({ seeded: true });
    await importFiles(db, allSwedbankFiles());
    const all = db.select().from(imports).all();
    const accountsOf = (id: number) => new Set(db.select({ a: transactions.accountId }).from(transactions).where(eq(transactions.importId, id)).all().map((r) => r.a));
    // An earlier file whose account a later file also has rows on.
    const first = all.find((i) => all.some((l) => l.id > i.id && [...accountsOf(l.id)].some((a) => accountsOf(i.id).has(a))))!;
    expect(importUndoStatus(db, first.id)).toEqual({ ok: false, reason: "En senare import från samma bank har rört samma konto." });
    expect(() => undoImport(db, first.id)).toThrow(/senare import/);

    const second = db.select().from(imports).all().at(-1)!;
    const row = db.select().from(transactions).where(eq(transactions.importId, second.id)).get()!;
    db.update(transactions).set({ manuallyEditedAt: "2026-09-19T00:00:00Z" }).where(eq(transactions.id, row.id)).run();
    expect(importUndoStatus(db, second.id)).toEqual({ ok: false, reason: "1 rad har ändrats för hand sedan importen." });
    expect(db.select().from(transactions).where(isNotNull(transactions.manuallyEditedAt)).all()).toHaveLength(1);
  });
});
