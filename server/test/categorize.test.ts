import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { categories, contacts, merchantRules, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { findMatchingRule } from "../src/categorize/matchRules.js";
import { recategorizeUncategorized } from "../src/categorize/categorize.js";
import { importSwedbankCsv } from "../src/import/importSwedbank.js";
import { createApp } from "../src/app.js";
import { buildCsv, freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const pathOf = (db: Db, id: number | null) => [...getCategoryPathMap(db)].find(([, v]) => v === id)?.[0] ?? null;

describe("rule direction", () => {
  const rules = [
    { id: 1, pattern: "+4670", matchType: "contains" as const, direction: "in" as const },
    { id: 2, pattern: "+4670", matchType: "contains" as const, direction: "out" as const },
    { id: 3, pattern: "Swish", matchType: "contains" as const, direction: "any" as const },
  ];
  it("applies 'in' rules to money in and 'out' rules to money out", () => {
    expect(findMatchingRule(rules, "Swish mottagen +4670", 100)?.id).toBe(1);
    expect(findMatchingRule(rules, "Swish skickad +4670", -100)?.id).toBe(2);
    expect(findMatchingRule(rules, "Swish skickad +4699", -100)?.id).toBe(3);
  });
  it("never applies a directional rule without an amount", () => {
    expect(findMatchingRule(rules, "Swish mottagen +4670")?.id).toBe(3);
  });
  it("prefers a directional rule over an 'any' rule with the same pattern", () => {
    const r = [
      { id: 1, pattern: "X", matchType: "contains" as const, direction: "any" as const },
      { id: 2, pattern: "X", matchType: "contains" as const, direction: "in" as const },
    ];
    expect(findMatchingRule(r, "X", 5)?.id).toBe(2);
    expect(findMatchingRule(r, "X", -5)?.id).toBe(1);
  });
});

describe("re-categorising rows without category", () => {
  const rows = [
    { date: "2026-01-10", desc: "NYBUTIKEN AB", amount: "-100.00" },
    { date: "2026-01-11", desc: "NYBUTIKEN AB", amount: "-50.00" },
    { date: "2026-01-12", desc: "ANNAT", amount: "-10.00" },
  ];

  it("applies a rule added later to old uncategorised rows, but not to rows edited by hand", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv(rows), "a.csv");
    const [first, second] = db.select().from(transactions).orderBy(transactions.id).all();
    db.update(transactions).set({ note: "rör ej", manuallyEditedAt: "2026-02-01T00:00:00Z" }).where(eq(transactions.id, second.id)).run();

    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.insert(merchantRules).values({ pattern: "NYBUTIKEN", matchType: "contains", categoryId: other.id }).run();
    expect(recategorizeUncategorized(db)).toBe(1);

    const after = db.select().from(transactions).orderBy(transactions.id).all();
    expect(after[0]).toMatchObject({ id: first.id, categoryId: other.id, categorySource: "rule" });
    expect(after[1]).toMatchObject({ id: second.id, categoryId: null, note: "rör ej" });
    expect(after[2].categoryId).toBeNull();
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "NYBUTIKEN")).get()!.hits).toBe(1);
  });

  it("is reported by the next import", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv(rows), "a.csv");
    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.insert(merchantRules).values({ pattern: "NYBUTIKEN", matchType: "contains", categoryId: other.id }).run();
    const r = importSwedbankCsv(db, buildCsv([{ date: "2026-02-01", desc: "ICA", amount: "-1.00" }]), "b.csv");
    expect(r.recategorized).toBe(2);
  });

  it("never touches manually categorised rows or transfers", () => {
    const db = freshDb({ seeded: true });
    importSwedbankCsv(db, buildCsv(rows), "a.csv");
    db.update(transactions).set({ categorySource: "manual" }).where(sql`amount = -10000`).run();
    db.update(transactions).set({ isTransfer: true }).where(sql`amount = -5000`).run();
    const other = db.select().from(categories).where(eq(categories.name, "Övrigt")).get()!;
    db.insert(merchantRules).values({ pattern: "NYBUTIKEN", matchType: "contains", categoryId: other.id }).run();
    expect(recategorizeUncategorized(db)).toBe(0);
  });
});

describe("contacts", () => {
  it("are seeded with names and shown as counterparty names in the transaction list", async () => {
    const db = freshDb({ seeded: true });
    expect(db.select({ c: contacts.counterparty, n: contacts.name }).from(contacts).all()).toEqual([
      { c: "+46765550019", n: "Mio" },
      { c: "+46705550009", n: "Pappa" },
      { c: "+46705550005", n: "Mamma" },
    ]);
    importSwedbankCsv(
      db,
      buildCsv([
        { date: "2026-01-10", desc: "Swish mottagen +46705550009", ref: "+46705550009", amount: "500.00" },
        { date: "2026-01-11", desc: "Swish skickad +46765550019", ref: "+46765550019", amount: "-200.00" },
      ]),
      "a.csv",
    );
    const app = createApp(db, { databasePath: ":memory:" });
    const { rows: list } = (await (await app.request("/api/transactions")).json()) as { rows: { counterpartyName: string | null; categoryId: number }[] };
    expect(list.map((t) => [t.counterpartyName, pathOf(db, t.categoryId)])).toEqual([
      // No seed rule covers a personal Swish number: the names show, the rows wait for a category.
      ["Mio", null],
      ["Pappa", null],
    ]);
  });
});
