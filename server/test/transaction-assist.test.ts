import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, merchantCategoryMap, merchantRules, transactions } from "../src/db/schema.js";
import { getCategoryKeyMap, getCategoryPathMap } from "../src/db/seed.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
type App = ReturnType<typeof createApp>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});
const get = async <T = any>(app: App, path: string) => (await (await app.request(`/api${path}`)).json()) as T;
const post = async <T = any>(app: App, path: string, body: unknown) => (await (await app.request(`/api${path}`, json("POST", body))).json()) as T;

let seq = 0;
function tx(
  db: Db,
  o: { desc: string; amount?: number; category?: string | null; date?: string; merchantCategory?: string; source?: "swedbank" | "manual"; private?: boolean },
) {
  const date = o.date ?? "2026-09-10";
  const cat = o.category ? getCategoryPathMap(db).get(o.category)! : null;
  return db
    .insert(transactions)
    .values({
      source: o.source ?? "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      counterparty: o.desc,
      amount: o.amount ?? -10000,
      categoryId: cat,
      categorySource: cat ? "rule" : "none",
      merchantCategory: o.merchantCategory ?? null,
      private: o.private ?? false,
      fingerprint: `a${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  return { db, app: createApp(db, { databasePath: ":memory:" }), path: (p: string) => getCategoryPathMap(db).get(p)! };
}

describe("category suggestions for the picker", () => {
  it("puts the matching rule first, then Norwegian's merchant category, then what the merchant got before", async () => {
    const { db, app, path } = setup();
    db.insert(merchantCategoryMap).values({ key: "TEST FOOD PLACES", label: "TEST FOOD PLACES", categoryId: path("Mat/Restaurang & café") }).run();
    db.insert(merchantRules).values({ pattern: "CAFE EXEMPEL AB", matchType: "contains", categoryId: path("Mat/Alkohol") }).run();
    tx(db, { desc: "CAFE EXEMPEL AB", category: "Nöje/Spel" });
    tx(db, { desc: "CAFE EXEMPEL AB", category: "Nöje/Spel" });
    tx(db, { desc: "CAFE EXEMPEL AB", category: "Resor/Taxi" });
    tx(db, { desc: "CAFE EXEMPEL AB", category: "Resor/Taxi", amount: 5000 }); // money in: other direction
    tx(db, { desc: "CAFE EXEMPEL AB", category: "Övrigt/Okänt" }); // never suggested
    const row = tx(db, { desc: "CAFE EXEMPEL AB", merchantCategory: "Test Food Places" });

    const s = await get(app, `/transactions/category-suggestions?ids=${row.id}`);
    expect(s.map((x: { categoryId: number }) => x.categoryId)).toEqual([
      path("Mat/Alkohol"),
      path("Mat/Restaurang & café"),
      path("Nöje/Spel"),
      path("Resor/Taxi"),
    ]);
    expect(s[0]).toMatchObject({ reason: "rule", detail: "Regel: CAFE EXEMPEL AB" });
    expect(s[1]).toMatchObject({ reason: "merchant_category" });
    expect(s[2]).toMatchObject({ reason: "history", detail: "2 gånger tidigare" });
    expect(s[3]).toMatchObject({ reason: "history", detail: "1 gång tidigare" });
  });

  it("pools the reasons for several rows", async () => {
    const { db, app, path } = setup();
    const a = tx(db, { desc: "LIDL 123" });
    const b = tx(db, { desc: "LIDL 456" });
    const c = tx(db, { desc: "OKLAR BUTIK" });
    const s = await get(app, `/transactions/category-suggestions?ids=${a.id},${b.id},${c.id}`);
    expect(s[0]).toMatchObject({ categoryId: path("Mat/Livsmedel"), reason: "rule", rows: 2 });
    expect(await get(app, "/transactions/category-suggestions?ids=")).toEqual([]);
  });
});

describe("list filters added for the new view", () => {
  it("filters on several categories, amount range and private rows", async () => {
    const { db, app, path } = setup();
    tx(db, { desc: "ICA", category: "Mat/Livsmedel", amount: -5000 });
    tx(db, { desc: "SL", category: "Resor/SL", amount: -39000 });
    tx(db, { desc: "SPEL", category: "Nöje/Spel", amount: -120000, private: true });
    const list = (q: string) => get(app, `/transactions?${q}`).then((r) => r.rows.map((x: { descriptionClean: string }) => x.descriptionClean).sort());
    const mat = getCategoryPathMap(db).get("Mat")!;
    expect(await list(`categoryIds=${mat},${path("Resor/SL")}`)).toEqual(["ICA", "SL"]);
    expect(await list("amountMin=10000&amountMax=100000")).toEqual(["SL"]);
    expect(await list("private=only")).toEqual(["SPEL"]);
  });
});

describe("bulk changes and undo", () => {
  it("sets a category on several rows and undo puts every row back as it was", async () => {
    const { db, app, path } = setup();
    const a = tx(db, { desc: "A", category: "Nöje/Spel" });
    const b = tx(db, { desc: "B" });
    const r = await post(app, "/transactions/bulk", { ids: [a.id, b.id], categoryId: path("Mat/Livsmedel") });
    expect(r).toMatchObject({ changed: 2 });
    const row = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;
    expect(row(b.id)).toMatchObject({ categoryId: path("Mat/Livsmedel"), categorySource: "manual" });

    expect(await post(app, "/transactions/undo", { rows: r.before })).toEqual({ restored: 2 });
    expect(row(a.id)).toMatchObject({ categoryId: path("Nöje/Spel"), categorySource: "rule", manuallyEditedAt: null });
    expect(row(b.id)).toMatchObject({ categoryId: null, categorySource: "none" });
    expect((await app.request("/api/transactions/undo", json("POST", { rows: [{ id: 1 }] }))).status).toBe(400);
  });

  it("makes rows private (never shared) and a transfer category unshares them", async () => {
    const { db, app, path } = setup();
    const a = tx(db, { desc: "A" });
    db.update(transactions).set({ shared: true }).where(eq(transactions.id, a.id)).run();
    await post(app, "/transactions/bulk", { ids: [a.id], private: true });
    expect(db.select().from(transactions).where(eq(transactions.id, a.id)).get()).toMatchObject({ private: true, shared: false });
    const own = getCategoryKeyMap(db).get("own_transfer")!;
    await post(app, "/transactions/bulk", { ids: [a.id], categoryId: own });
    expect(db.select().from(transactions).where(eq(transactions.id, a.id)).get()).toMatchObject({ isTransfer: true });
    expect(path("Mat")).toBeTruthy();
  });

  it("gives several rows the same note, and undo puts the old notes back", async () => {
    const { db, app } = setup();
    const a = tx(db, { desc: "ADSERVICE NL ADS" });
    const b = tx(db, { desc: "ADSERVICE NL ADS" });
    db.update(transactions).set({ note: "gammal" }).where(eq(transactions.id, b.id)).run();
    const c = tx(db, { desc: "ADSERVICE NL ADS" });
    db.update(transactions).set({ note: "Annons Reddit" }).where(eq(transactions.id, c.id)).run();
    const row = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;

    const r = await post(app, "/transactions/bulk", { ids: [a.id, b.id, c.id], note: "  Annons Reddit " });
    expect(r).toMatchObject({ changed: 2, unchanged: 1, skipped: 0 });
    expect([a, b, c].map((t) => row(t.id).note)).toEqual(["Annons Reddit", "Annons Reddit", "Annons Reddit"]);
    expect(row(a.id).manuallyEditedAt).not.toBeNull();

    await post(app, "/transactions/undo", { rows: r.before });
    expect([a, b].map((t) => row(t.id).note)).toEqual([null, "gammal"]);

    // Empty removes the note; not text is refused.
    expect(await post(app, "/transactions/bulk", { ids: [b.id], note: "" })).toMatchObject({ changed: 1 });
    expect(row(b.id).note).toBeNull();
    expect((await app.request("/api/transactions/bulk", json("POST", { ids: [b.id], note: 5 }))).status).toBe(400);
  });

  it("renames several rows at once (manual rows' text too), and undo puts the old names back", async () => {
    const { db, app } = setup();
    const a = tx(db, { desc: "ANTHROPIC* CLAUDE SUB" });
    const b = tx(db, { desc: "ANTHROPIC" });
    db.update(transactions).set({ label: "Claude" }).where(eq(transactions.id, b.id)).run();
    const m = tx(db, { desc: "Claude kontant", source: "manual" });
    const row = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;

    const r = await post(app, "/transactions/bulk", { ids: [a.id, b.id, m.id], label: " CLAUDE Abonnemang " });
    expect(r).toMatchObject({ changed: 3, unchanged: 0, skipped: 0 });
    expect([a, b, m].map((t) => row(t.id).label)).toEqual(["CLAUDE Abonnemang", "CLAUDE Abonnemang", "CLAUDE Abonnemang"]);
    expect(row(a.id).descriptionClean).toBe("ANTHROPIC* CLAUDE SUB"); // the bank's text stays
    expect(row(m.id)).toMatchObject({ descriptionClean: "CLAUDE Abonnemang", descriptionRaw: "CLAUDE Abonnemang" });

    await post(app, "/transactions/undo", { rows: r.before });
    expect([a, b].map((t) => row(t.id).label)).toEqual([null, "Claude"]);
    expect(row(m.id)).toMatchObject({ label: null, descriptionClean: "Claude kontant", descriptionRaw: "Claude kontant" });

    // Empty shows the bank's text again; a manual row can't lose its name.
    const cleared = await post(app, "/transactions/bulk", { ids: [b.id, m.id], label: "" });
    expect(cleared).toMatchObject({ changed: 1, skipped: 1, skipReason: "en manuell rad måste ha ett namn" });
    expect(row(b.id).label).toBeNull();
  });

  it("undo still accepts snapshots without a note (taken before notes could be bulk-changed)", async () => {
    const { db, app, path } = setup();
    const a = tx(db, { desc: "A", category: "Nöje/Spel" });
    db.update(transactions).set({ note: "kvar" }).where(eq(transactions.id, a.id)).run();
    const r = await post(app, "/transactions/bulk", { ids: [a.id], categoryId: path("Mat/Livsmedel") });
    const old = r.before.map(({ note: _n, ...rest }: { note: unknown }) => rest);
    expect(await post(app, "/transactions/undo", { rows: old })).toEqual({ restored: 1 });
    expect(db.select().from(transactions).where(eq(transactions.id, a.id)).get()).toMatchObject({ categoryId: path("Nöje/Spel"), note: "kvar" });
  });

  it("deletes imported rows softly (undoable) and manual rows for real", async () => {
    const { db, app } = setup();
    const imported = tx(db, { desc: "IMPORTED" });
    const manual = tx(db, { desc: "MANUAL", source: "manual" });
    const r = await post(app, "/transactions/bulk-delete", { ids: [imported.id, manual.id] });
    expect(r).toMatchObject({ soft: 1, hard: 1 });
    expect(db.select().from(transactions).where(eq(transactions.id, manual.id)).get()).toBeUndefined();
    await post(app, "/transactions/undo", { rows: r.before });
    expect(db.select().from(transactions).where(eq(transactions.id, imported.id)).get()!.deletedAt).toBeNull();
  });
});

describe("undoing a rule just saved", () => {
  it("removes a new rule and uncategorises the rows it set", async () => {
    const { db, app, path } = setup();
    const a = tx(db, { desc: "NYBUTIK 1" });
    const saved = await post(app, "/rules", { pattern: "NYBUTIK", matchType: "contains", direction: "any", categoryId: path("Nöje/Spel") });
    expect(saved).toMatchObject({ applied: 1, previousCategoryId: null });
    expect(db.select().from(transactions).where(eq(transactions.id, a.id)).get()!.categoryId).toBe(path("Nöje/Spel"));
    await post(app, `/rules/${saved.rule.id}/undo`, { previousCategoryId: saved.previousCategoryId, before: saved.before });
    expect(db.select().from(transactions).where(eq(transactions.id, a.id)).get()).toMatchObject({ categoryId: null, categorySource: "none" });
    expect(db.select().from(merchantRules).where(eq(merchantRules.id, saved.rule.id)).get()).toBeUndefined();
  });

  it("gives an updated rule its old category back", async () => {
    const { db, app, path } = setup();
    const old = db.insert(merchantRules).values({ pattern: "NYBUTIK", matchType: "contains", categoryId: path("Resor/Taxi") }).returning().get();
    const saved = await post(app, "/rules", { pattern: "NYBUTIK", matchType: "contains", direction: "any", categoryId: path("Nöje/Spel") });
    expect(saved.previousCategoryId).toBe(path("Resor/Taxi"));
    await post(app, `/rules/${saved.rule.id}/undo`, { previousCategoryId: saved.previousCategoryId, before: saved.before });
    expect(db.select().from(merchantRules).where(eq(merchantRules.id, old.id)).get()!.categoryId).toBe(path("Resor/Taxi"));
  });
});

describe("detail panel", () => {
  it("shows the same merchant for 12 months and the rules that match, the winner flagged", async () => {
    const { db, app, path } = setup();
    db.insert(merchantRules).values({ pattern: "LIDL 1", matchType: "contains", categoryId: path("Mat/Alkohol") }).run();
    tx(db, { desc: "LIDL 123", amount: -10000, date: "2026-08-01" });
    tx(db, { desc: "LIDL 123", amount: -30000, date: "2026-09-01" });
    tx(db, { desc: "LIDL 123", amount: -99900, date: "2024-01-01" }); // older than 12 months
    const row = tx(db, { desc: "LIDL 123", amount: -20000, category: "Mat/Livsmedel" });
    const d = await get(app, `/transactions/${row.id}/details`);
    expect(d.merchant).toMatchObject({ count: 3, total: -60000, average: -20000, query: "LIDL 123" });
    expect(d.rules.map((r: { pattern: string; best: boolean }) => [r.pattern, r.best])).toEqual(
      expect.arrayContaining([
        ["LIDL", false],
        ["LIDL 1", true],
      ]),
    );
    expect(d.import).toBeNull();
    // The winning rule (LIDL 1 -> Alkohol) doesn't give the row its category: suggest one that does.
    expect(d.ruleSuggestion).toMatchObject({ pattern: "LIDL 123", categoryId: path("Mat/Livsmedel") });
    db.update(transactions).set({ categoryId: path("Mat/Alkohol") }).where(eq(transactions.id, row.id)).run();
    expect((await get(app, `/transactions/${row.id}/details`)).ruleSuggestion).toBeNull();
    expect((await app.request("/api/transactions/999999/details")).status).toBe(404);
  });
});

describe("Att granska: quick picks and undo", () => {
  it("fills up the quick picks: rule and same merchant first, then the most used (as many as exist, at most six)", async () => {
    const { db, app, path } = setup();
    tx(db, { desc: "ICA NARA EXEMPELBY", category: "Mat/Livsmedel" });
    tx(db, { desc: "ICA NARA EXEMPELBY", category: "Mat/Livsmedel" });
    for (let i = 0; i < 5; i++) tx(db, { desc: `BUTIK ${i}`, category: "Nöje/Spel" });
    tx(db, { desc: "ANNAN", category: "Resor/Taxi" });
    const a = tx(db, { desc: "ICA KVANTUM EXEMPEL" });
    const b = tx(db, { desc: "ICA KVANTUM EXEMPEL" });
    const r = await post(app, "/review/quick-picks", { groups: [{ key: "out|ICA KVANTUM EXEMPEL", ids: [a.id, b.id] }] });
    const picks = r["out|ICA KVANTUM EXEMPEL"];
    // Only three categories are in use in this database: all of them, the rule's first.
    expect(picks).toHaveLength(3);
    expect(picks[0]).toMatchObject({ categoryId: path("Mat/Livsmedel"), reason: "rule" });
    expect(picks.find((p: { categoryId: number }) => p.categoryId === path("Nöje/Spel"))).toMatchObject({ reason: "popular" });
    expect(new Set(picks.map((p: { categoryId: number }) => p.categoryId)).size).toBe(3);
  });

  it("finds similar merchants by their first telling word", async () => {
    const { db, app, path } = setup();
    tx(db, { desc: "BILJARDHALLEN EXEMPELSTAD", category: "Nöje/Aktiviteter" });
    const a = tx(db, { desc: "BILJARDHALLEN" });
    const r = await post(app, "/review/quick-picks", { groups: [{ key: "k", ids: [a.id] }] });
    expect(r.k[0]).toMatchObject({ categoryId: path("Nöje/Aktiviteter"), reason: "similar", detail: "Liknande: BILJARDHALLEN EXEMPELSTAD" });
  });

  it("a group categorised with 'kom ihåg' can be undone: the rule goes, the rows are uncategorised again", async () => {
    const { db, app, path } = setup();
    const a = tx(db, { desc: "NYBUTIK A" });
    const b = tx(db, { desc: "NYBUTIK A" });
    const other = tx(db, { desc: "NYBUTIK B" }); // not in the group, but the rule takes it too
    const r = await post(app, "/transactions/categorize", {
      ids: [a.id, b.id],
      categoryId: path("Nöje/Spel"),
      rule: { pattern: "NYBUTIK", matchType: "contains", direction: "any" },
    });
    expect(r).toMatchObject({ byRule: 3, manual: 0 });
    await post(app, `/rules/${r.undo.rule.id}/undo`, { previousCategoryId: r.undo.rule.previousCategoryId, before: r.undo.rule.before });
    await post(app, "/transactions/undo", { rows: r.undo.rows });
    for (const t of [a, b, other]) {
      expect(db.select().from(transactions).where(eq(transactions.id, t.id)).get()).toMatchObject({ categoryId: null, categorySource: "none" });
    }
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "NYBUTIK")).get()).toBeUndefined();
  });
});
