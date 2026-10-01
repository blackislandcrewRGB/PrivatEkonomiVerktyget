import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, runMigrations } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import { transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

describe("Inställningar › Data", () => {
  it("lists backups and makes one now", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finans-data-"));
    const file = path.join(dir, "finance.db");
    const db = openDb(file);
    runMigrations(db);
    seed(db);
    const app = createApp(db, { databasePath: file });
    expect(await (await app.request("/api/data/backups")).json()).toEqual({ dir: path.join(dir, "backups"), backups: [] });
    const made = (await (await app.request("/api/data/backups", { method: "POST" })).json()) as { name: string; backups: { name: string; kind: string; size: number }[] };
    expect(made.name).toMatch(/^finance-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-manuell\.db$/);
    expect(made.backups).toEqual([expect.objectContaining({ name: made.name, kind: "manuell" })]);
    expect(made.backups[0].size).toBeGreaterThan(0);
    db.$client.close();
  });

  it("refuses a backup without a database file", async () => {
    const app = createApp(freshDb(), { databasePath: ":memory:" });
    expect((await app.request("/api/data/backups", { method: "POST" })).status).toBe(400);
  });

  it("exports everything as JSON and the transactions as CSV for Excel", async () => {
    const db = freshDb({ seeded: true });
    db.insert(transactions)
      .values({ source: "manual", bookingDate: "2026-09-01", descriptionRaw: "Gåva; kontant", descriptionClean: "Gåva; kontant", amount: 50050, fingerprint: "x1" })
      .run();
    const app = createApp(db, { databasePath: ":memory:" });
    const json = await app.request("/api/data/export?format=json");
    expect(json.headers.get("content-disposition")).toMatch(/attachment; filename="privatekonomi-\d{4}-\d{2}-\d{2}\.json"/);
    const all = (await json.json()) as Record<string, unknown[]>;
    expect(Object.keys(all)).toEqual(
      expect.arrayContaining(["accounts", "categories", "merchantRules", "transactions", "recurringExpenses", "settlements", "receipts", "receiptLines", "instruments", "trades", "priceSnapshots", "fxRates"]),
    );
    expect(all.transactions).toHaveLength(1);

    const csv = await (await app.request("/api/data/export?format=csv")).text();
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Bokföringsdag;Transaktionsdag;Konto;Beskrivning;Etikett;Kategori;Belopp;Valuta;Delad;Privat;Anteckning;Källa;Del");
    expect(lines[1]).toBe('2026-09-01;;;"Gåva; kontant";;;500,50;SEK;;;;manual;');
  });

  it("renames an account and changes its note", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const patch = (body: unknown) => app.request("/api/accounts/1", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect(await (await patch({ name: " Lönekonto ", note: "Lönen kommer hit" })).json()).toMatchObject({ name: "Lönekonto", note: "Lönen kommer hit" });
    expect((await patch({ name: "  " })).status).toBe(400);
    expect(await (await patch({ note: "" })).json()).toMatchObject({ note: null });
  });
});
