import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { categoryIdByKey } from "../src/db/seed.js";
import { setCash } from "../src/savings/portfolio.js";
import { iskDeclared, iskOverview, iskRuleFor, iskTax, setIskRule, setQuarterValue, IskError } from "../src/tax/isk.js";
import { saveTaxReturn } from "../src/taxReturns/taxReturns.js";
import { findings } from "../src/watch/watch.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-11-20";
let seq = 0;

/** Money moved to Avanza on a day (a Sparande transfer out of the bank); negative: taken back out. `to`: one of my own accounts instead. */
function deposit(db: Db, date: string, ore: number, to?: string) {
  const id = (name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
  db.insert(transactions)
    .values({
      source: "manual",
      accountId: id("Swedbank e-sparkonto"),
      counterAccountId: to ? id(to) : null,
      bookingDate: date,
      descriptionRaw: "AVANZA",
      descriptionClean: "AVANZA",
      amount: -ore,
      categoryId: categoryIdByKey(db, "savings")!,
      isTransfer: true,
      fingerprint: `isk-${++seq}`,
    })
    .run();
}
const quarters = (db: Db, year: number, kr: [number, number, number, number]) =>
  ["01-01", "04-01", "07-01", "10-01"].forEach((q, i) => setQuarterValue(db, `${year}-${q}`, kr[i] * 100));

describe("ISK-skatt", () => {
  it("over the allowance: (the quarters + the deposits) ÷ 4, less the allowance, × the rate × 30 %", () => {
    const db = freshDb({ seeded: true });
    setIskRule(db, { year: 2026, rateBp: 355, allowanceOre: 30_000_000, source: "statslåneräntan 30/11 2025 (2,55 %) + 1" });
    quarters(db, 2026, [380_000, 400_000, 420_000, 440_000]);
    deposit(db, "2026-03-25", 20_000_00);
    deposit(db, "2026-08-25", 20_000_00);
    // A withdrawal doesn't lower the base, and a move between my own accounts is no deposit.
    deposit(db, "2026-09-02", -15_000_00);
    deposit(db, "2026-09-03", 5_000_00, "Swedbank Privatkonto");
    const t = iskTax(db, 2026, TODAY);
    // (1 640 000 + 40 000) ÷ 4 = 420 000; − 300 000 = 120 000; × 3,55 % = 4 260; × 30 % = 1 278 kr.
    expect(t).toMatchObject({ capitalBaseOre: 42_000_000, taxableBaseOre: 12_000_000, standardIncomeOre: 426_000, taxOre: 127_800 });
    expect(t.deposits).toEqual({ ore: 4_000_000, count: 2, through: TODAY });
    expect(t.quarters.map((q) => q.source)).toEqual(["entered", "entered", "entered", "entered"]);
    // The year isn't over: the deposits still to come make it an estimate.
    expect(t.estimated).toBe(true);
  });

  it("under the allowance: nothing to tax, even before the year's rate is known", () => {
    const db = freshDb({ seeded: true });
    quarters(db, 2026, [200_000, 210_000, 220_000, 230_000]);
    const t = iskTax(db, 2026, TODAY);
    expect(t.rule.rateBp).toBeNull();
    expect(t).toMatchObject({ capitalBaseOre: 21_500_000, taxableBaseOre: 0, standardIncomeOre: 0, taxOre: 0 });
  });

  it("over the allowance without a rate: no tax yet", () => {
    const db = freshDb({ seeded: true });
    quarters(db, 2026, [400_000, 400_000, 400_000, 400_000]);
    expect(iskTax(db, 2026, TODAY)).toMatchObject({ taxableBaseOre: 10_000_000, standardIncomeOre: null, taxOre: null });
  });

  it("2024 had no allowance: the whole base is taxed", () => {
    const db = freshDb({ seeded: true });
    quarters(db, 2024, [100_000, 120_000, 130_000, 150_000]);
    // 500 000 ÷ 4 = 125 000 × 3,62 % = 4 525 kr; × 30 % = 1 357,50 kr.
    expect(iskTax(db, 2024, TODAY)).toMatchObject({ capitalBaseOre: 12_500_000, taxableBaseOre: 12_500_000, standardIncomeOre: 452_500, taxOre: 135_750, estimated: false });
  });

  it("values a quarter itself once the holdings are known, takes today's value for one to come, and says which are missing", () => {
    const db = freshDb({ seeded: true });
    setCash(db, "isk", "2026-05-10", 5_000_000);
    setCash(db, "isk", "2026-08-10", 6_000_000);
    const t = iskTax(db, 2026, "2026-09-20");
    expect(t.quarters).toEqual([
      { date: "2026-01-01", valueOre: 5_000_000, source: "first" },
      { date: "2026-04-01", valueOre: 5_000_000, source: "first" },
      { date: "2026-07-01", valueOre: 5_000_000, source: "computed" },
      { date: "2026-10-01", valueOre: 6_000_000, source: "today" },
    ]);
    expect(t.missing).toEqual(["2026-01-01", "2026-04-01"]);
    // Entered wins.
    setQuarterValue(db, "2026-01-01", 4_000_000);
    expect(iskTax(db, 2026, "2026-09-20").quarters[0]).toEqual({ date: "2026-01-01", valueOre: 4_000_000, source: "entered" });
  });

  it("works the capital base back out of box 7.1 (÷ the rate), and taxes what is over the allowance", () => {
    const db = freshDb({ seeded: true });
    saveTaxReturn(db, 2024, { boxes: { iskStandardIncome: 480_000 } }, TODAY);
    saveTaxReturn(db, 2025, { boxes: { iskStandardIncome: 300_000 } }, TODAY);
    const [y2024, y2025] = iskDeclared(db).sort((a, b) => a.year - b.year);
    // 4 800 kr ÷ 3,62 % = 132 597 kr, no allowance before 2025: 30 % of 4 800 kr.
    expect(y2024).toEqual({ year: 2024, standardIncomeOre: 480_000, rateBp: 362, allowanceOre: 0, capitalBaseOre: 13_259_669, taxOre: 144_000 });
    // Box 7.1 is before the allowance: 3 000 kr ÷ 2,96 % = 101 351 kr, under the 150 000 kr allowance, so no tax.
    expect(y2025).toEqual({ year: 2025, standardIncomeOre: 300_000, rateBp: 296, allowanceOre: 15_000_000, capitalBaseOre: 10_135_135, taxOre: 0 });
    // Over it: 7 400 kr ÷ 2,96 % = 250 000 kr; 100 000 kr taxed, 2 960 kr × 30 %.
    saveTaxReturn(db, 2025, { boxes: { iskStandardIncome: 740_000 } }, TODAY);
    expect(iskDeclared(db).find((d) => d.year === 2025)).toMatchObject({ capitalBaseOre: 25_000_000, taxOre: 88_800 });
  });

  it("puts the tool's own base beside the return's for a year it can value without guessing", () => {
    const db = freshDb({ seeded: true });
    saveTaxReturn(db, 2024, { boxes: { iskStandardIncome: 480_000 } }, TODAY);
    expect(iskOverview(db, TODAY).compared).toBeNull();
    quarters(db, 2024, [110_000, 120_000, 130_000, 150_000]);
    expect(iskOverview(db, TODAY).compared).toEqual({ year: 2024, declaredBaseOre: 13_259_669, ownBaseOre: 12_750_000, diffOre: -509_669 });
  });

  it("keeps the rules per year with their source, and checks them", async () => {
    const db = freshDb();
    expect(iskRuleFor(db, 2025)).toMatchObject({ rateBp: 296, allowanceOre: 15_000_000 });
    expect(iskRuleFor(db, 2027)).toMatchObject({ rateBp: null, allowanceOre: 30_000_000 });
    expect(() => setIskRule(db, { year: 2026, rateBp: 100, allowanceOre: 0, source: "x" })).toThrow(IskError);
    expect(() => setIskRule(db, { year: 2026, rateBp: 355, allowanceOre: 30_000_000, source: " " })).toThrow(/källan/);
    expect(() => setQuarterValue(db, "2026-02-01", 1)).toThrow(/kvartal/);
    const app = createApp(db, { databasePath: ":memory:" });
    const res = await app.request("/api/tax/isk/rules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ year: 2026, rateBp: 355, allowanceOre: 30_000_000, source: "statslåneräntan 30/11 2025 (2,55 %) + 1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).rules.find((r: { year: number }) => r.year === 2026).rateBp).toBe(355);
  });
});

describe("Vakt: ISK närmar sig fribeloppet", () => {
  it("says so once a month when the holdings and cash pass 90 % of the year's allowance", () => {
    const db = freshDb({ seeded: true });
    setCash(db, "isk", "2026-09-01", 26_000_000);
    expect(findings(db, "2026-09-20").filter((f) => f.kind === "isk_allowance")).toEqual([]);
    setCash(db, "isk", "2026-09-10", 27_500_000);
    const [f] = findings(db, "2026-09-20").filter((x) => x.kind === "isk_allowance");
    expect(f).toMatchObject({ key: "isk_allowance:2026-09", amount: 27_500_000 });
    expect(f.text).toMatch(/92 % av fribeloppet 300\s000 kr för 2026/);
    setCash(db, "isk", "2026-09-15", 31_000_000);
    expect(findings(db, "2026-09-20").find((x) => x.kind === "isk_allowance")!.text).toMatch(/över fribeloppet/);
  });
});
