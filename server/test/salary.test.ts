import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { payslipLines, payslips, salaryConstants, salaryMonths } from "../src/db/schema.js";
import { parsePayslip, parseRows, rowsFromPdf } from "../src/salary/hogia.js";
import type { PdfLine } from "../src/import/pdfText.js";
import { backtest, constantsFor, deriveConstants, getSalarySettings, importPayslip, storePayslip, modelMonth, obRatesFor, payDateFor, salaryForecasts, setConstant, setMonth, setSalarySettings, vacationPayout, vacationYearEnd } from "../src/salary/salary.js";
import { setSetting } from "../src/settings.js";
import { curveRate, fetchTaxTable, tableTax, taxCurve } from "../src/salary/tax.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";
import { JULY, MARCH, pinSalarySettings } from "./payslips.js";

/** A fake Skatteverket: table 32, 2026, the brackets the payslips and the model's months fall in (column 1; made-up figures). */
const BRACKETS: [number, number, number][] = [
  [24701, 24800, 4464],
  [27801, 27900, 5017],
  [27901, 28000, 5039],
  [30001, 30100, 5560],
];
const fakeSkv = async (url: string) => {
  const q = new URL(url).searchParams;
  const results =
    q.get("_offset") === "0"
      ? BRACKETS.map(([from, to, tax]) => ({
          år: q.get("år")!,
          tabellnr: q.get("tabellnr")!,
          "antal dgr": "30B",
          "inkomst fr.o.m.": String(from),
          "inkomst t.o.m.": String(to),
          "kolumn 1": String(tax),
          "kolumn 2": "0",
        }))
      : [];
  return { ok: true, json: async () => ({ results }) };
};

async function withJuly() {
  const db = freshDb({ seeded: true });
  pinSalarySettings(db);
  importPayslip(db, "Lonespec_2607.htm", JULY);
  deriveConstants(db);
  await fetchTaxTable(db, 2026, 32, fakeSkv);
  return db;
}

describe("Hogia payslips", () => {
  it("reads the pay day, the lines with their periods, gross, tax, net and the year values; nothing personal", () => {
    const p = parsePayslip(JULY);
    expect(p).toMatchObject({
      payDate: "2026-07-24",
      labelMonth: "2026-07",
      workMonth: "2026-06",
      gross: 2789995,
      tax: 501700,
      net: 2288295,
      taxBasis: 2789900,
      taxTable: 320,
      taxColumn: 1,
      category: "k01",
      salaryGroup: "b",
      hoursWorked: 157.5,
      ytdGross: 18041030,
      ytdTax: 3392000,
      vacationIncomeYtd: 7932150,
      vacationHourlyRate: 24317,
      vacationEarned: 161.7,
      vacationTaken: null,
      vacationRemaining: 161.7,
      vacationSaved: null,
      atfBalance: 18.5,
      wellnessYtd: 100000,
      accountMasked: "••0000",
    });
    expect(p.lines.map((l) => [l.code, l.dateFrom, l.quantity, l.unitPrice, l.amount])).toEqual([
      ["011", "2026-06-01", null, null, 2400000],
      ["01d", "2026-06-01", null, null, 30000],
      ["02f", "2026-06-01", null, null, 50000],
      ["160", "2026-06-01", 17.5, 17714, 309995],
      ["900", null, null, null, -501700],
    ]);
    expect(JSON.stringify(p)).not.toMatch(/Kim|Exempel|10001|0000-0000000/i);
  });

  it("an hourly payslip: ATF taken out and paid, the lines' month from their dates", () => {
    const p = parsePayslip(MARCH);
    expect(p).toMatchObject({ payDate: "2026-03-25", workMonth: "2026-02", gross: 2523632, tax: 454300, net: 2069332, hoursWorked: 140 });
    expect(p.lines.find((l) => l.code === "atb")).toMatchObject({ quantity: 4, unitPrice: 17000, amount: 68000, dateFrom: "2026-02-13" });
    expect(p.lines.find((l) => l.code === "424")).toMatchObject({ quantity: -4, info: "Omf 1,00" });
  });

  it("is imported once, with the lönearter not in the list reported", () => {
    const db = freshDb({ seeded: true });
    expect(importPayslip(db, "a.htm", MARCH)).toMatchObject({ status: "new", unknownCodes: ["150", "15h", "022"] });
    expect(importPayslip(db, "b.htm", MARCH)).toMatchObject({ status: "exists" });
    expect(importPayslip(db, "c.htm", "<html>inget</html>")).toMatchObject({ status: "error" });
    expect(db.select().from(payslips).all()).toHaveLength(1);
    expect(db.select().from(payslipLines).all()).toHaveLength(8);
  });
});

describe("Löneprognos", () => {
  it("constants from the payslip with where they come from; the lag from the lines' periods", async () => {
    const db = await withJuly();
    const c = constantsFor(db, "2026-09")!;
    expect(c).toMatchObject({
      validFrom: "2026-06",
      monthlySalary: 2400000,
      industrySupplement: 30000,
      salarySupplement: 50000,
      hoursPerMonth: 140,
      fullTimeHours: 165.6,
      mertidRate: 17714,
      vacationHourlyRate: 24317,
      baseHourlyRate: 17143,
      employmentRate: 0.8454,
    });
    expect(c.sources.monthlySalary).toBe("från julispec 2026");
    expect(constantsFor(db, "2026-05")).toBeNull();
    expect(getSalarySettings(db)).toMatchObject({ lagMonths: 1, lagSource: "1 av 1 specar: raderna gäller månaden före utbetalningen" });
  });

  it("pay day: the 25th of the month after, the bank day before when it isn't one", () => {
    const s = { ...getSalarySettings(freshDb()), lagMonths: 1 as const, payDay: 25 };
    expect(payDateFor("2026-06", s)).toBe("2026-07-24"); // 25 July 2026 is a Saturday
    expect(payDateFor("2026-09", s)).toBe("2026-10-23");
    expect(payDateFor("2026-07", s)).toBe("2026-08-25");
    expect(payDateFor("2026-07", { ...s, lagMonths: 0 })).toBe("2026-07-24");
  });

  it("the model: the August payslip's month to the öre (157,5 h, 1 h over 13 a shift); over full time is overtime, flagged", async () => {
    const db = await withJuly();
    const m = modelMonth(db, "2026-07", { hours: 157.5, overtimePassHours: 1 })!;
    expect(m.lines.map((l) => [l.code, l.amount])).toEqual([
      ["011", 2400000],
      ["01d", 30000],
      ["02f", 50000],
      ["160", 309995],
      ["164", 8857],
    ]);
    expect(m).toMatchObject({ gross: 2798852, tax: 503900, net: 2294952, payDate: "2026-08-25", taxSource: "tabell 32 kolumn 1, 2026" });
    // The quarter (July–September, the other two at 140) passes 3 × 165,6 at 157,5 + 59,3 hours.
    expect(m.thresholds).toMatchObject({ passes: false, overtimeRate: 26571, next: { at: 216.8, before: 17714, after: 26571 } });

    // A month over full time alone is no overtime: the quarter's average decides.
    const over = modelMonth(db, "2026-09", { hours: 170 })!;
    expect(over.thresholds).toMatchObject({ passes: false, quarter: { hours: 450, limit: 496.8, over: 0 } });
    expect(over.lines.find((l) => l.code === "160")).toMatchObject({ quantity: 30 });
    expect(over.lines.filter((l) => l.code === "164")).toEqual([]);
    // Under the working time: only the monthly salary and supplements.
    expect(modelMonth(db, "2026-09", { hours: 120 })!.gross).toBe(2480000);
  });

  it("overtime over 165,6 hours a month on average over the calendar quarter: mertid plus 50 %, settled with the quarter's last month", async () => {
    const db = await withJuly();
    setMonth(db, "2026-07", { hours: 180, overtimePassHours: 2 });
    // August not entered: the working time, 140.
    const sep = modelMonth(db, "2026-09", { hours: 200 })!;
    expect(sep.thresholds).toMatchObject({
      passes: true,
      quarter: {
        months: [
          { month: "2026-07", hours: 180, passHours: 2, entered: true },
          { month: "2026-08", hours: 140, passHours: 0, entered: false },
          { month: "2026-09", hours: 200, passHours: 0, entered: true },
        ],
        hours: 520,
        limit: 496.8,
        over: 23.2,
        settle: 21.2,
        settlesIn: "2026-09",
      },
      next: null,
    });
    expect(sep.lines.filter((l) => l.code === "160" || l.code === "164").map((l) => [l.name, l.quantity, l.unitPrice, l.unverified ?? false])).toEqual([
      ["Mertid", 60, 17714, false],
      ["Övertidstill. (kvartal)", 21.2, 8857, true],
    ]);
    // The same quarter seen from July: flagged, but settled in September.
    const jul = modelMonth(db, "2026-07", { hours: 180, overtimePassHours: 2 })!;
    expect(jul.thresholds.passes).toBe(false);
    expect(jul.lines.find((l) => l.name === "Övertidstill. (kvartal)")).toBeUndefined();
    setMonth(db, "2026-09", { hours: 200 });
    expect(modelMonth(db, "2026-07", { hours: 180, overtimePassHours: 2 })!.thresholds.passes).toBe(true);
  });

  it("vacation hours at the vacation rate instead of the base rate", async () => {
    const db = await withJuly();
    const m = modelMonth(db, "2026-09", { hours: 140, vacationHours: 20 })!;
    // Deducted at the whole fixed salary per hour (the mertid rate), not 011 alone.
    expect(m.gross).toBe(2480000 - 20 * 17714 + 20 * 24317);
  });

  it("backtest: the July payslip to the öre", async () => {
    const db = await withJuly();
    const [b] = backtest(db);
    expect(b).toMatchObject({ payDate: "2026-07-24", diff: 0, grossDiff: 0, model: { gross: 2789995, tax: 501700, net: 2288295 }, taxCheck: { diff: 0 } });
  });

  it("OB at the agreement's amount for the work month; a payslip's rate only for its own amount period", async () => {
    const db = await withJuly();
    const ob = (month: string, code: string) => modelMonth(db, month, { hours: 140, obHours: { [code]: 10 } })!.lines.find((l) => l.code === code);
    // No payslip with OB: the agreement, 2025 before June 2026 and 2026 from it.
    expect(obRatesFor(db, "2026-05")["150"]).toMatchObject({ rate: 2587, source: "avtalet fr o m 1/6 2025" });
    expect(ob("2026-09", "150")).toMatchObject({ unitPrice: 2662, amount: 26620 });
    expect(obRatesFor(db, "2026-09")).toMatchObject({
      "150": { name: "Kväll/natt 18–06", rate: 2662, source: "avtalet fr o m 1/6 2026" },
      "15e": { name: "Nyårs-, midsommar- och julafton", rate: 17625 },
    });
    // The March payslip (February's work) paid 150 at 25,87: it holds for its period, not after 1/6 2026.
    importPayslip(db, "mars.htm", MARCH);
    deriveConstants(db);
    expect(obRatesFor(db, "2026-02")["150"]).toMatchObject({ rate: 2587, source: "från marsspec 2026" });
    expect(obRatesFor(db, "2026-09")["150"]).toMatchObject({ rate: 2662, source: "avtalet fr o m 1/6 2026" });
    // A payslip that pays another amount in the same period is what was paid.
    setSetting(db, "salary_ob_rates", { "150": { name: "Ob-tillägg må-to", rate: 2700, source: "från oktoberspec 2026", month: "2026-09" } });
    expect(ob("2026-10", "150")).toMatchObject({ unitPrice: 2700 });
  });

  it("a salary changed by hand changes the mertid rate with it, unless the rate is given or set by hand", async () => {
    const db = await withJuly();
    const row = db.select().from(salaryConstants).get()!;
    // A revision entered before the payslip: 24 700 + 300 + 500 over 140.
    setConstant(db, row.id, { monthlySalary: 2470000 });
    expect(constantsFor(db, "2026-06")).toMatchObject({ mertidRate: 18214, sources: { monthlySalary: "ändrat för hand", mertidRate: "räknat: (011 + 01d + 02f) ÷ måttet" } });
    // A new working time (another employment rate): the rate follows.
    setConstant(db, row.id, { hoursPerMonth: 120 });
    expect(constantsFor(db, "2026-06")).toMatchObject({ mertidRate: 21250 });
    // Given, or set by hand before: kept.
    setConstant(db, row.id, { monthlySalary: 2600000, mertidRate: 19000 });
    expect(constantsFor(db, "2026-06")).toMatchObject({ mertidRate: 19000, sources: { mertidRate: "ändrat för hand" } });
    setConstant(db, row.id, { salarySupplement: 60000 });
    expect(constantsFor(db, "2026-06")).toMatchObject({ mertidRate: 19000 });
  });

  it("a value changed by hand is kept when payslips are read again", async () => {
    const db = await withJuly();
    const row = db.select().from(salaryConstants).get()!;
    setConstant(db, row.id, { monthlySalary: 3000000 });
    deriveConstants(db);
    expect(constantsFor(db, "2026-06")).toMatchObject({ monthlySalary: 3000000, sources: { monthlySalary: "ändrat för hand" } });
  });

  it("without a table the tax follows the curve from the payslips", () => {
    const db = freshDb({ seeded: true });
    importPayslip(db, "m.htm", MARCH);
    importPayslip(db, "j.htm", JULY);
    const points = taxCurve(db);
    expect(points.map((p) => p.payDate)).toEqual(["2026-03-25", "2026-07-24"]);
    const mid = (points[0].gross + points[1].gross) / 2;
    expect(curveRate(points, mid)).toBeCloseTo((points[0].rate + points[1].rate) / 2, 6);
    expect(tableTax(db, 3000000, 2026, 32, 1)).toBeNull();
  });

  it("the API: payslips in, the overview with constants and backtest, months saved with their forecast", async () => {
    const db = freshDb({ seeded: true });
    pinSalarySettings(db);
    await fetchTaxTable(db, 2026, 32, fakeSkv);
    const app = createApp(db, { databasePath: ":memory:" });
    const form = new FormData();
    form.append("files", new File([JULY], "Lonespec_2607.htm"));
    const up = await (await app.request("/api/salary/payslips", { method: "POST", body: form })).json();
    expect(up.results).toEqual([{ filename: "Lonespec_2607.htm", status: "new", payDate: "2026-07-24", unknownCodes: [] }]);
    const o = await (await app.request("/api/salary")).json();
    expect(o.constants).toHaveLength(1);
    expect(o.backtest[0].diff).toBe(0);
    expect(o.curve.points).toHaveLength(1);
    const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect((await app.request("/api/salary/months/2026-13", json("PUT", { hours: 150 }))).status).toBe(400);
    await app.request("/api/salary/months/2026-09", json("PUT", { hours: 157.5 }));
    const [m] = await (await app.request("/api/salary/months")).json();
    expect(m).toMatchObject({ month: "2026-09", hours: 157.5, forecast: { payDate: "2026-10-23", gross: 2789995, net: 2288295 } });
    expect((await app.request("/api/salary/settings", json("PUT", { lagMonths: 2 }))).status).toBe(400);
    setSalarySettings(db, { lagMonths: 0 });
    expect(getSalarySettings(db)).toMatchObject({ lagMonths: 0, lagManual: true });
  });
});

/**
 * The September 2026 payslip as the PDF gives its text: lines with an x
 * position, the columns where Hogia puts them. Fictional: the employer, the
 * figures and the account number are made up, and there is no name or address.
 */
const AUGUST_PDF: [number, [number, string][]][] = [
  [780, [[113, "Exempelbolaget AB"]]],
  [741, [[58, "Företag"], [172, "1000"], [312, "Mottagare"]]],
  [710, [[58, "Kategori"], [172, "k01"]]],
  [701, [[58, "Lönegrupp"], [172, "b"]]],
  [632, [[58, "Skattetabell"], [172, "320"]]],
  [623, [[58, "Skattekolumn"], [172, "1"]]],
  [596, [[58, "Löneart"], [87, "Benämning"], [200, "Datum"], [285, "Text"], [398, "Antal"], [427, "Apris"], [483, "Belopp"]]],
  [586, [[58, "011"], [87, "Månadslön"], [200, "260801-260831"], [510, "24000,00"]]],
  [577, [[58, "01d"], [87, "Tillägg, 5 år"], [200, "260801-260831"], [517, "300,00"]]],
  [567, [[58, "02f"], [87, "Lönetillägg, påv. a"], [200, "260801-260831"], [517, "500,00"]]],
  [557, [[58, "21a"], [87, "Avdrag semester"], [200, "260801-260823"], [407, "80,00-"], [460, "177,14"], [510, "14171,20-"]]],
  [547, [[58, "205"], [87, "Semestertimlön"], [200, "260801-260823"], [407, "80,00"], [460, "243,17"], [510, "19453,60"]]],
  [538, [[87, "Summa bruttolön"], [510, "30082,40"]]],
  [518, [[58, "900"], [87, "Prel.skatt"], [285, "Beräknad på: 30082"], [513, "5560,00-"]]],
  [508, [[58, "bfr"], [87, "Frånvaro övertidsgr"], [200, "260801-260831"], [407, "80,00-"]]],
  [294, [[58, "Lönen insatt på bankkonto nr"], [242, "Grundlön avser"], [342, "Utbetalningsdag"], [455, "NETTOLÖN"]]],
  [284, [[58, "00000000000"], [242, "2609"], [342, "260925"], [510, "24522,40"]]],
  [267, [[58, "Semestersaldon"], [181, "Antal"], [237, "Uttag"], [265, "Kvarv"], [313, "Benämning"], [446, "Periodvärde"], [511, "Årsvärde"]]],
  [257, [[58, "Semesterrätt lag"], [313, "Bruttolön"], [454, "30082,40"], [507, "210492,70"]]],
  [247, [[58, "Intjänad semester"], [177, "161,70"], [237, "80,00"], [265, "81,70"], [313, "Skatt"], [457, "5560,00-"], [510, "39480,00-"]]],
  [228, [[58, "Komp saldo"], [313, "Nettolön"], [454, "24522,40"], [507, "171012,70"]]],
  [218, [[58, "ATF saldo"], [180, "18,50"], [313, "Kostnadsersättn"]]],
  [208, [[58, "Sparad semester"], [313, "Tjänstgjorda tim"], [464, "60,00"], [517, "500,00"]]],
  [199, [[58, "Varav sparår 1"], [313, "Sem.gr inkomst"], [507, "98412,66"]]],
  [179, [[58, "Varav sparår 3"], [313, "Semestertimlön"], [517, "243,17"]]],
  [150, [[58, "Varav sparår 6"], [313, "Friskvård använt"], [514, "1000,00"]]],
];
const augustPdf = (): PdfLine[] => AUGUST_PDF.map(([y, items]) => ({ page: 1, y, items: items.map(([x, text]) => ({ x, text })) }));
const AUGUST = () => parseRows(rowsFromPdf(augustPdf()), "sha-august");

describe("the agreement as settings", () => {
  it("is empty from the start: no OB levels, no limits, no quarter rule, no schedule notice", () => {
    expect(getSalarySettings(freshDb())).toMatchObject({ obLevels: {}, shiftLimit: null, weekLimit: null, quarterOvertime: false, scheduleNoticeDays: null });
  });

  it("OB comes from the payslips alone when no level is entered, from the entered levels otherwise", async () => {
    const db = await withJuly();
    setSalarySettings(db, { obLevels: {} });
    expect(obRatesFor(db, "2026-09")).toEqual({});
    importPayslip(db, "mars.htm", MARCH);
    deriveConstants(db);
    // The March payslip's rate, with the month it was paid for.
    expect(obRatesFor(db, "2026-09")["150"]).toMatchObject({ rate: 2587, source: "från marsspec 2026" });
    setSalarySettings(db, { obLevels: { "150": { name: "Kväll", rates: [{ from: "2026-06", rate: 3000 }, { from: "2025-06", rate: 2900 }] } } });
    expect(obRatesFor(db, "2026-09")["150"]).toMatchObject({ rate: 3000, source: "avtalet fr o m 1/6 2026" });
    // The rates are kept in order, whichever order they were entered in.
    expect(getSalarySettings(db).obLevels["150"].rates.map((r) => r.from)).toEqual(["2025-06", "2026-06"]);
  });

  it("without the quarter rule the model gives no quarter overtime and no threshold for it", async () => {
    const db = await withJuly();
    const hours = { hours: 250 };
    expect(modelMonth(db, "2026-09", hours)!.thresholds).toMatchObject({ passes: true });
    setSalarySettings(db, { quarterOvertime: false });
    const m = modelMonth(db, "2026-09", hours)!;
    expect(m.thresholds).toMatchObject({ passes: false, quarter: null, next: null });
    expect(m.lines.some((l) => l.name === "Övertidstill. (kvartal)")).toBe(false);
  });

  it("checks what is entered", () => {
    const db = freshDb();
    expect(() => setSalarySettings(db, { shiftLimit: 30 })).toThrow("Gränsen per pass ska vara 0–24 timmar, eller tom.");
    expect(() => setSalarySettings(db, { weekLimit: 0 })).toThrow("Gränsen per vecka");
    expect(() => setSalarySettings(db, { scheduleNoticeDays: 2.5 })).toThrow("Schemat ska vara klart");
    expect(() => setSalarySettings(db, { quarterOvertime: "ja" })).toThrow("Kvartalsövertiden är på eller av.");
    expect(() => setSalarySettings(db, { obLevels: { "999": { name: "x", rates: [] } } })).toThrow("Lönearten 999");
    expect(() => setSalarySettings(db, { obLevels: { "150": { name: " ", rates: [] } } })).toThrow("behöver ett namn");
    expect(() => setSalarySettings(db, { obLevels: { "150": { name: "Kväll", rates: [{ from: "2026-06", rate: 25.5 }] } } })).toThrow("öre per timme");
    expect(() => setSalarySettings(db, { obLevels: { "150": { name: "Kväll", rates: [{ from: "2026-06", rate: 2500 }, { from: "2026-06", rate: 2600 }] } } })).toThrow("två satser");
    // Cleared again with null.
    setSalarySettings(db, { shiftLimit: 13 });
    expect(setSalarySettings(db, { shiftLimit: null }).shiftLimit).toBeNull();
  });
});

describe("the payslip as a PDF", () => {
  it("reads the same things as the HTML: lines, gross, tax, net, the year values", () => {
    const p = AUGUST();
    expect(p).toMatchObject({
      payDate: "2026-09-25",
      labelMonth: "2026-09",
      workMonth: "2026-08",
      gross: 3008240,
      tax: 556000,
      net: 2452240,
      taxBasis: 3008200,
      taxTable: 320,
      taxColumn: 1,
      category: "k01",
      salaryGroup: "b",
      hoursWorked: 60,
      ytdGross: 21049270,
      ytdTax: 3948000,
      ytdNet: 17101270,
      ytdHours: 500,
      vacationIncomeYtd: 9841266,
      vacationHourlyRate: 24317,
      vacationEarned: 161.7,
      vacationTaken: 80,
      vacationRemaining: 81.7,
      vacationSaved: null,
      atfBalance: 18.5,
      wellnessYtd: 100000,
      accountMasked: "••0000",
    });
    expect(p.lines.map((l) => [l.code, l.quantity, l.unitPrice, l.amount])).toEqual([
      ["011", null, null, 2400000],
      ["01d", null, null, 30000],
      ["02f", null, null, 50000],
      ["21a", -80, 17714, -1417120],
      ["205", 80, 24317, 1945360],
      ["900", null, null, -556000],
      ["bfr", -80, null, null],
    ]);
  });
});

describe("a month of vacation, as the September 2026 payslip has it", () => {
  it("the model: 80 hours off at 177,14 and paid at 243,17, to the öre", async () => {
    const db = await withJuly();
    const m = modelMonth(db, "2026-08", { hours: 140, vacationHours: 80 })!;
    expect(m.lines.map((l) => [l.code, l.quantity, l.unitPrice, l.amount])).toEqual([
      ["011", null, null, 2400000],
      ["01d", null, null, 30000],
      ["02f", null, null, 50000],
      ["21a", 80, 17714, -1417120],
      ["205", 80, 24317, 1945360],
    ]);
    // No longer an assumption: the payslip showed both lines.
    expect(m.lines.some((l) => l.unverified)).toBe(false);
    expect(m).toMatchObject({ gross: 3008240, tax: 556000, net: 2452240, payDate: "2026-09-25" });
  });

  it("backtest: the payslip to the öre, its hours worked plus the vacation", async () => {
    const db = await withJuly();
    expect(storePayslip(db, "lönespec.pdf", AUGUST())).toMatchObject({ status: "new", unknownCodes: [] });
    const b = backtest(db).find((x) => x.payDate === "2026-09-25")!;
    expect(b).toMatchObject({ diff: 0, grossDiff: 0, model: { gross: 3008240, tax: 556000, net: 2452240 }, taxCheck: { diff: 0 } });
  });

  it("a payslip read before the vacation balance was: reading it again fills the balance in, once", async () => {
    const db = await withJuly();
    storePayslip(db, "lönespec.pdf", { ...AUGUST(), vacationTaken: null, vacationRemaining: null, vacationSaved: null });
    expect(storePayslip(db, "lönespec.pdf", AUGUST())).toMatchObject({ status: "updated", payDate: "2026-09-25" });
    expect(db.select().from(payslips).where(eq(payslips.payDate, "2026-09-25")).get()).toMatchObject({ vacationTaken: 80, vacationRemaining: 81.7 });
    expect(storePayslip(db, "lönespec.pdf", AUGUST())).toMatchObject({ status: "exists" });
    expect(db.select().from(payslips).all()).toHaveLength(2);
  });

  it("a month without mertid reads its rate off the vacation deduction: no new constants", async () => {
    const db = await withJuly();
    storePayslip(db, "lönespec.pdf", AUGUST());
    // 24 800 / 140 is 177,142…; Hogia's rate is cut to the öre, and the
    // deduction line says so.
    expect(deriveConstants(db)).toEqual([]);
    expect(constantsFor(db, "2026-08")).toMatchObject({ validFrom: "2026-06", mertidRate: 17714 });
  });
});

describe("the vacation left at 31 March, paid out", () => {
  it("the vacation year ends with the March after the work month", () => {
    expect(vacationYearEnd("2026-08")).toBe("2027-03");
    expect(vacationYearEnd("2027-03")).toBe("2027-03");
    expect(vacationYearEnd("2027-04")).toBe("2028-03");
  });

  it("the latest payslip's balance, less the vacation entered up to March and the hours to save, at the vacation rate with the April salary", async () => {
    const db = await withJuly();
    // The July payslip, before any vacation: the whole year left.
    expect(vacationPayout(db)).toMatchObject({ source: "julispec 2026", remaining: 161.7, hours: 161.7 });
    storePayslip(db, "lönespec.pdf", AUGUST());
    expect(vacationPayout(db)).toMatchObject({
      workMonth: "2027-03",
      payDate: "2027-04-23", // 25 April 2027 is a Sunday
      source: "septemberspec 2026",
      remaining: 81.7,
      planned: 0,
      save: 0,
      hours: 81.7,
      rate: 24317,
      amount: 1986699,
    });
    setMonth(db, "2026-12", { hours: 140, vacationHours: 40 });
    // The next vacation year's: not taken from this one.
    setMonth(db, "2027-04", { hours: 140, vacationHours: 30 });
    setSalarySettings(db, { vacationSave: { "2027-03": 10 } });
    const amount = Math.round(31.7 * 24317);
    expect(vacationPayout(db)).toMatchObject({ planned: 40, save: 10, hours: 31.7, amount });

    // A line of March's salary, as an assumption; no other month has it.
    expect(modelMonth(db, "2027-03", { hours: 140 })!.lines.find((l) => l.code === "semut")).toMatchObject({ quantity: 31.7, unitPrice: 24317, amount, unverified: true });
    expect(modelMonth(db, "2027-02", { hours: 140 })!.lines.some((l) => l.code === "semut")).toBe(false);
    // No hours entered for March: a normal month with it, on the April pay day.
    expect(salaryForecasts(db).get("2027-04")).toMatchObject({ workMonth: "2027-03", payDate: "2027-04-23", hours: 140, vacationPayout: amount, assumed: true });
    setMonth(db, "2027-03", { hours: 150 });
    const entered = salaryForecasts(db).get("2027-04")!;
    expect(entered).toMatchObject({ hours: 150, vacationPayout: amount });
    expect(entered.assumed).toBeUndefined();

    // All of it saved: nothing paid out, and the forecast is the month as entered.
    setSalarySettings(db, { vacationSave: { "2027-03": 50 } });
    expect(vacationPayout(db)).toMatchObject({ hours: 0, amount: 0 });
    expect(salaryForecasts(db).get("2027-04")?.vacationPayout).toBeUndefined();
    expect(() => setSalarySettings(db, { vacationSave: { "2027-04": 5 } })).toThrow("Timmarna att spara ska vara 0–400 per semesterår.");
  });

  it("a payslip read in before its pay day is what the month pays: its gross, net and day, with or without hours entered", async () => {
    const db = await withJuly();
    // The July payslip is paid 2026-07-24; August's work is paid 2026-09-25 and its payslip comes in ahead of it.
    setMonth(db, "2026-07", { hours: 150 });
    const model = salaryForecasts(db).get("2026-08")!;
    expect(model.fromSpec).toBeUndefined();
    const august = { ...AUGUST(), payDate: "2026-09-25", workMonth: "2026-08", gross: 3000000, net: 2400000, hoursWorked: 147, sha256: "sha-ahead" };
    storePayslip(db, "ahead.pdf", august);
    // Hours entered for it: the payslip's figures replace the model's, the hours stay the entered ones.
    setMonth(db, "2026-08", { hours: 145 });
    expect(salaryForecasts(db).get("2026-09")).toMatchObject({ workMonth: "2026-08", payDate: "2026-09-25", gross: 3000000, net: 2400000, hours: 145, fromSpec: true });
    // Without hours: only when asked from a day before its pay day, and not after it was paid.
    db.delete(salaryMonths).where(eq(salaryMonths.month, "2026-08")).run();
    expect(salaryForecasts(db).get("2026-09")).toBeUndefined();
    expect(salaryForecasts(db, "2026-09-21").get("2026-09")).toMatchObject({ workMonth: "2026-08", payDate: "2026-09-25", net: 2400000, hours: 147, fromSpec: true });
    expect(salaryForecasts(db, "2026-09-26").get("2026-09")).toBeUndefined();
  });

  it("once the payslip for March is in, it is paid and nothing more is forecast", async () => {
    const db = await withJuly();
    storePayslip(db, "lönespec.pdf", AUGUST());
    storePayslip(db, "april.pdf", { ...AUGUST(), payDate: "2027-04-23", workMonth: "2027-03", vacationRemaining: 20, sha256: "sha-april" });
    expect(vacationPayout(db)).toBeNull();
    expect(salaryForecasts(db).size).toBe(0);
  });
});

