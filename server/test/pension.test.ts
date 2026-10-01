import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { payslips, pensionEntries, pensionForecasts, pensionFunds, pensionStatements } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import {
  PensionError,
  createPension,
  deletePension,
  listPensions,
  computedYear,
  deletePensionForecast,
  deletePensionStatement,
  pensionForecastsView,
  savePensionForecast,
  getPensionSettings,
  pensionStatementChecks,
  savePensionStatement,
  monthsBetween,
  pensionInflow,
  pensionOverview,
  setIncomeBaseAmount,
  seedPensions,
  updatePension,
} from "../src/networth/pension.js";
import { balanceSheet } from "../src/networth/networth.js";
import { endurance } from "../src/networth/endurance.js";
import { freshDb } from "./helpers.js";

/**
 * Pensionen.
 *
 * The one thing that must never happen has its own test: locked capital
 * leaking into the net worth or into how long the money would last. The rest
 * is that the figures add up, that a yearly update replaces the funds rather
 * than piling them up, and that nothing is assumed about a return.
 */

type Db = ReturnType<typeof freshDb>;

const TODAY = "2026-09-20";

const byName = (db: Db, name: string) => listPensions(db).find((e) => e.name === name)!;

describe("pensionen som den är avskriven", () => {
  it("adds up to what minpension says, split by whether the funds are chosen", () => {
    const db = freshDb({ seeded: true });
    const p = pensionOverview(db, TODAY);

    expect(p.entries).toHaveLength(4);
    expect(p.totalOre).toBe(30_000_000 + 10_000_000 + 8_000_000 + 300_000);
    expect(p.placeableOre).toBe(10_000_000 + 8_000_000);
    expect(p.fixedOre).toBe(30_000_000 + 300_000);
  });

  it("keeps each entry's funds adding up to the entry", () => {
    const db = freshDb({ seeded: true });
    for (const e of listPensions(db)) {
      if (e.funds.length === 0) continue;
      expect(e.funds.reduce((s, f) => s + f.amountOre, 0)).toBe(e.amountOre);
    }
  });

  it("grows by what is paid in, and by nothing else", () => {
    const db = freshDb({ seeded: true });
    // The only thing said about the future is the premium. A return would be
    // a guess dressed as a figure.
    expect(pensionOverview(db, TODAY).monthlyPremiumOre).toBe(100_000);

    // A closed entry pays nothing in, whatever it once did.
    const kpa = byName(db, "Traditionell försäkring, stängd");
    updatePension(db, kpa.id, { monthlyPremiumOre: 50_000 });
    expect(pensionOverview(db, TODAY).monthlyPremiumOre).toBe(100_000);
  });

  it("works the regions out from the placeable capital only", () => {
    const db = freshDb({ seeded: true });
    const p = pensionOverview(db, TODAY);
    // Where the funds aren't chosen, the region is nobody's decision — the
    // income pension is not 'global' by default.
    expect(p.regions.map((r) => [r.region, r.amountOre])).toEqual([
      ["usa", 10_000_000],
      ["global", 6_000_000],
      ["sweden", 2_000_000],
    ]);
    expect(p.regions[0].share).toBeCloseTo(10_000_000 / 18_000_000, 6);
    expect(p.regions.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 6);
  });

  it("names the tilt as an observation, not a warning", () => {
    const db = freshDb({ seeded: true });
    expect(pensionOverview(db, TODAY).notes).toEqual(["USA-fonden i premiepensionen är en avvikelse från policyns marknadsvikt."]);
  });

  it("says how old the oldest figure is", () => {
    const db = freshDb({ seeded: true });
    const p = pensionOverview(db, TODAY);
    expect(p.oldestValueDate).toBe("2025-11-28");
    expect(p.oldestMonths).toBe(9);
    // Nothing is over a year old yet; the income pension turns one in November.
    expect(p.stale).toEqual([]);
    expect(pensionOverview(db, "2026-11-28").stale.map((s) => s.name)).toEqual(["Pensionsmyndigheten – Inkomstpension"]);
    expect(monthsBetween("2025-11-28", "2026-11-27")).toBe(11);
  });
});

describe("att hålla den aktuell", () => {
  it("replaces the funds on an update instead of piling them up", () => {
    const db = freshDb({ seeded: true });
    const lf = byName(db, "Tjänstepension, fondförsäkring");
    expect(lf.funds).toHaveLength(2);

    // Next year's statement: one fund sold, the other grown. A merge row by
    // row would leave the sold one behind.
    const updated = updatePension(db, lf.id, {
      amountOre: 13_000_000,
      valueDate: "2027-08-20",
      funds: [{ fundName: "Exempelfond Global Index", amountOre: 13_000_000, unitsE4: 2_000_000, navOre: 65_000, valueDate: "2027-08-20", region: "global" }],
    });
    expect(updated.funds).toHaveLength(1);
    expect(updated.funds[0].fundName).toBe("Exempelfond Global Index");
    expect(db.select().from(pensionFunds).where(eq(pensionFunds.entryId, lf.id)).all()).toHaveLength(1);
  });

  it("leaves the funds alone when the update doesn't mention them", () => {
    const db = freshDb({ seeded: true });
    const lf = byName(db, "Tjänstepension, fondförsäkring");
    expect(updatePension(db, lf.id, { note: "Bytte arbetsgivare." }).funds).toHaveLength(2);
  });

  it("refuses a figure that can't be true", () => {
    const db = freshDb({ seeded: true });
    const base = { kind: "private" as const, provider: "Avanza", name: "Privat", amountOre: 1000, valueDate: "2026-09-20" };
    expect(() => createPension(db, { ...base, amountOre: -1 })).toThrow(PensionError);
    expect(() => createPension(db, { ...base, valueDate: "hösten" })).toThrow(/ÅÅÅÅ-MM-DD/);
    expect(() => createPension(db, { ...base, provider: " " })).toThrow(/förvaltare och namn/);
    expect(() =>
      createPension(db, { ...base, funds: [{ fundName: "X", amountOre: 1000, unitsE4: 0, navOre: 100, valueDate: "2026-09-20", region: "global" }] }),
    ).toThrow(/andelar ska vara fler än noll/);
    // Nothing was written on the way out.
    expect(listPensions(db)).toHaveLength(4);
  });

  it("takes a row away softly, and the funds with it", () => {
    const db = freshDb({ seeded: true });
    const kpa = byName(db, "Traditionell försäkring, stängd");
    expect(deletePension(db, kpa.id)).toBe(true);
    expect(listPensions(db)).toHaveLength(3);
    // Softly: the row is still there to restore.
    expect(db.select().from(pensionEntries).all()).toHaveLength(4);
    expect(pensionOverview(db, TODAY).totalOre).toBe(30_000_000 + 10_000_000 + 8_000_000);
  });

  it("seeds once, and doesn't bring back what was deleted", () => {
    const db = freshDb({ seeded: true });
    expect(seedPensions(db)).toBe(0);
    deletePension(db, byName(db, "Inkomstpension").id);
    expect(seedPensions(db)).toBe(0);
    expect(listPensions(db).map((e) => e.name)).not.toContain("Inkomstpension");
  });
});

describe("låst kapital räknas aldrig in", () => {
  it("is nowhere in the balance sheet", () => {
    const db = freshDb({ seeded: true });
    const sheet = balanceSheet(db, TODAY);
    const rows = [...sheet.liquid, ...sheet.debts, ...sheet.illiquid];
    // 683 000 kr of pension, and not a krona of it on the sheet: it cannot be
    // spent for decades, and a net worth that counted it would answer a
    // question nobody asked.
    expect(rows.some((r) => /pension/i.test(r.name))).toBe(false);
    expect(sheet.totals.liquidOre + sheet.totals.illiquidOre).toBe(8_000_000);
  });

  it("is nowhere in how long the money would last", () => {
    const db = freshDb({ seeded: true });
    const e = endurance(db, TODAY);
    expect(e.capital.portfolioOre).toBe(0);
    expect(e.capital.bufferOre).toBe(0);
  });
});

describe("vad som avsätts varje månad", () => {
  let seq = 0;
  /** A payslip with only what the inflow reads: the pay day and the gross. */
  const payslip = (db: Db, payDate: string, gross: number) =>
    db.insert(payslips).values({ payDate, gross, tax: 0, net: gross, filename: `${payDate}.htm`, sha256: `sha-${++seq}` }).run();

  it("works each part out from the average gross, to the öre", () => {
    const db = freshDb({ seeded: true });
    payslip(db, "2026-07-24", 3_300_000);
    payslip(db, "2026-08-25", 3_500_000);
    const f = pensionInflow(db, TODAY)!;
    // 34 000 kr a month: 34 000 × 12 × 0,93 = 379 440 kr pensionable a year.
    expect(f).toMatchObject({ grossOre: 3_400_000, payslips: 2, from: "2026-07-24", to: "2026-08-25", capped: false, pensionableOre: 3_162_000 });
    expect(f.incomePensionOre).toBe(505_920); // 16 %
    expect(f.premiumPensionOre).toBe(79_050); // 2,5 %
    expect(f.safLoOre).toBe(153_000); // 4,5 % of the gross, not of the pensionable income
    expect(f.totalOre).toBe(505_920 + 79_050 + 153_000);
  });

  it("stops at 7,5 income base amounts a year", () => {
    const db = freshDb({ seeded: true });
    payslip(db, "2026-08-25", 6_000_000);
    const f = pensionInflow(db, TODAY)!;
    // 60 000 × 12 × 0,93 = 669 600 kr, over 7,5 × 83 400 = 625 500.
    expect(f).toMatchObject({ capOre: 62_550_000, capped: true, pensionableOre: 5_212_500, incomePensionOre: 834_000 });
    // The SAF-LO share is of the whole gross.
    expect(f.safLoOre).toBe(270_000);
  });

  it("averages the payslips of the last twelve months only, and says nothing without one", () => {
    const db = freshDb({ seeded: true });
    expect(pensionInflow(db, TODAY)).toBeNull();
    payslip(db, "2025-08-25", 9_000_000); // thirteen months back
    expect(pensionInflow(db, TODAY)).toBeNull();
    payslip(db, "2026-01-23", 2_000_000);
    expect(pensionInflow(db, TODAY)).toMatchObject({ grossOre: 2_000_000, payslips: 1 });
  });

  it("puts the registered SAF-LO premium and the premium pension's fund beside it", () => {
    const db = freshDb({ seeded: true });
    payslip(db, "2026-08-25", 3_400_000);
    const f = pensionInflow(db, TODAY)!;
    expect(f.safLoLatest).toEqual({ amountOre: 100_000, date: "2026-07-22" });
    expect(f.premiumFunds).toEqual(["Exempelfond USA Index"]);
    expect(pensionOverview(db, TODAY).inflow).toEqual(f);
  });

  it("uses the income base amount of the year, and says when that year's isn't entered", () => {
    const db = freshDb({ seeded: true });
    payslip(db, "2027-01-25", 3_400_000);
    // Only 2026 is entered: 2027 falls back to it, and says so.
    expect(pensionInflow(db, "2027-02-10")).toMatchObject({ baseAmount: { year: 2026, amountOre: 8_340_000 }, forYear: 2027 });
    setIncomeBaseAmount(db, { year: 2027, amountOre: 8_600_000, source: "påhittat för testet" });
    expect(pensionInflow(db, "2027-02-10")).toMatchObject({ baseAmount: { year: 2027 }, capOre: 64_500_000 });
    // 2026 is still 2026's.
    payslip(db, "2026-11-25", 3_400_000);
    expect(pensionInflow(db, "2026-12-01")!.baseAmount.year).toBe(2026);
  });

  it("keeps the income base amount as a setting with its source, and refuses what can't be one", () => {
    const db = freshDb({ seeded: true });
    expect(getPensionSettings(db).incomeBaseAmounts).toEqual([{ year: 2026, amountOre: 8_340_000, source: "regeringsbeslut 6/11 2025" }]);
    setIncomeBaseAmount(db, { year: 2026, amountOre: 8_340_000, source: "Pensionsmyndigheten" });
    expect(getPensionSettings(db).incomeBaseAmounts).toHaveLength(1);
    expect(() => setIncomeBaseAmount(db, { year: 2026, amountOre: 83_400, source: "x" })).toThrow(PensionError);
    expect(() => setIncomeBaseAmount(db, { year: 2026, amountOre: 8_340_000, source: " " })).toThrow(/Skriv var/);
  });
});

describe("årsbeskedet mot beräkningen", () => {
  let seq = 0;
  const payslip = (db: Db, payDate: string, gross: number) =>
    db.insert(payslips).values({ payDate, gross, tax: 0, net: gross, filename: `${payDate}.htm`, sha256: `ps-${++seq}` }).run();
  /** A whole year of 30 000 kr: 360 000 kr, of which 334 800 kr pensionable. */
  const wholeYear = (db: Db, year: number, gross = 3_000_000) => {
    for (let m = 1; m <= 12; m++) payslip(db, `${year}-${String(m).padStart(2, "0")}-25`, gross);
  };
  const ENVELOPE = { year: 2026, pensionableIncomeOre: 33_480_000, incomePensionRightOre: 5_356_800, premiumPensionRightOre: 837_000 };

  it("works a year out from the payslips paid out in it, by the same rules", () => {
    const db = freshDb({ seeded: true });
    wholeYear(db, 2026);
    payslip(db, "2025-12-23", 9_000_000); // paid the year before: not this year's
    expect(computedYear(db, 2026)).toMatchObject({
      payslips: 12,
      grossOre: 36_000_000,
      pensionableIncomeOre: 33_480_000,
      incomePensionRightOre: 5_356_800, // 16 %
      premiumPensionRightOre: 837_000, // 2,5 %
      capped: false,
      baseAmount: { year: 2026 },
    });
    expect(computedYear(db, 2024)).toBeNull();
  });

  it("stops at the year's ceiling", () => {
    const db = freshDb({ seeded: true });
    wholeYear(db, 2026, 6_000_000);
    // 720 000 × 0,93 = 669 600, over 7,5 × 83 400 = 625 500.
    expect(computedYear(db, 2026)).toMatchObject({ pensionableIncomeOre: 62_550_000, capped: true, incomePensionRightOre: 10_008_000 });
  });

  it("puts each envelope beside the tool's figure, with the difference", () => {
    const db = freshDb({ seeded: true });
    wholeYear(db, 2026);
    savePensionStatement(db, { ...ENVELOPE, pensionableIncomeOre: 33_490_000 });
    savePensionStatement(db, { year: 2025, pensionableIncomeOre: 30_000_000, incomePensionRightOre: 4_800_000, premiumPensionRightOre: 750_000 });

    const [y2026, y2025] = pensionStatementChecks(db);
    expect(y2026.statement.year).toBe(2026);
    expect(y2026.diff).toEqual({ pensionableIncomeOre: 10_000, incomePensionRightOre: 0, premiumPensionRightOre: 0 });
    // No payslips for 2025: the envelope stands alone, no difference claimed.
    expect(y2025).toMatchObject({ computed: null, diff: null });
    expect(pensionOverview(db, TODAY).statements).toEqual(pensionStatementChecks(db));
  });

  it("is one per income year: entering it again corrects it", () => {
    const db = freshDb({ seeded: true });
    const first = savePensionStatement(db, ENVELOPE);
    const again = savePensionStatement(db, { ...ENVELOPE, premiumPensionRightOre: 837_100 });
    expect(again.id).toBe(first.id);
    expect(db.select().from(pensionStatements).all()).toHaveLength(1);
    expect(again).toMatchObject({ premiumPensionRightOre: 837_100, source: "orange_envelope" });
    expect(deletePensionStatement(db, first.id)).toBe(true);
    expect(pensionStatementChecks(db)).toEqual([]);
  });

  it("refuses what can't be an envelope", () => {
    const db = freshDb({ seeded: true });
    expect(() => savePensionStatement(db, { ...ENVELOPE, year: 25 })).toThrow(PensionError);
    expect(() => savePensionStatement(db, { ...ENVELOPE, incomePensionRightOre: -1 })).toThrow(/noll eller mer/);
    // The rights and the income swapped: the rights can't exceed the income.
    expect(() => savePensionStatement(db, { ...ENVELOPE, pensionableIncomeOre: 5_356_800, incomePensionRightOre: 33_480_000 })).toThrow(/rätt fält/);
  });

  it("the API takes an envelope and gives it back in the overview", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const res = await app.request("/api/networth/pension/statements", { method: "POST", body: JSON.stringify(ENVELOPE), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(201);
    const bad = await app.request("/api/networth/pension/statements", { method: "POST", body: JSON.stringify({ ...ENVELOPE, year: 1 }), headers: { "Content-Type": "application/json" } });
    expect(bad.status).toBe(400);
    const overview = await (await app.request(`/api/networth/pension?on=${TODAY}`)).json();
    expect(overview.statements).toHaveLength(1);
  });
});

describe("prognosen från minPension", () => {
  const F = { madeOn: "2026-03-14", retirementAge: 65, monthlyPensionOre: 1_845_000, assumptions: "avkastning 3,5 % före avgifter, löneutveckling 2 % (minPension)" };

  it("keeps the newest forecast per retirement age, with its date and assumptions", () => {
    const db = freshDb({ seeded: true });
    savePensionForecast(db, { ...F, madeOn: "2025-03-01", monthlyPensionOre: 1_700_000 });
    savePensionForecast(db, F);
    savePensionForecast(db, { ...F, retirementAge: 67, monthlyPensionOre: 2_150_000, note: "med SAF-LO från 65" });
    savePensionForecast(db, { ...F, retirementAge: 63, madeOn: "2025-03-01", monthlyPensionOre: 1_400_000 });

    const v = pensionForecastsView(db, TODAY);
    expect(v.latest.map((f) => [f.retirementAge, f.madeOn, f.monthlyPensionOre])).toEqual([
      [63, "2025-03-01", 1_400_000],
      [65, "2026-03-14", 1_845_000],
      [67, "2026-03-14", 2_150_000],
    ]);
    expect(v.latest[1]).toMatchObject({ assumptions: F.assumptions, monthsOld: 6 });
    expect(v.latest[2].note).toBe("med SAF-LO från 65");
    // The newest of all is half a year old: not stale.
    expect(v.stale).toBeNull();
    expect(pensionOverview(db, TODAY).forecasts).toEqual(v);
  });

  it("is stale when the newest forecast of all is a year old", () => {
    const db = freshDb({ seeded: true });
    expect(pensionForecastsView(db, TODAY)).toEqual({ latest: [], stale: null });
    savePensionForecast(db, { ...F, madeOn: "2025-09-20" });
    expect(pensionForecastsView(db, "2026-09-19").stale).toBeNull();
    expect(pensionForecastsView(db, TODAY).stale).toEqual({ madeOn: "2025-09-20", monthsOld: 12 });
  });

  it("is one per day and age: entering it again corrects it", () => {
    const db = freshDb({ seeded: true });
    const first = savePensionForecast(db, F);
    const again = savePensionForecast(db, { ...F, monthlyPensionOre: 1_846_000 });
    expect(again.id).toBe(first.id);
    expect(db.select().from(pensionForecasts).all()).toHaveLength(1);
    expect(deletePensionForecast(db, first.id)).toBe(true);
    expect(pensionForecastsView(db, TODAY).latest).toEqual([]);
  });

  it("will not store a figure without the assumptions it rests on", () => {
    const db = freshDb({ seeded: true });
    expect(() => savePensionForecast(db, { ...F, assumptions: "  " })).toThrow(/antagandena/);
    expect(() => savePensionForecast(db, { ...F, madeOn: "14/3 2026" })).toThrow(PensionError);
    expect(() => savePensionForecast(db, { ...F, retirementAge: 40 })).toThrow(/55–80/);
    expect(() => savePensionForecast(db, { ...F, monthlyPensionOre: 0 })).toThrow(/mer än noll/);
  });

  it("computes nothing of its own", () => {
    const db = freshDb({ seeded: true });
    savePensionForecast(db, F);
    // What comes back is what went in: no growth, no tax, no other age filled in.
    const [f] = pensionForecastsView(db, TODAY).latest;
    expect(f).toMatchObject({ monthlyPensionOre: F.monthlyPensionOre, retirementAge: 65 });
    expect(pensionForecastsView(db, TODAY).latest).toHaveLength(1);
  });
});
