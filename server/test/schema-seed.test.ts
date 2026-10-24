import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { accounts, categories, merchantRules, transactions } from "../src/db/schema.js";
import { getCategoryPathMap, isDatabaseEmpty, seed } from "../src/db/seed.js";
import { SEED_CATEGORIES, SEED_RULES } from "../src/db/seedData.js";
import { seedExampleHousehold } from "../src/db/exampleHousehold.js";
import { freshDb } from "./helpers.js";

const count = (db: ReturnType<typeof freshDb>, table: any) =>
  db.select({ n: sql<number>`count(*)` }).from(table).get()!.n;

describe("migrations", () => {
  it("create all tables", () => {
    const db = freshDb();
    const tables = db.$client
      .prepare("select name from sqlite_master where type='table' and name not like '\\_\\_%' escape '\\' and name != 'sqlite_sequence' order by name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual([
      "accounts",
      "avanza_movements",
      "avanza_statements",
      "bank_accounts",
      "bank_connections",
      "bank_pending",
      "cash_balances",
      "categories",
      "contacts",
      "data_migrations",
      "duplicate_dismissals",
      "fuel_fills",
      "fuel_prices",
      "fx_rates",
      "imports",
      "instruments",
      "isk_quarter_values",
      "item_attachments",
      "item_transactions",
      "items",
      "label_rules",
      "manual_balances",
      "merchant_category_map",
      "merchant_rules",
      "networth_snapshots",
      "odometer_readings",
      "payslip_lines",
      "payslips",
      "pension_entries",
      "pension_forecasts",
      "pension_funds",
      "pension_statements",
      "planned_items",
      "price_points",
      "price_series",
      "price_snapshots",
      "product_aliases",
      "product_groups",
      "products",
      "receipt_lines",
      "receipts",
      "recurring_expense_amounts",
      "recurring_expense_marks",
      "recurring_expenses",
      "recurring_income",
      "recurring_income_overrides",
      "reference_budget_adjustments",
      "reference_budget_amounts",
      "reference_budget_category_map",
      "reference_budget_expense_map",
      "reference_budget_items",
      "reference_budget_years",
      "rent_notices",
      "salary_constants",
      "salary_months",
      "savings_holdings",
      "savings_values",
      "settings",
      "settlements",
      "sick_days",
      "statements",
      "tax_returns",
      "tax_table_rows",
      "trades",
      "transaction_splits",
      "transactions",
      "watch_findings",
      "work_shift_days",
      "work_shifts",
    ]);
  });

  it("enforce unique (fingerprint, occurrence_index) on transactions", () => {
    const db = freshDb();
    const row = {
      source: "swedbank" as const,
      bookingDate: "2026-09-18",
      descriptionRaw: "Swish   skickad",
      descriptionClean: "Swish skickad",
      amount: -10000,
      fingerprint: "abc",
      occurrenceIndex: 1,
    };
    db.insert(transactions).values(row).run();
    db.insert(transactions).values({ ...row, occurrenceIndex: 2 }).run();
    expect(() => db.insert(transactions).values(row).run()).toThrow(/UNIQUE/);
    expect(count(db, transactions)).toBe(2);
  });
});

describe("seed", () => {
  it("starts empty and seeds categories and rules, and no accounts: those are the household's own", () => {
    const db = freshDb();
    expect(isDatabaseEmpty(db)).toBe(true);
    const r = seed(db);
    const expectedCategories = SEED_CATEGORIES.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);
    expect(r.categoriesAdded).toBe(expectedCategories);
    expect(r.rulesAdded).toBe(SEED_RULES.length);
    expect(isDatabaseEmpty(db)).toBe(false);
    expect(db.select().from(accounts).all()).toEqual([]);
  });

  it("the example household has four accounts at the banks the importers know", () => {
    const db = freshDb();
    seed(db);
    seedExampleHousehold(db);
    expect(db.select({ name: accounts.name, kind: accounts.kind, source: accounts.source }).from(accounts).all()).toEqual([
      { name: "Swedbank Privatkonto", kind: "bank", source: "swedbank" },
      { name: "Swedbank e-sparkonto", kind: "bank", source: "swedbank" },
      { name: "Swedbank Mastercard Guld", kind: "credit_card", source: "mastercard" },
      { name: "Bank Norwegian", kind: "credit_card", source: "norwegian" },
    ]);
  });

  it("is idempotent", () => {
    const db = freshDb();
    seed(db);
    const again = seed(db);
    expect(again).toEqual({ categoriesAdded: 0, rulesAdded: 0, merchantCategoriesAdded: 0 });
    expect(count(db, merchantRules)).toBe(SEED_RULES.length);
  });

  it("does not overwrite user edits on re-seed", () => {
    const db = freshDb();
    seed(db);
    db.update(categories).set({ color: "#000000" }).where(sql`name = 'Mat'`).run();
    seed(db);
    expect(db.select().from(categories).where(sql`name = 'Mat'`).get()!.color).toBe("#000000");
  });

  it("rejects duplicate category names under the same parent and at top level", () => {
    const db = freshDb();
    seed(db);
    const mat = db.select().from(categories).where(sql`name = 'Mat' and parent_id is null`).get()!;
    expect(() => db.insert(categories).values({ name: "Livsmedel", parentId: mat.id }).run()).toThrow(/UNIQUE/);
    expect(() => db.insert(categories).values({ name: "Mat" }).run()).toThrow(/UNIQUE/);
  });

  it("marks the transfer tree as is_transfer, and rules pointing there too", () => {
    const db = freshDb();
    seed(db);
    const paths = getCategoryPathMap(db);
    const all = db.select().from(categories).all();
    const byId = new Map(all.map((c) => [c.id, c]));
    for (const rule of SEED_RULES) {
      const cat = byId.get(paths.get(rule.category)!)!;
      expect(cat.isTransfer, rule.pattern).toBe(rule.isTransfer ?? false);
    }
  });

  it("marks the partner categories as settlement-only", () => {
    const db = freshDb();
    seed(db);
    const flagged = db.select().from(categories).where(sql`is_settlement = 1`).all().map((c) => c.name);
    expect(flagged.sort()).toEqual(["Från partner", "Till partner"]);
  });
});
