import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dataMigrations } from "../src/db/schema.js";
import { runDataMigrations } from "../src/db/dataMigrations.js";
import { createApp } from "../src/app.js";
import { getModules } from "../src/settings.js";
import { freshDb } from "./helpers.js";

const put = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request("/api/settings", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("optional modules (Lön, Pendling & bränsle)", () => {
  it("are off in a new database, and set one at a time", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    expect(getModules(db)).toEqual({ salary: false, commute: false });
    expect(((await (await app.request("/api/settings")).json()) as { modules: unknown }).modules).toEqual({ salary: false, commute: false });

    const res = await put(app, { modules: { commute: true } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { modules: unknown }).modules).toEqual({ salary: false, commute: true });
    // The other settings in the same request are left as they are.
    expect(getModules(db)).toEqual({ salary: false, commute: true });
  });

  it("refuse an unknown module and anything but on or off", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    expect((await put(app, { modules: { nothing: true } })).status).toBe(400);
    expect((await put(app, { modules: { salary: "yes" } })).status).toBe(400);
    expect(getModules(db)).toEqual({ salary: false, commute: false });
  });

  it("are on for a database that was in use before they were modules, so nothing it shows goes away", () => {
    const db = freshDb({ seeded: true });
    // A database that has run every earlier migration but not this one.
    db.delete(dataMigrations).where(eq(dataMigrations.name, "0023_modules_on_for_existing_databases")).run();
    runDataMigrations(db);
    expect(getModules(db)).toEqual({ salary: true, commute: true });
  });

  it("stay off for a database that is new when the migrations run", () => {
    const db = freshDb();
    runDataMigrations(db);
    expect(getModules(db)).toEqual({ salary: false, commute: false });
  });
});
