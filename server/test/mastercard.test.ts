import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { accounts, recurringExpenses, statements, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { extractPdfLines, type PdfLine } from "../src/import/pdfText.js";
import { detectMastercardPdf, mastercardFingerprint, parseMastercardInvoice, parseMastercardList } from "../src/import/mastercard.js";
import { importMastercardInvoice, importMastercardList } from "../src/import/importMastercard.js";
import { importFiles } from "../src/import/importBatch.js";
import { ImportError } from "../src/import/importCore.js";
import { ImportParseError } from "../src/import/swedbank.js";
import { chargeDate, suggestSchedule } from "../src/recurring/schedule.js";
import { buildOverview, cardInvoices, missingInvoices, upcomingInvoices } from "../src/overview/overview.js";
import { MASTERCARD_INVOICE, allSwedbankFiles, freshDb, hasPrivateSample, privateSample } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const INVOICE = MASTERCARD_INVOICE;
const hasInvoice = hasPrivateSample(INVOICE);
// The internet bank's card page saved as PDF: real, so kept in samples/privat/ with the real invoice.
const LIST = "Betal- och kreditkort Mastercard Guld _ Swedbank AB.pdf";
const hasList = hasPrivateSample(LIST);

let invoiceLines: PdfLine[];
let listLines: PdfLine[];
beforeAll(async () => {
  if (hasInvoice) invoiceLines = await extractPdfLines(privateSample(INVOICE).bytes);
  if (hasList) listLines = await extractPdfLines(privateSample(LIST).bytes);
});

// ---------------------------------------------------------------- made-up documents, laid out like the real ones

const line = (page: number, y: number, items: [number, string][]): PdfLine => ({ page, y, items: items.map(([x, text]) => ({ x, text })) });
/** öre -> '8 215,40' / '-161,18' */
function sek(ore: number): string {
  const abs = Math.abs(ore);
  const kr = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${ore < 0 ? "-" : ""}${kr},${String(abs % 100).padStart(2, "0")}`;
}

const CARD = "412345******0000";
// The invoice 2026-08-08–2026-09-04: a payment of the last one and four purchases [day, posting day, text, city (and other currency), öre].
const PAID = { date: "2026-08-28", amount: 230590 };
const PURCHASES: [string, string, string, string, number][] = [
  ["2026-08-08", "2026-08-10", "Amazon Prime", "LUXEMBOURG", 5900],
  ["2026-08-11", "2026-08-12", "STREAMTJANST*MANAD", "EXEMPEL.COM 5,990 EUR Kurs 11,170", 6691],
  ["2026-08-30", "2026-09-01", "MATBUTIKEN EXEMPEL", "EXEMPELSTAD", 31240],
  ["2026-09-02", "2026-09-03", "SPOTIFY", "STOCKHOLM", 11900],
];
const PURCHASES_TOTAL = PURCHASES.reduce((t, r) => t + r[4], 0); // 55731
// Bought after the invoice's period: what the list adds to the debt.
const AFTER = 24550 + 18900 + 25426;
const USED_CREDIT = PURCHASES_TOTAL + AFTER;

function madeUpInvoice(): PdfLine[] {
  let y = 800;
  const next = (items: [number, string][]) => line(1, (y -= 12), items);
  return [
    next([[40, "Mastercard Guld"]]),
    next([[40, "Faktura gäller för perioden: 2026-08-08 - 2026-09-04"]]),
    next([[40, "Datum vid sammanställning: 2026-09-04"]]),
    next([[40, "Oss tillhanda: 2026-09-30"]]),
    next([[40, `Skuld på föregående faktura: ${sek(PAID.amount)}`]]),
    next([[40, `Periodens inbetalningar: ${sek(PAID.amount)}`]]),
    next([[40, `Periodens köp och transaktioner (inklusive avgifter): ${sek(PURCHASES_TOTAL)}`]]),
    next([[40, `Total skuld vid sammanställning: ${sek(PURCHASES_TOTAL)}`]]),
    next([[300, "Lägst att betala:"]]),
    next([[300, "100,00"]]),
    next([[40, "Vid nästa avisering redovisas köp och uttag gjorda t o m 2026-10-07"]]),
    next([[40, "Specifikation"]]),
    next([[24, "Transaktionsdatum"], [80, "Bokföringsdatum"], [140, "Beskrivning"], [300, "Ort"], [440, "Belopp"], [500, "Inbetalt"]]),
    // The payment comes before any card.
    next([[24, PAID.date], [80, PAID.date], [140, "INBETALNING"], [500, sek(PAID.amount)]]),
    next([[40, `Kortnr: ${CARD}`]]),
    ...PURCHASES.flatMap(([date, posted, text, city, ore], i) => [
      next([[24, date], [80, posted], [140, text], [300, city], [440, sek(ore)]]),
      ...(i === 1 ? [next([[140, "INTERNET TRANSAKTION"]])] : []),
    ]),
    next([[40, `PERIODENS TOTALA TRANSAKTIONER KORTNR ${CARD}: ${sek(PURCHASES_TOTAL)}`]]),
    next([[40, `TOTALT: ${sek(PURCHASES_TOTAL)} ${sek(PAID.amount)}`]]),
  ];
}

type ListEntry = { heading: string } | { desc: string; date: string; amount: string; foreign?: string; account?: boolean } | { foreignOnly: string };
// Newest first, as the bank shows it. The currency line of the last row on page 1 is cut to the top of page 2, and the last row is cut off.
const LIST_PAGES: ListEntry[][] = [
  [
    { heading: "september 2026" },
    { desc: "MATBUTIKEN EXEMPEL", date: "2026-09-12", amount: "-245,50" },
    { desc: "PIZZERIA ROMA", date: "2026-09-07", amount: "-189,00" },
    { desc: "STREAMTJANST*MANAD", date: "2026-09-06", amount: "-254,26" },
  ],
  [
    { foreignOnly: "-22,50 EUR" },
    { desc: "SPOTIFY", date: "2026-09-02", amount: "-119,00" },
    { heading: "augusti 2026" },
    { desc: "MATBUTIKEN EXEMPEL", date: "2026-08-30", amount: "-312,40" },
    { desc: "INBETALNING BANKGIRO", date: PAID.date, amount: sek(PAID.amount) },
    { desc: "STREAMTJANST*MANAD", date: "2026-08-11", amount: "-66,91", foreign: "-5,99 EUR" },
    { desc: "Amazon Prime", date: "2026-08-08", amount: "-59,00" },
    { desc: "PIZZERIA ROMA", date: "2026-08-05", amount: "-150,00" },
    { desc: "SPOTIFY", date: "2026-08-02", amount: "-119,00" },
    { heading: "juli 2026" },
    { desc: "INBETALNING", date: "2026-07-28", amount: "1 688,20" },
    { desc: "BONUSUTBETALNING", date: "2026-07-14", amount: "20,00", account: true },
    { desc: "ICA KVANTUM EXEMPEL", date: "2026-07-03", amount: "-210,00" },
    { desc: "SPOTIFY", date: "2026-07-02", amount: "-119,00" },
    { heading: "juni 2026" },
    { desc: "SPOTIFY", date: "2026-06-02", amount: "-119,00" },
    { desc: "STREAMTJANST*VIP", date: "2026-06-01", amount: "-60,00", foreign: "6 00 USD" },
  ],
];
const LIST_ROWS = 15; // the rows with an amount: everything above but the cut-off one

function madeUpList(): PdfLine[] {
  const out: PdfLine[] = [
    line(1, 800, [[40, "Betal- och kreditkort Mastercard Guld"]]),
    line(1, 788, [[40, "Korttransaktioner"], [300, "2026-09-18 13:45"]]),
    line(1, 776, [[400, "Utnyttjad kredit"]]),
    line(1, 764, [[400, sek(-USED_CREDIT)]]),
    line(1, 740, [[40, "Transaktioner"], [300, "Datum"], [490, "Belopp"]]),
  ];
  LIST_PAGES.forEach((entries, i) => {
    const page = i + 1;
    let y = page === 1 ? 740 : 800;
    for (const e of entries) {
      if ("foreignOnly" in e) out.push(line(page, y, [[490, e.foreignOnly]]));
      else if ("heading" in e) out.push(line(page, (y -= 24), [[40, e.heading]]));
      else {
        out.push(line(page, (y -= 36), [[40, e.desc], [300, e.date], [490, e.amount]]));
        // The account number's tail is printed on a second line: never kept.
        if (e.account) out.push(line(page, y - 6, [[40, "(...0000)"]]));
        if (e.foreign) out.push(line(page, y - 11, [[490, e.foreign]]));
      }
    }
  });
  return out;
}
const INVOICE_LINES = madeUpInvoice();
const LIST_LINES = madeUpList();

const card = (db: Db) => db.select().from(accounts).where(eq(accounts.source, "mastercard")).get()!;
const cardRows = (db: Db) => db.select().from(transactions).where(and(eq(transactions.accountId, card(db).id), isNull(transactions.deletedAt))).all();
/** Moves one text item in the parsed PDF (to simulate a different file). */
const edit = (lines: PdfLine[], from: string, to: string) =>
  lines.map((l) => ({ ...l, items: l.items.map((i) => (i.text === from ? { ...i, text: to } : i)) }));
const pathOf = (db: Db, id: number | null) => [...getCategoryPathMap(db)].find(([, v]) => v === id)?.[0];

describe("Mastercard invoice (made-up PDF text)", () => {
  it("reads the statement and every row of the specification", () => {
    expect(detectMastercardPdf(INVOICE_LINES)).toBe("invoice");
    const { statement, rows } = parseMastercardInvoice(INVOICE_LINES);
    expect(statement).toEqual({
      invoiceDate: "2026-09-04",
      periodFrom: "2026-08-08",
      periodTo: "2026-09-04",
      dueDate: "2026-09-30",
      openingDebt: 230590,
      paymentsTotal: 230590,
      purchasesTotal: 55731,
      totalDebt: 55731,
      minPayment: 10000,
      nextPeriodTo: "2026-10-07",
    });
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ description: "INBETALNING", amount: 230590, isPayment: true, cardMasked: null });
    expect(rows.find((r) => r.description === "STREAMTJANST*MANAD")).toMatchObject({
      transactionDate: "2026-08-11",
      postedDate: "2026-08-12",
      merchantArea: "EXEMPEL.COM",
      amount: -6691,
      foreignAmount: -599,
      foreignCurrency: "EUR",
      exchangeRate: 11.17,
      cardMasked: CARD,
    });
    // 'INTERNET TRANSAKTION' is not part of the description; nothing holds the account number or OCR.
    expect(rows.map((r) => r.description).join(" ")).not.toMatch(/INTERNET|\d{13,}/);
  });

  it("refuses an invoice whose rows don't add up to its totals", () => {
    expect(() => parseMastercardInvoice(edit(INVOICE_LINES, "312,40", "312,50"))).toThrow(ImportParseError);
  });

  it("refuses a statement whose debt doesn't add up", () => {
    const bad = INVOICE_LINES.map((l) => ({ ...l, items: l.items.map((i) => ({ ...i, text: i.text.replace("Skuld på föregående faktura: 2 305,90", "Skuld på föregående faktura: 2 305,91") })) }));
    expect(() => parseMastercardInvoice(bad)).toThrow(/stämmer inte med dess summor/);
  });

  it("refuses a document that is not an invoice", () => {
    expect(() => parseMastercardInvoice(INVOICE_LINES.slice(0, 5))).toThrow(ImportParseError);
  });
});

describe("Mastercard transaction list (made-up PDF text)", () => {
  it("reads rows by position, joins currency lines cut to the next page, and reports the cut-off last row", () => {
    expect(detectMastercardPdf(LIST_LINES)).toBe("list");
    const list = parseMastercardList(LIST_LINES);
    expect(list.printedAt).toBe("2026-09-18");
    expect(list.usedCredit).toBe(USED_CREDIT);
    expect(list.rows).toHaveLength(LIST_ROWS);
    expect(list.incomplete).toEqual([{ date: "2026-06-01", description: "STREAMTJANST*VIP", reason: 'ofullständig valutarad "6 00 USD"' }]);
    // '-22,50 EUR' printed at the top of page 2 belongs to the last row of page 1.
    expect(list.rows.find((r) => r.transactionDate === "2026-09-06")).toMatchObject({ amount: -25426, foreignAmount: -2250, foreignCurrency: "EUR" });
    expect(list.rows.find((r) => r.transactionDate === "2026-08-11")).toMatchObject({ amount: -6691, foreignAmount: -599, foreignCurrency: "EUR" });
    // The SEK amount of a row with no currency line is its own.
    expect(list.rows.find((r) => r.transactionDate === "2026-09-12")).toMatchObject({ description: "MATBUTIKEN EXEMPEL", amount: -24550, foreignAmount: null });
    // '(...0000)' (part of the account number) is never kept.
    expect(list.rows.filter((r) => r.description === "BONUSUTBETALNING")).toHaveLength(1);
    expect(list.rows.some((r) => /0000/.test(r.description))).toBe(false);
    expect(list.rows.filter((r) => r.isPayment).map((r) => [r.transactionDate, r.amount])).toEqual([
      ["2026-08-28", 230590],
      ["2026-07-28", 168820],
    ]);
  });

  it("checks the dates against the month headings", () => {
    expect(() => parseMastercardList(edit(LIST_LINES, "2026-07-03", "2026-08-03"))).toThrow(/månadsrubrikerna/);
  });

  it("refuses an amount it can't tie to a row", () => {
    const stray = [...LIST_LINES, line(2, 100, [[490, "-10,00"]])];
    expect(() => parseMastercardList(stray)).toThrow(/gick inte att knyta/);
  });

  it("uses the same fingerprint for the same purchase in the invoice and the transaction list", () => {
    const inv = parseMastercardInvoice(INVOICE_LINES).rows;
    const list = parseMastercardList(LIST_LINES).rows;
    for (const r of inv) expect(list.map((x) => x.fingerprint)).toContain(r.fingerprint);
    expect(mastercardFingerprint({ transactionDate: "2026-08-28", description: "INBETALNING BANKGIRO", amount: 230590 })).toBe(inv[0].fingerprint);
  });
});

describe("importing Mastercard", () => {
  function imported() {
    const db = freshDb({ seeded: true });
    importMastercardInvoice(db, parseMastercardInvoice(INVOICE_LINES), "faktura.pdf");
    return db;
  }

  it("the invoice gives rows, the statement and the balance", () => {
    const db = imported();
    expect(cardRows(db)).toHaveLength(5);
    expect(db.select().from(statements).where(eq(statements.accountId, card(db).id)).all()).toMatchObject([
      { periodFrom: "2026-08-08", periodTo: "2026-09-04", dueDate: "2026-09-30", amountDue: 55731, minPayment: 10000, source: "pdf" },
    ]);
    expect(card(db)).toMatchObject({ balance: -55731, balanceUpdatedAt: "2026-09-04" });
    const cat = (d: string) => pathOf(db, cardRows(db).find((r) => r.descriptionClean === d)!.categoryId);
    expect(cat("SPOTIFY")).toBe("Nöje/Streaming");
    expect(cat("MATBUTIKEN EXEMPEL")).toBeUndefined();
    expect(cat("INBETALNING")).toBe("Överföringar & sparande/Kortbetalning");
    expect(cardRows(db).find((r) => r.descriptionClean === "INBETALNING")).toMatchObject({ isTransfer: true, shared: false });
    // A second import finds nothing new.
    const again = importMastercardInvoice(db, parseMastercardInvoice(INVOICE_LINES), "faktura.pdf");
    expect(again).toMatchObject({ rowsNew: 0, statement: { alreadyImported: true } });
  });

  it("replaces an invoice entered by hand for the same due date", () => {
    const db = freshDb({ seeded: true });
    db.insert(statements).values({ accountId: card(db).id, dueDate: "2026-09-30", amountDue: 55731, source: "manual" }).run();
    const r = importMastercardInvoice(db, parseMastercardInvoice(INVOICE_LINES), "faktura.pdf");
    expect(r.statement.replacesManual).toBe(true);
    expect(db.select().from(statements).where(eq(statements.accountId, card(db).id)).all()).toMatchObject([{ source: "pdf", periodTo: "2026-09-04" }]);
  });

  it("the list backfills a period without doubling the invoice's rows, and fills in nothing it shouldn't", () => {
    const db = imported();
    const r = importMastercardList(db, parseMastercardList(LIST_LINES), "lista.pdf");
    // The invoice's 5 rows (payment and 4 purchases) are the same rows in the list.
    expect(r).toMatchObject({ rowsTotal: LIST_ROWS, rowsNew: LIST_ROWS - 5, rowsSkipped: 5, matchedNearby: 0 });
    expect(r.debtCheck).toMatchObject({ usedCredit: USED_CREDIT, invoiceDebt: 55731, after: AFTER });
    expect(cardRows(db)).toHaveLength(LIST_ROWS);
    expect(card(db)).toMatchObject({ balance: -USED_CREDIT, balanceUpdatedAt: "2026-09-18" });
    // The invoice's rows keep their posting day.
    expect(cardRows(db).filter((x) => x.postedDate !== null)).toHaveLength(5);
    expect(cardRows(db).find((x) => x.descriptionClean === "STREAMTJANST*MANAD" && x.bookingDate === "2026-09-06")).toMatchObject({ foreignAmount: -2250, foreignCurrency: "EUR", postedDate: null });
    const cat = (d: string) => pathOf(db, cardRows(db).find((x) => x.descriptionClean === d)!.categoryId);
    expect(cat("BONUSUTBETALNING")).toBe("Inkomst/Övrigt");
    expect(cat("PIZZERIA ROMA")).toBe("Mat/Restaurang & café");
    expect(cat("ICA KVANTUM EXEMPEL")).toBe("Mat/Livsmedel");
    expect(cat("SPOTIFY")).toBe("Nöje/Streaming");
  });

  it("a row a few days off in the other source is the same purchase (±3 days, same amount and text)", () => {
    const db = freshDb({ seeded: true });
    // The list first says 2026-08-10 for the Amazon Prime of 8 August…
    importMastercardInvoice(db, parseMastercardInvoice(INVOICE_LINES), "faktura.pdf");
    db.delete(transactions).where(eq(transactions.descriptionClean, "Amazon Prime")).run();
    const shifted = parseMastercardList(edit(LIST_LINES, "2026-08-08", "2026-08-10"));
    importMastercardList(db, shifted, "lista.pdf");
    expect(cardRows(db).filter((x) => x.descriptionClean === "Amazon Prime" && x.bookingDate.startsWith("2026-08"))).toHaveLength(1);
    // …and the invoice, imported again, recognises it and gives it the posting day.
    const again = importMastercardInvoice(db, parseMastercardInvoice(INVOICE_LINES), "faktura.pdf");
    expect(again).toMatchObject({ rowsNew: 0, matchedNearby: 1, enriched: 1 });
    expect(cardRows(db).find((x) => x.descriptionClean === "Amazon Prime" && x.bookingDate === "2026-08-10")).toMatchObject({
      postedDate: "2026-08-10",
      merchantArea: "LUXEMBOURG",
    });
  });

  /** A made-up invoice: purchases [day, text, öre, posting day]. */
  function invoiceOf(periodFrom: string, periodTo: string, dueDate: string, rows: [string, string, number, string][]) {
    return {
      kind: "invoice" as const,
      statement: { invoiceDate: periodTo, periodFrom, periodTo, dueDate, openingDebt: null, paymentsTotal: null, purchasesTotal: null, totalDebt: -rows.reduce((t, r) => t + r[2], 0), minPayment: null, nextPeriodTo: null },
      rows: rows.map(([day, description, amount, posted]) => ({
        transactionDate: day,
        postedDate: posted,
        description,
        merchantArea: null,
        amount,
        foreignAmount: null,
        foreignCurrency: null,
        exchangeRate: null,
        cardMasked: null,
        isPayment: false,
        fingerprint: mastercardFingerprint({ transactionDate: day, description, amount }),
      })),
    };
  }
  const tickets = (db: Db) => cardRows(db).filter((x) => x.descriptionClean === "SL BILJETT").map((x) => [x.bookingDate, x.postedDate]);

  it("a purchase on the next invoice is not taken for the same one on the last, two days apart", () => {
    const db = freshDb({ seeded: true });
    importMastercardInvoice(db, invoiceOf("2026-08-05", "2026-09-04", "2026-09-30", [["2026-08-31", "SL BILJETT", -4300, "2026-09-01"]]), "aug.pdf");
    // Same ticket, same price, two days later: a new purchase, on the next invoice.
    const r = importMastercardInvoice(db, invoiceOf("2026-09-05", "2026-10-07", "2026-10-30", [["2026-09-02", "SL BILJETT", -4300, "2026-09-05"]]), "sep.pdf");
    expect(r).toMatchObject({ rowsNew: 1, matchedNearby: 0 });
    expect(tickets(db)).toEqual([
      ["2026-08-31", "2026-09-01"],
      ["2026-09-02", "2026-09-05"],
    ]);
  });

  it("two identical purchases on one day that land on two invoices are both kept, and neither comes back", () => {
    const db = freshDb({ seeded: true });
    const aug = invoiceOf("2026-08-05", "2026-09-04", "2026-09-30", [["2026-09-04", "SL BILJETT", -4300, "2026-09-04"]]);
    const sep = invoiceOf("2026-09-05", "2026-10-07", "2026-10-30", [["2026-09-04", "SL BILJETT", -4300, "2026-09-07"]]);
    importMastercardInvoice(db, aug, "aug.pdf");
    expect(importMastercardInvoice(db, sep, "sep.pdf")).toMatchObject({ rowsNew: 1 });
    expect(tickets(db)).toEqual([
      ["2026-09-04", "2026-09-04"],
      ["2026-09-04", "2026-09-07"],
    ]);
    // Both invoices again: nothing new, in either order.
    expect(importMastercardInvoice(db, sep, "sep.pdf")).toMatchObject({ rowsNew: 0 });
    expect(importMastercardInvoice(db, aug, "aug.pdf")).toMatchObject({ rowsNew: 0 });
    expect(tickets(db)).toHaveLength(2);
  });

  it("refuses the list without an invoice, or when the debt doesn't match", () => {
    const empty = freshDb({ seeded: true });
    expect(() => importMastercardList(empty, parseMastercardList(LIST_LINES), "lista.pdf")).toThrow(ImportError);
    const db = imported();
    const wrong = parseMastercardList(edit(LIST_LINES, "-189,00", "-190,00"));
    expect(() => importMastercardList(db, wrong, "lista.pdf")).toThrow(/stämmer inte med den senaste fakturan/);
    expect(cardRows(db)).toHaveLength(5);
  });

  it("pairs the card payments with e-sparkonto's payments to the card, and the fixed expense links to its draws", async () => {
    const db = freshDb({ seeded: true });
    const spotify = db
      .insert(recurringExpenses)
      .values({ name: "Spotify", amount: 11900, anchorDay: 5, paymentMethod: "credit_card", accountId: card(db).id, matchPattern: "SPOTIFY" })
      .returning()
      .get();
    importMastercardInvoice(db, parseMastercardInvoice(INVOICE_LINES), "faktura.pdf");
    importMastercardList(db, parseMastercardList(LIST_LINES), "lista.pdf");
    const r = await importFiles(db, allSwedbankFiles());
    expect(r.files.every((f) => f.ok)).toBe(true);
    // The two payments in the list match two of the e-sparkonto's 'Mastercard Guld' rows (28/7 and 28/8).
    const payments = cardRows(db).filter((x) => x.descriptionClean.startsWith("INBETALNING"));
    expect(payments).toHaveLength(2);
    expect(payments.filter((x) => x.transferPairId === null)).toEqual([]);

    const draws = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, spotify.id), isNotNull(transactions.recurringExpenseId)))
      .all();
    expect(draws).toHaveLength(4);
    // Expected on the 5th but drawn on the 2nd every month (the invoice's row by its posting day, 3/9): the schedule is suggested, and a correct one is not.
    expect(suggestSchedule(spotify, draws.map((t) => chargeDate(spotify, t)))).toMatchObject({ scheduleType: "day_of_month", anchorDay: 2, bankDayRule: "none", matches: 3, total: 4 });
    const right = { ...spotify, anchorDay: 2 };
    expect(suggestSchedule(right, draws.map((t) => chargeDate(right, t)))).toBeNull();
    expect(db.select({ n: sql<number>`count(*)` }).from(transactions).where(eq(transactions.source, "mastercard")).get()!.n).toBe(LIST_ROWS);
  });
});

describe("the next Mastercard invoice in the overview", () => {
  function withList() {
    const db = freshDb({ seeded: true });
    db.insert(recurringExpenses)
      .values({ name: "Spotify", amount: 11900, anchorDay: 23, paymentMethod: "credit_card", accountId: card(db).id, matchPattern: "SPOTIFY" })
      .run();
    importMastercardInvoice(db, parseMastercardInvoice(INVOICE_LINES), "faktura.pdf");
    importMastercardList(db, parseMastercardList(LIST_LINES), "lista.pdf");
    return db;
  }

  it("predicts it: from the day after the latest one to the announced end, due the last bank day, purchases so far plus fixed expenses to come", () => {
    const db = withList();
    const [next] = upcomingInvoices(db, "2026-09-18");
    // Bought since 5/9: 24 550 + 18 900 + 25 426 öre.
    expect(next).toMatchObject({ periodFrom: "2026-09-05", periodTo: "2026-10-07", dueDate: "2026-10-30", soFar: AFTER });
    // Spotify on the 23rd is still to come.
    const spotify = db.select().from(recurringExpenses).where(eq(recurringExpenses.name, "Spotify")).get()!;
    expect(next.expectedFixed).toBeGreaterThanOrEqual(spotify.amount);
    expect(next.estimate).toBe(next.soFar + next.expectedFixed);
    // Before the invoice's own period has ended there is nothing to predict.
    expect(upcomingInvoices(db, "2026-09-03")).toEqual([]);
  });

  it("reminds from the 10th when this month's invoice isn't imported", () => {
    const db = withList();
    expect(missingInvoices(db, "2026-09-18")).toEqual([]);
    expect(missingInvoices(db, "2026-10-09")).toEqual([]);
    expect(missingInvoices(db, "2026-10-10")).toMatchObject([{ month: "2026-10", monthName: "oktober" }]);
    const warnings = buildOverview(db, "2026-10-12").warnings.filter((w) => w.kind === "invoice_missing");
    expect(warnings.map((w) => w.text)).toEqual(["Mastercard-fakturan för oktober borde finnas i Swedbank – importera."]);
  });

  it("is paid by the payment from e-sparkonto: from the invoice date up to 3 days after the due date, ±1 kr", () => {
    const db = withList();
    const espar = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!;
    const pay = (date: string, amount: number) =>
      db
        .insert(transactions)
        .values({
          source: "swedbank",
          accountId: espar.id,
          bookingDate: date,
          transactionDate: date,
          descriptionRaw: "Mastercard Guld",
          descriptionClean: "Mastercard Guld",
          amount,
          isTransfer: true,
          counterAccountId: card(db).id,
          fingerprint: `pay-${date}`,
        })
        .run();
    const invoice = () => cardInvoices(db, "2026-09-18").find((i) => i.accountId === card(db).id)!;
    expect(invoice().status).toBe("unpaid");
    pay("2026-10-04", -55731); // four days late: not this invoice's
    expect(invoice().status).toBe("unpaid");
    pay("2026-09-24", -55700); // 31 öre short: paid
    expect(invoice()).toMatchObject({ status: "paid", paidBy: "payment" });
    const overview = buildOverview(db, "2026-09-18");
    expect(overview.balances.find((b) => b.id === card(db).id)).toMatchObject({ invoiceImported: true, nextInvoice: { dueDate: "2026-10-30" } });
  });
});

// The real invoice and the real card page (samples/privat/, not in git): the same parsers on the documents the made-up ones imitate.
describe.skipIf(!hasInvoice)("the real Mastercard invoice", () => {
  it("reads the statement and the rows, refuses a sum that is off, and keeps no card number or account number", () => {
    expect(detectMastercardPdf(invoiceLines)).toBe("invoice");
    const { statement, rows } = parseMastercardInvoice(invoiceLines);
    expect(statement.totalDebt).toBeGreaterThan(0);
    expect(statement.periodTo > statement.periodFrom).toBe(true);
    expect(rows.some((r) => r.isPayment)).toBe(true);
    expect(rows.filter((r) => !r.isPayment).every((r) => r.amount < 0 && /^\d{6}\*{6}\d{4}$/.test(r.cardMasked ?? ""))).toBe(true);
    expect(rows.map((r) => r.description).join(" ")).not.toMatch(/INTERNET|\d{13,}/);
    expect(statement.openingDebt! - statement.paymentsTotal! + statement.purchasesTotal!).toBe(statement.totalDebt);
  });

  it("is imported, and again gives nothing new", () => {
    const db = freshDb({ seeded: true });
    importMastercardInvoice(db, parseMastercardInvoice(invoiceLines), INVOICE);
    const { statement, rows } = parseMastercardInvoice(invoiceLines);
    expect(cardRows(db)).toHaveLength(rows.length);
    expect(card(db)).toMatchObject({ balance: -statement.totalDebt, balanceUpdatedAt: statement.invoiceDate });
    expect(importMastercardInvoice(db, parseMastercardInvoice(invoiceLines), INVOICE)).toMatchObject({ rowsNew: 0, statement: { alreadyImported: true } });
  });
});

describe.skipIf(!hasInvoice || !hasList)("the real Mastercard card page together with the invoice", () => {
  it("uses the same fingerprint for the same purchase in both", () => {
    const inv = parseMastercardInvoice(invoiceLines).rows;
    const list = parseMastercardList(listLines).rows;
    for (const r of inv) expect(list.map((x) => x.fingerprint)).toContain(r.fingerprint);
  });

  it("backfills from the list without doubling the invoice's rows, and the batch import pairs the payments", async () => {
    const db = freshDb({ seeded: true });
    const invoice = parseMastercardInvoice(invoiceLines);
    importMastercardInvoice(db, invoice, INVOICE);
    const list = parseMastercardList(listLines);
    const r = importMastercardList(db, list, LIST);
    expect(r).toMatchObject({ rowsTotal: list.rows.length, rowsSkipped: invoice.rows.length, matchedNearby: 0 });
    expect(r.debtCheck).toMatchObject({ usedCredit: list.usedCredit, invoiceDebt: invoice.statement.totalDebt });
    expect(cardRows(db)).toHaveLength(list.rows.length);
    expect(card(db)).toMatchObject({ balance: -list.usedCredit, balanceUpdatedAt: list.printedAt });
    // Both files through the batch import, in whatever order they are given.
    const batch = freshDb({ seeded: true });
    const b = await importFiles(batch, [privateSample(LIST), privateSample(INVOICE)]);
    expect(b.files.every((f) => f.ok)).toBe(true);
    expect(cardRows(batch)).toHaveLength(list.rows.length);
  });
});
