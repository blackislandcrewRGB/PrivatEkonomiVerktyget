import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { importSwedbankCsv } from "../src/import/importSwedbank.js";
import { buildCsv, freshDb, metaLine } from "./helpers.js";

const coffee = { date: "2026-01-15", bookingDate: "2026-01-16", desc: "CAFE EXEMPEL", amount: "-45.00" };
const lunch = { date: "2026-01-10", desc: "LUNCHSTALLET AB", amount: "-129.00" };

describe("possible duplicates (bank changed an already booked row)", () => {
  it("flags a new row with the same transaction date, amount and description but another booking date", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([coffee, lunch]), "a.csv");
    const existing = db.select().from(transactions).where(eq(transactions.descriptionClean, "CAFE EXEMPEL")).get()!;

    const r = importSwedbankCsv(db, buildCsv([{ ...coffee, bookingDate: "2026-01-17" }, lunch]), "b.csv");
    // Imported anyway, but listed.
    expect(r.rowsNew).toBe(1);
    expect(r.possibleDuplicates).toEqual([
      {
        transactionDate: "2026-01-15",
        descriptionClean: "CAFE EXEMPEL",
        amount: -4500,
        newBookingDate: "2026-01-17",
        existing: { id: existing.id, bookingDate: "2026-01-16" },
      },
    ]);
  });

  it("is reported in the dry run too", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([coffee]), "a.csv");
    const dry = importSwedbankCsv(db, buildCsv([{ ...coffee, bookingDate: "2026-01-17" }]), "b.csv", { dryRun: true });
    expect(dry.possibleDuplicates).toHaveLength(1);
  });

  it("does not flag when the file still contains the existing version too (two real purchases)", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([coffee]), "a.csv");
    const r = importSwedbankCsv(db, buildCsv([coffee, { ...coffee, bookingDate: "2026-01-17" }]), "b.csv");
    expect(r.rowsNew).toBe(1);
    expect(r.possibleDuplicates).toEqual([]);
  });

  it("does not flag when the existing row is outside the new file's period", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([coffee]), "a.csv");
    const r = importSwedbankCsv(db, buildCsv([{ ...coffee, bookingDate: "2026-01-17" }], { meta: metaLine("2026-01-17", "2026-01-31") }), "b.csv");
    expect(r.possibleDuplicates).toEqual([]);
  });

  it("does not flag against soft-deleted rows or other accounts", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([coffee]), "a.csv");
    db.update(transactions).set({ deletedAt: "2026-02-01T00:00:00Z" }).run();
    expect(importSwedbankCsv(db, buildCsv([{ ...coffee, bookingDate: "2026-01-17" }]), "b.csv").possibleDuplicates).toEqual([]);

    const mc = db.select().from(accounts).where(eq(accounts.name, "Swedbank Mastercard Guld")).get()!;
    const other = buildCsv([{ ...coffee, bookingDate: "2026-01-18", account: "5555123412349999", product: "Mastercard Guld" }]);
    const r = importSwedbankCsv(db, other, "mc.csv", { accountMap: { "••9999": mc.id } });
    expect(r.possibleDuplicates).toEqual([]);
  });

  it("does not flag identical rows (those are handled by the fingerprint)", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([coffee, lunch]), "a.csv");
    expect(importSwedbankCsv(db, buildCsv([coffee, lunch]), "a.csv").possibleDuplicates).toEqual([]);
  });
});
