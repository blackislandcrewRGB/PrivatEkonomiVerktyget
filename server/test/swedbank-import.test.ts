import { describe, expect, it } from "vitest";
import { eq, isNull, sql } from "drizzle-orm";
import { accounts, categories, imports, merchantRules, transactions } from "../src/db/schema.js";
import { ImportError, importSwedbankCsv } from "../src/import/importSwedbank.js";
import { ImportParseError, parseSwedbankCsv } from "../src/import/swedbank.js";
import { SWEDBANK_FILES, buildCsv, cp1252, filterCsvLines, freshDb, sampleFile, swedbankSample } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const txCount = (db: Db) => db.select({ n: sql<number>`count(*)` }).from(transactions).get()!.n;
const accountByName = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!;
const bookingDateOf = (line: string) => line.split(",")[5];

describe("Swedbank import: dedupe on the made-up sample", () => {
  const sample = swedbankSample();

  it("imports 195 rows, and importing the same file again gives 195, not 390", () => {
    const db = freshDb({ seeded: true });
    const first = importSwedbankCsv(db, sample.bytes, sample.name);
    expect(first).toMatchObject({ rowsTotal: 195, rowsNew: 195, rowsSkipped: 0 });
    expect(txCount(db)).toBe(195);

    const second = importSwedbankCsv(db, sample.bytes, sample.name);
    expect(second).toMatchObject({ rowsTotal: 195, rowsNew: 0, rowsSkipped: 195, rowsUncategorized: 0 });
    expect(txCount(db)).toBe(195);

    // Both imports are logged.
    const log = db.select().from(imports).all();
    expect(log.map((i) => [i.rowsTotal, i.rowsNew, i.rowsSkipped])).toEqual([
      [195, 195, 0],
      [195, 0, 195],
    ]);
    expect(log[0]).toMatchObject({ source: "swedbank", filename: sample.name, periodFrom: "2026-03-19", periodTo: "2026-09-18" });
  });

  it("keeps genuine identical transactions (all 3 SL tickets on the same day)", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const sl = db
      .select()
      .from(transactions)
      .where(sql`booking_date = '2026-07-04' and description_clean = 'Swish AB STORSTOCKHOLM' and amount = -3900`)
      .all();
    expect(sl.map((r) => r.occurrenceIndex).sort()).toEqual([1, 2, 3]);
  });

  it("handles overlapping exports: older half, then the full file", () => {
    const db = freshDb({ seeded: true });
    const older = filterCsvLines(sample.bytes, (l) => bookingDateOf(l) < "2026-06-01");
    const a = importSwedbankCsv(db, older, "older.csv");
    expect(a.rowsNew).toBe(a.rowsTotal);
    const full = importSwedbankCsv(db, sample.bytes, sample.name);
    expect(full.rowsNew).toBe(195 - a.rowsTotal);
    expect(full.rowsSkipped).toBe(a.rowsTotal);
    expect(txCount(db)).toBe(195);
  });

  it("handles overlapping windows in any order", () => {
    const db = freshDb({ seeded: true });
    const recent = filterCsvLines(sample.bytes, (l) => bookingDateOf(l) >= "2026-07-01");
    const middle = filterCsvLines(sample.bytes, (l) => bookingDateOf(l) >= "2026-05-01" && bookingDateOf(l) < "2026-08-01");
    importSwedbankCsv(db, recent, "recent.csv");
    importSwedbankCsv(db, middle, "middle.csv");
    importSwedbankCsv(db, sample.bytes, sample.name);
    importSwedbankCsv(db, middle, "middle.csv");
    expect(txCount(db)).toBe(195);
  });

  it("adds only the missing copies of identical rows (N - M)", () => {
    const db = freshDb({ seeded: true });
    const isTriple = (l: string) => l.includes(",2026-07-04,2026-07-04,") && l.includes("AB STORSTOCKHOLM");
    let seen = 0;
    const oneCopy = filterCsvLines(sample.bytes, (l) => isTriple(l) && ++seen === 1);
    const allThree = filterCsvLines(sample.bytes, isTriple);

    expect(importSwedbankCsv(db, oneCopy, "one.csv").rowsNew).toBe(1);
    const r = importSwedbankCsv(db, allThree, "three.csv");
    expect(r).toMatchObject({ rowsTotal: 3, rowsNew: 2, rowsSkipped: 1 });
    // A later export that happens to contain only one of them adds nothing (N <= M).
    expect(importSwedbankCsv(db, oneCopy, "one.csv").rowsNew).toBe(0);
    expect(txCount(db)).toBe(3);
  });

  it("does not re-import when the same export was re-saved as UTF-8", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const utf8 = Buffer.from(new TextDecoder("windows-1252").decode(sample.bytes), "utf8");
    expect(importSwedbankCsv(db, utf8, "resaved.csv").rowsNew).toBe(0);
    expect(txCount(db)).toBe(195);
  });

  it("never touches existing rows: manual category, shared flag and note survive re-import", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const target = db.select().from(transactions).where(sql`description_clean = 'FOLKTANDVÅRD'`).get()!;
    const other = db.select().from(categories).where(sql`name = 'Övrigt'`).get()!;
    db.update(transactions)
      .set({ categoryId: other.id, categorySource: "manual", shared: true, note: "fika med M", manuallyEditedAt: "2026-09-18T12:00:00Z" })
      .where(eq(transactions.id, target.id))
      .run();
    const before = db.select().from(transactions).all();

    importSwedbankCsv(db, sample.bytes, sample.name);

    expect(db.select().from(transactions).all()).toEqual(before);
    expect(db.select().from(transactions).where(eq(transactions.id, target.id)).get()).toMatchObject({
      categoryId: other.id,
      categorySource: "manual",
      shared: true,
      note: "fika med M",
    });
  });

  it("does not bring back a soft-deleted row", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const victim = db.select().from(transactions).where(sql`description_clean = 'FOLKTANDVÅRD'`).get()!;
    db.update(transactions).set({ deletedAt: "2026-09-18T12:00:00Z" }).where(eq(transactions.id, victim.id)).run();

    const r = importSwedbankCsv(db, sample.bytes, sample.name);
    expect(r.rowsNew).toBe(0);
    expect(txCount(db)).toBe(195);
    expect(db.select().from(transactions).where(isNull(transactions.deletedAt)).all()).toHaveLength(194);
  });

  it("dry run reports the same numbers but writes nothing", () => {
    const db = freshDb({ seeded: true });
    const dry = importSwedbankCsv(db, sample.bytes, sample.name, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, rowsTotal: 195, rowsNew: 195, rowsSkipped: 0, importId: null });
    expect(dry.newRowsPreview.length).toBeGreaterThan(0);
    expect(txCount(db)).toBe(0);
    expect(db.select().from(imports).all()).toHaveLength(0);
    expect(accountByName(db, "Swedbank Privatkonto").accountRef).toBeNull();

    const real = importSwedbankCsv(db, sample.bytes, sample.name);
    expect(real.rowsUncategorized).toBe(dry.rowsUncategorized);
  });

  it("stores no full account numbers anywhere", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const dump = db.$client
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .flatMap((t: any) => db.$client.prepare(`select * from "${t.name}"`).all())
      .map((r) => JSON.stringify(r))
      .join("\n");
    // The sample's own account numbers, read from it rather than written out here.
    const rows = parseSwedbankCsv(sample.bytes).rows;
    expect(dump).not.toContain(rows[0].accountNumber);
    // Swedbank puts the receiving account in 'Referens' for internet transfers.
    const transfer = rows.find((r) => /^\d{10,17}$/.test(r.reference.replace(/[\s-]/g, "")))!;
    expect(dump).not.toContain(transfer.reference.replace(/[\s-]/g, ""));
    expect(dump).toContain("••1234");
  });
});

describe("Swedbank import: account per file", () => {
  const sample = swedbankSample();
  const mastercardCsv = buildCsv([
    { account: "5555123412349999", product: "Mastercard Guld", date: "2026-08-02", desc: "SPOTIFY", amount: "-189.00" },
    { account: "5555123412349999", product: "Mastercard Guld", date: "2026-08-04", desc: "AMAZON PRIME", amount: "-59.00" },
  ]);

  it("maps the Privatkonto export to Swedbank Privatkonto and binds the masked number", () => {
    const db = freshDb({ seeded: true });
    const r = importSwedbankCsv(db, sample.bytes, sample.name);
    const privat = accountByName(db, "Swedbank Privatkonto");
    expect(r.accounts).toEqual([
      { ref: "••1234", clearing: "80000", product: "Privatkonto", rows: 195, accountId: privat.id, resolvedBy: "hint" },
    ]);
    expect(privat).toMatchObject({ accountRef: "••1234", clearing: "80000" });
    expect(db.select({ n: sql<number>`count(*)` }).from(transactions).where(eq(transactions.accountId, privat.id)).get()!.n).toBe(195);

    // Next time the binding is used.
    expect(importSwedbankCsv(db, sample.bytes, sample.name, { dryRun: true }).accounts[0].resolvedBy).toBe("bound");
  });

  it("never guesses the Mastercard account for a Swedbank CSV (the card is imported from its invoices)", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const dry = importSwedbankCsv(db, mastercardCsv, "Transaktioner_mc.csv", { dryRun: true });
    expect(dry.accounts[0]).toMatchObject({ ref: "••9999", accountId: null, resolvedBy: null });
    expect(() => importSwedbankCsv(db, mastercardCsv, "Transaktioner_mc.csv")).toThrow(ImportError);
  });

  it("requires a choice for an unknown account and writes nothing without it", () => {
    const db = freshDb({ seeded: true });
    const unknown = buildCsv([{ account: "1234567890", product: "Sparkonto", date: "2026-08-02", desc: "Ränta", amount: "12.00" }]);
    const dry = importSwedbankCsv(db, unknown, "x.csv", { dryRun: true });
    expect(dry.accounts[0]).toMatchObject({ ref: "••7890", product: "Sparkonto", accountId: null });
    expect(() => importSwedbankCsv(db, unknown, "x.csv")).toThrow(ImportError);
    expect(txCount(db)).toBe(0);
    expect(db.select().from(imports).all()).toHaveLength(0);

    importSwedbankCsv(db, unknown, "x.csv", { accountMap: { "••7890": "new" } });
    const created = accountByName(db, "Swedbank Sparkonto ••7890");
    expect(created).toMatchObject({ source: "swedbank", accountRef: "••7890" });
    expect(db.select().from(transactions).get()!.accountId).toBe(created.id);
  });

  it("refuses to put rows on an account bound to a different number, atomically", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const privat = accountByName(db, "Swedbank Privatkonto");
    expect(() => importSwedbankCsv(db, mastercardCsv, "mc.csv", { accountMap: { "••9999": privat.id } })).toThrow(/redan kopplat/);
    expect(txCount(db)).toBe(195);
    expect(db.select().from(imports).all()).toHaveLength(1);
  });
});

describe("Swedbank import: categorisation of new rows", () => {
  const sample = swedbankSample();

  it("applies rules, marks transfers and counts rule hits", () => {
    const db = freshDb({ seeded: true });
    const r = importSwedbankCsv(db, sample.bytes, sample.name);
    // Only Privatkonto is imported here, so e-sparkonto isn't known yet: its
    // transfers are not assumed to be internal and go to review.
    const transfers = db.select().from(transactions).where(sql`description_clean = 'Överföring via internet'`).all();
    expect(transfers).toHaveLength(7);
    expect(transfers.every((t) => !t.isTransfer && t.categoryId === null && t.counterRef === "80000-••5678")).toBe(true);

    const uncategorized = db.select().from(transactions).where(isNull(transactions.categoryId)).all();
    expect(uncategorized.every((t) => t.categorySource === "none")).toBe(true);
    expect(r.rowsUncategorized).toBe(uncategorized.length);
    // A Swish to a number with no rule stays uncategorised (on purpose).
    expect(uncategorized.some((t) => t.descriptionClean === "Swish skickad +46705550008")).toBe(true);

    // The card bills are paid from the e-sparkonto: those rows are marked as transfers by the rules.
    importSwedbankCsv(db, sampleFile(SWEDBANK_FILES.esparUttag).bytes, SWEDBANK_FILES.esparUttag);
    const mc = db.select().from(transactions).where(sql`description_clean = 'Mastercard Guld'`).all();
    expect(mc).toHaveLength(5);
    expect(mc.every((t) => t.isTransfer && t.categorySource === "rule")).toBe(true);
    const mcRule = db.select().from(merchantRules).where(eq(merchantRules.pattern, "Mastercard Guld")).get()!;
    expect(mcRule.hits).toBe(5);
  });

  it("sets counterparty to the phone number for Swish", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, sample.bytes, sample.name);
    const swish = db.select().from(transactions).where(sql`description_clean = 'Swish skickad +46765550019'`).all();
    expect(swish.length).toBe(8);
    expect(new Set(swish.map((t) => t.counterparty))).toEqual(new Set(["+46765550019"]));
  });

  it("rejects a broken file without writing anything", () => {
    const db = freshDb({ seeded: true });
    const broken = cp1252(sample.bytes.toString("latin1").replace(",-100.00\r\n", ",-1OO.00\r\n"));
    expect(() => importSwedbankCsv(db, broken, "broken.csv")).toThrow(ImportParseError);
    expect(txCount(db)).toBe(0);
  });
});
