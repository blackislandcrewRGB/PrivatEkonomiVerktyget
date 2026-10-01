import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, categories, merchantRules, recurringExpenses, transactions } from "../src/db/schema.js";
import { categoryIdByKey, getCategoryPathMap } from "../src/db/seed.js";
import { categorize, loadCategorizeContext, recategorizeUncategorized } from "../src/categorize/categorize.js";
import { spendingPace, monthByCategory } from "../src/overview/overview.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});
const cat = (db: Db, path: string) => getCategoryPathMap(db).get(path)!;
const privat = (db: Db) => db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;

let seq = 0;
function tx(db: Db, o: { desc: string; amount: number; date?: string; category?: string; shared?: boolean; private?: boolean; counterparty?: string }) {
  const categoryId = o.category ? cat(db, o.category) : null;
  const c = categoryId ? db.select().from(categories).where(eq(categories.id, categoryId)).get()! : null;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: privat(db),
      bookingDate: o.date ?? "2026-09-10",
      transactionDate: o.date ?? "2026-09-10",
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      counterparty: o.counterparty ?? o.desc,
      amount: o.amount,
      categoryId,
      categorySource: categoryId ? "rule" : "none",
      isTransfer: !!c?.isTransfer,
      shared: o.shared ?? false,
      private: o.private ?? false,
      fingerprint: `p${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  return { db, app: createApp(db, { databasePath: ":memory:" }) };
}

describe("private transactions", () => {
  it("are never shared", async () => {
    const { db, app } = setup();
    const t = tx(db, { desc: "GULDSMEDEN", amount: -250000, shared: true });
    const res = await app.request(`/api/transactions/${t.id}`, json("PATCH", { private: true }));
    expect((await res.json()).transaction).toMatchObject({ private: true, shared: false });
    const again = await app.request(`/api/transactions/${t.id}`, json("PATCH", { shared: true }));
    expect(again.status).toBe(400);
  });

  it("count in totals but never match a text search while hidden", async () => {
    const { db, app } = setup();
    tx(db, { desc: "GULDSMEDEN", amount: -250000, category: "Prylar & hem", private: true });
    tx(db, { desc: "ICA NARA", amount: -10000, category: "Mat/Livsmedel" });
    const all = await (await app.request("/api/transactions")).json();
    expect(all.totals.out).toBe(-260000);
    expect(all.rows.find((r: { private: boolean }) => r.private)).toBeDefined();
    const hidden = await (await app.request("/api/transactions?q=guldsmed")).json();
    expect(hidden.rows).toEqual([]);
    const byAmount = await (await app.request("/api/transactions?q=2500")).json();
    expect(byAmount.rows).toEqual([]);
    const shown = await (await app.request("/api/transactions?q=guldsmed&showPrivate=1")).json();
    expect(shown.rows).toHaveLength(1);
  });

  it("are left out of review groups (only counted) while hidden", async () => {
    const { db, app } = setup();
    tx(db, { desc: "GULDSMEDEN", amount: -250000, private: true });
    tx(db, { desc: "OKAND BUTIK", amount: -5000 });
    const hidden = await (await app.request("/api/review/groups")).json();
    expect(hidden.groups.map((g: { merchant: string }) => g.merchant)).toEqual(["OKAND BUTIK"]);
    expect(hidden.privateHidden).toBe(1);
    const shown = await (await app.request("/api/review/groups?showPrivate=1")).json();
    expect(shown.groups).toHaveLength(2);
    expect(shown.privateHidden).toBe(0);
  });

  it("stay private when a rule with a shared default categorises them", () => {
    const { db } = setup();
    const t = tx(db, { desc: "BLOMSTER AB", amount: -40000, private: true });
    db.insert(merchantRules).values({ pattern: "BLOMSTER", matchType: "contains", categoryId: cat(db, "Prylar & hem"), sharedDefault: true }).run();
    // Also a shared row the same rule touches, to prove the rule does set shared.
    const other = tx(db, { desc: "BLOMSTER AB", amount: -10000 });
    expect(recategorizeUncategorized(db)).toBe(2);
    expect(db.select().from(transactions).where(eq(transactions.id, other.id)).get()!.shared).toBe(true);
    const row = db.select().from(transactions).where(eq(transactions.id, t.id)).get()!;
    expect(row.categoryId).toBe(cat(db, "Prylar & hem"));
    expect(row.shared).toBe(false);
  });
});

describe("marking several rows shared or own", () => {
  it("skips private rows, transfers and partner money", async () => {
    const { db, app } = setup();
    const a = tx(db, { desc: "ICA", amount: -10000, category: "Mat/Livsmedel" });
    const b = tx(db, { desc: "WILLYS", amount: -20000, category: "Mat/Livsmedel", shared: true });
    const p = tx(db, { desc: "PRESENT", amount: -30000, private: true });
    const t = tx(db, { desc: "SPAR", amount: -50000, category: "Överföringar & sparande/Sparande" });
    const s = tx(db, { desc: "Swish Mio", amount: -9000, category: "Till partner" });
    const res = await app.request("/api/transactions/bulk", json("POST", { ids: [a.id, b.id, p.id, t.id, s.id], shared: true }));
    expect(await res.json()).toMatchObject({ changed: 1, unchanged: 1, skipped: 3 });
    const shared = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.shared, true)).all().map((r) => r.id);
    expect(shared.sort()).toEqual([a.id, b.id].sort());
    const own = await app.request("/api/transactions/bulk", json("POST", { ids: [a.id, b.id, p.id], shared: false }));
    expect(await own.json()).toMatchObject({ changed: 2, unchanged: 1, skipped: 0 });
  });
});

describe("'Vet ej' (Övrigt › Okänt)", () => {
  it("sets the category without suggesting a rule, and rules can't target it", async () => {
    const { db, app } = setup();
    const unknown = categoryIdByKey(db, "unknown")!;
    expect(unknown).toBe(cat(db, "Övrigt/Okänt"));
    const t = tx(db, { desc: "KONSTIG AB", amount: -1234 });
    tx(db, { desc: "KONSTIG AB", amount: -999 });
    const res = await (await app.request(`/api/transactions/${t.id}`, json("PATCH", { categoryId: unknown }))).json();
    expect(res.transaction.categoryId).toBe(unknown);
    expect(res.ruleSuggestion).toBeNull();
    const rule = await app.request("/api/rules", json("POST", { pattern: "KONSTIG", categoryId: unknown }));
    expect(rule.status).toBe(400);
  });

  it("can be included in the 'utan kategori' filter", async () => {
    const { db, app } = setup();
    tx(db, { desc: "A", amount: -100 });
    tx(db, { desc: "B", amount: -200, category: "Övrigt/Okänt" });
    tx(db, { desc: "C", amount: -300, category: "Mat/Livsmedel" });
    const none = await (await app.request("/api/transactions?categoryId=none")).json();
    expect(none.rows.map((r: { descriptionClean: string }) => r.descriptionClean)).toEqual(["A"]);
    const withUnknown = await (await app.request("/api/transactions?categoryId=none&includeUnknown=1")).json();
    expect(withUnknown.rows.map((r: { descriptionClean: string }) => r.descriptionClean).sort()).toEqual(["A", "B"]);
  });
});

describe("category keys", () => {
  it("keep partner money and salary working after a rename", () => {
    const { db } = setup();
    db.update(categories).set({ name: "Mios swish" }).where(eq(categories.id, cat(db, "Inkomst/Från partner"))).run();
    const c = categorize(loadCategorizeContext(db), {
      accountId: null,
      descriptionClean: "Swish mottagen +46765550019",
      counterparty: "+46765550019",
      amount: 50000,
      defaultShared: false,
    });
    expect(c.categoryId).toBe(cat(db, "Inkomst/Mios swish"));
  });
});

describe("managing categories", () => {
  it("creates main and subcategories; a subcategory inherits colour and transfer flag", async () => {
    const { db, app } = setup();
    const top = await (await app.request("/api/categories", json("POST", { name: "Husdjur", color: "#123456" }))).json();
    expect(top).toMatchObject({ name: "Husdjur", parentId: null, color: "#123456", isTransfer: false });
    const sub = await (await app.request("/api/categories", json("POST", { name: "Foder", parentId: top.id }))).json();
    expect(sub).toMatchObject({ parentId: top.id, color: "#123456" });
    const saving = await (await app.request("/api/categories", json("POST", { name: "Buffert", parentId: cat(db, "Överföringar & sparande") }))).json();
    expect(saving.isTransfer).toBe(true);
    const dup = await app.request("/api/categories", json("POST", { name: "foder", parentId: top.id }));
    expect(dup.status).toBe(400);
    const deep = await app.request("/api/categories", json("POST", { name: "X", parentId: sub.id }));
    expect(deep.status).toBe(400);
  });

  it("renames and recolours; subcategories that followed the main colour follow along", async () => {
    const { db, app } = setup();
    const mat = cat(db, "Mat");
    const own = db.update(categories).set({ color: "#000000" }).where(eq(categories.id, cat(db, "Mat/Alkohol"))).returning().get();
    await app.request(`/api/categories/${mat}`, json("PATCH", { name: "Mat & dryck", color: "#abcdef" }));
    const rows = db.select().from(categories).all();
    expect(rows.find((c) => c.id === mat)).toMatchObject({ name: "Mat & dryck", color: "#abcdef" });
    expect(rows.find((c) => c.id === cat(db, "Mat & dryck/Livsmedel"))!.color).toBe("#abcdef");
    expect(rows.find((c) => c.id === own.id)!.color).toBe("#000000");
  });

  it("moves a subcategory; its rows take the new main category's transfer flag", async () => {
    const { db, app } = setup();
    const sub = cat(db, "Hälsa/Träning");
    const t = tx(db, { desc: "GYM", amount: -30000, category: "Hälsa/Träning", shared: true });
    const res = await app.request(`/api/categories/${sub}`, json("PATCH", { parentId: cat(db, "Överföringar & sparande") }));
    expect(await res.json()).toMatchObject({ parentId: cat(db, "Överföringar & sparande"), isTransfer: true });
    expect(db.select().from(transactions).where(eq(transactions.id, t.id)).get()).toMatchObject({ isTransfer: true, shared: false });
    const top = await app.request(`/api/categories/${cat(db, "Mat")}`, json("PATCH", { parentId: cat(db, "Bil") }));
    expect(top.status).toBe(400);
    const keyed = await app.request(`/api/categories/${cat(db, "Inkomst/Lön")}`, json("PATCH", { parentId: cat(db, "Övrigt") }));
    expect(keyed.status).toBe(400);
  });

  it("deletes an empty category, and asks where rows and rules should go otherwise", async () => {
    const { db, app } = setup();
    const empty = cat(db, "Nöje/Aktiviteter");
    expect((await app.request(`/api/categories/${empty}`, json("DELETE"))).status).toBe(200);
    expect(getCategoryPathMap(db).has("Nöje/Aktiviteter")).toBe(false);

    const kjell = cat(db, "Prylar & hem/Elektronik");
    tx(db, { desc: "KJELL", amount: -9900, category: "Prylar & hem/Elektronik" });
    db.insert(recurringExpenses).values({ name: "Hörlurar", amount: 100, paymentMethod: "card", categoryId: kjell }).run();
    const asked = await app.request(`/api/categories/${kjell}`, json("DELETE"));
    expect(asked.status).toBe(409);
    // KJELL, ELGIGANTEN and REFURBED are the seed rules in Elektronik.
    expect((await asked.json()).needsMove).toMatchObject({ transactions: 1, rules: 3, recurringExpenses: 1 });

    const target = cat(db, "Prylar & hem");
    const moved = await app.request(`/api/categories/${kjell}?moveTo=${target}`, json("DELETE"));
    expect(moved.status).toBe(200);
    expect(db.select().from(transactions).where(eq(transactions.categoryId, target)).all()).toHaveLength(1);
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "KJELL")).get()!.categoryId).toBe(target);
    expect(db.select().from(recurringExpenses).get()!.categoryId).toBe(target);
  });

  it("refuses to delete a main category with subcategories or a category the tool relies on", async () => {
    const { db, app } = setup();
    expect((await app.request(`/api/categories/${cat(db, "Bil")}`, json("DELETE"))).status).toBe(400);
    expect((await app.request(`/api/categories/${cat(db, "Övrigt/Okänt")}`, json("DELETE"))).status).toBe(400);
  });

  it("merges two subcategories, and two main categories with their subcategories", async () => {
    const { db, app } = setup();
    tx(db, { desc: "SF BIO", amount: -15000, category: "Nöje/Film" });
    const r1 = await app.request(`/api/categories/${cat(db, "Nöje/Film")}/merge`, json("POST", { into: cat(db, "Nöje/Aktiviteter") }));
    expect(r1.status).toBe(200);
    expect(getCategoryPathMap(db).has("Nöje/Film")).toBe(false);
    expect(db.select().from(transactions).get()!.categoryId).toBe(cat(db, "Nöje/Aktiviteter"));

    // A main category: its subcategories move along; a same-named one is merged.
    const hem = await (await app.request("/api/categories", json("POST", { name: "Hem" }))).json();
    const hemInredning = await (await app.request("/api/categories", json("POST", { name: "Inredning & verktyg", parentId: hem.id }))).json();
    const hemVaxter = await (await app.request("/api/categories", json("POST", { name: "Växter", parentId: hem.id }))).json();
    tx(db, { desc: "IKEA", amount: -50000, category: "Hem/Inredning & verktyg" });
    const r2 = await app.request(`/api/categories/${hem.id}/merge`, json("POST", { into: cat(db, "Prylar & hem") }));
    expect(r2.status).toBe(200);
    const paths = getCategoryPathMap(db);
    expect(paths.has("Hem")).toBe(false);
    expect(paths.get("Prylar & hem/Växter")).toBe(hemVaxter.id);
    expect(paths.has("Prylar & hem/Inredning & verktyg")).toBe(true);
    expect(db.select().from(categories).where(eq(categories.id, hemInredning.id)).get()).toBeUndefined();
    expect(db.select().from(transactions).where(eq(transactions.descriptionClean, "IKEA")).get()!.categoryId).toBe(paths.get("Prylar & hem/Inredning & verktyg"));

    const keyed = await app.request(`/api/categories/${cat(db, "Övrigt/Okänt")}/merge`, json("POST", { into: cat(db, "Övrigt") }));
    expect(keyed.status).toBe(400);
  });
});

describe("my share of spending", () => {
  it("counts shared rows at half, the household view in full", () => {
    const { db } = setup();
    tx(db, { desc: "ICA", amount: -40000, date: "2026-09-10", category: "Mat/Livsmedel", shared: true });
    tx(db, { desc: "KJELL", amount: -10000, date: "2026-09-10", category: "Prylar & hem" });
    expect(spendingPace(db, "2026-09-18", "mine").total).toBe(30000);
    expect(spendingPace(db, "2026-09-18", "household").total).toBe(50000);
    const mat = (rows: ReturnType<typeof monthByCategory>) => rows.find((r) => r.name === "Mat")!.current;
    expect(mat(monthByCategory(db, "2026-09-18", "mine"))).toBe(20000);
    expect(mat(monthByCategory(db, "2026-09-18", "household"))).toBe(40000);
  });
});
