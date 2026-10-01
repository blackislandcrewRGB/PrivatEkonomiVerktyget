import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenseAmounts, recurringExpenses, rentNotices, transactions } from "../src/db/schema.js";
import { looksLikeRentNotice, parseRentNotice } from "../src/import/rentNotice.js";
import { importRentNotice } from "../src/import/importRentNotice.js";
import { importFiles } from "../src/import/importBatch.js";
import { undoImport } from "../src/import/undoImport.js";
import { expectedAmounts } from "../src/recurring/amounts.js";
import { linkRecurring } from "../src/recurring/link.js";
import type { PdfLine } from "../src/import/pdfText.js";
import { createApp } from "../src/app.js";
import { freshDb, hasPrivateSample, privateSample } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;

/** A made-up notice laid out as the landlord's system prints it. */
function noticeLines(o: { number: string; month: string; year: string; rent: string; extra: string; toPay: string; due: string }): PdfLine[] {
  const line = (y: number, ...items: [number, string][]): PdfLine => ({ page: 1, y, items: items.map(([x, text]) => ({ x, text })) });
  return [
    line(810, [334, "HYRESFAKTURA"], [504, "Sida: 1 (1)"]),
    line(725, [48, "Exempel Förvaltning AB"], [323, "Testsson, Test"]),
    line(664, [48, "Avidatum 2026-09-11"], [164, `Avinr ${o.number}`]),
    line(644, [51, "Specifikation"], [320, "Period"], [362, "Objektnummer"], [490, "Radbelopp"]),
    line(629, [51, `Hyra för ${o.month} - ${o.year}`], [320, o.month], [362, "01 - 0001"], [488, o.rent.split(" ")[0]], [501, o.rent.split(" ")[1]]),
    line(615, [51, "Diverse tillägg"], [362, "01 - 0001"], [508, o.extra]),
    line(535, [51, "Dröjsmålsränta 8% över gällande referensränta."], [334, "Att betala"], [488, o.toPay.split(" ")[0]], [501, o.toPay.split(" ")[1]]),
    line(521, [334, "Förfallodatum"], [490, o.due]),
    line(351, [51, "Exempel Förvaltning AB"], [391, "Bankgiro: 123-4567"]),
    line(242, [26, `Avinr: ${o.number}, Att betala: ${o.toPay}`]),
    line(231, [26, `Förfallodatum: ${o.due}, Avidatum: 2026-09-11`]),
    line(175, [24, "Betalningsavsändare"], [316, "Betalningsmottagare"]),
    line(164, [26, "Testsson, Test"], [318, "Exempel Förvaltning AB"]),
  ];
}
const OCTOBER = { number: "101", month: "Oktober", year: "2026", rent: "7 100,00", extra: "50,00", toPay: "7 150,00", due: "2026-09-30" };
const bytesOf = (s: string) => new TextEncoder().encode(s);

function withRent(db: Db, matchPattern: string | null = "EXEMPEL FÖRVALTNING") {
  const account = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id;
  return db
    .insert(recurringExpenses)
    .values({ name: "Hyra", amount: 715000, anchorDay: 25, paymentMethod: "transfer", accountId: account, matchPattern, shared: true })
    .returning()
    .get();
}
const ownAmounts = (db: Db) => db.select().from(recurringExpenseAmounts).all().map((r) => `${r.month} ${r.amount}`);

describe("reading a rent notice", () => {
  it("has the landlord, number, dates, the month the rent is for, the rows and what to pay", () => {
    const lines = noticeLines(OCTOBER);
    expect(looksLikeRentNotice(lines)).toBe(true);
    expect(parseRentNotice(lines, bytesOf("a"))).toMatchObject({
      issuer: "Exempel Förvaltning AB",
      number: "101",
      noticeDate: "2026-09-11",
      dueDate: "2026-09-30",
      rentMonth: "2026-10",
      amount: 715000,
      bankgiro: "123-4567",
      lines: [
        { text: "Hyra för Oktober - 2026", amount: 710000 },
        { text: "Diverse tillägg", amount: 5000 },
      ],
    });
  });

  it("refuses one whose rows don't add up, or that lacks what it is", () => {
    expect(() => parseRentNotice(noticeLines({ ...OCTOBER, extra: "70,00" }), bytesOf("a"))).toThrow(/går inte ihop/);
    expect(() => parseRentNotice(noticeLines(OCTOBER).filter((l) => !l.items.some((i) => i.text.startsWith("Förfallodatum"))), bytesOf("a"))).toThrow(
      /Kunde inte läsa hyresavin/,
    );
  });
});

describe("importing rent notices", () => {
  const notice = (o = OCTOBER) => parseRentNotice(noticeLines(o), bytesOf(o.number));

  it("belongs to the rent's fixed expense and sets its amount for the period it is paid in", () => {
    const db = freshDb({ seeded: true });
    const e = withRent(db);
    // A new rent from December (due 30 November, the November charge).
    const r = importRentNotice(db, notice({ ...OCTOBER, number: "103", month: "December", rent: "7 250,00", toPay: "7 300,00", due: "2026-11-30" }), bytesOf("x"), "avi.pdf");
    expect(r).toMatchObject({ source: "rent_notice", expense: { id: e.id, name: "Hyra", before: 715000 }, notice: { period: "2026-11", rentMonth: "2026-12", alreadyImported: false } });
    expect(expectedAmounts(db)(e, "2026-11")).toBe(730000);
    expect(expectedAmounts(db)(e, "2026-10")).toBe(715000);
    // The usual amount sets no month of its own.
    importRentNotice(db, notice(), bytesOf("y"), "avi2.pdf");
    expect(ownAmounts(db)).toEqual(["2026-11 730000"]);
    // The same notice again is already there.
    expect(importRentNotice(db, notice(), bytesOf("z"), "avi2 kopia.pdf").notice.alreadyImported).toBe(true);
    expect(db.select().from(rentNotices).all()).toHaveLength(2);
  });

  it("without a matching expense, the one called Hyra; without that, an error saying what to do", () => {
    const db = freshDb({ seeded: true });
    expect(() => importRentNotice(db, notice(), bytesOf("x"), "avi.pdf")).toThrow(/Hittar ingen fast utgift för hyran till Exempel Förvaltning AB/);
    const e = withRent(db, null);
    expect(importRentNotice(db, notice(), bytesOf("x"), "avi.pdf").expense.id).toBe(e.id);
  });

  it("undoing the import takes the notice away and puts the period's own amount back", async () => {
    const db = freshDb({ seeded: true });
    const e = withRent(db);
    db.insert(recurringExpenseAmounts).values({ recurringExpenseId: e.id, month: "2026-09", amount: 700000 }).run();
    const r = importRentNotice(db, notice(), bytesOf("x"), "avi.pdf");
    expect(ownAmounts(db)).toEqual([]);
    undoImport(db, r.importId!);
    expect(ownAmounts(db)).toEqual(["2026-09 700000"]);
    expect(db.select().from(rentNotices).all()).toEqual([]);
  });

  it("lists an expense's notices with whether each is paid, and serves the PDF", async () => {
    const db = freshDb({ seeded: true });
    const e = withRent(db);
    importRentNotice(db, notice(), bytesOf("%PDF-1.4 x"), "avi.pdf");
    db.insert(transactions)
      .values({ source: "swedbank", accountId: e.accountId, bookingDate: "2026-09-25", descriptionRaw: "EXEMPEL FÖRVALTNING", descriptionClean: "EXEMPEL FÖRVALTNING", amount: -715000, fingerprint: "r1" })
      .run();
    linkRecurring(db);
    const app = createApp(db, { databasePath: ":memory:" });
    const list = (await (await app.request(`/api/rent-notices?expenseId=${e.id}`)).json()) as { id: number; rentMonth: string; paid: unknown; lines: unknown[] }[];
    expect(list).toEqual([expect.objectContaining({ rentMonth: "2026-10", paid: { date: "2026-09-25", amount: 715000 }, lines: expect.any(Array) })]);
    const pdf = await app.request(`/api/rent-notices/${list[0].id}/pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-security-policy")).toContain("sandbox");
    expect(new TextDecoder().decode(await pdf.arrayBuffer())).toBe("%PDF-1.4 x");
  });
});

// The real notices (three at a time), out of git in samples/privat/.
const REAL = ["Hyresavi 2792.pdf", "Hyresavi 2793.pdf", "Hyresavi 2794.pdf"];
describe.skipIf(!REAL.every(hasPrivateSample))("the real rent notices, three in one go", () => {
  it("are read, previewed and imported with the bank files' batch, and are known the second time", async () => {
    const db = freshDb({ seeded: true });
    const e = withRent(db, "EXEMPELHEM");
    db.update(recurringExpenses).set({ amount: 720000 }).where(eq(recurringExpenses.id, e.id)).run();
    const files = REAL.map(privateSample);
    const preview = await importFiles(db, files, { dryRun: true });
    expect(db.select().from(rentNotices).all()).toEqual([]);
    const summary = (b: typeof preview) =>
      b.files.map((f) => (f.ok && f.result.source === "rent_notice" ? `${f.result.notice.rentMonth} ${f.result.notice.dueDate} ${f.result.notice.amount} ${f.alreadyImported}` : "fel"));
    expect(summary(preview)).toEqual(["2026-10 2026-09-30 720000 false", "2026-11 2026-10-30 720000 false", "2026-12 2026-11-30 720000 false"]);
    await importFiles(db, files);
    expect(db.select().from(rentNotices).all().map((n) => n.period)).toEqual(["2026-09", "2026-10", "2026-11"]);
    // The usual rent: no month of its own.
    expect(ownAmounts(db)).toEqual([]);
    expect(summary(await importFiles(db, files, { dryRun: true })).every((s) => s.endsWith("true"))).toBe(true);
  });
});
