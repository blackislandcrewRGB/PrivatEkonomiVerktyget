import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

/**
 * /api/products. Names and shelves only: no call here can move an amount, and
 * the receipts keep their rows exactly as they were read.
 */

type Db = ReturnType<typeof freshDb>;
type App = ReturnType<typeof createApp>;

interface Product {
  id: number;
  name: string;
  groupId: number | null;
  groupName: string | null;
  aliases: string[];
  times: number;
  totalOre: number;
  lastPurchase: string | null;
}
interface Group {
  id: number;
  name: string;
  color: string | null;
}

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/receipts", name), "utf8");
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

let seq = 0;
function tx(db: Db, amount: number, desc: string, date = "2026-09-15") {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  return db
    .insert(transactions)
    .values({ source: "swedbank", accountId, bookingDate: date, transactionDate: date, descriptionRaw: desc, descriptionClean: desc, counterparty: desc, amount, fingerprint: `v${++seq}` })
    .returning()
    .get();
}

/** A receipt read and stored over the API, the way the panel does it. */
async function save(app: App, db: Db, file: string, amount: number, desc: string) {
  const text = fixture(file);
  const row = tx(db, amount, desc);
  const parsed = await (await app.request("/api/receipts/parse", json("POST", { text, transactionId: row.id }))).json();
  await app.request("/api/receipts", json("POST", { ...(parsed as object), transactionId: row.id }));
}

async function setup() {
  const db = freshDb({ seeded: true });
  const app = createApp(db, { databasePath: ":memory:" });
  await save(app, db, "lidl.txt", -18772, "LIDL");
  return { db, app };
}

const list = async (app: App) => (await (await app.request("/api/products")).json()) as Product[];
const groups = async (app: App) => (await (await app.request("/api/products/groups")).json()) as Group[];
const find = async (app: App, name: string) => (await list(app)).find((p) => p.name === name)!;

describe("varorna over the API", () => {
  it("lists the groceries the receipts have seen, with shelf and what they cost", async () => {
    const { app } = await setup();
    const rows = await list(app);
    expect(rows).toHaveLength(8);
    expect(await find(app, "Filmjölk 3%")).toMatchObject({ groupName: "Mejeri & ägg", times: 1, totalOre: 1350, lastPurchase: "2026-09-15" });
    expect((await find(app, "Havredryck Barista")).aliases).toEqual(["havredryck barista"]);
  });

  it("gives the shelves in the order they are shown, Övrigt last", async () => {
    const { app } = await setup();
    const names = (await groups(app)).map((g) => g.name);
    expect(names[0]).toBe("Mejeri & ägg");
    expect(names.at(-1)).toBe("Övrigt");
    expect(names).toHaveLength(13);
  });

  it("renames a grocery and moves it to another shelf in one call", async () => {
    const { app } = await setup();
    const juice = await find(app, "Apelsinjuice kyld");
    const fruit = (await groups(app)).find((g) => g.name === "Frukt & grönt")!;
    const res = await app.request(`/api/products/${juice.id}`, json("PUT", { name: "Färsk apelsinjuice", groupId: fruit.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Färsk apelsinjuice", groupId: fruit.id, groupName: "Frukt & grönt", times: 1 });
  });

  it("takes a grocery off its shelf when the group is null", async () => {
    const { app } = await setup();
    const flakes = await find(app, "Havregryn fullkorn");
    const res = await app.request(`/api/products/${flakes.id}`, json("PUT", { groupId: null }));
    expect(await res.json()).toMatchObject({ groupId: null, groupName: null });
    // Unplaced groceries come first in the list: they are the ones to answer for.
    expect((await list(app))[0].name).toBe("Havregryn fullkorn");
  });

  it("puts two names together and lets one leave again", async () => {
    const { db, app } = await setup();
    // The same crème fraîche, as Lidl and ICA each write it.
    await save(app, db, "ica.txt", -9120, "ICA SUPERMARKET EXEMPELSTAD");
    const lidl = await find(app, "Cremé Fraiche Lätt");
    const ica = await find(app, "Creme fraiche 32%");

    const merged = await app.request("/api/products/merge", json("POST", { keepId: lidl.id, mergeIds: [ica.id] }));
    expect(merged.status).toBe(200);
    expect((await list(app)).map((p) => p.name)).not.toContain("Creme fraiche 32%");
    const one = await find(app, "Cremé Fraiche Lätt");
    expect(one.aliases).toEqual(["cremé fraiche lätt", "creme fraiche 32%"]);
    // Both shops' rows count towards the same grocery now.
    expect(one.times).toBe(2);
    expect(one.totalOre).toBe(2950 + 1575);

    const back = await app.request("/api/products/detach", json("POST", { nameKey: "creme fraiche 32%" }));
    expect(back.status).toBe(200);
    expect(await find(app, "Creme fraiche 32%")).toMatchObject({ times: 1, totalOre: 1575 });
  });

  it("answers plainly when something isn't there", async () => {
    const { app } = await setup();
    expect((await app.request("/api/products/9999")).status).toBe(404);
    const bad = await app.request("/api/products/merge", json("POST", { mergeIds: [1] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "Välj vilken vara som ska behållas." });
    const empty = await app.request(`/api/products/${(await find(app, "Havregryn fullkorn")).id}`, json("PUT", { name: "  " }));
    expect(empty.status).toBe(400);
  });

  it("makes a shelf of its own, and frees the groceries when it goes", async () => {
    const { app } = await setup();
    const made = await app.request("/api/products/groups", json("POST", { name: "Barn", color: "#112233" }));
    const group = (await made.json()) as Group;
    expect(group).toMatchObject({ name: "Barn", color: "#112233" });
    expect((await app.request("/api/products/groups", json("POST", { name: "Barn" }))).status).toBe(400);

    const flakes = await find(app, "Havregryn fullkorn");
    await app.request(`/api/products/${flakes.id}`, json("PUT", { groupId: group.id }));
    await app.request(`/api/products/groups/${group.id}`, { method: "DELETE" });
    // The grocery stays; it is simply unplaced again.
    expect(await find(app, "Havregryn fullkorn")).toMatchObject({ groupId: null, groupName: null, times: 1 });
  });
});
