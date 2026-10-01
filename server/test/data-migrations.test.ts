import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "../src/config.js";
import { openDb, runMigrations, type Db } from "../src/db/client.js";
import { accounts, categories, dataMigrations, merchantCategoryMap, merchantRules, transactions } from "../src/db/schema.js";
import { SEED_ACCOUNTS, SEED_CATEGORIES } from "../src/db/seedData.js";
import { norwegianFingerprint } from "../src/import/norwegianKey.js";
import { parseNorwegianXlsx } from "../src/import/norwegianXlsx.js";
import { importNorwegianXlsx } from "../src/import/importNorwegian.js";
import { sampleFile } from "./helpers.js";

/**
 * A database as the step 3 code left it, made here with made-up rows: the SQL
 * migrations applied, but none of the data migrations; the categories as they
 * were then (Mat › Systembolaget, no keys, none of the later ones), only the
 * Privatkonto and Bank Norwegian, a couple of rules, no merchant category map,
 * and a Bank Norwegian invoice imported from the PDF with its old fingerprints
 * and descriptions ('MERCHANT ,CITY'), one row edited by hand.
 */
const LATER_CATEGORIES = new Set(["Hämtmat", "A-kassa", "Hotell", "Från partner", "Okänt", "Utlägg"]);
const OLD_ROWS: { date: string; raw: string; amount: number; transfer?: boolean; manual?: boolean }[] = [
  { date: "2026-08-02", raw: "WILLYS EXEMPELSTAD ,EXEMPELSTAD", amount: -27103 },
  { date: "2026-08-04", raw: "PIZZERIA ROMA ,EXEMPELSTAD", amount: -17463 },
  { date: "2026-08-06", raw: "OKQ8 EXEMPELSTAD ,EXEMPELSTAD", amount: -81388 },
  { date: "2026-08-08", raw: "STADIUM EXEMPELSTAD ,EXEMPELSTAD", amount: -37769, manual: true },
  { date: "2026-08-25", raw: "Inbetalning från 1234567", amount: 791350, transfer: true },
];

function step3Db(): Db {
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: config.migrationsDir });
  for (const top of SEED_CATEGORIES.filter((c) => c.name !== "Till partner")) {
    const parent = db.insert(categories).values({ name: top.name, color: top.color, isTransfer: top.isTransfer ?? false }).returning().get();
    for (const child of (top.children ?? []).filter((c) => !LATER_CATEGORIES.has(c))) {
      db.insert(categories).values({ name: child === "Alkohol" ? "Systembolaget" : child, parentId: parent.id, color: top.color, isTransfer: top.isTransfer ?? false }).run();
    }
  }
  for (const a of SEED_ACCOUNTS.filter((a) => a.source === "swedbank" && a.importHint === "Privatkonto" || a.source === "norwegian")) db.insert(accounts).values(a).run();
  const categoryOf = (name: string) => db.select().from(categories).where(eq(categories.name, name)).get()!;
  const norwegian = db.select().from(accounts).where(eq(accounts.source, "norwegian")).get()!;
  db.insert(merchantRules).values({ pattern: "Bank Norwegian", matchType: "contains", categoryId: categoryOf("Kortbetalning").id, isTransfer: true, createdFrom: "seed" }).run();
  db.insert(merchantRules).values({ pattern: "WILLYS", matchType: "contains", categoryId: categoryOf("Livsmedel").id, createdFrom: "seed" }).run();
  OLD_ROWS.forEach((r, i) =>
    db
      .insert(transactions)
      .values({
        source: "norwegian",
        accountId: norwegian.id,
        bookingDate: r.date,
        transactionDate: r.date,
        descriptionRaw: r.raw,
        descriptionClean: r.raw, // the old import kept the city in the description
        amount: r.amount,
        categoryId: r.transfer ? categoryOf("Kortbetalning").id : r.manual ? categoryOf("Övrigt").id : null,
        categorySource: r.transfer ? "rule" : r.manual ? "manual" : "none",
        note: r.manual ? "manuell anteckning" : null,
        isTransfer: r.transfer ?? false,
        cardMasked: r.transfer ? null : "412345******0000",
        fingerprint: `step3-${i}`,
        occurrenceIndex: 1,
      })
      .run(),
  );
  return db;
}

describe("data migrations on a step 3 database", () => {
  it("recomputes Norwegian fingerprints to the cross-source key", async () => {
    const db = step3Db();
    const oldRows = db.select({ id: transactions.id, fingerprint: transactions.fingerprint }).from(transactions).orderBy(transactions.id).all();
    runMigrations(db);

    const rows = db.select().from(transactions).orderBy(transactions.id).all();
    expect(rows).toHaveLength(OLD_ROWS.length);
    // The key an XLSX export gives the same purchases: no card number, the text without the city, payments as one text.
    const exported = await parseNorwegianXlsx(sampleFile("Augusti.xlsx").bytes);
    expect(new Set(rows.map((r) => r.fingerprint))).toEqual(new Set(exported.rows.filter((r) => OLD_ROWS.some((o) => o.date === r.transactionDate && o.amount === r.amount)).map((r) => r.fingerprint)));
    expect(rows[0].fingerprint).toBe(norwegianFingerprint({ transactionDate: "2026-08-02", merchantText: "WILLYS EXEMPELSTAD", isPayment: false, amount: -27103 }));
    expect(rows.every((r, i) => r.fingerprint !== oldRows[i].fingerprint)).toBe(true);
    expect(rows.every((r) => r.occurrenceIndex === 1)).toBe(true);

    // Description split into merchant + area; manual edit kept.
    expect(rows.find((r) => r.descriptionRaw === "WILLYS EXEMPELSTAD ,EXEMPELSTAD")).toMatchObject({
      descriptionClean: "WILLYS EXEMPELSTAD",
      merchantArea: "EXEMPELSTAD",
      counterparty: "WILLYS EXEMPELSTAD",
    });
    expect(rows.find((r) => r.descriptionClean === "STADIUM EXEMPELSTAD")).toMatchObject({ note: "manuell anteckning", categorySource: "manual" });
    expect(rows.find((r) => r.isTransfer)).toMatchObject({ descriptionClean: "Inbetalning från ••4567" });

    // After the migration the XLSX export dedupes against the old PDF rows.
    const aug = await importNorwegianXlsx(db, sampleFile("Augusti.xlsx").bytes, "Augusti.xlsx");
    expect(aug).toMatchObject({ rowsNew: 17 - OLD_ROWS.length, rowsSkipped: OLD_ROWS.length });
    db.$client.close();
  });

  it("renames Systembolaget to Alkohol and adds the merchant category map and rule", () => {
    const db = step3Db();
    runMigrations(db);
    const names = db.select({ name: categories.name }).from(categories).all().map((c) => c.name);
    expect(names).toContain("Alkohol");
    expect(names).not.toContain("Systembolaget");
    expect(db.select().from(merchantCategoryMap).all().length).toBeGreaterThanOrEqual(8);
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "SYSTEMBOLA")).get()).toBeDefined();
    // Step "accounts, transfers, income": e-sparkonto, new categories and rules.
    const accountNames = db.$client.prepare("select name from accounts").all().map((r: any) => r.name);
    expect(accountNames).toContain("Swedbank e-sparkonto");
    expect(names).toEqual(expect.arrayContaining(["A-kassa", "Hotell", "Från partner"]));
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "FITNESS24")).get()).toBeDefined();
    expect(db.select().from(dataMigrations).all().map((m) => m.name)).toEqual([
      "0001_norwegian_fingerprint_v2",
      "0002_merchant_categories_and_alkohol",
      "0003_accounts_transfers_income",
      "0004_remove_internet_transfer_rule",
      "0005_contacts_and_person_rules",
      "0006_settlement_categories_and_pocket",
      "0007_category_keys_and_new_categories",
      "0008_recurring_expense_seed_names",
      "0009_food_category_keys",
      "0010_mastercard",
      "0011_nordicwell_pattern",
      "0012_colorblind_palette",
      "0013_shared_expense_charges",
      "0014_savings_category_key",
      "0015_takeaway_category",
      "0016_match_keys",
      "0017_brand_slugs",
      "0018_products",
      "0019_manual_balances",
      "0020_pensions",
      "0021_reference_budget_map",
      "0022_merchant_category_aliases",
      "0023_modules_on_for_existing_databases",
    ]);
    // Keys for the categories the code relies on, and the new categories.
    const keyed = db.$client
      .prepare("select c.system_key as key, coalesce(p.name || '/', '') || c.name as path from categories c left join categories p on p.id = c.parent_id where c.system_key is not null order by c.system_key")
      .all();
    expect(keyed).toEqual([
      { key: "card_payment", path: "Överföringar & sparande/Kortbetalning" },
      { key: "from_partner", path: "Inkomst/Från partner" },
      { key: "groceries", path: "Mat/Livsmedel" },
      { key: "income", path: "Inkomst" },
      { key: "own_transfer", path: "Överföringar & sparande/Egna överföringar" },
      { key: "restaurants", path: "Mat/Restaurang & café" },
      { key: "salary", path: "Inkomst/Lön" },
      { key: "savings", path: "Överföringar & sparande/Sparande" },
      { key: "takeaway", path: "Mat/Hämtmat" },
      { key: "to_partner", path: "Till partner" },
      { key: "transfers", path: "Överföringar & sparande" },
      { key: "unknown", path: "Övrigt/Okänt" },
    ]);
    expect(db.$client.prepare("select count(*) as n from categories where name = 'Utlägg'").get()).toEqual({ n: 1 });
    db.$client.close();
  });

  it("renumbers rows that end up with the same fingerprint, and runs only once", () => {
    const db = step3Db();
    // Two rows that differed only in card number (possible with a partner card)
    // collapse to one fingerprint and must become occurrence 1 and 2.
    db.$client
      .prepare(
        `insert into transactions (source, account_id, booking_date, transaction_date, description_raw, description_clean, amount, currency,
          category_source, shared, is_transfer, card_masked, fingerprint, occurrence_index)
         select source, account_id, booking_date, transaction_date, description_raw, description_clean, amount, currency,
          category_source, shared, is_transfer, '111111******2222', 'old-partner-card-fp', 1
         from transactions where description_raw = 'WILLYS EXEMPELSTAD ,EXEMPELSTAD' and transaction_date = '2026-08-02'`,
      )
      .run();

    runMigrations(db);
    const willys = db
      .select()
      .from(transactions)
      .where(sql`description_clean = 'WILLYS EXEMPELSTAD' and transaction_date = '2026-08-02'`)
      .all();
    expect(willys.map((r) => r.occurrenceIndex).sort()).toEqual([1, 2]);
    expect(new Set(willys.map((r) => r.fingerprint)).size).toBe(1);

    const snapshot = db.select().from(transactions).all();
    runMigrations(db);
    expect(db.select().from(transactions).all()).toEqual(snapshot);
    db.$client.close();
  });
});

describe("0004: 'Överföring via internet' is no longer a rule", () => {
  it("removes the seed rule and sends rule-made, non-internal transfers back to review", async () => {
    const { freshDb } = await import("./helpers.js");
    const { categories: cats } = await import("../src/db/schema.js");
    const db = freshDb({ seeded: true });
    // Recreate the state before the migration: the old seed rule and rows it categorised.
    const egna = db.select().from(cats).where(eq(cats.name, "Egna överföringar")).get()!;
    db.insert(merchantRules).values({ pattern: "Överföring via internet", matchType: "contains", categoryId: egna.id, isTransfer: true, createdFrom: "seed" }).run();
    const base = { source: "swedbank" as const, bookingDate: "2026-01-10", descriptionRaw: "Överföring via internet", descriptionClean: "Överföring via internet", amount: -100 };
    const byRule = { ...base, categoryId: egna.id, categorySource: "rule" as const, isTransfer: true };
    db.insert(transactions).values([
      { ...byRule, fingerprint: "a" },
      { ...byRule, fingerprint: "b", counterAccountId: 1 }, // internal: stays
      { ...byRule, fingerprint: "c", manuallyEditedAt: "2026-02-01T00:00:00Z" }, // edited: stays
    ]).run();
    db.delete(dataMigrations).where(eq(dataMigrations.name, "0004_remove_internet_transfer_rule")).run();

    runMigrations(db);

    const rows = db.select().from(transactions).orderBy(transactions.fingerprint).all();
    expect(rows.map((r) => [r.fingerprint, r.isTransfer, r.categoryId])).toEqual([
      ["a", false, null],
      ["b", true, egna.id],
      ["c", true, egna.id],
    ]);
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "Överföring via internet")).get()).toBeUndefined();
  });
});

describe("0013: charges of a shared fixed expense are shared", () => {
  it("shares the linked rows of shared expenses, not private rows or other expenses' rows", async () => {
    const { freshDb } = await import("./helpers.js");
    const { accounts, recurringExpenses, transactions } = await import("../src/db/schema.js");
    const db = freshDb({ seeded: true });
    const account = db.select().from(accounts).get()!.id;
    const expense = (name: string, shared: boolean) =>
      db.insert(recurringExpenses).values({ name, amount: 12900, paymentMethod: "credit_card", shared }).returning().get().id;
    const streaming = expense("Streaming", true);
    const gym = expense("Gym", false);
    let n = 0;
    const row = (recurringExpenseId: number, o: { private?: boolean } = {}) =>
      db
        .insert(transactions)
        .values({ source: "swedbank", accountId: account, bookingDate: "2026-09-18", transactionDate: "2026-09-18", descriptionRaw: "X", descriptionClean: "X", counterparty: "X", amount: -12900, recurringExpenseId, private: o.private ?? false, fingerprint: `m${++n}` })
        .returning()
        .get().id;
    const a = row(streaming);
    const hidden = row(streaming, { private: true });
    const other = row(gym);
    db.delete(dataMigrations).where(eq(dataMigrations.name, "0013_shared_expense_charges")).run();
    runMigrations(db);
    const shared = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!.shared;
    expect([shared(a), shared(hidden), shared(other)]).toEqual([true, false, false]);
  });
});

