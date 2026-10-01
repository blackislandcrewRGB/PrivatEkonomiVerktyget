import { describe, expect, it } from "vitest";
import { payslips, transactions, accounts } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { basicDeduction, finalTax, jobTaxCredit, MissingRatesError } from "../src/tax/finalTax.js";
import { setTaxRules, taxRulesFor, TaxRuleError, type TaxYearRules } from "../src/tax/rules.js";
import { estimateTaxRefund, setRefundSettings, upcomingRefunds } from "../src/tax/refund.js";
import { saveTaxReturn } from "../src/taxReturns/taxReturns.js";
import { cashflow } from "../src/cashflow/cashflow.js";
import { ahead } from "../src/networth/ahead.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;

// The hand-worked case for 2026: KI 30,58 % (18,25 + 12,33), burial fee 0,292 %.
const RATES = { municipalPct: 18.25, regionPct: 12.33, burialPct: 0.292, churchPct: 0, ratesSource: "Skattesatser kommuner 2026" };
const INPUT = { salary: 360_000, commuteDeduction: 14_000, iskStandardIncome: 0, capitalIncome: 250, capitalExpenses: 0 };
const rules2026 = (over: Partial<TaxYearRules> = {}): TaxYearRules => ({ ...taxRulesFor(freshDb(), 2026), ...RATES, ...over });

describe("the final tax, 2026 (the hand-worked case)", () => {
  it("without church fee: 61 833 kr", () => {
    expect(finalTax(INPUT, rules2026())).toEqual({
      ffi: 346_000,
      // 0,77 × 59 200 − 0,1 × (346 000 − 3,11 × 59 200) = 29 395,20 → 29 400.
      basicDeduction: 29_400,
      bfi: 316_600,
      municipalTax: 96_816,
      burialFee: 924,
      churchFee: 0,
      stateTax: 0,
      pensionFee: 25_200,
      pensionFeeReduction: 25_200,
      publicService: 1_184,
      // The surplus in tjänst: the salary less the commute deduction.
      workIncome: 346_000,
      // (107 329,6 + 0,251 × (346 000 − 191 808) − 29 400) × 30,58 % = 35 666,00.
      jobTaxCredit: 35_666,
      earnedIncomeReduction: 1_500,
      capitalSurplus: 250,
      capitalTax: 75,
      capitalDeficitReduction: 0,
      total: 61_833,
      ki: expect.closeTo(0.3058, 10),
    });
  });

  it("with the church fee 0,73 %: 2 311 kr more, 64 144 kr", () => {
    const t = finalTax(INPUT, rules2026({ churchPct: 0.73 }));
    expect(t.churchFee).toBe(2_311);
    expect(t.total).toBe(64_144);
  });

  it("the basic deduction's brackets and the job tax credit's", () => {
    // Skatteverket's own examples (SKV 433 2026): 120 000 kr → 37 400; 324 000 kr → 31 600.
    expect(basicDeduction(120_000, 59_200)).toBe(37_400);
    expect(basicDeduction(324_000, 59_200)).toBe(31_600);
    // And the credit: 90 000 kr at 32,84 % → 11 976; 240 000 kr → 26 083.
    const j = rules2026().jobTaxCredit;
    expect(jobTaxCredit(90_000, 31_400, 0.3284, 59_200, j)).toBe(11_976);
    expect(jobTaxCredit(240_000, 40_000, 0.3284, 59_200, j)).toBe(26_083);
  });

  it("the state tax over the threshold, and a capital deficit back at 30 %", () => {
    const t = finalTax({ ...INPUT, salary: 760_000, commuteDeduction: 0, capitalIncome: 0, capitalExpenses: 1_000 }, rules2026());
    // 760 000 − 17 400 (0,293 PBB up to the hundred) = 742 600; 20 % of 99 600.
    expect(t.bfi).toBe(742_600);
    expect(t.stateTax).toBe(19_920);
    expect(t.capitalDeficitReduction).toBe(300);
  });

  it("needs the year's rates", () => {
    expect(() => finalTax(INPUT, taxRulesFor(freshDb(), 2026))).toThrow(MissingRatesError);
  });
});

/** A year of payslips: 30 000 kr a month, 68 000 kr withheld over the year. */
function payslipsFor(db: Db, year: number) {
  for (let m = 1; m <= 12; m++) {
    const tax = m < 12 ? 566_700 : 566_300;
    db.insert(payslips).values({ payDate: `${year}-${String(m).padStart(2, "0")}-25`, gross: 3_000_000, tax, net: 3_000_000 - tax, filename: `${year}-${m}.htm`, sha256: `refund-${year}-${m}` }).run();
  }
}
function handCase(db: Db, church = 0) {
  setTaxRules(db, 2026, { ...RATES, churchPct: church });
  saveTaxReturn(db, 2026, { submittedAt: "2027-03-20", boxes: { employmentIncome: 36_000_000, commuteDeduction: 1_400_000, iskStandardIncome: 0, capitalIncome: 25_000, capitalExpenses: 0 } }, "2027-03-25");
  payslipsFor(db, 2026);
}

describe("Skatteåterbäring (uppskattad)", () => {
  it("the payslips' tax plus the bank's 30 % on interest, less the final tax: 6 242 kr, and 3 931 kr with the church fee", () => {
    const db = freshDb({ seeded: true });
    handCase(db);
    const r = estimateTaxRefund(db, 2026, "2027-03-25");
    expect(r.basis).toBe("return");
    expect(r.preliminary).toMatchObject({ payslips: 68_000, payslipMonths: 12, forecast: 0, estimated: 0, bank: 75, total: 68_075 });
    expect(r.finalTax!.total).toBe(61_833);
    expect(r.refund).toBe(6_242);
    expect(r.payDate).toBe("2027-06-10");

    const church = freshDb({ seeded: true });
    handCase(church, 0.73);
    expect(estimateTaxRefund(church, 2026, "2027-03-25")).toMatchObject({ refund: 3_931, finalTax: { total: 64_144 } });
  });

  it("is a planned income in Kassaflöde on its pay day within 90 days, and a line in Framåt further off", () => {
    const db = freshDb({ seeded: true });
    handCase(db);
    const flow = cashflow(db, "2027-04-01");
    expect(flow.events.filter((e) => e.taxRefundYear)).toEqual([
      { date: "2027-06-10", kind: "income", name: "Skatteåterbäring 2026 (uppskattad)", amount: 624_200, estimate: true, taxRefundYear: 2026 },
    ]);
    expect(cashflow(db, "2027-02-01").events.some((e) => e.taxRefundYear)).toBe(false);
    expect(ahead(db, "2027-02-01", 0).later).toEqual([{ incomeYear: 2026, payDate: "2027-06-10", amount: 624_200 }]);
    // Another pay day.
    setRefundSettings(db, { payoutDay: "04-15" });
    expect(cashflow(db, "2027-04-01").events.find((e) => e.taxRefundYear)!.date).toBe("2027-04-15");
  });

  it("is kvarskatt, going out, when too little was withheld", () => {
    const db = freshDb({ seeded: true });
    handCase(db);
    db.update(payslips).set({ tax: 400_000 }).run();
    const r = estimateTaxRefund(db, 2026, "2027-04-01");
    expect(r.refund).toBe(48_000 + 75 - 61_833);
    expect(cashflow(db, "2027-04-01").events.find((e) => e.taxRefundYear)).toMatchObject({ kind: "fixed", name: "Kvarskatt 2026 (uppskattad)", amount: (48_075 - 61_833) * 100 });
  });

  it("is gone once Skatteverket has paid", () => {
    const db = freshDb({ seeded: true });
    handCase(db);
    const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
    db.insert(transactions)
      .values({ source: "manual", accountId, bookingDate: "2027-04-08", descriptionRaw: "SKATTEVERKET", descriptionClean: "Skatteverket", amount: 624_200, fingerprint: "skv-1" })
      .run();
    expect(estimateTaxRefund(db, 2026, "2027-04-10").paid).toEqual({ date: "2027-04-08", amount: 624_200 });
    expect(upcomingRefunds(db, "2027-04-10")).toEqual([]);
  });

  it("this year without a return: the payslips so far, the months entered, the rest at the payslips' share", () => {
    const db = freshDb({ seeded: true });
    setTaxRules(db, 2026, RATES);
    for (let m = 1; m <= 9; m++) db.insert(payslips).values({ payDate: `2026-${String(m).padStart(2, "0")}-25`, gross: 3_000_000, tax: 600_000, net: 2_400_000, filename: `${m}.htm`, sha256: `now-${m}` }).run();
    const r = estimateTaxRefund(db, 2026, "2026-09-26");
    expect(r.basis).toBe("forecast");
    // Three months left at 30 000 kr × 20 %.
    expect(r.preliminary).toMatchObject({ payslips: 54_000, payslipMonths: 9, estimated: 18_000, estimatedMonths: 3, total: 72_000 });
    expect(r.input.salary).toEqual({ value: 360_000, from: "Årsinkomst: utbetalt + prognos" });
    expect(r.finalTax).not.toBeNull();
  });

  it("the rules per year are entered with their source, and checked", async () => {
    const db = freshDb();
    expect(() => setTaxRules(db, 2026, { municipalPct: 18.25 })).toThrow(/källan/);
    expect(() => setTaxRules(db, 2026, { municipalPct: 55, ratesSource: "x" })).toThrow(TaxRuleError);
    expect(() => setTaxRules(db, 2030, { municipalPct: 18, ratesSource: "x" })).toThrow(/finns inte/);
    setTaxRules(db, 2026, RATES);
    // A later save of one rate leaves the others.
    setTaxRules(db, 2026, { churchPct: 0.73 });
    expect(taxRulesFor(db, 2026)).toMatchObject({ ...RATES, churchPct: 0.73 });
    const app = createApp(db, { databasePath: ":memory:" });
    const res = await app.request("/api/tax/refund/2026?today=2026-09-26");
    expect(res.status).toBe(200);
  });
});
