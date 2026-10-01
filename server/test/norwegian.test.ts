import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { accounts, categories, imports, merchantRules, statements, transactions } from "../src/db/schema.js";
import { maskLongNumbers, parseNordicAmount, parseNorwegianLines, parseNorwegianPdf } from "../src/import/norwegian.js";
import { importNorwegianInvoice, importNorwegianPdf } from "../src/import/importNorwegian.js";
import { splitPdfDescription } from "../src/import/norwegianKey.js";
import { ImportParseError } from "../src/import/swedbank.js";
import type { PdfLine } from "../src/import/pdfText.js";
import { freshDb, hasNorwegianInvoice, privateSecrets, samplePdf } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const txCount = (db: Db) => db.select({ n: sql<number>`count(*)` }).from(transactions).get()!.n;
const norwegianAccount = (db: Db) => db.select().from(accounts).where(eq(accounts.source, "norwegian")).get()!;
const CARD = "412345******0000";
/** The real invoice's card is masked the same way (first six, last four) but is not in git. */
const CARD_FORMAT = /^\d{6}\*{6}\d{4}$/;

// ---- Synthetic invoices, laid out like the real PDF (same x positions). ----

function nordic(ore: number): string {
  const sign = ore < 0 ? "-" : "";
  const abs = Math.abs(ore);
  const kr = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${kr},${String(abs % 100).padStart(2, "0")}`;
}

interface SynthRow {
  date: string; // DD.MM.YYYY
  desc: string;
  amount: number; // öre as printed (purchases positive, payments negative)
  card?: string | null;
}

function synthInvoice(opts: {
  invoiceDate: string;
  dueDate: string;
  period: string;
  opening: number;
  rows: SynthRow[];
  purchasesTotal?: number;
  totalDebt?: number;
}): PdfLine[] {
  const purchases = opts.rows.filter((r) => !r.desc.startsWith("Inbetalning")).reduce((a, r) => a + r.amount, 0);
  const payments = opts.rows.filter((r) => r.desc.startsWith("Inbetalning")).reduce((a, r) => a + r.amount, 0);
  const purchasesTotal = opts.purchasesTotal ?? purchases;
  const total = opts.totalDebt ?? opts.opening + payments + purchasesTotal;
  let y = 800;
  const line = (page: number, items: [number, string][]): PdfLine => ({ page, y: (y -= 11), items: items.map(([x, text]) => ({ x, text })) });
  return [
    line(1, [[325, "Bank Norwegian-kortet"]]),
    line(1, [[44, "Fakturadatum"], [210, opts.invoiceDate]]),
    line(1, [[44, "Förfallodatum"], [210, opts.dueDate]]),
    line(1, [[44, "Period"], [181, opts.period], [327, "Förnamn Efternamn"]]),
    line(1, [[43, "Ingående skuld från föregående period"], [462, "Kr"], [529, nordic(opts.opening)]]),
    line(1, [[43, "Summa inbetalningar"], [462, "Kr"], [526, nordic(payments)]]),
    line(1, [[43, "Summa transaktioner denna period"], [462, "Kr"], [529, nordic(purchasesTotal)]]),
    line(1, [[43, "Total skuld per x"], [461, "Kr"], [529, nordic(total)]]),
    line(1, [[43, "Lägsta belopp att betala (3.5% av skuld, minimum kr 300,00)"], [461, "Kr"], [536, "300,00"]]),
    line(2, [[24, "Datum"], [74, "Beskrivning"], [279, "Kortnr"], [348, "Lokal Valuta"], [416, "Valuta"], [458, "Valutakurs"], [516, "Belopp i SEK"]]),
    ...opts.rows.map((r) =>
      r.desc.startsWith("Inbetalning")
        ? line(2, [[24, r.date], [74, r.desc], [549, nordic(r.amount)]])
        : line(2, [[24, r.date], [74, r.desc], [267, r.card ?? CARD], [385, nordic(r.amount)], [432, "SEK"], [557, nordic(r.amount)]]),
    ),
    line(2, [[29, "Utnyttjad kredit"], [145, "3 mnd"]]),
    line(2, [[46, "Kr 5.000"], [148, "275,-"]]),
  ];
}

// The August invoice: its last day (15.08) overlaps the September invoice.
const augustInvoice = () =>
  parseNorwegianLines(
    synthInvoice({
      invoiceDate: "15.08.2026",
      dueDate: "28.08.2026",
      period: "16.07.26 - 15.08.26",
      opening: 500000,
      rows: [
        { date: "20.07.2026", desc: "Inbetalning från 1234567", amount: -500000 },
        { date: "01.08.2026", desc: "WILLYS EXEMPELCENTRUM ,EXEMPELSTAD", amount: 581100 },
        { date: "15.08.2026", desc: "LIDLSVERIGEKB ,STOCKHOLM", amount: 18940 },
        { date: "15.08.2026", desc: "ICA EXEMPELTORGET ,EXEMPELSTAD", amount: 9640 },
      ],
    }),
  );

describe("parseNordicAmount", () => {
  it.each([
    ["6.123,45", 612345],
    ["-6.123,45", -612345],
    ["189,40", 18940],
    ["Kr 300,00", 30000],
    ["1.234.567,89", 123456789],
    ["0,05", 5],
  ])("%s -> %i", (s, ore) => expect(parseNordicAmount(s)).toBe(ore));

  it.each(["", "275,-", "8,847.47", "12,3", "1.23,45", "abc"])("rejects %j", (s) => expect(parseNordicAmount(s)).toBeNull());
});

describe("helpers", () => {
  it("masks long digit runs but keeps short ones", () => {
    expect(maskLongNumbers("Inbetalning från 1234567")).toBe("Inbetalning från ••4567");
    expect(maskLongNumbers("LIDL271EXEMPELSTOCKSU")).toBe("LIDL271EXEMPELSTOCKSU");
  });

  it("splits the PDF description into merchant text and area (on the last comma)", () => {
    expect(splitPdfDescription("LIDLSVERIGEKB ,STOCKHOLM")).toEqual({ merchant: "LIDLSVERIGEKB", area: "STOCKHOLM" });
    expect(splitPdfDescription("PIZZERIA ROMA CENTRUM,EXEMPELSTAD")).toEqual({ merchant: "PIZZERIA ROMA CENTRUM", area: "EXEMPELSTAD" });
    expect(splitPdfDescription("SUSHI HOUSE - EXEMPELBY ,EXEMPELBY")).toEqual({ merchant: "SUSHI HOUSE - EXEMPELBY", area: "EXEMPELBY" });
    expect(splitPdfDescription("GITHUB, INC. ,SAN FRANCISCO")).toEqual({ merchant: "GITHUB, INC.", area: "SAN FRANCISCO" });
    expect(splitPdfDescription("NO CITY")).toEqual({ merchant: "NO CITY", area: null });
  });
});

describe.skipIf(!hasNorwegianInvoice)("parseNorwegianPdf on the real invoice", async () => {
  const pdf = samplePdf();
  // Parsed only when the invoice is there: this body runs even when skipped.
  const invoice = hasNorwegianInvoice ? await parseNorwegianPdf(pdf.bytes) : (undefined as never);

  it("reads page 1", () => {
    expect(invoice.statement).toEqual({
      invoiceDate: "2026-09-15",
      dueDate: "2026-09-28",
      periodFrom: "2026-08-16",
      periodTo: "2026-09-15",
      openingDebt: 612345,
      paymentsTotal: -612345,
      purchasesTotal: 548620,
      totalDebt: 548620,
      minPayment: 30000,
    });
  });

  it("reads 31 purchases and 1 payment, matching the invoice totals", () => {
    const purchases = invoice.rows.filter((r) => !r.isPayment);
    const payments = invoice.rows.filter((r) => r.isPayment);
    expect(invoice.rows).toHaveLength(32);
    expect(purchases).toHaveLength(31);
    expect(purchases.reduce((a, r) => a + r.amount, 0)).toBe(-548620);
    expect(purchases.every((r) => r.amount < 0 && r.cardMasked !== null && CARD_FORMAT.test(r.cardMasked))).toBe(true);
    expect(payments).toEqual([
      expect.objectContaining({ date: "2026-08-25", descriptionClean: expect.stringMatching(/^Inbetalning från ••\d{4}$/), amount: 612345, cardMasked: null }),
    ]);
  });

  it("parses rows in order with dates, descriptions and amounts", () => {
    expect(invoice.rows[1]).toMatchObject({
      date: "2026-08-15",
      descriptionRaw: "LIDLSVERIGEKB ,STOCKHOLM",
      descriptionClean: "LIDLSVERIGEKB",
      merchantArea: "STOCKHOLM",
      amount: -18940,
    });
    expect(invoice.rows.at(-1)).toMatchObject({ date: "2026-09-13", amount: -7425 });
    expect(new Set(invoice.rows.map((r) => r.fingerprint)).size).toBe(32);
  });

  it("gives the same result when parsed twice", async () => {
    const again = await parseNorwegianPdf(pdf.bytes);
    expect(again).toEqual(invoice);
  });
});

describe("parseNorwegianLines validation", () => {
  const base = {
    invoiceDate: "15.08.2026",
    dueDate: "28.08.2026",
    period: "16.07.26 - 15.08.26",
    opening: 0,
    rows: [{ date: "01.08.2026", desc: "LIDL ,STOCKHOLM", amount: 10000 }],
  };

  it("accepts a consistent invoice", () => {
    expect(parseNorwegianLines(synthInvoice(base)).rows).toHaveLength(1);
  });

  it("rejects an invoice whose table doesn't add up to the summary", () => {
    expect(() => parseNorwegianLines(synthInvoice({ ...base, purchasesTotal: 12345 }))).toThrow(/stämmer inte/);
    expect(() => parseNorwegianLines(synthInvoice({ ...base, totalDebt: 1 }))).toThrow(/stämmer inte/);
  });

  it("rejects a transaction row without a readable amount", () => {
    const lines = synthInvoice(base);
    const row = lines.find((l) => l.items[0].text === "01.08.2026")!;
    row.items[row.items.length - 1].text = "100.00";
    expect(() => parseNorwegianLines(lines)).toThrow(ImportParseError);
  });

  it("rejects documents that are not Bank Norwegian invoices", () => {
    const lines = synthInvoice(base).filter((l) => !l.items.some((i) => i.text.includes("Bank Norwegian")));
    expect(() => parseNorwegianLines(lines)).toThrow(/inte ut som en faktura/);
  });

  it("keeps two identical purchases on the same day", () => {
    const inv = parseNorwegianLines(
      synthInvoice({
        ...base,
        rows: [
          { date: "01.08.2026", desc: "SL ,STOCKHOLM", amount: 4300 },
          { date: "01.08.2026", desc: "SL ,STOCKHOLM", amount: 4300 },
        ],
      }),
    );
    const db = freshDb({ seeded: true });
    expect(importNorwegianInvoice(db, inv, "x.pdf").rowsNew).toBe(2);
    expect(importNorwegianInvoice(db, inv, "x.pdf").rowsNew).toBe(0);
    expect(txCount(db)).toBe(2);
  });
});

describe("Bank Norwegian import of a made-up invoice", () => {
  const invoice = () =>
    parseNorwegianLines(
      synthInvoice({
        invoiceDate: "15.09.2026",
        dueDate: "28.09.2026",
        period: "16.08.26 - 15.09.26",
        opening: 0,
        rows: [
          { date: "20.08.2026", desc: "LIDLSVERIGEKB ,EXEMPELSTAD", amount: 18940 },
          { date: "22.08.2026", desc: "COOP EXEMPELVAGEN ,EXEMPELSTAD", amount: 9640 },
          { date: "30.08.2026", desc: "WILLYS EXEMPELSTAD ,EXEMPELSTAD", amount: 15500 },
          { date: "05.09.2026", desc: "WILLYS EXEMPELBY ,EXEMPELBY", amount: 7425 },
          { date: "07.09.2026", desc: "EXEMPELBUTIKEN ,EXEMPELSTAD", amount: 49900 },
        ],
      }),
    );
  const byDesc = (db: Db, d: string) => db.select().from(transactions).where(eq(transactions.descriptionClean, d)).get()!;

  it("categorises purchases with the rules, and leaves the unknown merchant uncategorised (the PDF has no merchant category)", () => {
    const db = freshDb({ seeded: true });
    const r = importNorwegianInvoice(db, invoice(), "x.pdf");
    const cat = (id: number | null) => db.select().from(categories).where(eq(categories.id, id!)).get()?.name;
    expect(cat(byDesc(db, "LIDLSVERIGEKB").categoryId)).toBe("Livsmedel");
    expect(cat(byDesc(db, "COOP EXEMPELVAGEN").categoryId)).toBe("Livsmedel");
    expect(byDesc(db, "EXEMPELBUTIKEN").categoryId).toBeNull();
    expect(r.rowsUncategorized).toBe(1);
    expect(byDesc(db, "LIDLSVERIGEKB")).toMatchObject({ counterparty: "LIDLSVERIGEKB", merchantArea: "EXEMPELSTAD", merchantCategory: null });
  });

  it("lets a rule turn off the shared default", () => {
    const db = freshDb({ seeded: true });
    const rule = db.select().from(merchantRules).where(eq(merchantRules.pattern, "WILLYS")).get()!;
    db.update(merchantRules).set({ sharedDefault: false }).where(eq(merchantRules.id, rule.id)).run();
    importNorwegianInvoice(db, invoice(), "x.pdf");
    const willys = db.select().from(transactions).where(sql`description_clean like 'WILLYS%'`).all();
    expect(willys).toHaveLength(2);
    expect(willys.every((t) => t.shared === false)).toBe(true);
    expect(byDesc(db, "LIDLSVERIGEKB").shared).toBe(true);
  });
});

describe.skipIf(!hasNorwegianInvoice)("Bank Norwegian import", () => {
  const pdf = samplePdf();

  it("importing the same PDF twice gives 32 rows (31 purchases + 1 payment), second time 0 new", async () => {
    const db = freshDb({ seeded: true });
    const first = await importNorwegianPdf(db, pdf.bytes, pdf.name);
    expect(first).toMatchObject({ rowsTotal: 32, rowsNew: 32, rowsSkipped: 0 });
    const second = await importNorwegianPdf(db, pdf.bytes, pdf.name);
    expect(second).toMatchObject({ rowsTotal: 32, rowsNew: 0, rowsSkipped: 32, possibleDuplicates: [] });
    expect(second.statement.alreadyImported).toBe(true);
    expect(txCount(db)).toBe(32);
    expect(db.select().from(statements).all()).toHaveLength(1);
    expect(db.select().from(imports).all().map((i) => [i.source, i.periodFrom, i.periodTo, i.rowsNew])).toEqual([
      ["norwegian", "2026-08-16", "2026-09-15", 32],
      ["norwegian", "2026-08-16", "2026-09-15", 0],
    ]);
  });

  it("stores purchases negative and shared, and the payment as a non-shared transfer", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianPdf(db, pdf.bytes, pdf.name);
    const rows = db.select().from(transactions).all();
    const account = norwegianAccount(db);
    expect(rows.every((r) => r.source === "norwegian" && r.accountId === account.id && r.currency === "SEK")).toBe(true);

    const purchases = rows.filter((r) => !r.isTransfer);
    expect(purchases).toHaveLength(31);
    expect(purchases.every((r) => r.amount < 0 && r.shared && CARD_FORMAT.test(r.cardMasked ?? ""))).toBe(true);
    expect(purchases.reduce((a, r) => a + r.amount, 0)).toBe(-548620);

    const [payment] = rows.filter((r) => r.isTransfer);
    const kortbetalning = db.select().from(categories).where(eq(categories.name, "Kortbetalning")).get()!;
    expect(payment).toMatchObject({
      amount: 612345,
      shared: false,
      categoryId: kortbetalning.id,
      descriptionClean: expect.stringMatching(/^Inbetalning från ••\d{4}$/),
      counterparty: "Bank Norwegian",
    });
  });

  it("categorises purchases with the rules", async () => {
    const db = freshDb({ seeded: true });
    const r = await importNorwegianPdf(db, pdf.bytes, pdf.name);
    const byDesc = (d: string) => db.select().from(transactions).where(eq(transactions.descriptionClean, d)).get()!;
    const cat = (id: number | null) => db.select().from(categories).where(eq(categories.id, id!)).get()?.name;
    expect(cat(byDesc("LIDLSVERIGEKB").categoryId)).toBe("Livsmedel");
    expect(cat(byDesc("COOP EXEMPELVAGEN").categoryId)).toBe("Livsmedel");
    // The PDF has no merchant category, so these stay uncategorised.
    expect(byDesc("EXEMPELBUTIKEN").categoryId).toBeNull();
    expect(r.rowsUncategorized).toBeGreaterThanOrEqual(2); // EXEMPELBUTIKEN, RUSTA, and whatever no rule covers
    expect(byDesc("LIDLSVERIGEKB")).toMatchObject({ counterparty: "LIDLSVERIGEKB", merchantArea: "STOCKHOLM", merchantCategory: null });
  });

  it("saves the invoice as a statement and sets the account balance to minus the debt", async () => {
    const db = freshDb({ seeded: true });
    const r = await importNorwegianPdf(db, pdf.bytes, pdf.name);
    const account = norwegianAccount(db);
    expect(db.select().from(statements).get()).toMatchObject({
      accountId: account.id,
      periodFrom: "2026-08-16",
      periodTo: "2026-09-15",
      dueDate: "2026-09-28",
      amountDue: 548620,
      minPayment: 30000,
      source: "pdf",
      importId: r.importId,
    });
    expect(account.balance).toBe(-548620);
    expect(account.balanceUpdatedAt).toBe("2026-09-15");
  });

  it("dry run writes nothing (no rows, statement or balance)", async () => {
    const db = freshDb({ seeded: true });
    const r = await importNorwegianPdf(db, pdf.bytes, pdf.name, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, rowsNew: 32, importId: null });
    expect(r.statement.updatesBalance).toBe(true);
    expect(txCount(db)).toBe(0);
    expect(db.select().from(statements).all()).toHaveLength(0);
    expect(norwegianAccount(db).balance).toBe(0);
  });

  it("skips the rows that overlap the previous invoice (15.08)", async () => {
    const db = freshDb({ seeded: true });
    const aug = importNorwegianInvoice(db, augustInvoice(), "Faktura Augusti.pdf");
    expect(aug.rowsNew).toBe(4);
    const sep = await importNorwegianPdf(db, pdf.bytes, pdf.name);
    expect(sep).toMatchObject({ rowsTotal: 32, rowsNew: 30, rowsSkipped: 2 });
    expect(txCount(db)).toBe(34);
    expect(db.select().from(statements).all()).toHaveLength(2);
  });

  it("an older invoice imported later does not overwrite the balance", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianPdf(db, pdf.bytes, pdf.name);
    const r = importNorwegianInvoice(db, augustInvoice(), "Faktura Augusti.pdf");
    expect(r.statement.updatesBalance).toBe(false);
    expect(norwegianAccount(db)).toMatchObject({ balance: -548620, balanceUpdatedAt: "2026-09-15" });
  });

  it("a later manual balance update is not overwritten by an invoice", async () => {
    const db = freshDb({ seeded: true });
    const id = norwegianAccount(db).id;
    db.update(accounts).set({ balance: -700000, balanceUpdatedAt: "2026-09-20T08:00:00.000Z" }).where(eq(accounts.id, id)).run();
    await importNorwegianPdf(db, pdf.bytes, pdf.name);
    expect(norwegianAccount(db).balance).toBe(-700000);
  });

  it("stores no personal data or full numbers from the invoice", async () => {
    const db = freshDb({ seeded: true });
    await importNorwegianPdf(db, pdf.bytes, pdf.name);
    const dump = db.$client
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .flatMap((t: any) => db.$client.prepare(`select * from "${t.name}"`).all())
      .map((r) => JSON.stringify(r))
      .join("\n");
    // What the invoice says about me — name, address, OCR, account — is kept beside it in
    // samples/privat/, out of git: none of it may end up in the database.
    const secrets = privateSecrets("norwegianInvoice");
    expect(secrets.length, "samples/privat/personuppgifter.json").toBeGreaterThan(0);
    for (const secret of secrets) {
      expect(dump, secret).not.toContain(secret);
    }
  });
});
