import { describe, expect, it } from "vitest";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { accounts, categories, merchantRules, recurringExpenses, recurringIncome, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { importFiles } from "../src/import/importBatch.js";
import { importSwedbankCsv } from "../src/import/importSwedbank.js";
import { importNorwegianXlsx } from "../src/import/importNorwegian.js";
import { extractCounterparty, merchantText, normalizePhone } from "../src/categorize/counterparty.js";
import { counterRefFromReference, accountForCounterRef } from "../src/transfers/transfers.js";
import { suggestRecurringIncome } from "../src/recurring/income.js";
import { linkRecurring, nearestDue } from "../src/recurring/link.js";
import { getPartnerNumbers, setPartnerNumbers } from "../src/settings.js";
import { createApp } from "../src/app.js";
import { SWEDBANK_FILES, allSwedbankFiles, buildCsv, freshDb, sampleFile } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const account = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!;
const count = (db: Db, where = sql`1`) => db.select({ n: sql<number>`count(*)` }).from(transactions).where(where).get()!.n;
const pathOf = (db: Db, id: number | null) => [...getCategoryPathMap(db)].find(([, v]) => v === id)?.[0] ?? null;

async function importAllSwedbank(db: Db) {
  const r = await importFiles(db, allSwedbankFiles());
  for (const f of r.files) if (!f.ok) throw new Error(`${f.filename}: ${f.error}`);
  return r;
}

describe("helpers", () => {
  it("masks the transfer reference to clearing + last four", () => {
    expect(counterRefFromReference("800001234565678")).toBe("80000-••5678");
    expect(counterRefFromReference("8000 0-555 000 5678")).toBe("80000-••5678");
    expect(counterRefFromReference("+46765550019")).toBeNull();
    expect(counterRefFromReference("TRE KRONOR")).toBeNull();
    expect(counterRefFromReference("SK0001019999")).toBeNull();
  });

  it("finds the account for a counter ref by clearing + last four", () => {
    const all = [
      { id: 1, clearing: "80000", accountRef: "••1234" },
      { id: 2, clearing: "80000", accountRef: "••5678" },
      { id: 3, clearing: null, accountRef: null },
    ];
    expect(accountForCounterRef(all, "80000-••5678")).toBe(2);
    expect(accountForCounterRef(all, "80000-••0000")).toBeNull();
    expect(accountForCounterRef(all, "83279-••5678")).toBeNull();
  });

  it("strips the K* card prefix and treats Swish numbers as merchants in both directions", () => {
    expect(merchantText("K*ICA KVANTU")).toBe("ICA KVANTU");
    expect(extractCounterparty("K*Systembola")).toBe("Systembola");
    expect(extractCounterparty("Swish skickad +46765550019")).toBe("+46765550019");
    expect(extractCounterparty("Swish mottagen +46765550019")).toBe("+46765550019");
    expect(extractCounterparty("Swish utbetalning Rocker AB (publ)")).toBe("Rocker AB (publ)");
  });

  it("normalizes Swedish phone numbers", () => {
    for (const n of ["0765550019", "076-555 00 19", "+46765550019", "46765550019", "0046765550019"]) {
      expect(normalizePhone(n)).toBe("+46765550019");
    }
    expect(normalizePhone("abc")).toBeNull();
  });

  it("finds the nearest due date across month ends", () => {
    expect(nearestDue("2026-08-28", 30)).toEqual({ distance: 2, month: "2026-08" });
    expect(nearestDue("2026-03-02", 31)).toEqual({ distance: 2, month: "2026-02" }); // due Feb 28
    expect(nearestDue("2026-09-01", 31)).toEqual({ distance: 1, month: "2026-08" });
    expect(nearestDue("2026-08-24", 24)).toEqual({ distance: 0, month: "2026-08" });
  });
});

describe("all four Swedbank files", () => {
  it("import into Privatkonto and e-sparkonto, bound by product with clearing", async () => {
    const db = freshDb({ seeded: true });
    const r = await importAllSwedbank(db);
    expect(r.accounts.map((a) => [a.product, a.ref, a.clearing, a.resolvedBy])).toEqual(
      expect.arrayContaining([
        ["Privatkonto", "••1234", "80000", "hint"],
        ["e-sparkonto", "••5678", "80000", "hint"],
      ]),
    );
    expect(account(db, "Swedbank e-sparkonto")).toMatchObject({ accountRef: "••5678", clearing: "80000" });
    expect(count(db)).toBe(195 + 16 + 65 + 21);
    expect(r.files.map((f) => (f.ok ? f.result.rowsNew : -1)).reduce((a, b) => a + b)).toBe(297);
  });

  it("pairs all 14 internal transfers; none counts as expense or income", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    const privat = account(db, "Swedbank Privatkonto").id;
    const espar = account(db, "Swedbank e-sparkonto").id;

    const paired = db.select().from(transactions).where(isNotNull(transactions.transferPairId)).all();
    expect(paired).toHaveLength(28);
    expect(new Set(paired.map((t) => t.transferPairId)).size).toBe(14);
    expect(paired.every((t) => t.isTransfer && !t.shared)).toBe(true);
    // No rule for 'Överföring via internet': these are transfers because Referens matched my own account.
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "Överföring via internet")).get()).toBeUndefined();
    expect(paired.every((t) => pathOf(db, t.categoryId) === "Överföringar & sparande/Egna överföringar" && t.counterRef)).toBe(true);

    // Each pair: opposite amounts, opposite accounts pointing at each other.
    const byPair = Map.groupBy(paired, (t) => t.transferPairId!);
    for (const [, [a, b]] of byPair) {
      expect(a.amount).toBe(-b.amount);
      expect(a.counterAccountId).toBe(b.accountId);
      expect(b.counterAccountId).toBe(a.accountId);
    }
    const sumOut = (from: number) => paired.filter((t) => t.accountId === from && t.amount < 0).reduce((s, t) => s + t.amount, 0);
    expect(sumOut(espar)).toBe(-3850000); // e-sparkonto -> Privatkonto, 6 x 6 000 kr + 2 500 kr
    expect(sumOut(privat)).toBe(-1174000); // Privatkonto -> e-sparkonto, 6 x 1 500 kr + 2 740 kr
    expect(paired.filter((t) => t.accountId === espar && t.amount < 0)).toHaveLength(7);
    expect(paired.filter((t) => t.accountId === privat && t.amount < 0)).toHaveLength(7);

    // Nothing with a counter account is left unpaired except card-bill payments (card accounts not imported here).
    const unpaired = db
      .select({ d: transactions.descriptionClean })
      .from(transactions)
      .where(and(isNotNull(transactions.counterAccountId), sql`${transactions.transferPairId} is null`))
      .all();
    expect(new Set(unpaired.map((u) => u.d))).toEqual(new Set(["Bank Norwegian", "Mastercard Guld"]));
  });

  it("does not pair a purchase that happens to equal a transfer (FORDONSSKATT 2 740 kr)", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    const skatt = db.select().from(transactions).where(sql`description_clean = 'FORDONSSKATT TRA' and amount = -274000`).get()!;
    expect(skatt).toMatchObject({ isTransfer: false, counterAccountId: null, transferPairId: null });
    expect(pathOf(db, skatt.categoryId)).toBe("Bil");
  });

  it("pairs transfers when the two accounts are imported in separate batches", async () => {
    const db = freshDb({ seeded: true });
    await importFiles(db, [sampleFile(SWEDBANK_FILES.privatUttag), sampleFile(SWEDBANK_FILES.privatInsattningar)]);
    // e-sparkonto isn't bound yet: the counter account is unknown, so these are
    // not transfers but uncategorised rows to review.
    expect(count(db, isNotNull(transactions.transferPairId))).toBe(0);
    const internet = sql`description_clean = 'Överföring via internet'`;
    expect(count(db, and(internet, eq(transactions.isTransfer, false), sql`category_id is null`))).toBe(14);
    await importFiles(db, [sampleFile(SWEDBANK_FILES.esparUttag), sampleFile(SWEDBANK_FILES.esparInsattningar)]);
    expect(count(db, isNotNull(transactions.transferPairId))).toBe(28);
    expect(count(db, and(internet, eq(transactions.isTransfer, true)))).toBe(28);
  });

  it("dry run of the batch gives the real numbers and writes nothing", async () => {
    const db = freshDb({ seeded: true });
    const dry = await importFiles(db, allSwedbankFiles(), { dryRun: true });
    expect(count(db)).toBe(0);
    expect(account(db, "Swedbank e-sparkonto").accountRef).toBeNull();
    const real = await importFiles(db, allSwedbankFiles());
    const summary = (r: typeof dry) =>
      r.files.map((f) => (f.ok ? [f.filename, f.result.rowsNew, f.result.rowsSkipped, f.result.internalTransfers, f.result.transferPairs] : f.error));
    expect(summary(dry)).toEqual(summary(real));
    expect(dry.files.every((f) => f.ok && f.result.dryRun && f.result.importId === null)).toBe(true);
  });

  it("re-importing shows every file as already imported", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    const again = await importFiles(db, allSwedbankFiles());
    expect(again.files.every((f) => f.ok && f.alreadyImported && f.result.rowsNew === 0)).toBe(true);
    expect(count(db)).toBe(297);
    expect(new Set(db.select().from(transactions).where(isNotNull(transactions.transferPairId)).all().map((t) => t.transferPairId)).size).toBe(14);
  });
});

describe("rules on the new accounts", () => {
  it("categorise expenses, income and K* card rows", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    const cat = (desc: string) => {
      const t = db.select().from(transactions).where(eq(transactions.descriptionClean, desc)).get();
      if (!t) throw new Error(`no row "${desc}"`);
      return pathOf(db, t.categoryId);
    };
    // The landlord has no seed rule (it is not a generic merchant): the rent is for the user to categorise.
    expect(cat("EXEMPELHEM BOSTAD")).toBeNull();
    expect(cat("TRE KRONOR")).toBe("Försäkring");
    expect(cat("IF SKADEFÖRS")).toBe("Försäkring");
    expect(cat("AKASSA EXEMPEL")).toBe("Försäkring/A-kassa");
    expect(cat("FOLKTANDVÅRD")).toBe("Hälsa/Tandvård");
    expect(cat("FITNESS24")).toBe("Hälsa/Träning");
    expect(cat("K*apotekhjar")).toBe("Hälsa/Vård & apotek");
    expect(cat("PRIS NYCKELKUND")).toBe("Bank & avgifter");
    expect(cat("FORDONSSKATT TRA")).toBe("Bil");
    expect(cat("TRÄNGSELSKATT TR")).toBe("Bil/Trängselskatt");
    expect(cat("Infrastrukturavg")).toBe("Bil/Trängselskatt");
    expect(cat("CSN")).toBe("Lån & avbetalning/CSN");
    expect(cat("TELE2")).toBe("IT & tele/Bredband & mobil");
    expect(cat("K*Systembola")).toBe("Mat/Alkohol");
    expect(cat("Systembolaget")).toBe("Mat/Alkohol");
    expect(cat("K*Elite Stad")).toBe("Resor/Hotell");
    expect(cat("K*Quality Ho")).toBe("Resor/Hotell");
    expect(cat("Swish Scandic Hotels A")).toBe("Resor/Hotell");
    // K*-truncated names still hit the existing rules.
    expect(cat("K*ICA KVANTU")).toBe("Mat/Livsmedel");
    expect(cat("K*LIDL 271 D")).toBe("Mat/Livsmedel");
    expect(cat("K*WILLYS TAB")).toBe("Mat/Livsmedel");
    expect(cat("K*MAX HAMBURG")).toBe("Mat/Restaurang & café");
    expect(cat("K*SpotifySE")).toBe("Nöje/Streaming");
    // Income.
    expect(cat("LÖN")).toBe("Inkomst/Lön");
    expect(cat("Lön")).toBe("Inkomst/Lön");
    expect(cat("Sparränta")).toBe("Inkomst/Övrigt");
    expect(cat("ÅTERBET IF")).toBe("Inkomst/Övrigt");
    expect(cat("AVANZA")).toBe("Överföringar & sparande/Sparande");
    expect(cat("LYSA")).toBe("Överföringar & sparande/Sparande");
    // Swish numbers: only the partner's (a contact) is categorised; any other number stays uncategorised until the user adds a rule.
    expect(cat("Swish mottagen +46705550005")).toBeNull();
    expect(cat("Swish mottagen +46705550009")).toBeNull();
    expect(cat("Swish mottagen +46765550019")).toBe("Inkomst/Från partner");
    // Money sent to the partner needs a rule of the user's own (see the partner payments below).
    expect(cat("Swish skickad +46765550019")).toBeNull();
    expect(cat("Swish mottagen +46705550008")).toBeNull();
    expect(cat("Swish skickad +46705550008")).toBeNull();
  });

  it("marks card bill payments as transfers to the card account", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    const norwegian = account(db, "Bank Norwegian").id;
    const mastercard = account(db, "Swedbank Mastercard Guld").id;
    const rows = db.select().from(transactions).where(sql`description_clean in ('Bank Norwegian', 'Mastercard Guld')`).all();
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.isTransfer).toBe(true);
      expect(r.counterAccountId).toBe(r.descriptionClean === "Bank Norwegian" ? norwegian : mastercard);
      expect(pathOf(db, r.categoryId)).toBe("Överföringar & sparande/Kortbetalning");
    }
  });

  it("pairs the e-sparkonto payment of the Norwegian bill with the card's 'Inbetalning'", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { SAMPLES_DIR } = await import("./helpers.js");
    await importNorwegianXlsx(db, readFileSync(join(SAMPLES_DIR, "Augusti.xlsx")), "Augusti.xlsx");
    const pay = db.select().from(transactions).where(sql`description_clean = 'Bank Norwegian' and booking_date = '2026-08-25'`).get()!;
    const inb = db.select().from(transactions).where(sql`description_clean = 'Inbetalning' and booking_date = '2026-08-25'`).get()!;
    expect(pay.transferPairId).not.toBeNull();
    expect(inb).toMatchObject({ transferPairId: pay.transferPairId, counterAccountId: account(db, "Swedbank e-sparkonto").id, amount: 791350 });
  });

  it("one rule per Swish number covers both directions", () => {
    const db = freshDb({ seeded: true });
    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.insert(merchantRules).values({ pattern: "+46705550002", matchType: "contains", categoryId: other.id }).run();
    importSwedbankCsv(
      db,
      buildCsv([
        { date: "2026-01-10", desc: "Swish skickad +46705550002", ref: "+46705550002", amount: "-100.00" },
        { date: "2026-01-11", desc: "Swish mottagen +46705550002", ref: "+46705550002", amount: "50.00" },
        { date: "2026-01-12", desc: "Swish mottagen +46705550003", ref: "+46705550003", amount: "50.00" },
      ]),
      "mixed.csv",
    );
    const rows = db.select().from(transactions).orderBy(transactions.bookingDate).all();
    expect(rows.map((r) => [r.counterparty, r.categoryId])).toEqual([
      ["+46705550002", other.id],
      ["+46705550002", other.id],
      ["+46705550003", null],
    ]);
  });
});

describe("partner payments", () => {
  it("categorises incoming Swish from the partner's number as 'Från partner'; outgoing is the user's own rule to 'Till partner'", async () => {
    const db = freshDb({ seeded: true });
    // Seeded from SEED_CONTACTS; the number in settings is normalized.
    expect(getPartnerNumbers(db)).toEqual(["+46765550019"]);
    await importAllSwedbank(db);
    const incoming = db.select().from(transactions).where(eq(transactions.descriptionClean, "Swish mottagen +46765550019")).all();
    expect(incoming).toHaveLength(6);
    expect(incoming.every((t) => pathOf(db, t.categoryId) === "Inkomst/Från partner" && !t.isTransfer && !t.shared)).toBe(true);
    // No seed rule for outgoing Swish to a number: it waits for review.
    const outgoing = db.select().from(transactions).where(eq(transactions.descriptionClean, "Swish skickad +46765550019")).all();
    expect(outgoing).toHaveLength(8);
    expect(outgoing.every((t) => t.categoryId === null && !t.isTransfer)).toBe(true);

    // With a rule for the partner's number, the same rows go to 'Till partner' (settlement, not shared).
    const db2 = freshDb({ seeded: true });
    const toPartner = db2.select().from(categories).where(eq(categories.name, "Till partner")).get()!;
    db2.insert(merchantRules).values({ pattern: "Swish skickad +46765550019", matchType: "contains", categoryId: toPartner.id }).run();
    await importAllSwedbank(db2);
    const sent = db2.select().from(transactions).where(eq(transactions.descriptionClean, "Swish skickad +46765550019")).all();
    expect(sent).toHaveLength(8);
    expect(sent.every((t) => pathOf(db2, t.categoryId) === "Till partner" && !t.isTransfer && !t.shared)).toBe(true);
  });

  it("follows a changed partner number in settings", async () => {
    const db = freshDb({ seeded: true });
    setPartnerNumbers(db, ["070-555 00 08"]);
    await importAllSwedbank(db);
    const cat = (d: string) => pathOf(db, db.select().from(transactions).where(eq(transactions.descriptionClean, d)).get()!.categoryId);
    expect(cat("Swish mottagen +46705550008")).toBe("Inkomst/Från partner");
    expect(cat("Swish mottagen +46765550019")).toBeNull();
  });

  it("rejects an invalid number in settings", () => {
    const db = freshDb({ seeded: true });
    expect(() => setPartnerNumbers(db, ["hej"])).toThrow(/Ogiltigt/);
  });
});

describe("recurring income (salary)", () => {
  it("suggests Lön on e-sparkonto from the three latest salaries, and links salary rows once confirmed", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    const espar = account(db, "Swedbank e-sparkonto");
    const [s, ...rest] = suggestRecurringIncome(db, "2026-09-18");
    expect(rest).toEqual([]); // Privatkonto's salaries are too old.
    expect(s).toMatchObject({
      name: "Lön",
      accountId: espar.id,
      amount: 1683300, // (24500 + 24500 + 1500) / 3, whole kronor: the extra 1 500 kr 'Lön' on 30 June is one of the three latest
      dayOfMonth: 25,
      matchPattern: "LÖN",
    });
    expect(s.basedOn.map((b) => b.bookingDate)).toEqual(["2026-08-25", "2026-07-25", "2026-06-30"]);

    db.insert(recurringIncome).values({ name: s.name, amount: s.amount, dayOfMonth: s.dayOfMonth, accountId: s.accountId, matchPattern: s.matchPattern }).run();
    const linked = linkRecurring(db);
    const salaries = db.select().from(transactions).where(and(eq(transactions.accountId, espar.id), sql`description_clean in ('LÖN', 'Lön')`)).all();
    expect(linked.income).toBe(salaries.length);
    expect(salaries.every((t) => t.recurringIncomeId !== null)).toBe(true);
    expect(suggestRecurringIncome(db, "2026-09-18")).toEqual([]);
  });

  it("suggests nothing when the latest salary is old", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    expect(suggestRecurringIncome(db, "2027-03-01")).toEqual([]);
  });
});

describe("recurring expense matching", () => {
  it("matches by account + pattern + day ±5; amount only breaks ties", async () => {
    const db = freshDb({ seeded: true });
    await importAllSwedbank(db);
    // A second insurer charge the same day as the first (389 and 231 on the 30th), as on a household with two policies.
    importSwedbankCsv(
      db,
      buildCsv([
        { account: "1234565678", product: "e-sparkonto", date: "2026-08-30", desc: "TRE KRONOR", amount: "-389.00" },
        { account: "1234565678", product: "e-sparkonto", date: "2026-07-30", desc: "TRE KRONOR", amount: "-389.00" },
      ]),
      "extra.csv",
    );
    const espar = account(db, "Swedbank e-sparkonto").id;
    const privat = account(db, "Swedbank Privatkonto").id;
    const add = (name: string, amount: number, day: number, pattern: string, accountId = espar) =>
      db.insert(recurringExpenses).values({ name, amount, anchorDay: day, paymentMethod: "autogiro", matchPattern: pattern, accountId }).returning().get();
    // The car policy's price is a little off what the bank draws (370 vs 389): the amount still picks the right charge.
    const bil = add("Bilförsäkringen", 37000, 30, "TRE KRONOR");
    const hem = add("Hemförsäkring", 23100, 30, "TRE KRONOR");
    // A-kassa: 150 in the bank vs 140 expected, drawn the 5th vs due the 3rd.
    const akassa = add("A-Kassa", 14000, 3, "AKASSA EXEMPEL");
    const wrongAccount = add("CSN på fel konto", 150000, 25, "CSN", privat);
    linkRecurring(db);

    const linkedTo = (id: number, month: string) =>
      db.select().from(transactions).where(sql`recurring_expense_id = ${id} and booking_date like ${month + "%"}`).all().map((t) => t.amount);

    // August and July: 389 and 231 the same day go to the right expense.
    expect(linkedTo(bil.id, "2026-08")).toEqual([-38900]);
    expect(linkedTo(hem.id, "2026-08")).toEqual([-23100]);
    expect(linkedTo(bil.id, "2026-07")).toEqual([-38900]);
    expect(linkedTo(hem.id, "2026-07")).toEqual([-23100]);
    // A-kassa: the price and the day both differ a little and it still links.
    expect(linkedTo(akassa.id, "2026-08")).toEqual([-15000]);
    // One draw per period: April to September, six months in all.
    expect(linkedTo(akassa.id, "2026")).toHaveLength(6);
    // CSN is drawn from e-sparkonto; an expense on Privatkonto never matches it.
    expect(linkedTo(wrongAccount.id, "2026")).toEqual([]);
  });
});

describe("multi-file import", () => {
  it("imports in date order, one import log per file, a broken file only stops itself", async () => {
    const db = freshDb({ seeded: true });
    const older = buildCsv([{ date: "2025-01-10", desc: "ICA", amount: "-10.00" }], { meta: "* Transaktioner Period 2025-01-01–2025-01-31" });
    const newer = buildCsv([{ date: "2026-01-10", desc: "ICA", amount: "-20.00" }], { meta: "* Transaktioner Period 2026-01-01–2026-01-31" });
    const broken = buildCsv([{ date: "2026-13-10", desc: "X", amount: "-1.00" }]);
    const r = await importFiles(db, [
      { name: "b.csv", bytes: newer },
      { name: "trasig.csv", bytes: broken },
      { name: "a.csv", bytes: older },
      { name: "okänd.txt", bytes: Buffer.from("hej") },
    ]);
    expect(r.files.map((f) => [f.filename, f.ok])).toEqual([
      ["a.csv", true],
      ["b.csv", true],
      ["trasig.csv", false],
      ["okänd.txt", false],
    ]);
    const imports = db.$client.prepare("select filename, rows_new from imports order by id").all();
    expect(imports).toEqual([
      { filename: "a.csv", rows_new: 1 },
      { filename: "b.csv", rows_new: 1 },
    ]);
  });

  it("asks once per unknown account; files for other accounts still import", async () => {
    const db = freshDb({ seeded: true });
    const sparA = buildCsv([{ account: "1234567890", product: "Sparkonto", date: "2026-01-10", desc: "Ränta", amount: "1.00" }]);
    const sparB = buildCsv([{ account: "1234567890", product: "Sparkonto", date: "2026-02-10", desc: "Ränta", amount: "2.00" }]);
    const privat = buildCsv([{ date: "2026-01-10", desc: "ICA", amount: "-5.00" }]);
    const files = [
      { name: "a.csv", bytes: sparA },
      { name: "b.csv", bytes: sparB },
      { name: "p.csv", bytes: privat },
    ];
    const first = await importFiles(db, files);
    expect(first.accounts.find((a) => a.ref === "••7890")).toMatchObject({ accountId: null, rows: 2 });
    expect(first.files.map((f) => f.ok)).toEqual([false, false, true]);

    const second = await importFiles(db, files, { accountMap: { "••7890": "new" } });
    expect(second.files.map((f) => f.ok)).toEqual([true, true, true]);
    expect(db.select().from(accounts).where(eq(accounts.accountRef, "••7890")).all()).toHaveLength(1);
    expect(count(db)).toBe(3);
  });

  it("handles file names with spaces and å/ä through the API (also decomposed Unicode)", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const form = new FormData();
    for (const f of allSwedbankFiles()) form.append("files", new File([new Uint8Array(f.bytes)], f.name));
    // macOS can hand over names in NFD (a + combining ring); stored as NFC.
    form.append("files", new File([new Uint8Array(buildCsv([{ date: "2026-01-10", desc: "ICA", amount: "-1.00" }]))], "Insättningar extra.csv".normalize("NFD")));
    const res = await app.request("/api/imports", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Awaited<ReturnType<typeof importFiles>>;
    expect(body.files.every((f) => f.ok)).toBe(true);
    expect(body.files.map((f) => f.filename).sort()).toEqual(
      [...Object.values(SWEDBANK_FILES), "Insättningar extra.csv"].sort(),
    );
    const names = db.$client.prepare("select filename from imports").all() as { filename: string }[];
    expect(names.map((n) => n.filename)).toContain("SWEDBANK - Insättningar ESPARKONTO.csv");
    expect(names.every((n) => n.filename === n.filename.normalize("NFC"))).toBe(true);
  });

  it("imports a file with both deposits and withdrawals", () => {
    const db = freshDb({ seeded: true });
    const r = importSwedbankCsv(
      db,
      buildCsv([
        { date: "2026-01-25", desc: "LÖN", amount: "25000.00" },
        { date: "2026-01-26", desc: "ICA", amount: "-100.00" },
      ]),
      "blandad.csv",
    );
    expect(r.rowsNew).toBe(2);
    expect(db.select({ a: transactions.amount }).from(transactions).orderBy(transactions.bookingDate).all()).toEqual([{ a: 2500000 }, { a: -10000 }]);
  });
});

describe("transfer pairing edge cases (synthetic)", () => {
  const PRIVAT = { account: "1234561234", product: "Privatkonto" };
  const ESPAR = { account: "1234565678", product: "e-sparkonto" };
  const toEspar = "800001234565678";
  const toPrivat = "800001234561234";

  function setup(privatRows: Parameters<typeof buildCsv>[0], esparRows: Parameters<typeof buildCsv>[0]) {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv(privatRows.map((r) => ({ ...PRIVAT, ...r }))), "privat.csv");
    importSwedbankCsv(db, buildCsv(esparRows.map((r) => ({ ...ESPAR, ...r }))), "espar.csv");
    return db;
  }
  const rowsOf = (db: Db) => db.select().from(transactions).orderBy(transactions.id).all();

  it("pairs sides one day apart, not two", () => {
    const db = setup(
      [
        { date: "2026-01-10", desc: "Överföring via internet", ref: toEspar, amount: "-100.00" },
        { date: "2026-01-20", desc: "Överföring via internet", ref: toEspar, amount: "-200.00" },
      ],
      [
        { date: "2026-01-11", desc: "Överföring via internet", ref: toPrivat, amount: "100.00" },
        { date: "2026-01-22", desc: "Överföring via internet", ref: toPrivat, amount: "200.00" },
      ],
    );
    const [a100, a200, b100, b200] = rowsOf(db);
    expect(a100.transferPairId).not.toBeNull();
    expect(b100.transferPairId).toBe(a100.transferPairId);
    expect(a200.transferPairId).toBeNull();
    expect(b200.transferPairId).toBeNull();
    // Unpaired, but still internal transfers (the counter account is known).
    expect([a200, b200].every((t) => t.isTransfer && t.counterAccountId !== null)).toBe(true);
  });

  it("never pairs with an ordinary purchase of the same amount, even with no other candidate", () => {
    const db = setup(
      [{ date: "2026-01-10", desc: "Överföring via internet", ref: toEspar, amount: "2845.00" }],
      [{ date: "2026-01-10", desc: "FORDONSSKATT TRA", amount: "-2845.00" }],
    );
    const [transfer, skatt] = rowsOf(db);
    expect(transfer).toMatchObject({ isTransfer: true, transferPairId: null });
    expect(skatt).toMatchObject({ isTransfer: false, transferPairId: null, counterAccountId: null });
  });

  it("pairs identical same-day transfers one to one", () => {
    const t = { date: "2026-01-10", desc: "Överföring via internet", amount: "-500.00" };
    const db = setup(
      [{ ...t, ref: toEspar }, { ...t, ref: toEspar }, { ...t, ref: toEspar }],
      [
        { ...t, ref: toPrivat, amount: "500.00" },
        { ...t, ref: toPrivat, amount: "500.00" },
      ],
    );
    const rows = rowsOf(db);
    const pairs = Map.groupBy(rows.filter((r) => r.transferPairId), (r) => r.transferPairId);
    expect(pairs.size).toBe(2);
    expect([...pairs.values()].every((p) => p.length === 2)).toBe(true);
    expect(rows.filter((r) => r.transferPairId === null)).toHaveLength(1);
  });

  it("leaves a hand-edited row's category and flags alone when its counter account is found later", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv([{ ...PRIVAT, date: "2026-01-10", desc: "Överföring via internet", ref: toEspar, amount: "-100.00" }]), "p.csv");
    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.update(transactions).set({ categoryId: other.id, categorySource: "manual", isTransfer: false, manuallyEditedAt: "2026-02-01T00:00:00Z" }).run();
    importSwedbankCsv(db, buildCsv([{ ...ESPAR, date: "2026-01-10", desc: "Överföring via internet", ref: toPrivat, amount: "100.00" }]), "e.csv");
    const [edited] = rowsOf(db);
    expect(edited).toMatchObject({ categoryId: other.id, categorySource: "manual", isTransfer: false });
    expect(edited.counterAccountId).toBe(account(db, "Swedbank e-sparkonto").id);
  });
});
