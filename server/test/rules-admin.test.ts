import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { categories, merchantRules, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { createApp } from "../src/app.js";
import { applyCategoryPalette } from "../src/db/paletteMigration.js";
import { assignTopColors, CATEGORY_PALETTE, NEUTRAL_COLOR, nextTopColor, subTone } from "../src/db/palette.js";
import { SEED_CATEGORIES } from "../src/db/seedData.js";
import { todayLocal } from "../src/overview/dates.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
let seq = 0;
function tx(db: Db, o: { desc: string; amount: number; date?: string; category?: string }) {
  const cat = o.category ? getCategoryPathMap(db).get(o.category)! : null;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      bookingDate: o.date ?? todayLocal(),
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      amount: o.amount,
      categoryId: cat,
      categorySource: cat ? "rule" : "none",
      fingerprint: `r${++seq}`,
    })
    .returning()
    .get();
}
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const withMethod = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("rules for the management view", () => {
  it("lists direction and the rows of the last 12 months each rule decides", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    tx(db, { desc: "LIDL EXEMPELSTAD", amount: -10000, category: "Mat/Livsmedel" });
    tx(db, { desc: "LIDL EXEMPELSTAD", amount: -20000, category: "Mat/Livsmedel" });
    tx(db, { desc: "LIDL EXEMPELSTAD", amount: -30000, date: "2020-01-01" }); // older than 12 months
    const rules = (await (await app.request("/api/rules")).json()) as { pattern: string; direction: string; matches12: number }[];
    expect(rules.find((r) => r.pattern === "LIDL")).toMatchObject({ direction: "any", matches12: 2 });
    expect(rules.filter((r) => r.matches12 === 0).length).toBeGreaterThan(10);
  });

  it("'Testa mönster' shows every row a pattern would match, newest first", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    tx(db, { desc: "GYMMET ODENPLAN", amount: -39900, date: "2026-08-01" });
    tx(db, { desc: "GYMMET ODENPLAN", amount: -39900, date: "2026-09-01", category: "Hälsa/Träning" });
    tx(db, { desc: "GYMMET ODENPLAN", amount: 39900, date: "2026-09-02" }); // money back: not with direction 'out'
    const res = (await (await app.request("/api/rules/preview", json({ pattern: "gymmet", direction: "out", examples: true }))).json()) as {
      matches: number;
      total: number;
      uncategorized: number;
      rows: { bookingDate: string }[];
    };
    expect(res).toMatchObject({ matches: 1, total: 2, uncategorized: 1 });
    expect(res.rows.map((r) => r.bookingDate)).toEqual(["2026-09-01", "2026-08-01"]);
    // Without 'examples' the answer is as before.
    expect(await (await app.request("/api/rules/preview", json({ pattern: "gymmet" }))).json()).toEqual({ matches: 2 });
  });

  it("edits a rule: new matches get the category, rows it categorised keep theirs; clashes and bad regex are refused", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const paths = getCategoryPathMap(db);
    const rule = db.insert(merchantRules).values({ pattern: "GYM ONE", categoryId: paths.get("Hälsa/Träning")! }).returning().get();
    const old = tx(db, { desc: "GYM ONE", amount: -100, category: "Hälsa/Träning" });
    const fresh = tx(db, { desc: "GYMMET", amount: -100 });

    const res = await app.request(`/api/rules/${rule.id}`, withMethod("PATCH", { pattern: "GYM", categoryId: paths.get("Nöje/Aktiviteter") }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rule: { pattern: "GYM", categoryId: paths.get("Nöje/Aktiviteter") }, applied: 1 });
    const byId = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;
    expect(byId(fresh.id).categoryId).toBe(paths.get("Nöje/Aktiviteter"));
    expect(byId(old.id).categoryId).toBe(paths.get("Hälsa/Träning"));

    expect((await app.request(`/api/rules/${rule.id}`, withMethod("PATCH", { pattern: "LIDL" }))).status).toBe(400);
    expect((await app.request(`/api/rules/${rule.id}`, withMethod("PATCH", { pattern: "(", matchType: "regex" }))).status).toBe(400);
  });

  it("deletes a rule and puts it back as it was", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const lidl = db.select().from(merchantRules).where(eq(merchantRules.pattern, "LIDL")).get()!;
    const deleted = await (await app.request(`/api/rules/${lidl.id}`, withMethod("DELETE"))).json();
    expect(db.select().from(merchantRules).where(eq(merchantRules.id, lidl.id)).get()).toBeUndefined();
    expect((await app.request("/api/rules/restore", json(deleted))).status).toBe(200);
    expect(db.select().from(merchantRules).where(eq(merchantRules.id, lidl.id)).get()).toEqual(lidl);
    expect((await app.request(`/api/rules/99999`, withMethod("DELETE"))).status).toBe(404);
  });
});

describe("category usage", () => {
  it("counts rows and their sum in the last 12 months per category", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    tx(db, { desc: "ICA", amount: -10000, category: "Mat/Livsmedel" });
    tx(db, { desc: "ICA", amount: -5000, category: "Mat/Livsmedel" });
    tx(db, { desc: "ICA", amount: -99900, date: "2020-01-01", category: "Mat/Livsmedel" });
    const usage = (await (await app.request("/api/categories/usage")).json()) as Record<string, { transactions: number; count12: number; sum12: number }>;
    expect(usage[getCategoryPathMap(db).get("Mat/Livsmedel")!]).toMatchObject({ transactions: 3, count12: 2, sum12: -15000 });
  });
});

describe("colour-blind-safe category colours", () => {
  it("the seed gives every main category its own palette colour, Övrigt neutral; Mat green, Bil red", () => {
    const tops = SEED_CATEGORIES.map((c) => c.color);
    const palette = tops.filter((c) => c !== NEUTRAL_COLOR);
    expect(new Set(palette).size).toBe(palette.length);
    expect(palette.every((c) => (CATEGORY_PALETTE as readonly string[]).includes(c))).toBe(true);
    expect(SEED_CATEGORIES.find((c) => c.name === "Övrigt")!.color).toBe(NEUTRAL_COLOR);
    expect(SEED_CATEGORIES.find((c) => c.name === "Mat")!.color).toBe("#117733");
    expect(SEED_CATEGORIES.find((c) => c.name === "Bil")!.color).toBe("#D55E00");
  });

  it("moves an old database to the palette: subcategories follow, own colours stay, a main category beyond the 16 colours is neutral", () => {
    const db = freshDb({ seeded: true });
    // As before the palette: the old colours, a user's own main category and a subcategory with its own colour.
    const old: Record<string, string> = { Mat: "#16a34a", Bil: "#dc2626", Övrigt: "#a3a3a3" };
    for (const [name, color] of Object.entries(old)) {
      const top = db.select().from(categories).where(eq(categories.name, name)).get()!;
      db.update(categories).set({ color }).where(eq(categories.id, top.id)).run();
      db.update(categories).set({ color }).where(eq(categories.parentId, top.id)).run();
    }
    const husdjur = db.insert(categories).values({ name: "Husdjur", color: "#0e7490" }).returning().get();
    const alkohol = db.select().from(categories).where(eq(categories.name, "Alkohol")).get()!;
    db.update(categories).set({ color: "#123456" }).where(eq(categories.id, alkohol.id)).run();

    applyCategoryPalette(db);
    const color = (name: string) => db.select().from(categories).where(eq(categories.name, name)).get()!.color;
    expect(color("Mat")).toBe("#117733");
    expect(color("Livsmedel")).toBe("#117733");
    expect(color("Alkohol")).toBe("#123456");
    expect(color("Bil")).toBe("#D55E00");
    expect(color("Övrigt")).toBe(NEUTRAL_COLOR);
    expect(color("Okänt")).toBe(NEUTRAL_COLOR);
    // 16 colours for 17 seed main categories plus Husdjur: it gets what is left (none), i.e. neutral.
    expect(db.select().from(categories).where(eq(categories.id, husdjur.id)).get()!.color).toBe(NEUTRAL_COLOR);
  });

  it("assigns the nearest free colour, closest first, and new main categories the first free one", () => {
    const m = assignTopColors(
      [
        { id: 1, name: "A", color: "#16a34a" },
        { id: 2, name: "B", color: "#15803d" },
      ],
      { A: "#117733" },
    );
    expect(m.get(1)).toBe("#117733");
    expect(m.get(2)).not.toBe("#117733");
    expect(nextTopColor(["#E69F00", null])).toBe("#56B4E9");
    expect(nextTopColor([...CATEGORY_PALETTE])).toBe(NEUTRAL_COLOR);
  });

  it("draws subcategories in lighter tones of the main colour", () => {
    expect(subTone("#000000", 0, 1)).toBe("#4d4d4d");
    const tones = [0, 1, 2].map((i) => subTone("#000000", i, 3));
    expect(tones).toEqual(["#262626", "#606060", "#999999"]);
  });

  it("a new main category takes a free palette colour", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const created = (await (await app.request("/api/categories", json({ name: "Husdjur" }))).json()) as { color: string };
    // All 16 are taken by the seed, so: neutral.
    expect(created.color).toBe(NEUTRAL_COLOR);
    // Free a colour: Vänner's olive.
    db.update(categories).set({ color: NEUTRAL_COLOR }).where(eq(categories.name, "Vänner")).run();
    const next = (await (await app.request("/api/categories", json({ name: "Barn" }))).json()) as { color: string };
    expect(next.color).toBe("#999933");
  });
});
