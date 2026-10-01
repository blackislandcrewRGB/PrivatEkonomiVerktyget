import { describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { merchantRules } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
type Rule = { id: number; pattern: string; hits: number; createdFrom: string };

describe("'Rensa oanvända': deleting chosen rules at once", () => {
  it("deletes only the chosen rules and gives them back for Ångra, which puts them back as they were", async () => {
    const db = freshDb({ seeded: true });
    const all = db.select().from(merchantRules).all();
    const chosen = all.slice(0, 3).map((r) => r.id);
    const app = createApp(db, { databasePath: ":memory:" });

    const res = await app.request("/api/rules/delete", json({ ids: [...chosen, 999_999] }));
    const deleted = (await res.json()) as Rule[];
    expect(deleted.map((r) => r.id).sort()).toEqual([...chosen].sort());
    const left = db.select().from(merchantRules).all();
    expect(left).toHaveLength(all.length - 3);
    expect(db.select().from(merchantRules).where(inArray(merchantRules.id, chosen)).all()).toEqual([]);

    const restored = (await (await app.request("/api/rules/restore", json(deleted))).json()) as Rule[];
    expect(restored.map((r) => r.id).sort()).toEqual([...chosen].sort());
    expect(db.select().from(merchantRules).all().sort((a, b) => a.id - b.id)).toEqual(all.sort((a, b) => a.id - b.id));
  });

  it("refuses an empty choice", async () => {
    const app = createApp(freshDb({ seeded: true }), { databasePath: ":memory:" });
    expect((await app.request("/api/rules/delete", json({ ids: [] }))).status).toBe(400);
    expect((await app.request("/api/rules/delete", json({}))).status).toBe(400);
  });
});
