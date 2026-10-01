import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, categories, fuelPrices, payslips, recurringExpenses, transactions } from "../src/db/schema.js";
import {
  AKASSA_DEFAULTS,
  akassa,
  endurance,
  getAkassaSettings,
  getBufferAccount,
  monthlyCost,
  monthlyFixed,
  payslipTaxRate,
  setAkassaSettings,
  setBufferAccount,
  withAkassaMonths,
} from "../src/networth/endurance.js";
import { findings } from "../src/watch/watch.js";
import { setFuelSettings, setShifts } from "../src/fuel/fuel.js";
import { setCash } from "../src/savings/portfolio.js";
import { getCategoryPathMap } from "../src/db/seed.js";

import { savePensionForecast, updatePension } from "../src/networth/pension.js";
import { freshDb } from "./helpers.js";

/**
 * Uthållighet.
 *
 * The three levels, and the arithmetic under them. What is checked is that a
 * krona is counted once, that the benefit steps down when it is supposed to
 * and stops when it runs out, and that nothing is quietly assumed when the
 * figures to work from aren't there.
 */

type Db = ReturnType<typeof freshDb>;

const TODAY = "2026-09-20";

/** Swedish number formatting puts a non-breaking space in a thousand. */
const plain = (text: string) => text.replace(/\s/g, " ");

const accountId = (db: Db, name: string) => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, name)).get()!.id;

let n = 1;

function spend(db: Db, date: string, ore: number, opts: { shared?: boolean; recurringExpenseId?: number; categoryId?: number } = {}) {
  db.insert(transactions)
    .values({
      accountId: accountId(db, "Swedbank Privatkonto"),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "köp",
      descriptionClean: "köp",
      amount: -ore,
      shared: opts.shared ?? false,
      categoryId: opts.categoryId ?? null,
      recurringExpenseId: opts.recurringExpenseId ?? null,
      source: "manual",
      fingerprint: `end-${n++}`,
    })
    .run();
}

const expense = (db: Db, patch: Record<string, unknown>) =>
  db
    .insert(recurringExpenses)
    .values({ name: `utgift ${n++}`, amount: 100_000, paymentMethod: "autogiro", anchorDay: 25, ...patch })
    .returning()
    .get();

/** Shifts in a month, and a price to work the litres out at: what a forecast needs. */
function commuting(db: Db, month: string, shifts: number) {
  setShifts(db, month, shifts);
  db.insert(fuelPrices).values({ date: `${month}-01`, price: 1_900 }).onConflictDoNothing().run();
}

/** A payslip with a gross and the tax on it. */
const slip = (db: Db, payDate: string, gross: number, tax: number) =>
  db
    .insert(payslips)
    .values({ payDate, gross, tax, net: gross - tax, filename: `${payDate}.html`, sha256: `sha-${payDate}` })
    .run();

describe("vad en månad kostar", () => {
  it("is the variable average over whole months plus the standing expenses", () => {
    const db = freshDb({ seeded: true });
    // June, July, August: three whole months before September.
    spend(db, "2026-06-10", 300_000);
    spend(db, "2026-07-10", 600_000);
    spend(db, "2026-08-10", 300_000);
    // September is not over, so it must not pull the average down.
    spend(db, "2026-09-10", 900_000);
    expense(db, { amount: 500_000 });

    const cost = monthlyCost(db, TODAY);
    expect(cost.variableOre).toBe(400_000);
    expect(cost.fixedOre).toBe(500_000);
    expect(cost.totalOre).toBe(900_000);
    expect([cost.from, cost.to]).toEqual(["2026-06-01", "2026-08-31"]);
  });

  it("counts a shared purchase half and a charge of a fixed expense not at all", () => {
    const db = freshDb({ seeded: true });
    const rent = expense(db, { amount: 1_000_000, shared: true });
    spend(db, "2026-07-10", 200_000, { shared: true });
    // The rent's own charge: it is already in the fixed half, and counting the
    // row as well would pay the rent twice.
    spend(db, "2026-07-25", 1_000_000, { recurringExpenseId: rent.id });

    const cost = monthlyCost(db, TODAY);
    expect(cost.variableOre).toBe(Math.round(100_000 / 3));
    expect(cost.fixedOre).toBe(500_000);
  });

  it("spreads a yearly charge over twelve and leaves a paused one out", () => {
    const db = freshDb({ seeded: true });
    expense(db, { amount: 1_200_000, billingCycle: "yearly" });
    expense(db, { amount: 900_000, paused: true });
    expect(monthlyFixed(db, TODAY)).toEqual({ ore: 100_000, count: 1 });
  });
});

describe("a-kassan", () => {
  /** Eight payslips: 30 000 gross, 19 % tax, the shape of a real year. */
  function salary(db: Db, gross = 3_000_000) {
    for (const m of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]) {
      slip(db, `${m}-25`, gross, Math.round(gross * 0.19));
    }
  }

  it("works the benefit out from the payslips, and taxes it as they are taxed", () => {
    const db = freshDb({ seeded: true });
    salary(db);
    const a = akassa(db, TODAY)!;

    expect(a.payslips).toBe(8);
    expect(a.grossOre).toBe(3_000_000);
    expect(a.cappedByCeiling).toBe(false);
    expect(a.taxRate).toBeCloseTo(0.19, 6);
    expect(a.taxFromPayslips).toBe(true);
    // 30 000 × 80 % = 24 000 before tax, 19 440 after. An untaxed benefit
    // compared with expenses paid in net kronor would flatter every month.
    expect(a.steps.map((s) => [Math.round(s.rate * 100), s.monthlyNetOre])).toEqual([
      [80, 1_944_000],
      [70, 1_701_000],
      [65, 1_579_500],
    ]);
    expect(a.totalDays).toBe(300);
    expect(a.months).toBeCloseTo(300 / 22, 6);
  });

  it("stops at the ceiling, and says that it did", () => {
    const db = freshDb({ seeded: true });
    salary(db, 5_000_000);
    const a = akassa(db, TODAY)!;
    expect(a.grossOre).toBe(5_000_000);
    expect(a.cappedByCeiling).toBe(true);
    // 34 000, not 50 000.
    expect(a.qualifyingOre).toBe(AKASSA_DEFAULTS.incomeCapOre);
    expect(a.steps[0].monthlyNetOre).toBe(Math.round(3_400_000 * 0.8 * 0.81));
  });

  it("has nothing to say without a payslip", () => {
    const db = freshDb({ seeded: true });
    expect(akassa(db, TODAY)).toBeNull();
    expect(payslipTaxRate(db)).toBeNull();
    expect(endurance(db, TODAY).current.withAkassa.missing).toMatch(/Ingen lönespec/);
  });

  it("leaves out a payslip older than the window", () => {
    const db = freshDb({ seeded: true });
    slip(db, "2026-08-25", 3_000_000, 570_000);
    slip(db, "2024-08-25", 9_000_000, 1_710_000); // two years ago
    expect(akassa(db, TODAY)!.payslips).toBe(1);
    expect(akassa(db, TODAY)!.grossOre).toBe(3_000_000);
  });
});

describe("hur länge det räcker", () => {
  it("steps the benefit down, and keeps going after it runs out", () => {
    const a = {
      grossOre: 3_000_000,
      payslips: 8,
      qualifyingOre: 3_000_000,
      cappedByCeiling: false,
      taxRate: 0.19,
      taxFromPayslips: true,
      steps: [
        { days: 100, rate: 0.8, monthlyNetOre: 1_944_000 },
        { days: 100, rate: 0.7, monthlyNetOre: 1_701_000 },
        { days: 100, rate: 0.65, monthlyNetOre: 1_579_500 },
      ],
      totalDays: 300,
      months: 300 / 22,
    };
    const cost = 2_500_000;
    // While the benefit pays, the gap is 5 560, then 7 990, then 9 205 a
    // month; after 300 days it is the whole 25 000.
    // Each step lasts 100 ÷ 22 months, and the gap in it is the cost less
    // what the benefit pays.
    const perStep = 100 / 22;
    const gaps = (2_500_000 - 1_944_000 + (2_500_000 - 1_701_000) + (2_500_000 - 1_579_500)) * perStep;
    const capital = Math.round(gaps) + 2_500_000; // one month's worth left over
    const run = withAkassaMonths(capital, cost, a, 22)!;

    expect(run.akassaMonths).toBeCloseTo(300 / 22, 1);
    // The benefit carries 13.6 months, and what is left carries one more.
    expect(run.months).toBeGreaterThan(300 / 22);
    expect(run.months).toBeLessThan(300 / 22 + 1.2);
  });

  it("says so when the benefit covers the whole cost", () => {
    const a = {
      grossOre: 3_000_000,
      payslips: 1,
      qualifyingOre: 3_000_000,
      cappedByCeiling: false,
      taxRate: 0.19,
      taxFromPayslips: true,
      steps: [{ days: 300, rate: 0.8, monthlyNetOre: 1_944_000 }],
      totalDays: 300,
      months: 300 / 22,
    };
    // Cheaper to live than the benefit pays: nothing is drawn down while it
    // lasts, and afterwards the capital still has to carry everything.
    expect(withAkassaMonths(100_000, 1_000_000, a, 22)!.months).toBeGreaterThan(300 / 22);
  });

  it("gives the three levels, each with its arithmetic written out", () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 6_000_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    expense(db, { amount: 1_000_000 });
    spend(db, "2026-06-10", 3_000_000);
    spend(db, "2026-07-10", 3_000_000);
    spend(db, "2026-08-10", 3_000_000);

    const e = endurance(db, TODAY);
    expect(e.cost.totalOre).toBe(4_000_000);
    expect(e.capital.bufferAccount?.name).toBe("Swedbank e-sparkonto");
    // What is left on the 1st (nothing more to come this month): 60 000 ÷ 40 000 a month.
    expect(e.current.buffer.months).toBeCloseTo(1.5, 6);
    expect(e.capital.monthStart).toEqual({ date: "2026-10-01", balance: 6_000_000 });
    expect(e.current.buffer.formula.replace(/\s/g, " ")).toBe("kvar vid månadsskiftet 1/10 60 000 kr ÷ 40 000 kr/mån = 1,5 månader");
    // Nothing saved, so the second level is the same as the first.
    expect(e.current.withSavings.months).toBeCloseTo(1.5, 6);
    expect(e.current.withAkassa.months).toBeNull();
  });

  it("counts the cash on Avanza as buffer: it can be moved any day", () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 6_000_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    expense(db, { amount: 4_000_000 });
    setCash(db, "isk", "2026-09-18", 2_000_000);

    const e = endurance(db, TODAY);
    expect(e.capital).toMatchObject({ bufferOre: 6_000_000, cashOre: 2_000_000, portfolioOre: 0 });
    expect(e.capital.cash).toEqual([{ account: "isk", name: "ISK", ore: 2_000_000, date: "2026-09-18" }]);
    // (60 000 + 20 000) ÷ 40 000 a month.
    expect(e.current.buffer.months).toBeCloseTo(2, 6);
    expect(plain(e.current.buffer.formula)).toBe("kvar vid månadsskiftet 1/10 80 000 kr (varav 20 000 kr på ISK) ÷ 40 000 kr/mån = 2 månader");
    // Moved from the savings to the buffer, not counted twice.
    expect(e.current.withSavings.months).toBeCloseTo(2, 6);
    expect(plain(e.current.withSavings.formula)).toBe("(80 000 kr + 0 kr) ÷ 40 000 kr/mån = 2 månader");
  });

  it("adds what was moved to Avanza after the cash was entered", () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 6_000_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    expense(db, { amount: 4_000_000 });
    setCash(db, "isk", "2026-09-10", 1_000_000);
    const savings = getCategoryPathMap(db).get("Överföringar & sparande/Sparande")!;
    db.insert(transactions)
      .values({ source: "manual", accountId: accountId(db, "Swedbank e-sparkonto"), bookingDate: "2026-09-12", descriptionRaw: "AVANZA", descriptionClean: "AVANZA", amount: -1_000_000, categoryId: savings, isTransfer: true, fingerprint: "avanza-1" })
      .run();
    const e = endurance(db, TODAY);
    expect(e.capital).toMatchObject({ cashOre: 2_000_000, deposited: { ore: 1_000_000, since: "2026-09-10" } });
    expect(plain(e.current.buffer.formula)).toBe("kvar vid månadsskiftet 1/10 80 000 kr (varav 20 000 kr på ISK) ÷ 40 000 kr/mån = 2 månader");
  });

  it("has a buffer from the cash alone when no account is chosen", () => {
    const db = freshDb({ seeded: true });
    expense(db, { amount: 1_000_000 });
    setCash(db, "isk", "2026-09-18", 500_000);
    // No account to fall back on.
    for (const a of db.select().from(accounts).all()) db.update(accounts).set({ kind: "credit_card" }).where(eq(accounts.id, a.id)).run();
    const e = endurance(db, TODAY);
    expect(e.capital.bufferAccount).toBeNull();
    expect(e.current.buffer.months).toBeCloseTo(0.5, 6);
    expect(plain(e.current.buffer.formula)).toBe("kvar vid månadsskiftet 1/10 5 000 kr (varav 5 000 kr på ISK) ÷ 10 000 kr/mån = 0,5 månader");
  });

  it("can't divide by a month that costs nothing", () => {
    const db = freshDb({ seeded: true });
    expect(endurance(db, TODAY).current.buffer.months).toBeNull();
    expect(endurance(db, TODAY).current.buffer.missing).toMatch(/Ingen månadsutgift/);
  });

  it("measures the buffer against the account that was chosen, not a name in the code", () => {
    const db = freshDb({ seeded: true });
    // Unset, the one that looks like savings is suggested.
    expect(getBufferAccount(db)?.name).toBe("Swedbank e-sparkonto");
    setBufferAccount(db, accountId(db, "Swedbank Privatkonto"));
    expect(getBufferAccount(db)?.name).toBe("Swedbank Privatkonto");
    // A renamed account keeps being the buffer, because the id was stored.
    db.update(accounts).set({ name: "Lönekontot" }).where(eq(accounts.name, "Swedbank Privatkonto")).run();
    expect(getBufferAccount(db)?.name).toBe("Lönekontot");
  });
});

describe("inställningarna", () => {
  it("starts at the rules as they stand, and keeps what is written in", () => {
    const db = freshDb({ seeded: true });
    expect(getAkassaSettings(db)).toEqual(AKASSA_DEFAULTS);

    setAkassaSettings(db, { incomeCapOre: 4_000_000, steps: [{ days: 200, rate: 0.75 }], taxRate: 0.3 });
    const s = getAkassaSettings(db);
    expect(s.incomeCapOre).toBe(4_000_000);
    expect(s.steps).toEqual([{ days: 200, rate: 0.75 }]);
    expect(s.taxRate).toBe(0.3);
    // Untouched fields stay where they were.
    expect(s.daysPerMonth).toBe(22);
  });

  it("refuses a figure that can't be true", () => {
    const db = freshDb({ seeded: true });
    expect(() => setAkassaSettings(db, { steps: [{ days: 0, rate: 0.8 }] })).toThrow(/dagar över noll/);
    expect(() => setAkassaSettings(db, { steps: [{ days: 10, rate: 1.4 }] })).toThrow(/andel mellan 0 och 1/);
    expect(() => setAkassaSettings(db, { daysPerMonth: 0 })).toThrow(/fler än noll/);
    expect(() => setAkassaSettings(db, { taxRate: 1.5 })).toThrow(/mellan 0 och 1/);
    // And nothing was stored on the way out.
    expect(getAkassaSettings(db)).toEqual(AKASSA_DEFAULTS);
  });

  it("uses the payslips' own tax rate until another one is written in", () => {
    const db = freshDb({ seeded: true });
    slip(db, "2026-08-25", 3_000_000, 600_000);
    expect(payslipTaxRate(db)).toBeCloseTo(0.2, 6);
    expect(akassa(db, TODAY)!.taxRate).toBeCloseTo(0.2, 6);

    setAkassaSettings(db, { taxRate: 0.3 });
    expect(akassa(db, TODAY)!.taxRate).toBe(0.3);
    expect(akassa(db, TODAY)!.taxFromPayslips).toBe(false);
  });
});

describe("vakten om situationen", () => {
  /** Only the two the balance sheet adds. */
  const situation = (db: Db, today = TODAY) => findings(db, today).filter((f) => f.kind === "buffer_low" || f.kind === "pension_stale");

  it("says when the buffer wouldn't carry three months, once a month", () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 500_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    expense(db, { amount: 1_000_000 });
    // Spending that could be cut doesn't count: the buffer is measured against what would have to be paid.
    for (const m of ["06", "07", "08"]) spend(db, `2026-${m}-10`, 1_000_000);
    expect(endurance(db, TODAY).current.monthlyOre).toBeGreaterThan(1_000_000);

    const [f] = situation(db);
    expect(f.kind).toBe("buffer_low");
    expect(f.text.replace(/\s/g, " ")).toBe("Bufferten räcker 0,5 månader — under 3. Kvar vid månadsskiftet 1/10 5 000 kr mot det nödvändiga 10 000 kr/mån.");
    // What is missing up to three months, so the task can say it.
    expect(f.amount).toBe(3 * 1_000_000 - 500_000);
    // Keyed by the month: said once, not once an overview is opened.
    expect(f.key).toBe("buffer_low:2026-09");
    expect(situation(db, "2026-09-25")[0].key).toBe(f.key);
    expect(situation(db, "2026-10-01")[0].key).toBe("buffer_low:2026-10");
  });

  it("counts the cash on Avanza in the buffer it warns about", () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 500_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    expense(db, { amount: 1_000_000 });
    setCash(db, "isk", "2026-09-18", 1_000_000);
    const [f] = situation(db);
    expect(plain(f.text)).toBe("Bufferten räcker 1,5 månader — under 3. Kvar vid månadsskiftet 1/10 15 000 kr (varav 10 000 kr på ISK) mot det nödvändiga 10 000 kr/mån.");
    expect(f.amount).toBe(3 * 1_000_000 - 500_000 - 1_000_000);
    // Enough cash: quiet.
    setCash(db, "isk", "2026-09-19", 2_500_000);
    expect(situation(db)).toEqual([]);
  });

  it("is quiet when the buffer carries three months", () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 4_000_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    expense(db, { amount: 1_000_000 });
    expect(situation(db)).toEqual([]);
  });

  it("has nothing to say without a monthly cost to divide by", () => {
    const db = freshDb({ seeded: true });
    // Nothing spent and nothing standing: a buffer of zero months would be
    // arithmetic about an empty database, not a fact about anyone's money.
    expect(situation(db)).toEqual([]);
  });

  it("asks for a pension value that has gone a year without being looked at", () => {
    const db = freshDb({ seeded: true });
    // The income pension's figure is from 28 November 2025.
    expect(situation(db, "2026-11-27").filter((f) => f.kind === "pension_stale")).toEqual([]);
    const [stale] = situation(db, "2026-11-28").filter((f) => f.kind === "pension_stale");
    expect(stale.text).toBe("Pensionsmyndigheten – Inkomstpension har ett värde från 28/11 — över ett år gammalt. Skriv av ett nytt från minpension.se.");
    // Keyed by the value it is stale at, so the same old figure is asked
    // about once and a new one clears it.
    expect(stale.key).toBe(`pension_stale:1:2025-11-28`);

    updatePension(db, 1, { amountOre: 43_000_000, valueDate: "2026-11-28" });
    expect(situation(db, "2026-11-28").filter((f) => f.kind === "pension_stale")).toEqual([]);
  });

  it("asks for a new minPension forecast when the latest is a year old", () => {
    const db = freshDb({ seeded: true });
    const forecastStale = (today: string) => findings(db, today).filter((f) => f.kind === "pension_forecast_stale");
    // None entered: nothing to be stale.
    expect(forecastStale(TODAY)).toEqual([]);
    savePensionForecast(db, { madeOn: "2025-10-01", retirementAge: 65, monthlyPensionOre: 1_800_000, assumptions: "minPensions standard" });
    savePensionForecast(db, { madeOn: "2025-10-01", retirementAge: 67, monthlyPensionOre: 2_100_000, assumptions: "minPensions standard" });
    expect(forecastStale("2026-09-30")).toEqual([]);

    const [f] = forecastStale("2026-10-01");
    expect(f.text).toBe("Senaste pensionsprognosen är från 1/10 2025 — 12 månader gammal. Gör en ny på minpension.se och skriv av den.");
    // One reminder for the day's forecasts, not one per age; keyed by the day,
    // so a new forecast clears it.
    expect(f.key).toBe("pension_forecast_stale:2025-10-01");
    savePensionForecast(db, { madeOn: "2026-10-01", retirementAge: 65, monthlyPensionOre: 1_900_000, assumptions: "minPensions standard" });
    expect(forecastStale("2026-10-01")).toEqual([]);
  });
});

describe("bara det nödvändiga", () => {
  /** Groceries, restaurant food, fuel and something that is none of them. */
  function aMonthOfLiving(db: Db) {
    const id = (key: string) => db.select({ id: categories.id }).from(categories).where(eq(categories.systemKey, key)).get()!.id;
    const fuelId = db.select({ id: categories.id }).from(categories).where(eq(categories.name, "Drivmedel")).get()!.id;
    setFuelSettings(db, { fuelCategoryId: fuelId });
    for (const m of ["2026-06", "2026-07", "2026-08"]) {
      spend(db, `${m}-05`, 300_000, { categoryId: id("groceries") });
      spend(db, `${m}-12`, 150_000, { categoryId: id("restaurants") });
      spend(db, `${m}-18`, 200_000, { categoryId: fuelId });
      spend(db, `${m}-22`, 400_000);
    }
    expense(db, { amount: 1_000_000 });
  }

  it("is the standing expenses and the groceries, and nothing else", () => {
    const db = freshDb({ seeded: true });
    aMonthOfLiving(db);
    const cost = monthlyCost(db, TODAY);

    // Everything that was spent is still in the rate that describes today.
    expect(cost.totalOre).toBe(1_000_000 + 300_000 + 150_000 + 200_000 + 400_000);
    // What would still have to be paid is the rent and the food shop. Not
    // the restaurant, not the fuel — the driving that was commuting ends
    // with the job.
    expect(cost.groceriesOre).toBe(300_000);
    expect(cost.essentialsOre).toBe(1_300_000);
  });

  it("carries roughly twice as long on the tighter rate", () => {
    const db = freshDb({ seeded: true });
    aMonthOfLiving(db);
    db.update(accounts).set({ balance: 2_600_000, balanceUpdatedAt: `${TODAY}T10:00:00.000Z` }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();

    const e = endurance(db, TODAY);
    expect(e.current.monthlyOre).toBe(2_050_000);
    expect(e.essential.monthlyOre).toBe(1_300_000);
    // What is left on the 1st: the 26 000 kr less the spending pace to the month's end.
    const left = e.capital.liquidOre;
    expect(left).toBeLessThan(2_600_000);
    expect(e.current.buffer.months).toBeCloseTo(left / 2_050_000, 6);
    expect(e.essential.buffer.months).toBeCloseTo(left / 1_300_000, 6);
    // Both say what they rest on, and they don't say the same thing.
    expect(plain(e.essential.buffer.formula)).toContain("13 000 kr/mån");
    expect(plain(e.current.buffer.formula)).toContain("20 500 kr/mån");
  });

  it("takes fuel from the commuting forecast when there is one, not from the tank", () => {
    const db = freshDb({ seeded: true });
    aMonthOfLiving(db);
    // No shifts entered: the forecast has nothing to say, so what was
    // actually filled counts.
    const spentOn = monthlyCost(db, TODAY);
    expect(spentOn.fuel).toEqual({ ore: 200_000, source: "spending", shifts: null });
    expect(spentOn.variableOre).toBe(300_000 + 150_000 + 200_000 + 400_000);

    // Shifts entered: the forecast speaks for the fuel and the tankings are
    // left out, so nothing is counted twice — and when the shifts stop, so
    // does the fuel, without a setting to remember.
    commuting(db, "2026-09", 4);
    const forecast = monthlyCost(db, TODAY);
    expect(forecast.fuel.source).toBe("forecast");
    expect(forecast.fuel.shifts).toBe(4);
    expect(forecast.variableOre).toBe(300_000 + 150_000 + 400_000 + forecast.fuel.ore);
    // The tighter rate never had fuel in it either way.
    expect(forecast.essentialsOre).toBe(1_300_000);
  });
});
