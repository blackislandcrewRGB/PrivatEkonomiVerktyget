import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { categories, merchantCategoryMap, merchantRules, statements, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { excelDate, parseNorwegianXlsx } from "../src/import/norwegianXlsx.js";
import { parseNorwegianPdf } from "../src/import/norwegian.js";
import { importNorwegianPdf, importNorwegianXlsx } from "../src/import/importNorwegian.js";
import { importFiles } from "../src/import/importBatch.js";
import { merchantCategoryKey, normalizeNorwegianDescription } from "../src/import/norwegianKey.js";
import { ImportParseError } from "../src/import/swedbank.js";
import { strToU8, zipSync } from "fflate";
import { SAMPLES_DIR, freshDb, hasNorwegianInvoice, hasPrivateSample, privateSample, samplePdf } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const sample = (name: string) => fs.readFileSync(path.join(SAMPLES_DIR, name));
const AUG = sample("Augusti.xlsx");
const SEP = sample("September.xlsx");
const pdf = samplePdf();

/**
 * The cross-source tests pair the real September invoice (PDF) with the real
 * exports it overlaps. They read all three from the owner's samples/privat/ and
 * skip when any is missing; the made-up exports above have no invoice.
 */
const hasPrivateNorwegian = hasNorwegianInvoice && hasPrivateSample("Augusti.xlsx") && hasPrivateSample("September.xlsx");
const privateXlsx = (name: string) => (hasPrivateSample(name) ? privateSample(name).bytes : Buffer.alloc(0));
const PRIVATE_AUG = privateXlsx("Augusti.xlsx");
const PRIVATE_SEP = privateXlsx("September.xlsx");

/** A minimal workbook with one sheet 'transactions' (inline strings, plain numbers for dates), for exports the fixtures don't cover. */
function workbook(rows: (string | number)[][]): Buffer {
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const sheet = rows
    .map((r, y) => `<row r="${y + 1}">${r.map((v, x) => (typeof v === "number" ? `<c r="${col(x)}${y + 1}"><v>${v}</v></c>` : `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join("")}</row>`)
    .join("");
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      "xl/workbook.xml": strToU8(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="transactions" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
      "xl/worksheets/sheet1.xml": strToU8(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`),
    }),
  );
}
const EXPORT_HEADER = ["TransactionDate", "Text", "Type", "Amount", "Merchant Area", "Merchant Category", "BookDate"];
const txCount = (db: Db) => db.select({ n: sql<number>`count(*)` }).from(transactions).get()!.n;
const byDesc = (db: Db, d: string) => db.select().from(transactions).where(eq(transactions.descriptionClean, d)).all();
const pathOf = (db: Db, id: number | null) => [...getCategoryPathMap(db)].find(([, v]) => v === id)?.[0];

describe("excelDate", () => {
  it.each([
    [46249, "2026-08-15"],
    ["46249", "2026-08-15"],
    ["46234.75", "2026-07-31"],
    [new Date("2026-09-02T00:00:00.000Z"), "2026-09-02"],
    ["2026-09-02", "2026-09-02"],
  ])("%s -> %s", (cell, iso) => expect(excelDate(cell)).toBe(iso));

  it.each(["", "abc", "12", null, "2026-13-01"])("rejects %j", (cell) => expect(excelDate(cell)).toBeNull());
});

describe("normalization", () => {
  it("gives the same merchant category key for both export spellings", () => {
    expect(merchantCategoryKey("GROCERY STORES/SUPERMARKETS")).toBe("GROCERY STORES SUPERMARKETS");
    expect(merchantCategoryKey("Grocery Stores, Supermarkets        ")).toBe("GROCERY STORES SUPERMARKETS");
    expect(merchantCategoryKey("MISC FOOD STORES - DEFAULT")).toBe("MISC FOOD STORES DEFAULT");
    expect(merchantCategoryKey("Fast Food Restaurants")).toBe(merchantCategoryKey("FAST FOOD RESTAURANTS"));
  });

  it("normalizes descriptions and all payment texts to one key", () => {
    expect(normalizeNorwegianDescription("ICA TORNET  EXEMPELSTAD", false)).toBe("ICA TORNET EXEMPELSTAD");
    expect(normalizeNorwegianDescription("ICA Kvantum Exempelstad ", false)).toBe("ICA KVANTUM EXEMPELSTAD");
    expect(normalizeNorwegianDescription("Inbetalning", true)).toBe("INBETALNING");
    expect(normalizeNorwegianDescription("Inbetalning från 1234567", true)).toBe("INBETALNING");
  });
});

describe("parseNorwegianXlsx", () => {
  it("reads Augusti.xlsx: 16 purchases + 1 payment, BookDate month as period", async () => {
    const f = await parseNorwegianXlsx(AUG);
    expect(f.period).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(f.rows).toHaveLength(17);
    expect(f.reserved).toEqual({ count: 0, amount: 0 });
    expect(f.otherTypes).toEqual([]);
    expect(f.rows[0]).toMatchObject({
      transactionDate: "2026-07-31",
      bookDate: "2026-08-01",
      type: "Köp",
      descriptionClean: "LIDL271EXEMPELSTOCKSU",
      merchantArea: "EXEMPELSTAD",
      merchantCategory: "GROCERY STORES/SUPERMARKETS",
      amount: -24435, // '-244.35' in the file
      isPayment: false,
    });
    expect(f.rows.find((r) => r.descriptionClean === "SYSTEMBOLAGET" && r.transactionDate === "2026-08-16")!.amount).toBe(-38096); // '-380.96'
    expect(f.rows.filter((r) => r.isPayment)).toEqual([
      expect.objectContaining({ transactionDate: "2026-08-25", descriptionClean: "Inbetalning", amount: 791350, merchantCategory: null }),
    ]);
  });

  it("reads September.xlsx: 8 purchases, the period runs from the first posting day", async () => {
    const f = await parseNorwegianXlsx(SEP);
    expect(f.period).toEqual({ from: "2026-09-02", to: "2026-09-16" });
    expect(f.rows).toHaveLength(8);
    expect(f.reserved).toEqual({ count: 0, amount: 0 });
    expect(f.rows[0]).toMatchObject({ transactionDate: "2026-09-01", bookDate: "2026-09-02", descriptionClean: "WILLYS EXEMPELSTAD", merchantArea: "EXEMPELSTAD", amount: -28602 });
    expect(f.rows.every((r) => r.type === "Köp")).toBe(true);
  });

  it("trims padding, keeps the raw text, and skips and sums 'Reserverat'", async () => {
    const f = await parseNorwegianXlsx(
      workbook([
        EXPORT_HEADER,
        [46266, "LIDL271EXEMPELSTOCKSU   ", "Köp", "-64.34", "EXEMPELSTAD", "Grocery Stores, Supermarkets", 46267],
        [46267, "MCDONALDS EXEMPEL", "Reserverat", "-221", "EXEMPELSTAD", "FAST FOOD RESTAURANTS", ""],
        [46267, "ICA NARA EXEMPELBY", "Reserverat", "-124.82", "EXEMPELBY", "MISC FOOD STORES - DEFAULT", ""],
      ]),
    );
    expect(f.rows).toHaveLength(1);
    expect(f.reserved).toEqual({ count: 2, amount: -(22100 + 12482) });
    expect(f.rows[0]).toMatchObject({
      descriptionRaw: "LIDL271EXEMPELSTOCKSU   ",
      descriptionClean: "LIDL271EXEMPELSTOCKSU",
      merchantArea: "EXEMPELSTAD",
      merchantCategory: "Grocery Stores, Supermarkets",
      amount: -6434,
    });
  });

  it("rejects an Excel file that isn't a Norwegian export", async () => {
    await expect(parseNorwegianXlsx(fs.readFileSync(path.join(import.meta.dirname, "fixtures/prices/oil-bulletin-history.xlsx")))).rejects.toThrow(ImportParseError);
  });
});

describe.skipIf(!hasPrivateNorwegian)("same fingerprint in PDF and XLSX", () => {
  it("every row of the September invoice has an identical row in the August or September export", async () => {
    const [inv, aug, sep] = await Promise.all([parseNorwegianPdf(pdf.bytes), parseNorwegianXlsx(PRIVATE_AUG), parseNorwegianXlsx(PRIVATE_SEP)]);
    const xlsx = new Set([...aug.rows, ...sep.rows].map((r) => r.fingerprint));
    const missing = inv.rows.filter((r) => !xlsx.has(r.fingerprint)).map((r) => `${r.date} ${r.descriptionRaw}`);
    expect(missing).toEqual([]);
  });
});

describe("Bank Norwegian import across sources", () => {
  // Needs the real invoice and the real exports it overlaps (samples/privat/): the counts are theirs.
  it.skipIf(!hasPrivateNorwegian)("the August export, then the September PDF, then the September export", async () => {
    const db = freshDb({ seeded: true });
    const aug = await importNorwegianXlsx(db, PRIVATE_AUG, "Augusti.xlsx");
    expect(aug).toMatchObject({ rowsTotal: 42, rowsNew: 42, rowsSkipped: 0 });

    const sepPdf = await importNorwegianPdf(db, pdf.bytes, pdf.name);
    // Skipped: the purchases from the 15th that already came from the August export, and the payment.
    expect(sepPdf).toMatchObject({ rowsTotal: 32, rowsNew: 11, rowsSkipped: 21, possibleDuplicates: [] });
    // The invoice is still recorded and sets the balance.
    expect(db.select().from(statements).all()).toHaveLength(1);

    const sep = await importNorwegianXlsx(db, PRIVATE_SEP, "September.xlsx");
    // The booked purchases are skipped, the newest are new, and the reserved ones are not imported.
    expect(sep).toMatchObject({ rowsTotal: 14, rowsNew: 3, rowsSkipped: 11, reserved: { count: 5, amount: -95428 } });
    expect(txCount(db)).toBe(42 + 11 + 3);
    expect(db.select().from(transactions).where(sql`amount = -22100`).all()).toEqual([]); // a reserved purchase
  });

  it.skipIf(!hasPrivateNorwegian)("gives the same rows whatever the import order", async () => {
    const orders = [
      ["aug", "pdf", "sep"],
      ["pdf", "sep", "aug"],
      ["sep", "aug", "pdf"],
    ];
    const snapshots = [];
    for (const order of orders) {
      const db = freshDb({ seeded: true });
      for (const step of order) {
        if (step === "pdf") await importNorwegianPdf(db, pdf.bytes, pdf.name);
        else await importNorwegianXlsx(db, step === "aug" ? PRIVATE_AUG : PRIVATE_SEP, step);
      }
      snapshots.push(
        db
          .select({ fp: transactions.fingerprint, i: transactions.occurrenceIndex, d: transactions.bookingDate, a: transactions.amount })
          .from(transactions)
          .all()
          .map((r) => `${r.d}|${r.a}|${r.i}|${r.fp}`)
          .sort(),
      );
    }
    expect(snapshots[0]).toHaveLength(56);
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
  });

  it("gives the same rows whatever the order of two exports", async () => {
    const snapshot = async (order: [Buffer, string][]) => {
      const db = freshDb({ seeded: true });
      for (const [bytes, name] of order) await importNorwegianXlsx(db, bytes, name);
      return db
        .select({ fp: transactions.fingerprint, i: transactions.occurrenceIndex, d: transactions.bookingDate, a: transactions.amount })
        .from(transactions)
        .all()
        .map((r) => `${r.d}|${r.a}|${r.i}|${r.fp}`)
        .sort();
    };
    const forward = await snapshot([[AUG, "Augusti.xlsx"], [SEP, "September.xlsx"]]);
    expect(forward).toHaveLength(17 + 8);
    expect(await snapshot([[SEP, "September.xlsx"], [AUG, "Augusti.xlsx"]])).toEqual(forward);
  });

  it("re-importing an XLSX gives 0 new", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianXlsx(db, AUG, "Augusti.xlsx");
    expect((await importNorwegianXlsx(db, AUG, "Augusti.xlsx")).rowsNew).toBe(0);
    expect(txCount(db)).toBe(17);
  });

  it.skipIf(!hasPrivateNorwegian)("never touches existing rows (a manual edit on a PDF row survives the XLSX)", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianPdf(db, pdf.bytes, pdf.name);
    const [asian] = byDesc(db, "EXEMPEL TRADING");
    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.update(transactions)
      .set({ categoryId: other.id, categorySource: "manual", shared: false, note: "privat", manuallyEditedAt: "2026-09-18T12:00:00Z" })
      .where(eq(transactions.id, asian.id))
      .run();
    const before = db.select().from(transactions).all();
    await importNorwegianXlsx(db, PRIVATE_AUG, "Augusti.xlsx");
    const after = db.select().from(transactions).all();
    // Only the posting day (unknown in the PDF) is filled in: nothing the user or the PDF set changes.
    const withoutPosted = (rows: typeof before) => rows.map(({ postedDate: _, ...r }) => r);
    expect(withoutPosted(after.slice(0, before.length))).toEqual(withoutPosted(before));
    const asianAfter = after.find((t) => t.id === asian.id)!;
    expect(asianAfter).toMatchObject({ note: "privat", shared: false, categoryId: other.id, postedDate: "2026-08-23" });
  });

  it("is worth importing again when existing rows lack their posting day", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianXlsx(db, AUG, "Augusti.xlsx");
    db.update(transactions).set({ postedDate: null }).run(); // as imported before posting days were stored
    const dry = await importFiles(db, [{ name: "Augusti.xlsx", bytes: AUG }], { dryRun: true });
    expect(dry.files[0]).toMatchObject({ ok: true, alreadyImported: false, result: { rowsNew: 0, postedDatesAdded: 17 } });
    const real = await importFiles(db, [{ name: "Augusti.xlsx", bytes: AUG }], {});
    expect(real.files[0]).toMatchObject({ ok: true, result: { postedDatesAdded: 17 } });
    expect(db.select().from(transactions).where(sql`posted_date is null`).all()).toEqual([]);
    const again = await importFiles(db, [{ name: "Augusti.xlsx", bytes: AUG }], { dryRun: true });
    expect(again.files[0]).toMatchObject({ alreadyImported: true });
  });

  it("stores the posting day (BookDate), which decides the invoice", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianXlsx(db, AUG, "Augusti.xlsx");
    // Bought on the 14th, posted on the 15th: the last day of the invoice 16/7–15/8.
    expect(byDesc(db, "MCDONALDS EXEMPEL").map((t) => [t.transactionDate, t.postedDate])).toContainEqual(["2026-08-14", "2026-08-15"]);
  });

  it("stores payments as non-shared transfers and purchases as shared", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianXlsx(db, AUG, "Augusti.xlsx");
    const [payment] = byDesc(db, "Inbetalning");
    expect(payment).toMatchObject({ amount: 791350, isTransfer: true, shared: false, counterparty: "Bank Norwegian" });
    expect(pathOf(db, payment.categoryId)).toBe("Överföringar & sparande/Kortbetalning");
    const purchases = db.select().from(transactions).where(eq(transactions.isTransfer, false)).all();
    expect(purchases).toHaveLength(16);
    expect(purchases.every((t) => t.shared && t.amount < 0 && t.bookingDate === t.transactionDate)).toBe(true);
  });
});

describe("categorisation from Merchant Category", () => {
  it("maps merchant categories, lets rules win, and stores category and area", async () => {
    const db = freshDb({ seeded: true });
    const r = await importNorwegianXlsx(db, AUG, "Augusti.xlsx");
    expect(r.rowsUncategorized).toBe(0);
    expect(r.unmappedMerchantCategories).toEqual([]);

    const one = (d: string) => byDesc(db, d)[0];
    // STADIUM: no rule, but the bank says department store.
    expect(one("STADIUM EXEMPELSTAD")).toMatchObject({ categorySource: "merchant_category", merchantCategory: "DEPARTMENT STORES", merchantArea: "EXEMPELSTAD" });
    expect(pathOf(db, one("STADIUM EXEMPELSTAD").categoryId)).toBe("Prylar & hem");
    expect(pathOf(db, one("OKQ8 EXEMPELSTAD").categoryId)).toBe("Bil/Drivmedel");
    expect(pathOf(db, one("PIZZERIA ROMA").categoryId)).toBe("Mat/Restaurang & café");
    // A rule exists for these, so the rule wins (and the bank's own category is still stored).
    expect(one("ICA NARA EXEMPELBY")).toMatchObject({ categorySource: "rule", merchantCategory: "MISC FOOD STORES - DEFAULT", merchantArea: "EXEMPELBY" });
    expect(pathOf(db, one("ICA NARA EXEMPELBY").categoryId)).toBe("Mat/Livsmedel");
    expect(one("SYSTEMBOLAGET")).toMatchObject({ categorySource: "rule" });
    expect(pathOf(db, one("SYSTEMBOLAGET").categoryId)).toBe("Mat/Alkohol");
    expect(one("LIDL271EXEMPELSTOCKSU").categorySource).toBe("rule");
  });

  it("a rule can move a merchant away from its merchant category", async () => {
    const db = freshDb({ seeded: true });
    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.insert(merchantRules).values({ pattern: "STADIUM", matchType: "contains", categoryId: other.id }).run();
    await importNorwegianXlsx(db, AUG, "Augusti.xlsx");
    expect(byDesc(db, "STADIUM EXEMPELSTAD")[0]).toMatchObject({ categoryId: other.id, categorySource: "rule" });
  });

  it("logs unknown merchant categories for mapping (not in a dry run)", async () => {
    const db = freshDb({ seeded: true });
    db.delete(merchantCategoryMap).where(eq(merchantCategoryMap.key, "DEPARTMENT STORES")).run();

    const dry = await importNorwegianXlsx(db, AUG, "Augusti.xlsx", { dryRun: true });
    expect(dry.unmappedMerchantCategories).toEqual([{ label: "DEPARTMENT STORES", rows: 2 }]);
    expect(db.select().from(merchantCategoryMap).where(eq(merchantCategoryMap.key, "DEPARTMENT STORES")).get()).toBeUndefined();

    const r = await importNorwegianXlsx(db, AUG, "Augusti.xlsx");
    expect(r.rowsUncategorized).toBe(2);
    expect(byDesc(db, "STADIUM EXEMPELSTAD")[0]).toMatchObject({ categoryId: null, categorySource: "none" });
    expect(db.select().from(merchantCategoryMap).where(eq(merchantCategoryMap.key, "DEPARTMENT STORES")).get()).toMatchObject({
      label: "DEPARTMENT STORES",
      categoryId: null,
      timesSeen: 2,
    });
    // Known categories are counted too.
    expect(db.select().from(merchantCategoryMap).where(eq(merchantCategoryMap.key, "GROCERY STORES SUPERMARKETS")).get()!.timesSeen).toBe(6);
  });
});
