import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, imports, recurringExpenses, statements, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { linkRecurring } from "../src/recurring/link.js";
import { setSettlementStart } from "../src/settings.js";
import { partnerOutstanding, sharedMonth } from "../src/shared/settlement.js";
import { spendingPace } from "../src/overview/overview.js";
import { createApp } from "../src/app.js";
import { freshDb, hasNorwegianInvoice, hasPrivateSample, privateSample, privateSecrets, sampleFile, samplePdf } from "./helpers.js";
import { importNorwegianPdf, importNorwegianXlsx } from "../src/import/importNorwegian.js";

type Db = ReturnType<typeof freshDb>;
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const cat = (db: Db, path: string) => getCategoryPathMap(db).get(path)!;
const TODAY = "2026-09-18";
// The test that adds the real invoice's PDF to its exports needs the real exports too (samples/privat/, not in git).
// The invoice total is read from samples/privat/personuppgifter.json (key "norwegianInvoiceTotalOre"), not written here.
const privateInvoiceTotal = Number(privateSecrets("norwegianInvoiceTotalOre")[0]);
const hasPrivateNorwegian = hasNorwegianInvoice && hasPrivateSample("Augusti.xlsx") && hasPrivateSample("September.xlsx") && Number.isInteger(privateInvoiceTotal);

let seq = 0;
function tx(
  db: Db,
  o: { account: string; date: string; amount: number; desc: string; shared?: boolean; category?: string; source?: "swedbank" | "norwegian" | "manual"; private?: boolean },
) {
  return db
    .insert(transactions)
    .values({
      source: o.source ?? (o.account === "Bank Norwegian" ? "norwegian" : "swedbank"),
      accountId: acc(db, o.account),
      bookingDate: o.date,
      transactionDate: o.date,
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      counterparty: o.desc,
      amount: o.amount,
      categoryId: o.category ? cat(db, o.category) : null,
      categorySource: o.category ? "rule" : "none",
      shared: o.shared ?? false,
      private: o.private ?? false,
      fingerprint: `s${++seq}`,
    })
    .returning()
    .get();
}

/**
 * August: Norwegian shared 100 kr and a shared refund of 10 kr, a Norwegian
 * purchase of my own, a shared Swedbank row of 40 kr, a shared fixed expense
 * on Mastercard (200 kr, never imported) and one drawn from e-spar (310 kr,
 * expected 300). Mio paid 60 kr, swished me 50 kr, I swished her 10 kr.
 */
async function setup() {
  const db = freshDb({ seeded: true });
  const app = createApp(db, { databasePath: ":memory:" });
  setSettlementStart(db, "2026-08");
  tx(db, { account: "Bank Norwegian", date: "2026-08-10", amount: -10000, desc: "ICA", shared: true });
  tx(db, { account: "Bank Norwegian", date: "2026-08-11", amount: 1000, desc: "ICA RETUR", shared: true });
  tx(db, { account: "Bank Norwegian", date: "2026-08-12", amount: -5000, desc: "KJELL" });
  tx(db, { account: "Swedbank Privatkonto", date: "2026-08-13", amount: -4000, desc: "SYSTEMBOLAGET", shared: true });
  tx(db, { account: "Swedbank Privatkonto", date: "2026-08-14", amount: -7000, desc: "PRESENT", private: true });
  db.insert(recurringExpenses)
    .values({ name: "Netflix", amount: 20000, anchorDay: 15, paymentMethod: "credit_card", accountId: acc(db, "Swedbank Mastercard Guld"), shared: true })
    .run();
  db.insert(recurringExpenses)
    .values({ name: "El", amount: 30000, anchorDay: 25, paymentMethod: "autogiro", accountId: acc(db, "Swedbank e-sparkonto"), matchPattern: "ELBOLAGET", shared: true })
    .run();
  // The charge isn't flagged shared when imported: linking it to the shared expense makes it so.
  tx(db, { account: "Swedbank e-sparkonto", date: "2026-08-26", amount: -31000, desc: "ELBOLAGET" });
  linkRecurring(db);
  const partner = await app.request(
    "/api/transactions",
    json("POST", { label: "Apotek", amount: -6000, bookingDate: "2026-08-12", paidBy: "partner" }),
  );
  expect(partner.status).toBe(200);
  tx(db, { account: "Swedbank Privatkonto", date: "2026-08-20", amount: 5000, desc: "Swish mottagen +46765550019", category: "Inkomst/Från partner" });
  tx(db, { account: "Swedbank Privatkonto", date: "2026-08-22", amount: -1000, desc: "Swish skickad +46765550019", category: "Till partner" });
  return { db, app };
}

describe("shared economy per month", () => {
  it("adds up what I paid, what she paid and the Swish between us", async () => {
    const { db } = await setup();
    const m = sharedMonth(db, "2026-08", TODAY);
    expect(m.partnerName).toBe("Mio");
    // The August Norwegian purchases are on the invoice for 16/7–15/8, paid 25/8.
    expect(m.iPaid.groups.map((g) => [g.kind, g.total, g.payDate ?? null])).toEqual([
      ["norwegian", 9000, "2026-08-25"],
      ["recurring", 51000, null],
      ["swedbank", 4000, null],
    ]);
    expect(m.iPaid.groups.find((g) => g.key === "recurring")!.rows.map((r) => [r.description, r.amount, r.status])).toEqual([
      ["Netflix", 20000, "forvantat"],
      ["El", 31000, "dragen"],
    ]);
    expect(m.partnerPaid).toMatchObject({ total: 6000, rows: [{ description: "Apotek", amount: 6000 }] });
    expect(m.transfers.fromPartner.total).toBe(5000);
    expect(m.transfers.toPartner.total).toBe(1000);
    // (64 000 − 6 000) / 2 − (5 000 − 1 000) = 25 000
    expect(m.live).toEqual({
      iPaid: 64000,
      partnerPaid: 6000,
      iPaidForPartner: 0,
      partnerPaidForMe: 0,
      fromPartner: 5000,
      toPartner: 1000,
      carryIn: 0,
      half: 29000,
      result: 25000,
    });
    expect(m.carryFrom).toBeNull();
  });

  it("a shared fixed expense's charge is shared in the list too; made own, it is neither counted nor expected", async () => {
    const { db } = await setup();
    const el = db.select().from(transactions).where(eq(transactions.descriptionClean, "ELBOLAGET")).get()!;
    expect(el).toMatchObject({ shared: true, recurringExpenseId: expect.any(Number) });
    db.update(transactions).set({ shared: false }).where(eq(transactions.id, el.id)).run();
    const recurring = sharedMonth(db, "2026-08", TODAY).iPaid.groups.find((g) => g.key === "recurring")!;
    expect(recurring.rows.map((r) => r.description)).toEqual(["Netflix"]);
  });

  it("carries the previous month's result, so next month's Swish evens it out", async () => {
    const { db } = await setup();
    tx(db, { account: "Swedbank Privatkonto", date: "2026-09-03", amount: 25000, desc: "Swish mottagen +46765550019", category: "Inkomst/Från partner" });
    const sep = sharedMonth(db, "2026-09", TODAY);
    // September: only the two fixed expenses (expected), half 25 000, and the 25 000 she paid for August.
    expect(sep.live).toMatchObject({ iPaid: 50000, carryIn: 25000, half: 25000, fromPartner: 25000, result: 25000 });
    expect(sep.carryFrom).toEqual({ month: "2026-08", reconciled: false, settledEven: false });
    // So far (18/9) only Netflix (15/9) is paid; El comes 25/9.
    expect(sep.sofar).toMatchObject({ iPaid: 20000, half: 10000, result: 10000 });
    expect(sep.nextPayDate).toBe("2026-09-25");
    // Expected from the partner: the whole month (what she swishes on the 25th).
    expect(partnerOutstanding(db, TODAY).amount).toBe(25000);
    expect(sep.payDay).toBe("2026-09-25");
  });

  it("locks a month; later changes show as a deviation and the locked result carries on", async () => {
    const { db, app } = await setup();
    const locked = await (await app.request("/api/shared/2026-08/settlement?today=2026-09-18", json("PUT", { note: "Swishat 250 kr" }))).json();
    expect(locked.settlement).toMatchObject({ result: 25000, note: "Swishat 250 kr" });
    expect(locked.deviates).toBe(false);

    tx(db, { account: "Swedbank Privatkonto", date: "2026-08-30", amount: -2000, desc: "COOP", shared: true });
    const after = sharedMonth(db, "2026-08", TODAY);
    expect(after.deviates).toBe(true);
    expect(after.settlement!.result).toBe(25000);
    expect(after.live.result).toBe(26000);
    expect(sharedMonth(db, "2026-09", TODAY).live.carryIn).toBe(25000);
    expect(sharedMonth(db, "2026-09", TODAY).carryFrom).toEqual({ month: "2026-08", reconciled: true, settledEven: false });

    const unlocked = await (await app.request("/api/shared/2026-08/settlement?today=2026-09-18", json("DELETE"))).json();
    expect(unlocked.settlement).toBeNull();
    expect(sharedMonth(db, "2026-09", TODAY).live.carryIn).toBe(26000);
  });

  it("can be reconciled as 'kvitt': the difference is settled and next month starts at 0", async () => {
    const { db, app } = await setup();
    const res = await (await app.request("/api/shared/2026-08/settlement?today=2026-09-18", json("PUT", { note: "Kvitt", carryForward: false }))).json();
    expect(res.settlement).toMatchObject({ result: 25000, carryForward: false });
    const sep = sharedMonth(db, "2026-09", TODAY);
    expect(sep.live.carryIn).toBe(0);
    expect(sep.carryFrom).toEqual({ month: "2026-08", reconciled: true, settledEven: true });
    expect(partnerOutstanding(db, TODAY).amount).toBe(sep.live.result);
  });

  it("lists the last six months from the start month with how each was settled, and the rows' categories", async () => {
    const { db, app } = await setup();
    await app.request("/api/shared/2026-08/settlement?today=2026-09-18", json("PUT", { note: "Kvitt", carryForward: false }));
    const sep = sharedMonth(db, "2026-09", TODAY);
    expect(sep.history).toEqual([
      { month: "2026-08", result: 25000, status: "even", note: "Kvitt", deviates: false },
      { month: "2026-09", result: sep.live.result, status: "open", note: null, deviates: false },
    ]);
    tx(db, { account: "Swedbank Privatkonto", date: "2026-08-30", amount: -2000, desc: "COOP", shared: true });
    expect(sharedMonth(db, "2026-09", TODAY).history[0]).toMatchObject({ status: "even", result: 25000, deviates: true });

    const aug = sharedMonth(db, "2026-08", TODAY);
    const el = aug.iPaid.groups.find((g) => g.kind === "recurring")!.rows.find((r) => r.description === "El")!;
    expect(el.categoryId).toBeNull();
    const toMarta = aug.transfers.toPartner.rows[0];
    expect(toMarta.categoryId).toBe(cat(db, "Till partner"));
  });

  it("leaves a Swish marked 'räkna inte' out of the result but lists it", async () => {
    const { db, app } = await setup();
    const before = sharedMonth(db, "2026-08", TODAY);
    const to = before.transfers.toPartner.rows[0];
    const res = await app.request(`/api/transactions/${to.id}`, json("PATCH", { settlementExcluded: true }));
    expect(res.status).toBe(200);
    const after = sharedMonth(db, "2026-08", TODAY);
    expect(after.transfers.toPartner).toMatchObject({ total: 0, rows: [], excluded: [{ id: to.id, amount: 1000 }] });
    expect(after.live.result).toBe(before.live.result - 1000);
    await app.request(`/api/transactions/${to.id}`, json("PATCH", { settlementExcluded: false }));
    expect(sharedMonth(db, "2026-08", TODAY).live.result).toBe(before.live.result);
  });

  it("carries nothing into the start month or before it", async () => {
    const { db } = await setup();
    tx(db, { account: "Bank Norwegian", date: "2026-07-10", amount: -8000, desc: "ICA", shared: true });
    expect(sharedMonth(db, "2026-07", TODAY)).toMatchObject({ beforeStart: true, live: { carryIn: 0 } });
    expect(sharedMonth(db, "2026-08", TODAY).live.carryIn).toBe(0);
  });

  it("notes when the month isn't fully imported yet", async () => {
    const { db } = await setup();
    db.insert(imports).values({ source: "norwegian", filename: "a.xlsx", periodFrom: "2026-08-01", periodTo: "2026-08-20" }).run();
    db.insert(imports).values({ source: "swedbank", filename: "b.csv", periodFrom: "2026-08-01", periodTo: "2026-09-10" }).run();
    expect(sharedMonth(db, "2026-08", TODAY).incompleteImports).toEqual([{ source: "norwegian", importedTo: "2026-08-20" }]);
    expect(sharedMonth(db, "2026-08", TODAY).monthNotOver).toBe(false);
    expect(sharedMonth(db, "2026-09", TODAY).monthNotOver).toBe(true);
    // The running month: complete if imported up to yesterday.
    expect(sharedMonth(db, "2026-09", TODAY).incompleteImports).toEqual([
      { source: "swedbank", importedTo: "2026-09-10" },
      { source: "norwegian", importedTo: "2026-08-20" },
    ]);
    db.insert(imports).values({ source: "norwegian", filename: "c.xlsx", periodFrom: "2026-09-01", periodTo: "2026-09-17" }).run();
    expect(sharedMonth(db, "2026-09", TODAY).incompleteImports).toEqual([{ source: "swedbank", importedTo: "2026-09-10" }]);
  });
});

describe("Bank Norwegian purchases count when the invoice is paid", () => {
  it("adds up to the purchases posted 16/8–15/9 in the exports", async () => {
    const db = freshDb({ seeded: true });
    setSettlementStart(db, "2026-09");
    await importNorwegianXlsx(db, sampleFile("Augusti.xlsx").bytes, "Augusti.xlsx");
    await importNorwegianXlsx(db, sampleFile("September.xlsx").bytes, "September.xlsx");
    const card = sharedMonth(db, "2026-09", TODAY).iPaid.groups.find((g) => g.kind === "norwegian")!;
    // The 15 purchases from 16/8 to 13/9; the one bought 14/8 is posted 15/8 (the invoice before) and the one bought 15/9 is posted 16/9 (the next).
    expect(card).toMatchObject({ payDate: "2026-09-25", periodEnd: "2026-09-15", total: 423984 });
  });

  it.skipIf(!hasPrivateNorwegian)("adds up to the real invoice from the exports and the PDF", async () => {
    const db = freshDb({ seeded: true });
    setSettlementStart(db, "2026-09");
    await importNorwegianXlsx(db, privateSample("Augusti.xlsx").bytes, "Augusti.xlsx");
    await importNorwegianXlsx(db, privateSample("September.xlsx").bytes, "September.xlsx");
    const card = sharedMonth(db, "2026-09", TODAY).iPaid.groups.find((g) => g.kind === "norwegian")!;
    expect(card).toMatchObject({ payDate: "2026-09-25", periodEnd: "2026-09-15", total: privateInvoiceTotal });
    // The same with the invoice PDF imported too.
    await importNorwegianPdf(db, samplePdf().bytes, samplePdf().name);
    expect(sharedMonth(db, "2026-09", TODAY).iPaid.groups.find((g) => g.kind === "norwegian")!.total).toBe(privateInvoiceTotal);
  });

  it("goes by the posting day: bought 15/8 but posted 16/8 is on the next invoice", async () => {
    const { db } = await setup();
    const t = tx(db, { account: "Bank Norwegian", date: "2026-08-15", amount: -2000, desc: "LIDL 15/8", shared: true });
    const u = tx(db, { account: "Bank Norwegian", date: "2026-09-15", amount: -3000, desc: "LIDL 15/9", shared: true });
    const card = () => sharedMonth(db, "2026-09", TODAY).iPaid.groups.find((g) => g.kind === "norwegian")!;
    // No posting day stored: the day after the purchase is assumed.
    expect(card().rows.map((r) => r.description)).toContain("LIDL 15/8");
    expect(card().rows.map((r) => r.description)).not.toContain("LIDL 15/9");
    // A posting day from the export wins.
    db.update(transactions).set({ postedDate: "2026-08-15" }).where(eq(transactions.id, t.id)).run();
    db.update(transactions).set({ postedDate: "2026-09-15" }).where(eq(transactions.id, u.id)).run();
    expect(card().rows.map((r) => r.description)).toEqual(expect.arrayContaining(["LIDL 15/9"]));
    expect(card().rows.map((r) => r.description)).not.toContain("LIDL 15/8");
  });

  it("puts purchases 16/8–15/9 on the invoice paid 25/9, and later ones in October", async () => {
    const { db } = await setup();
    tx(db, { account: "Bank Norwegian", date: "2026-08-20", amount: -3000, desc: "WILLYS", shared: true });
    tx(db, { account: "Bank Norwegian", date: "2026-09-10", amount: -2000, desc: "COOP", shared: true });
    tx(db, { account: "Bank Norwegian", date: "2026-09-16", amount: -7000, desc: "ICA", shared: true });
    const sep = sharedMonth(db, "2026-09", TODAY);
    const card = sep.iPaid.groups.filter((g) => g.kind === "norwegian");
    expect(card.map((g) => [g.payDate, g.periodEnd, g.total, g.paidTotal])).toEqual([["2026-09-25", "2026-09-15", 5000, 0]]);
    // Paid so far: only Netflix; the card bill and El come on the 25th.
    expect(sep.sofar.iPaid).toBe(20000);
    expect(sep.live.iPaid).toBe(55000);
    // On the 26th everything is paid.
    expect(sharedMonth(db, "2026-09", "2026-09-26").sofar.iPaid).toBe(55000);
  });

  it("uses the actual payment day, and an imported invoice's period", async () => {
    const { db } = await setup();
    const norwegian = acc(db, "Bank Norwegian");
    tx(db, { account: "Swedbank e-sparkonto", date: "2026-09-24", amount: -5000, desc: "BANK NORWEGIAN" });
    db.update(transactions).set({ counterAccountId: norwegian, isTransfer: true }).where(eq(transactions.descriptionClean, "BANK NORWEGIAN")).run();
    tx(db, { account: "Bank Norwegian", date: "2026-09-10", amount: -2000, desc: "COOP", shared: true });
    expect(sharedMonth(db, "2026-09", TODAY).iPaid.groups.find((g) => g.kind === "norwegian")!.payDate).toBe("2026-09-24");

    // An invoice ending on the 12th moves a purchase on the 14th to the next invoice.
    const { statements } = await import("../src/db/schema.js");
    db.insert(statements).values({ accountId: norwegian, periodFrom: "2026-08-13", periodTo: "2026-09-12", dueDate: "2026-09-28", amountDue: 1, source: "pdf" }).run();
    tx(db, { account: "Bank Norwegian", date: "2026-09-14", amount: -1000, desc: "LIDL", shared: true });
    const groups = sharedMonth(db, "2026-09", TODAY).iPaid.groups.filter((g) => g.kind === "norwegian");
    expect(groups.map((g) => [g.payDate, g.total])).toEqual([["2026-09-24", 2000]]);
    expect(sharedMonth(db, "2026-10", "2026-10-30").iPaid.groups.find((g) => g.kind === "norwegian")).toMatchObject({ periodEnd: "2026-10-12", total: 1000 });
  });

  it("warns when a shared fixed expense on the card is probably also a card purchase", async () => {
    const { db } = await setup();
    db.insert(recurringExpenses)
      .values({ name: "Spotify", amount: 18900, anchorDay: 23, paymentMethod: "credit_card", accountId: acc(db, "Bank Norwegian"), shared: true })
      .run();
    const sep = sharedMonth(db, "2026-09", TODAY);
    // Charged 23/8 → invoice ending 15/9 → paid 25/9.
    expect(sep.iPaid.groups.find((g) => g.kind === "recurring")!.rows.find((r) => r.description === "Spotify")).toMatchObject({ date: "2026-08-23", payDate: "2026-09-25", paid: false });
    expect(sep.warnings).toEqual([]);
    // Same amount but another name (an ICA purchase of 189 kr) is no reason to warn.
    tx(db, { account: "Bank Norwegian", date: "2026-08-24", amount: -18900, desc: "ICA KVANTUM", shared: true });
    expect(sharedMonth(db, "2026-09", TODAY).warnings).toEqual([]);
    // With a purchase of the same amount on that invoice, it is probably counted twice.
    tx(db, { account: "Bank Norwegian", date: "2026-08-23", amount: -18900, desc: "SPOTIFY P3", shared: true });
    expect(sharedMonth(db, "2026-09", TODAY).warnings).toEqual([expect.stringContaining('Spotify räknas troligen dubbelt: som förväntad fast utgift och som köpet "SPOTIFY P3"')]);
  });

  it("warns when a shared fixed expense is drawn from another account than the one it is expected on", async () => {
    const { db } = await setup();
    const spotify = db
      .insert(recurringExpenses)
      .values({ name: "Spotify", amount: 18900, anchorDay: 23, paymentMethod: "credit_card", accountId: acc(db, "Bank Norwegian"), matchPattern: "SPOTIFY", shared: true })
      .returning()
      .get();
    // Moved to Norwegian without saving the move: August's charge on Mastercard stays unlinked.
    tx(db, { account: "Swedbank Mastercard Guld", date: "2026-08-23", amount: -18900, desc: "Spotify P3X7Q1R5", shared: true });
    linkRecurring(db);
    const warnings = sharedMonth(db, "2026-09", TODAY).warnings;
    expect(warnings).toEqual([
      'Spotify räknas troligen dubbelt: som förväntad fast utgift på Bank Norwegian och som köpet "Spotify P3X7Q1R5" 2026-08-23 på Swedbank Mastercard Guld. Har den bytt konto? Ange det tidigare kontot under Fasta utgifter så kopplas dragningen dit.',
    ]);
    // A row of my own is not counted as shared: nothing is counted twice.
    db.update(transactions).set({ shared: false }).where(eq(transactions.descriptionClean, "Spotify P3X7Q1R5")).run();
    expect(sharedMonth(db, "2026-09", TODAY).warnings).toEqual([]);
    db.update(transactions).set({ shared: true }).where(eq(transactions.descriptionClean, "Spotify P3X7Q1R5")).run();
    // With the move saved the charge links to August on Mastercard, and August is no longer expected in September.
    db.update(recurringExpenses).set({ previousAccountId: acc(db, "Swedbank Mastercard Guld"), accountFrom: "2026-09" }).where(eq(recurringExpenses.id, spotify.id)).run();
    linkRecurring(db);
    const sep = sharedMonth(db, "2026-09", TODAY);
    expect(sep.warnings).toEqual([]);
    expect(sep.iPaid.groups.flatMap((g) => g.rows).filter((r) => r.description.includes("Spotify"))).toEqual([]);
  });
});

describe("Bank Norwegian invoice periods", () => {
  it("lists invoices by posting day and filters the transaction list to one", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    await importNorwegianXlsx(db, sampleFile("Augusti.xlsx").bytes, "Augusti.xlsx");
    await importNorwegianXlsx(db, sampleFile("September.xlsx").bytes, "September.xlsx");
    const invoices = await (await app.request(`/api/shared/invoices?today=${TODAY}&count=3`)).json();
    // 16/8–15/9 has closed on 18/9: the open one (16/9–15/10) comes first.
    expect(invoices.map((i: { month: string; from: string; to: string; payDate: string }) => [i.month, i.from, i.to, i.payDate])).toEqual([
      ["2026-10", "2026-09-16", "2026-10-15", "2026-10-25"],
      ["2026-09", "2026-08-16", "2026-09-15", "2026-09-25"],
      ["2026-08", "2026-07-16", "2026-08-15", "2026-08-25"],
    ]);
    const list = await (await app.request("/api/transactions?invoice=2026-09")).json();
    // 15 purchases: the one bought 16/8 (posted 17/8) is on it, 14/8 (posted 15/8) is on the invoice before and 15/9 (posted 16/9) on the next.
    expect(list.totals).toMatchObject({ count: 15, out: -423984 });
    expect(list.rows.some((r: { transactionDate: string }) => r.transactionDate === "2026-08-16")).toBe(true);
    expect(list.rows.some((r: { transactionDate: string }) => r.transactionDate === "2026-08-14")).toBe(false);
    expect(list.rows.some((r: { transactionDate: string }) => r.transactionDate === "2026-09-15")).toBe(false);
  });
});

describe("pay days on bank accounts", () => {
  it("counts a fixed charge on a bank account on its booking day (31/7 stays in July)", async () => {
    const { db } = await setup();
    const home = db
      .insert(recurringExpenses)
      .values({ name: "Hemförsäkring", amount: 18900, anchorDay: 31, paymentMethod: "autogiro", accountId: acc(db, "Swedbank e-sparkonto"), matchPattern: "IF SKADEFÖRS", shared: true })
      .returning()
      .get();
    tx(db, { account: "Swedbank e-sparkonto", date: "2026-07-31", amount: -19100, desc: "IF SKADEFÖRS" });
    linkRecurring(db);
    const rowsIn = (m: string) => sharedMonth(db, m, TODAY).iPaid.groups.find((g) => g.kind === "recurring")!.rows.filter((r) => r.recurringExpenseId === home.id);
    expect(rowsIn("2026-08").map((r) => [r.date, r.status])).toEqual([["2026-08-31", "forvantat"]]);
  });

  it("counts a charge drawn days before its month in the month the money left: a yearly one due 1/10 drawn 28/9 is September's", async () => {
    const { db } = await setup();
    const fee = db
      .insert(recurringExpenses)
      .values({ name: "Årsavgift", amount: 120000, anchorDay: 1, anchorMonth: 10, billingCycle: "yearly", paymentMethod: "card", accountId: acc(db, "Swedbank Privatkonto"), matchPattern: "EXEMPELKLUBBEN", shared: true })
      .returning()
      .get();
    tx(db, { account: "Swedbank Privatkonto", date: "2026-09-28", amount: -120000, desc: "EXEMPELKLUBBEN" });
    linkRecurring(db);
    const rowsIn = (m: string) => sharedMonth(db, m, "2026-09-29").iPaid.groups.find((g) => g.kind === "recurring")?.rows.filter((r) => r.recurringExpenseId === fee.id) ?? [];
    expect(rowsIn("2026-09").map((r) => [r.payDate, r.status, r.amount])).toEqual([["2026-09-28", "dragen", 120000]]);
    // October's charge is already drawn: neither again nor as expected.
    expect(rowsIn("2026-10")).toEqual([]);
  });
});

describe("purchases that are wholly one person's", () => {
  it("counts in full: hers that I paid, and mine that she paid", async () => {
    const { db, app } = await setup();
    // I paid 82,90 kr on the shared card for something that was hers alone, and she swished 85 kr.
    const hers = tx(db, { account: "Bank Norwegian", date: "2026-08-07", amount: -8290, desc: "KOSTTILLSKOTT", shared: true });
    const before = sharedMonth(db, "2026-08", TODAY).live.result;
    const res = await app.request(`/api/transactions/${hers.id}`, json("PATCH", { forOther: true }));
    expect((await res.json()).transaction).toMatchObject({ shared: false, forOther: true });
    const aug = sharedMonth(db, "2026-08", TODAY);
    expect(aug.forPartner).toMatchObject({ total: 8290, rows: [{ description: "KOSTTILLSKOTT", payDate: "2026-08-25" }] });
    // Shared: half of it counted; hers: all of it.
    expect(aug.live.result - before).toBe(8290 - 4145);

    // She paid 30 kr for something that was mine alone.
    await app.request("/api/transactions", json("POST", { label: "Frimärken", amount: -3000, bookingDate: "2026-08-20", paidBy: "partner", forOther: true }));
    const after = sharedMonth(db, "2026-08", TODAY);
    expect(after.forMe).toMatchObject({ total: 3000, rows: [{ description: "Frimärken" }] });
    expect(after.partnerPaid.total).toBe(6000);
    expect(after.live.result).toBe(aug.live.result - 3000);
  });

  it("can be set for several rows at once, never for private rows or transfers", async () => {
    const { db, app } = await setup();
    const a = tx(db, { account: "Swedbank Privatkonto", date: "2026-08-02", amount: -1000, desc: "A", shared: true });
    const p = tx(db, { account: "Swedbank Privatkonto", date: "2026-08-02", amount: -1000, desc: "P", private: true });
    const res = await app.request("/api/transactions/bulk", json("POST", { ids: [a.id, p.id], owner: "partner" }));
    expect(await res.json()).toMatchObject({ changed: 1, unchanged: 0, skipped: 1 });
    expect(db.select().from(transactions).where(eq(transactions.id, a.id)).get()).toMatchObject({ shared: false, forOther: true });
    expect((await app.request(`/api/transactions/${p.id}`, json("PATCH", { forOther: true }))).status).toBe(400);
  });

  it("counts nothing for me when I paid something wholly hers, and all of it when she paid something mine", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const hers = tx(db, { account: "Swedbank Privatkonto", date: "2026-09-10", amount: -4000, desc: "PRESENT TILL HENNE" });
    await app.request(`/api/transactions/${hers.id}`, json("PATCH", { forOther: true }));
    await app.request("/api/transactions", json("POST", { label: "Bok", amount: -1000, bookingDate: "2026-09-11", paidBy: "partner", forOther: true }));
    expect(spendingPace(db, TODAY, "mine").total).toBe(1000);
    expect(spendingPace(db, TODAY, "household").total).toBe(5000);
  });

  it("suggests which of my purchases a Swish from her was for", async () => {
    const { db } = await setup();
    tx(db, { account: "Swedbank Privatkonto", date: "2026-08-15", amount: -4990, desc: "KINO" }); // ≈ Swish: hers
    tx(db, { account: "Swedbank Privatkonto", date: "2026-08-18", amount: -10200, desc: "MIDDAG" }); // ≈ 2 × Swish: shared
    tx(db, { account: "Swedbank Privatkonto", date: "2026-08-18", amount: -30000, desc: "ANNAT" });
    tx(db, { account: "Swedbank Privatkonto", date: "2026-08-19", amount: -5050, desc: "APOTEK", shared: true }); // shared ≈ Swish: hers?
    tx(db, { account: "Swedbank Privatkonto", date: "2026-08-19", amount: -9900, desc: "DELAT REDAN", shared: true }); // already shared: fine
    const aug = sharedMonth(db, "2026-08", TODAY);
    const swish = aug.transfers.fromPartner.rows.find((r) => r.amount === 5000)!;
    // KJELL (50 kr, from the setup) matches exactly, so it comes first.
    expect(aug.swishCandidates[swish.id!].map((c) => [c.description, c.suggest])).toEqual([
      ["KJELL", "partner"],
      ["KINO", "partner"],
      ["APOTEK", "partner"],
      ["MIDDAG", "shared"],
    ]);
  });
});

describe("what the partner paid", () => {
  it("is shared, has no account and can't be made mine", async () => {
    const { db, app } = await setup();
    const row = db.select().from(transactions).where(eq(transactions.paidBy, "partner")).get()!;
    expect(row).toMatchObject({ source: "manual", accountId: null, shared: true, amount: -6000 });
    expect((await app.request(`/api/transactions/${row.id}`, json("PATCH", { shared: false }))).status).toBe(400);
    expect((await app.request(`/api/transactions/${row.id}`, json("PATCH", { private: true }))).status).toBe(400);
    const withAccount = await app.request(
      "/api/transactions",
      json("POST", { label: "X", amount: -100, bookingDate: "2026-08-12", paidBy: "partner", accountId: acc(db, "Swedbank Privatkonto") }),
    );
    expect(withAccount.status).toBe(400);
    const bulk = await (await app.request("/api/transactions/bulk", json("POST", { ids: [row.id], shared: false }))).json();
    expect(bulk).toMatchObject({ changed: 0, unchanged: 0, skipped: 1 });
  });

  it("counts at half in my spending pace and in full for the household", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    await app.request("/api/transactions", json("POST", { label: "Mat", amount: -6000, bookingDate: "2026-09-10", paidBy: "partner" }));
    expect(spendingPace(db, TODAY, "mine").total).toBe(3000);
    expect(spendingPace(db, TODAY, "household").total).toBe(6000);
  });
});

describe("overview", () => {
  it("shows what is expected from the partner next to the forecast", async () => {
    const { db, app } = await setup();
    db.insert((await import("../src/db/schema.js")).recurringIncome)
      .values({ name: "Lön", amount: 2500000, dayOfMonth: 24, accountId: acc(db, "Swedbank e-sparkonto") })
      .run();
    const o = await (await app.request(`/api/overview?today=${TODAY}`)).json();
    // August's 25 000 carried in, plus half of September's 50 000 in fixed expenses.
    expect(o.forecast.partner).toMatchObject({ amount: 50000, partnerName: "Mio", month: "2026-09" });
  });
});

describe("delade köp på Mastercard", () => {
  it("count on the charge day up to September, from October when the invoice is paid (the 25th, with the salary)", () => {
    const db = freshDb({ seeded: true });
    setSettlementStart(db, "2026-09");
    const mc = acc(db, "Swedbank Mastercard Guld");
    db.insert(statements).values({ accountId: mc, periodFrom: "2026-08-08", periodTo: "2026-09-04", dueDate: "2026-09-30", amountDue: 0, nextPeriodTo: "2026-10-07", source: "pdf" }).run();
    const card = (date: string, amount: number, desc: string) =>
      db.insert(transactions).values({ source: "mastercard", accountId: mc, bookingDate: date, transactionDate: date, descriptionRaw: desc, descriptionClean: desc, counterparty: desc, amount, shared: true, fingerprint: `mc${++seq}` }).run();
    card("2026-09-20", -10000, "SEPTEMBER");
    // On the invoice to 7/10, paid 25/10; and one after it, on November's.
    card("2026-10-02", -20000, "OKTOBER");
    card("2026-10-10", -40000, "EFTER BRYTDAGEN");
    const rows = (month: string) =>
      sharedMonth(db, month, "2026-11-30")
        .iPaid.groups.filter((g) => g.rows.some((r) => /SEPTEMBER|OKTOBER|BRYTDAGEN/.test(r.description)))
        .map((g) => `${g.kind} ${g.payDate ?? "-"} ${g.rows.map((r) => r.description).join(",")}`);
    // September as it was: on the charge day, among the Swedbank rows.
    expect(rows("2026-09")).toEqual(["swedbank - SEPTEMBER"]);
    expect(rows("2026-10")).toEqual(["mastercard 2026-10-25 OKTOBER"]);
    expect(rows("2026-11")).toEqual(["mastercard 2026-11-25 EFTER BRYTDAGEN"]);
  });
});
