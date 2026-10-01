import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, runMigrations, type Db } from "../src/db/client.js";
import { categories } from "../src/db/schema.js";
import { perGeneration } from "../src/db/generation.js";
import { responseCache } from "../src/responseCache.js";
import { setSetting } from "../src/settings.js";
import { freshDb } from "./helpers.js";

/** A GET under a kept path that counts how often it is worked out, and one that isn't kept. */
function counting(db: Db, now: () => number) {
  let computed = 0;
  const app = new Hono().basePath("/api");
  const cache = responseCache(db, { now });
  app.use("*", cache.middleware);
  app.get("/overview", (c) => c.json({ n: ++computed, q: c.req.query("x") ?? null }));
  app.get("/digest", (c) => c.json({ n: ++computed }));
  app.get("/transactions", (c) => c.json({ n: ++computed }));
  return { app, cache, computed: () => computed };
}
const get = async (app: Hono, url: string) => {
  const r = await app.request(url);
  return { cache: r.headers.get("X-Cache"), body: (await r.json()) as { n: number } };
};
const T0 = Date.parse("2026-09-27T10:00:00");

describe("the response cache", () => {
  it("answers the same GET again without working it out, per address", async () => {
    const { app, computed } = counting(freshDb(), () => T0);
    expect(await get(app, "/api/overview")).toEqual({ cache: null, body: { n: 1, q: null } });
    expect(await get(app, "/api/overview")).toEqual({ cache: "hit", body: { n: 1, q: null } });
    expect((await get(app, "/api/overview?x=1")).body).toEqual({ n: 2, q: "1" });
    // Not a kept path: worked out every time.
    await get(app, "/api/transactions");
    await get(app, "/api/transactions");
    expect(computed()).toBe(4);
  });

  it("works it out again after a write, a new day, or when the nightly copy counts as missing – not after a while", async () => {
    const db = freshDb({ seeded: true });
    // The last nightly copy 47 hours before T0: missing after 48.
    setSetting(db, "nightly_backup", { at: new Date(T0 - 47 * 3_600_000).toISOString(), ok: true });
    let now = T0;
    const { app } = counting(db, () => now);
    await get(app, "/api/overview");
    db.update(categories).set({ name: "Mat och dryck" }).where(eq(categories.name, "Mat")).run();
    expect(await get(app, "/api/overview")).toEqual({ cache: null, body: { n: 2, q: null } });
    now = T0 + 50 * 60_000;
    expect((await get(app, "/api/overview")).cache).toBe("hit");
    now = T0 + 61 * 60_000;
    expect((await get(app, "/api/overview")).body.n).toBe(3);
    now = Date.parse("2026-09-28T00:05:00");
    expect((await get(app, "/api/overview")).body.n).toBe(4);
  });

  it("sees a write from another connection to the same file", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cache-")), "t.db");
    const db = openDb(file);
    runMigrations(db);
    const { app } = counting(db, () => T0);
    await get(app, "/api/overview");
    expect((await get(app, "/api/overview")).cache).toBe("hit");
    const other = new Database(file);
    other.prepare("insert into categories (name) values ('Från skriptet')").run();
    other.close();
    expect((await get(app, "/api/overview")).body.n).toBe(2);
  });

  it("the real app keeps the menu's count until something is written through it", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const counts = () => app.request("/api/review/counts");
    expect((await counts()).headers.get("X-Cache")).toBeNull();
    expect((await counts()).headers.get("X-Cache")).toBe("hit");
    const r = await app.request("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hobby" }) });
    expect(r.status).toBe(200);
    expect((await counts()).headers.get("X-Cache")).toBeNull();
  });

  it("gzips the API's answers for a browser that takes it, kept ones too", async () => {
    const app = createApp(freshDb({ seeded: true }), { databasePath: ":memory:" });
    const ask = () => app.request("/api/categories", { headers: { "Accept-Encoding": "gzip" } });
    const r = await ask();
    expect(r.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString()).length).toBeGreaterThan(10);
    await app.request("/api/review/counts", { headers: { "Accept-Encoding": "gzip" } });
    const kept = await app.request("/api/review/counts", { headers: { "Accept-Encoding": "gzip" } });
    expect(kept.headers.get("X-Cache")).toBe("hit");
    expect(Object.keys(JSON.parse(zlib.gunzipSync(Buffer.from(await kept.arrayBuffer())).toString()))).toEqual(["uncategorized", "duplicates", "deleted"]);
  });

  it("perGeneration keeps what it worked out until the database is written to", () => {
    const db = freshDb({ seeded: true });
    let runs = 0;
    const names = perGeneration((d: Db) => (runs++, d.select().from(categories).all().map((c) => c.name)));
    expect(names(db)).toContain("Mat");
    expect(names(db)).toBe(names(db));
    expect(runs).toBe(1);
    db.update(categories).set({ name: "Mat och dryck" }).where(eq(categories.name, "Mat")).run();
    expect(names(db)).toContain("Mat och dryck");
    expect(runs).toBe(2);
    // Another database has its own.
    names(freshDb({ seeded: true }));
    expect(runs).toBe(3);
  });

  it("keeps Fasta utgifter and Lön too", async () => {
    const app = createApp(freshDb({ seeded: true }), { databasePath: ":memory:" });
    for (const url of ["/api/recurring-expenses", "/api/salary"]) {
      expect((await app.request(url)).headers.get("X-Cache")).toBeNull();
      const again = await app.request(url);
      expect(again.status).toBe(200);
      expect(again.headers.get("X-Cache")).toBe("hit");
    }
  });

  it("a refresh works out again what a write made stale, so the next one asking gets it kept", async () => {
    const db = freshDb({ seeded: true });
    let now = T0;
    const { app, cache, computed } = counting(db, () => now);
    await get(app, "/api/overview");
    await get(app, "/api/digest");
    expect(computed()).toBe(2);
    // Nothing stale: nothing to do.
    expect(await cache.refresh((r) => app.fetch(r))).toBe(0);
    db.update(categories).set({ name: "Mat och dryck" }).where(eq(categories.name, "Mat")).run();
    now += 5_000;
    expect(await cache.refresh((r) => app.fetch(r))).toBe(2);
    expect(computed()).toBe(4);
    expect(await get(app, "/api/overview")).toEqual({ cache: "hit", body: { n: 3, q: null } });
    expect((await get(app, "/api/digest")).cache).toBe("hit");
  });

  it("a refresh stops when someone asks, and leaves answers nobody has asked for in 12 hours", async () => {
    const db = freshDb({ seeded: true });
    let now = T0;
    const { app, cache } = counting(db, () => now);
    await get(app, "/api/overview");
    now += 13 * 3_600_000;
    await get(app, "/api/digest");
    db.update(categories).set({ name: "Mat och dryck" }).where(eq(categories.name, "Mat")).run();
    // Only the digest was asked for within 12 hours.
    expect(await cache.refresh((r) => app.fetch(r))).toBe(1);
    await get(app, "/api/overview?x=1");
    await get(app, "/api/overview?x=2");
    db.update(categories).set({ name: "Mat" }).where(eq(categories.name, "Mat och dryck")).run();
    // Someone asks as the first answer is worked out again: the rest waits.
    const busy = (r: Request) => {
      now += 1;
      const res = app.fetch(r);
      void app.request("/api/transactions");
      return res;
    };
    expect(await cache.refresh(busy)).toBe(1);
  });
});
