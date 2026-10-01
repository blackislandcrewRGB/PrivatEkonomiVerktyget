import { asc, desc, eq, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { payslipLines, payslips, salaryConstants, salaryMonths, workShiftDays } from "../db/schema.js";
import { previousBankDay } from "../calendar/bankDays.js";
import { addMonths } from "../overview/dates.js";
import { getSetting, setSetting } from "../settings.js";
import { KNOWN_CODES, parsePayslip, parsePayslipPdf, PayslipError, type ParsedPayslip, type PayslipLine } from "./hogia.js";
import { curveRate, tableTax, taxCurve } from "./tax.js";
import { fromText, OB_CODES, rateFor, validateObLevels, type ObLevels } from "./agreement.js";
import { shiftsByMonth } from "../fuel/fuel.js";

/**
 * Löneprognos: from the hours of a work month, what lands on the account and
 * when. The constants (monthly salary, supplements, working time, the mertid
 * and vacation rates) are read from the payslips, with the month they hold
 * from; the lag between work and pay is read from the lines' periods.
 */

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** 'julispec 2026': the payslip paid in July. */
export const specName = (payDate: string) => `${MONTHS[Number(payDate.slice(5, 7)) - 1]}spec ${payDate.slice(0, 4)}`;
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// ---------- Settings ----------

export interface SalarySettings {
  /** Months between the work and its pay (read from the payslips). */
  lagMonths: 0 | 1;
  lagSource: string;
  /** Set by hand: the payslips no longer set it. */
  lagManual?: boolean;
  /** The day of the month the salary is paid, moved to the bank day before. */
  payDay: number;
  /** Full time a month (the agreement's, 173,3 by default); not on the payslips. */
  fullTimeHours: number;
  /** Skatteverket's table and column (the payslip's 'Skattetabell 320' is table 32). */
  taxTable: number;
  taxColumn: number;
  /** The table year to use; null = the pay day's year (else the latest stored). */
  taxYear: number | null;
  /** Hours per shift, for hours from Pendling's shifts. */
  shiftHours: number;
  /** The agreement's OB per level; the payslips' rates are used for a level not given here. */
  obLevels: ObLevels;
  /** Hours over this in a shift, or over `weekLimit` in a week (Monday–Sunday), are overtime; null = no such rule. */
  shiftLimit: number | null;
  weekLimit: number | null;
  /** Overtime when the quarter's hours pass full time on average, settled with the quarter's last month. */
  quarterOvertime: boolean;
  /** The days before a month the work schedule is due at the latest; null = no deadline shown. */
  scheduleNoticeDays: number | null;
  /** Vacation hours to save to the next vacation year, by the year's last work month ('2027-03'). */
  vacationSave: Record<string, number>;
}

const SETTINGS = "salary_settings";
export const SALARY_DEFAULTS: SalarySettings = {
  lagMonths: 1,
  lagSource: "",
  payDay: 25,
  fullTimeHours: 173.3,
  taxTable: 33,
  taxColumn: 1,
  taxYear: null,
  shiftHours: 8,
  obLevels: {},
  shiftLimit: null,
  weekLimit: null,
  quarterOvertime: false,
  scheduleNoticeDays: null,
  vacationSave: {},
};

export function getSalarySettings(db: Db): SalarySettings {
  return { ...SALARY_DEFAULTS, ...getSetting<Partial<SalarySettings>>(db, SETTINGS, {}) };
}

export function setSalarySettings(db: Db, patch: Record<string, unknown>): SalarySettings {
  const s = getSalarySettings(db);
  const num = (k: keyof SalarySettings, ok: (v: number) => boolean, msg: string) => {
    if (patch[k] === undefined) return;
    const v = patch[k];
    if (typeof v !== "number" || !ok(v)) throw new Error(msg);
    (s as unknown as Record<string, unknown>)[k] = v;
  };
  num("lagMonths", (v) => v === 0 || v === 1, "Eftersläpningen är 0 eller 1 månad.");
  if (patch.lagMonths !== undefined) s.lagManual = true;
  num("payDay", (v) => Number.isInteger(v) && v >= 1 && v <= 28, "Lönedagen ska vara 1–28.");
  num("fullTimeHours", (v) => v > 0 && v < 300, "Heltidsmåttet ska vara timmar per månad.");
  num("taxTable", (v) => Number.isInteger(v) && v >= 29 && v <= 42, "Skattetabellen är 29–42.");
  num("taxColumn", (v) => Number.isInteger(v) && v >= 1 && v <= 6, "Kolumnen är 1–6.");
  num("shiftHours", (v) => v > 0 && v <= 24, "Timmar per pass ska vara 0–24.");
  const optional = (k: "shiftLimit" | "weekLimit" | "scheduleNoticeDays", ok: (v: number) => boolean, msg: string) => {
    if (patch[k] === undefined) return;
    if (patch[k] !== null && (typeof patch[k] !== "number" || !ok(patch[k] as number))) throw new Error(msg);
    s[k] = patch[k] as number | null;
  };
  optional("shiftLimit", (v) => v > 0 && v <= 24, "Gränsen per pass ska vara 0–24 timmar, eller tom.");
  optional("weekLimit", (v) => v > 0 && v <= 168, "Gränsen per vecka ska vara 0–168 timmar, eller tom.");
  optional("scheduleNoticeDays", (v) => Number.isInteger(v) && v >= 0 && v <= 60, "Schemat ska vara klart 0–60 dagar före, eller tomt.");
  if (patch.quarterOvertime !== undefined) {
    if (typeof patch.quarterOvertime !== "boolean") throw new Error("Kvartalsövertiden är på eller av.");
    s.quarterOvertime = patch.quarterOvertime;
  }
  if (patch.obLevels !== undefined) s.obLevels = validateObLevels(patch.obLevels);
  if (patch.vacationSave !== undefined) {
    const v = patch.vacationSave as Record<string, unknown>;
    if (typeof v !== "object" || v === null || Object.entries(v).some(([k, h]) => !/^\d{4}-03$/.test(k) || typeof h !== "number" || !(h >= 0 && h <= 400))) {
      throw new Error("Timmarna att spara ska vara 0–400 per semesterår.");
    }
    s.vacationSave = Object.fromEntries(Object.entries(v as Record<string, number>).filter(([, h]) => h > 0));
  }
  if (patch.taxYear !== undefined) {
    if (patch.taxYear !== null && !(Number.isInteger(patch.taxYear) && (patch.taxYear as number) > 2000)) throw new Error("Tabellåret ska vara ett år.");
    s.taxYear = patch.taxYear as number | null;
  }
  setSetting(db, SETTINGS, s);
  return s;
}

/** OB per level, from the latest payslip that had it: {code: {name, rate, source, month}}. */
const OB_KEY = "salary_ob_rates";
export type ObRates = Record<string, { name: string; rate: number; source: string; month?: string }>;
export const getObRates = (db: Db) => getSetting<ObRates>(db, OB_KEY, {});

/**
 * The OB rates for a work month: the agreement's amount for it (the levels
 * entered in the settings), unless a payslip showed the level for a month
 * under the same amount (the payslip is what was paid). A level only a
 * payslip has keeps its rate.
 */
export function obRatesFor(db: Db, month: string): ObRates {
  const seen = getObRates(db);
  const out: ObRates = {};
  for (const [code, level] of Object.entries(getSalarySettings(db).obLevels)) {
    const agreed = rateFor(level.rates, month);
    const slip = seen[code];
    const sameAmount = agreed && slip?.month && rateFor(level.rates, slip.month)?.from === agreed.from;
    if (slip && (!agreed || sameAmount)) out[code] = { ...slip, name: level.name };
    else if (agreed) out[code] = { name: level.name, rate: agreed.rate, source: `avtalet ${fromText(agreed.from)}` };
  }
  for (const [code, slip] of Object.entries(seen)) if (!out[code]) out[code] = slip;
  return out;
}

// ---------- Import ----------

export interface ImportResult {
  filename: string;
  /** 'updated': read before, now with what the payslips' first reading left out (the vacation balance). */
  status: "new" | "exists" | "updated" | "error";
  payDate?: string;
  error?: string;
  /** Lönearter not in the model's list. */
  unknownCodes?: string[];
}

export function importPayslip(db: Db, filename: string, html: string): ImportResult {
  let p;
  try {
    p = parsePayslip(html);
  } catch (e) {
    return { filename, status: "error", error: (e as Error).message };
  }
  return storePayslip(db, filename, p);
}

/** The payslip as the PDF the employer mails. */
export async function importPayslipPdf(db: Db, filename: string, bytes: Uint8Array): Promise<ImportResult> {
  let p;
  try {
    p = await parsePayslipPdf(bytes);
  } catch (e) {
    return { filename, status: "error", error: e instanceof PayslipError ? e.message : "Kunde inte läsa PDF:en som en lönespec." };
  }
  return storePayslip(db, filename, p);
}

export function storePayslip(db: Db, filename: string, p: ParsedPayslip): ImportResult {
  const unknownCodes = [...new Set(p.lines.map((l) => l.code).filter((c) => !(c in KNOWN_CODES)))];
  const existing =
    db.select().from(payslips).where(eq(payslips.payDate, p.payDate)).get() ?? db.select().from(payslips).where(eq(payslips.sha256, p.sha256)).get();
  if (existing) {
    // Read before the vacation balance was: read the payslip again to fill it in.
    const balance = { vacationTaken: p.vacationTaken, vacationRemaining: p.vacationRemaining, vacationSaved: p.vacationSaved };
    const missing = (Object.keys(balance) as (keyof typeof balance)[]).some((k) => existing[k] === null && balance[k] !== null);
    if (!missing) return { filename, status: "exists", payDate: p.payDate, unknownCodes };
    db.update(payslips).set(balance).where(eq(payslips.id, existing.id)).run();
    return { filename, status: "updated", payDate: p.payDate, unknownCodes };
  }
  db.transaction((tx) => {
    const { lines, ...row } = p;
    const slip = tx.insert(payslips).values({ ...row, filename }).returning().get();
    lines.forEach((l, i) => tx.insert(payslipLines).values({ ...l, payslipId: slip.id, position: i }).run());
  });
  return { filename, status: "new", payDate: p.payDate, unknownCodes };
}

export function listPayslips(db: Db) {
  const slips = db.select().from(payslips).orderBy(desc(payslips.payDate)).all();
  const lines = db.select().from(payslipLines).orderBy(asc(payslipLines.position)).all();
  return slips.map((s) => ({ ...s, name: specName(s.payDate), lines: lines.filter((l) => l.payslipId === s.id) }));
}

// ---------- What the payslips say ----------

export interface ConstantsRow {
  validFrom: string;
  monthlySalary: number;
  industrySupplement: number;
  salarySupplement: number;
  hoursPerMonth: number;
  fullTimeHours: number;
  mertidRate: number;
  vacationHourlyRate: number | null;
  sources: Record<string, string>;
  payslipId: number | null;
}

const lineOf = (lines: PayslipLine[], code: string) => lines.find((l) => l.code === code);

/**
 * From every payslip with a monthly salary (011), the constants for its work
 * month; a row is added only where something changed since the one before.
 * The working time is the fixed part over the mertid rate (explicit on the
 * payslip): Hogia's rate is about 1 öre under (011 + 01d + 02f) / 140, so
 * the time comes out as 140,0 when rounded to a tenth. Values changed by hand
 * are kept. Returns what changed (for a to-do).
 */
export function deriveConstants(db: Db): { month: string; changes: { field: string; from: number | null; to: number | null }[] }[] {
  const s = getSalarySettings(db);
  const slips = listPayslips(db).reverse();
  const out: { month: string; changes: { field: string; from: number | null; to: number | null }[] }[] = [];

  // Lag: months between the lines' period and the pay day, the same on every payslip?
  const lags = slips.filter((p) => p.workMonth).map((p) => monthsBetween(p.workMonth!, p.payDate.slice(0, 7)));
  if (lags.length) {
    const lag = lags.every((l) => l === 1) ? 1 : lags.every((l) => l === 0) ? 0 : null;
    if (lag !== null && !s.lagManual) {
      setSetting(db, SETTINGS, {
        ...getSalarySettings(db),
        lagMonths: lag,
        lagSource: `${lags.length} av ${lags.length} specar: raderna gäller ${lag === 1 ? "månaden före" : "samma månad som"} utbetalningen`,
      });
    }
  }

  // OB rates: the latest payslip with each level.
  const ob: ObRates = { ...getObRates(db) };
  for (const p of slips) for (const l of p.lines) if (OB_CODES.test(l.code) && l.unitPrice) ob[l.code] = { name: l.name, rate: l.unitPrice, source: `från ${specName(p.payDate)}`, month: p.workMonth ?? undefined };
  setSetting(db, OB_KEY, ob);

  for (const p of slips) {
    const salary = lineOf(p.lines as PayslipLine[], "011");
    if (!salary?.amount || !p.workMonth) continue;
    const src = `från ${specName(p.payDate)}`;
    const industry = lineOf(p.lines as PayslipLine[], "01d")?.amount ?? 0;
    const supplement = (lineOf(p.lines as PayslipLine[], "02f") ?? lineOf(p.lines as PayslipLine[], "022"))?.amount ?? 0;
    const prev = db.select().from(salaryConstants).where(lte(salaryConstants.validFrom, p.workMonth)).orderBy(desc(salaryConstants.validFrom)).get();
    const mertid = lineOf(p.lines as PayslipLine[], "160");
    const fixed = salary.amount + industry + supplement;
    const hours = mertid?.unitPrice ? Math.round((fixed / mertid.unitPrice) * 10) / 10 : (prev?.hoursPerMonth ?? null);
    if (hours === null) continue;
    // The vacation deduction (21a) is per hour at the same rate, Hogia's
    // öre under included: a month of vacation and no mertid still gives it.
    const rate = mertid?.unitPrice ?? lineOf(p.lines as PayslipLine[], "21a")?.unitPrice ?? Math.floor(fixed / hours);
    const next = {
      monthlySalary: salary.amount,
      industrySupplement: industry,
      salarySupplement: supplement,
      hoursPerMonth: hours,
      mertidRate: rate,
      vacationHourlyRate: p.vacationHourlyRate ?? prev?.vacationHourlyRate ?? null,
    };
    if (prev) {
      const manual = JSON.parse(prev.sources) as Record<string, string>;
      const changes = (Object.keys(next) as (keyof typeof next)[])
        .filter((k) => next[k] !== prev[k] && manual[k] !== "ändrat för hand")
        .map((k) => ({ field: k, from: prev[k] as number | null, to: next[k] }));
      if (changes.length === 0) continue;
      if (prev.validFrom === p.workMonth) continue;
      out.push({ month: p.workMonth, changes });
    }
    const sources = Object.fromEntries(Object.keys(next).map((k) => [k, src]));
    db.insert(salaryConstants)
      .values({ validFrom: p.workMonth, ...next, fullTimeHours: s.fullTimeHours, sources: JSON.stringify({ ...sources, fullTimeHours: "inställningen Heltid (står inte på specen)" }), payslipId: p.id })
      .onConflictDoNothing()
      .run();
  }
  return out;
}

/** Every constants row, oldest first, with what follows from them. */
export function listConstants(db: Db) {
  return db
    .select()
    .from(salaryConstants)
    .orderBy(asc(salaryConstants.validFrom))
    .all()
    .map((c) => ({ ...c, sources: JSON.parse(c.sources) as Record<string, string>, ...derived(c) }));
}

/** Grundtimlön (monthly ÷ working time) and the employment rate (working time ÷ full time). */
const derived = (c: Pick<ConstantsRow, "monthlySalary" | "hoursPerMonth" | "fullTimeHours">) => ({
  baseHourlyRate: Math.round(c.monthlySalary / c.hoursPerMonth),
  employmentRate: Math.round((c.hoursPerMonth / c.fullTimeHours) * 10000) / 10000,
});

/** The constants for a work month: the latest row from it or before. */
export function constantsFor(db: Db, month: string) {
  const c = db.select().from(salaryConstants).where(lte(salaryConstants.validFrom, month)).orderBy(desc(salaryConstants.validFrom)).get();
  return c ? { ...c, sources: JSON.parse(c.sources) as Record<string, string>, ...derived(c) } : null;
}

/** Changing one of these by hand changes the mertid rate with it. */
const FIXED_PARTS = ["monthlySalary", "industrySupplement", "salarySupplement", "hoursPerMonth"] as const;
export const COMPUTED_MERTID = "räknat: (011 + 01d + 02f) ÷ måttet";

/**
 * A value changed by hand in Inställningar › Lön: marked as such, kept over
 * what payslips say. A change to the fixed salary or the working time also
 * changes the mertid rate, (011 + 01d + 02f) ÷ the working time (to the öre
 * under, as Hogia's), unless the rate is given or was itself set by hand.
 */
export function setConstant(db: Db, id: number, patch: Record<string, unknown>) {
  const row = db.select().from(salaryConstants).where(eq(salaryConstants.id, id)).get();
  if (!row) throw new Error("Hittades inte.");
  const fields = ["monthlySalary", "industrySupplement", "salarySupplement", "hoursPerMonth", "fullTimeHours", "mertidRate", "vacationHourlyRate"] as const;
  const set: Record<string, number> = {};
  const sources = JSON.parse(row.sources) as Record<string, string>;
  for (const f of fields) {
    if (patch[f] === undefined) continue;
    const v = patch[f];
    if (typeof v !== "number" || !(v >= 0)) throw new Error(`${f} ska vara ett tal.`);
    set[f] = v;
    sources[f] = "ändrat för hand";
  }
  if (FIXED_PARTS.some((f) => f in set) && set.mertidRate === undefined && sources.mertidRate !== "ändrat för hand") {
    const v = (f: (typeof FIXED_PARTS)[number]) => set[f] ?? row[f];
    const hours = v("hoursPerMonth");
    if (hours > 0) {
      set.mertidRate = Math.floor((v("monthlySalary") + v("industrySupplement") + v("salarySupplement")) / hours);
      sources.mertidRate = COMPUTED_MERTID;
    }
  }
  return db.update(salaryConstants).set({ ...set, sources: JSON.stringify(sources), updatedAt: new Date().toISOString() }).where(eq(salaryConstants.id, id)).returning().get();
}

// ---------- The model ----------

export interface MonthInput {
  hours: number;
  vacationHours?: number;
  atfHours?: number;
  /** Of the hours, those over 13 a shift or 52 a week (Övertidstill. p/v). */
  overtimePassHours?: number;
  /** OB hours per level ('150': 7.5). */
  obHours?: Record<string, number>;
}

export interface ModelLine {
  code: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  /** Not seen on any payslip with a monthly salary: the rule is an assumption. */
  unverified?: boolean;
}

/** The pay day for a work month: the 25th of the month after (the lag), or the bank day before. */
export function payDateFor(workMonth: string, s: SalarySettings): string {
  const m = addMonths(workMonth, s.lagMonths);
  return previousBankDay(`${m}-${String(s.payDay).padStart(2, "0")}`);
}

const money = (qty: number, price: number) => Math.round(qty * price);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function taxFor(db: Db, gross: number, payDate: string, s = getSalarySettings(db)) {
  const t = tableTax(db, gross, s.taxYear ?? Number(payDate.slice(0, 4)), s.taxTable, s.taxColumn);
  if (t) return { tax: t.tax, source: `tabell ${s.taxTable} kolumn ${s.taxColumn}, ${t.year}` };
  const rate = curveRate(taxCurve(db), gross);
  return rate === null ? { tax: 0, source: "ingen skatt: varken tabell eller specar" } : { tax: Math.round((gross * rate) / 100) * 100, source: "kurva från specarna" };
}

/**
 * A work month's salary: the monthly salary (vacation hours at the vacation
 * rate instead of the base rate), the fixed supplements, mertid (over the
 * working time up to full time), overtime (over full time), the overtime
 * supplement per shift/week, OB and ATF paid out; gross, tax and net.
 */
export function modelMonth(db: Db, workMonth: string, input: MonthInput) {
  const s = getSalarySettings(db);
  const c = constantsFor(db, workMonth);
  if (!c) return null;
  const ob = obRatesFor(db, workMonth);
  const lines: ModelLine[] = [];
  const add = (l: ModelLine) => l.amount !== 0 && lines.push(l);
  const H = c.hoursPerMonth;
  const full = c.fullTimeHours;
  const vac = Math.min(input.vacationHours ?? 0, Math.min(input.hours, H));

  add({ code: "011", name: "Månadslön", quantity: null, unitPrice: null, amount: c.monthlySalary });
  add({ code: "01d", name: "Fast tillägg", quantity: null, unitPrice: null, amount: c.industrySupplement });
  add({ code: "02f", name: "Lönetillägg", quantity: null, unitPrice: null, amount: c.salarySupplement });
  // As the September 2026 payslip has it: the hours off are deducted at the
  // whole fixed salary per hour (011 + 01d + 02f over the working time, the
  // mertid rate — not the monthly salary alone), and paid at the vacation rate.
  if (vac > 0 && c.vacationHourlyRate) {
    add({ code: "21a", name: "Avdrag semester", quantity: vac, unitPrice: c.mertidRate, amount: -money(vac, c.mertidRate) });
    add({ code: "205", name: "Semestertimlön", quantity: vac, unitPrice: c.vacationHourlyRate, amount: money(vac, c.vacationHourlyRate) });
  }
  // The vacation left at the year's end, paid with the April salary (assumed).
  const payout = vacationPayout(db, s);
  if (payout?.workMonth === workMonth && payout.rate) {
    add({ code: "semut", name: "Outtagen semester", quantity: payout.hours, unitPrice: payout.rate, amount: payout.amount, unverified: true });
  }
  // Every hour over the working time is paid as mertid; an hour that is also
  // overtime gets 50 % of the mertid rate on top (164), as the July 2026
  // payslip paid its hour over 13 a shift. Hours to hundredths (165,6 − 140
  // is 25,599… in floating point).
  const mertid = round2(Math.max(0, input.hours - H));
  add({ code: "160", name: "Mertid", quantity: mertid, unitPrice: c.mertidRate, amount: money(mertid, c.mertidRate) });
  const pass = input.overtimePassHours ?? 0;
  const passRate = Math.round(c.mertidRate / 2);
  add({ code: "164", name: "Övertidstill. (p/v)", quantity: pass, unitPrice: passRate, amount: money(pass, passRate) });
  const quarter = s.quarterOvertime ? quarterOvertime(db, workMonth, input, H, full) : null;
  if (quarter && workMonth === quarter.settlesIn) {
    add({ code: "164", name: "Övertidstill. (kvartal)", quantity: quarter.settle, unitPrice: passRate, amount: money(quarter.settle, passRate), unverified: true });
  }
  for (const [code, h] of Object.entries(input.obHours ?? {})) {
    const r = ob[code];
    if (r && h) add({ code, name: r.name, quantity: h, unitPrice: r.rate, amount: money(h, r.rate) });
  }
  if (input.atfHours) add({ code: "atb", name: "Utbetalning ATF", quantity: input.atfHours, unitPrice: c.baseHourlyRate, amount: money(input.atfHours, c.baseHourlyRate), unverified: true });

  const gross = lines.reduce((sum, l) => sum + l.amount, 0);
  const payDate = payDateFor(workMonth, s);
  const t = taxFor(db, gross, payDate, s);

  // What one more hour is worth, gross, now and once the quarter passes full time on average.
  const overtimeRate = c.mertidRate + passRate;
  const room = quarter ? round2(quarter.limit - quarter.hours) : 0;
  const next = input.hours < H ? { at: H, before: 0, after: c.mertidRate } : room > 0 ? { at: round2(input.hours + room), before: c.mertidRate, after: overtimeRate } : null;
  return {
    workMonth,
    payDate,
    lines,
    gross,
    tax: t.tax,
    taxSource: t.source,
    net: gross - t.tax,
    thresholds: {
      hoursPerMonth: H,
      fullTimeHours: full,
      mertidRate: c.mertidRate,
      overtimeRate,
      passes: quarter !== null && quarter.hours > quarter.limit,
      quarter,
      next,
    },
    constantsFrom: c.validFrom,
  };
}

/** The calendar quarter's months: '2026-08' → 2026-07, 2026-08 and 2026-09. */
export function quarterOf(month: string): string[] {
  const first = Math.floor((Number(month.slice(5, 7)) - 1) / 3) * 3 + 1;
  return [0, 1, 2].map((i) => `${month.slice(0, 4)}-${String(first + i).padStart(2, "0")}`);
}

/**
 * Overtime by the month limit (a setting): the hours over
 * full time (165,6) on average over the calendar quarter. The quarter's months
 * as entered in Lön (this one as given), a month not entered at the working
 * time. The hours over, less those already paid as overtime per shift or week
 * in the quarter, are settled with the quarter's last month (assumed).
 */
function quarterOvertime(db: Db, workMonth: string, input: MonthInput, H: number, full: number) {
  const entered = new Map(listMonths(db).map((m) => [m.month, m]));
  const months = quarterOf(workMonth).map((month) => {
    if (month === workMonth) return { month, hours: input.hours, passHours: input.overtimePassHours ?? 0, entered: true };
    const m = entered.get(month);
    return m ? { month, hours: m.effectiveHours, passHours: m.effectiveOvertimePassHours, entered: true } : { month, hours: H, passHours: 0, entered: false };
  });
  const hours = round2(months.reduce((a, m) => a + m.hours, 0));
  const limit = round2(full * 3);
  const over = round2(Math.max(0, hours - limit));
  const paid = round2(months.reduce((a, m) => a + m.passHours, 0));
  return { months, hours, limit, over, settle: round2(Math.max(0, over - paid)), settlesIn: months[2].month };
}

// ---------- Backtest ----------

/**
 * The model's inputs as the payslip shows them. The model's hours are the
 * month's total with the vacation in it (as entered: "Timmar totalt, varav
 * semester"); the payslip's 'Tjänstgjorda tim' are the hours worked only.
 */
function inputFromPayslip(lines: PayslipLine[], hoursWorked: number | null): MonthInput {
  const qty = (code: string) => lines.filter((l) => l.code === code).reduce((s, l) => s + (l.quantity ?? 0), 0);
  const obHours: Record<string, number> = {};
  for (const l of lines) if (OB_CODES.test(l.code)) obHours[l.code] = (obHours[l.code] ?? 0) + (l.quantity ?? 0);
  const vacation = qty("205");
  return {
    hours: (hoursWorked ?? 0) + vacation,
    vacationHours: vacation,
    atfHours: qty("atb"),
    overtimePassHours: qty("164"),
    obHours,
  };
}

/** What the model leaves out, with what it did to the net. */
const EXPLAIN: Record<string, string> = {
  "676": "friskvårdsutlägg",
  "677": "friskvårdsutlägg",
  "700": "friskvårdsutlägg",
};

export function backtest(db: Db) {
  const s = getSalarySettings(db);
  return listPayslips(db)
    .reverse()
    .map((p) => {
      const lines = p.lines as PayslipLine[];
      const monthly = lines.some((l) => l.code === "011");
      const tax = taxFor(db, p.gross, p.payDate, s);
      const base = {
        payDate: p.payDate,
        name: p.name,
        workMonth: p.workMonth,
        hours: p.hoursWorked,
        actual: { gross: p.gross, tax: p.tax, net: p.net },
        taxCheck: { tax: tax.tax, diff: tax.tax - p.tax, source: tax.source },
      };
      if (!monthly || !p.workMonth) {
        return { ...base, model: null, diff: null, explained: [] as { what: string; amount: number }[], note: "Timlön (03b): modellen gäller månadslönen, från april 2026. Skatten stämmer." };
      }
      const m = modelMonth(db, p.workMonth, inputFromPayslip(lines, p.hoursWorked))!;
      // Lines after the gross that change the net: outlays, VAT.
      const outside = lines.filter((l) => !["900"].includes(l.code) && l.amount !== null && !m.lines.some((x) => x.code === l.code) && EXPLAIN[l.code]);
      const explained = Object.entries(
        outside.reduce<Record<string, number>>((acc, l) => ({ ...acc, [EXPLAIN[l.code]]: (acc[EXPLAIN[l.code]] ?? 0) + l.amount! }), {}),
      ).map(([what, amount]) => ({ what, amount }));
      const diff = m.net - p.net;
      const rest = diff + explained.reduce((a, e) => a + e.amount, 0);
      return {
        ...base,
        model: { gross: m.gross, tax: m.tax, net: m.net },
        diff,
        grossDiff: m.gross - p.gross,
        explained,
        note:
          Math.abs(diff) <= 20000
            ? null
            : Math.abs(rest) <= 20000
              ? `Förklarat: ${explained.map((e) => `${e.what} ${Math.round(e.amount / 100)} kr`).join(", ")} ligger utanför modellen.`
              : "Oförklarad avvikelse: kolla specen.",
      };
    });
}

// ---------- Overtime per shift and week, from the days worked ----------

/** The agreement's limits (settings): hours over them are overtime (the 164 supplement), also within the month's mertid. */
export interface OvertimeLimits {
  shiftLimit: number | null;
  weekLimit: number | null;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Monday of the week a day is in. */
const mondayOf = (iso: string) => isoOf(utc(iso) - ((new Date(utc(iso)).getUTCDay() + 6) % 7) * DAY_MS);

export interface WeekOvertime {
  /** Monday–Sunday. */
  from: string;
  to: string;
  shifts: number;
  hours: number;
  over: number;
}

/**
 * The overtime a month's days worked give (Pendling's calendar): per shift the
 * hours over the shift limit, per week (Monday–Sunday) the hours over the week
 * limit (shifts counted up to the shift limit each); a limit left out gives
 * none. A week across two months belongs to the month of its Thursday (as ISO
 * weeks do): an assumption until a payslip shows such a week.
 */
export function weekOvertime(days: string[], month: string, shiftHours: number, limits: OvertimeLimits): { hours: number; weeks: WeekOvertime[] } {
  const perShiftCap = limits.shiftLimit ?? Infinity;
  const byWeek = new Map<string, string[]>();
  for (const d of days) byWeek.set(mondayOf(d), [...(byWeek.get(mondayOf(d)) ?? []), d]);
  const weeks: WeekOvertime[] = [];
  for (const [monday, list] of [...byWeek].sort(([a], [b]) => a.localeCompare(b))) {
    const thursday = isoOf(utc(monday) + 3 * DAY_MS);
    if (thursday.slice(0, 7) !== month) continue;
    const hours = list.length * Math.min(shiftHours, perShiftCap);
    weeks.push({ from: monday, to: isoOf(utc(monday) + 6 * DAY_MS), shifts: list.length, hours, over: limits.weekLimit === null ? 0 : Math.max(0, hours - limits.weekLimit) });
  }
  const perShift = limits.shiftLimit === null ? 0 : days.filter((d) => d.startsWith(month)).length * Math.max(0, shiftHours - limits.shiftLimit);
  const hours = Math.round((weeks.reduce((a, w) => a + w.over, 0) + perShift) * 100) / 100;
  return { hours, weeks: weeks.filter((w) => w.over > 0) };
}

/** Every month with days marked: the overtime they give. */
export function overtimeByMonth(db: Db): Record<string, { hours: number; weeks: WeekOvertime[] }> {
  const s = getSalarySettings(db);
  const days = db.select().from(workShiftDays).all().map((d) => d.date);
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  return Object.fromEntries(months.map((m) => [m, weekOvertime(days, m, s.shiftHours, s)]));
}

// ---------- Months entered ----------

export function listMonths(db: Db) {
  const s = getSalarySettings(db);
  const shifts = shiftsByMonth(db);
  const days = db.select().from(workShiftDays).all().map((d) => d.date);
  return db
    .select()
    .from(salaryMonths)
    .orderBy(asc(salaryMonths.month))
    .all()
    .map((r) => {
      // From Pendling's shifts when chosen and entered there; else the hours as entered.
      const n = shifts.get(r.month);
      // The vacation is part of the month's hours but not of its shifts.
      const fromShifts = r.hoursMode === "shifts" && n !== undefined ? Math.round((n * s.shiftHours + r.vacationHours) * 100) / 100 : null;
      // With the days marked, the overtime per shift/week follows from them too.
      const marked = days.filter((d) => d.startsWith(r.month));
      const overtime = fromShifts !== null && marked.length && (s.shiftLimit !== null || s.weekLimit !== null) ? weekOvertime(days, r.month, s.shiftHours, s) : null;
      return {
        ...r,
        obHours: JSON.parse(r.obHours) as Record<string, number>,
        shifts: n ?? null,
        hoursFromShifts: fromShifts,
        effectiveHours: fromShifts ?? r.hours,
        overtimeFromDays: overtime,
        effectiveOvertimePassHours: overtime?.hours ?? r.overtimePassHours,
      };
    });
}

export interface SalaryForecast {
  workMonth: string;
  payDate: string;
  gross: number;
  net: number;
  hours: number;
  vacationHours: number;
  /** The vacation left paid with it (gross öre). */
  vacationPayout?: number;
  /** No hours entered for the month: a normal month (the working time) with the vacation left. */
  assumed?: boolean;
}

/**
 * The forecast of every month entered, by the month it is paid ('2026-10' for
 * September's work): what Översikten and Kassaflöde use for the salary.
 */
export function salaryForecasts(db: Db): Map<string, SalaryForecast> {
  const out = new Map<string, SalaryForecast>();
  const payoutOf = (f: { lines: ModelLine[] }) => f.lines.find((l) => l.code === "semut")?.amount;
  for (const m of listMonths(db)) {
    const f = modelMonth(db, m.month, { ...m, hours: m.effectiveHours, overtimePassHours: m.effectiveOvertimePassHours });
    if (f) {
      out.set(f.payDate.slice(0, 7), { workMonth: m.month, payDate: f.payDate, gross: f.gross, net: f.net, hours: m.effectiveHours, vacationHours: m.vacationHours, vacationPayout: payoutOf(f) });
    }
  }
  // The vacation left lands also when no hours are entered for March: a normal month with it.
  const p = vacationPayout(db);
  if (p && p.amount > 0 && ![...out.values()].some((f) => f.workMonth === p.workMonth)) {
    const c = constantsFor(db, p.workMonth);
    const f = c && modelMonth(db, p.workMonth, { hours: c.hoursPerMonth });
    if (f) {
      out.set(f.payDate.slice(0, 7), { workMonth: p.workMonth, payDate: f.payDate, gross: f.gross, net: f.net, hours: c.hoursPerMonth, vacationHours: 0, vacationPayout: payoutOf(f), assumed: true });
    }
  }
  return out;
}

// ---------- Vacation left at the vacation year's end ----------

/** The vacation year runs 1 April–31 March: the March a work month's year ends with. */
export function vacationYearEnd(month: string): string {
  const y = Number(month.slice(0, 4));
  return `${Number(month.slice(5, 7)) <= 3 ? y : y + 1}-03`;
}

export interface VacationPayout {
  /** The vacation year's last work month (March), the one it is paid with. */
  workMonth: string;
  payDate: string;
  /** The payslip the balance is from, and its 'Kvarv'. */
  source: string;
  sourceMonth: string;
  remaining: number;
  /** Vacation hours entered in Lön after the payslip's month, up to March. */
  planned: number;
  /** To save to the next vacation year (a setting). */
  save: number;
  hours: number;
  rate: number | null;
  amount: number;
  /** Saved hours from earlier years, left ('Sparad semester'): not paid out. */
  savedEarlier: number | null;
}

/**
 * Vacation hours neither taken nor saved by 31 March are paid out in money
 * (the employer's payroll office, not in the agreement's text). From the latest
 * payslip's balance, less what is entered to be taken before then and what is
 * to be saved, at the vacation hourly rate of March. Assumed paid with the
 * salary for March (the April pay day); null once that payslip is in.
 */
export function vacationPayout(db: Db, s = getSalarySettings(db)): VacationPayout | null {
  const slip = db.select().from(payslips).where(isNotNull(payslips.vacationRemaining)).orderBy(desc(payslips.payDate)).get();
  if (!slip?.workMonth || slip.vacationRemaining === null) return null;
  const workMonth = vacationYearEnd(slip.workMonth);
  const payDate = payDateFor(workMonth, s);
  if (payDate <= slip.payDate) return null;
  const planned = round2(
    db
      .select()
      .from(salaryMonths)
      .all()
      .filter((m) => m.month > slip.workMonth! && m.month <= workMonth)
      .reduce((a, m) => a + m.vacationHours, 0),
  );
  const save = s.vacationSave[workMonth] ?? 0;
  const hours = round2(Math.max(0, slip.vacationRemaining - planned - save));
  const rate = constantsFor(db, workMonth)?.vacationHourlyRate ?? slip.vacationHourlyRate ?? null;
  return {
    workMonth,
    payDate,
    source: specName(slip.payDate),
    sourceMonth: slip.workMonth,
    remaining: slip.vacationRemaining,
    planned,
    save,
    hours,
    rate,
    amount: rate ? money(hours, rate) : 0,
    savedEarlier: slip.vacationSaved,
  };
}

// ---------- To-dos ----------

const CHANGES_KEY = "salary_constant_changes";
export type ConstantChange = { month: string; changes: { field: string; from: number | null; to: number | null }[] };

/** New values a payslip brought: kept until looked at (Att göra). */
export const pendingChanges = (db: Db) => getSetting<ConstantChange[]>(db, CHANGES_KEY, []);
export function notePendingChanges(db: Db, changes: ConstantChange[]) {
  if (changes.length) setSetting(db, CHANGES_KEY, [...pendingChanges(db).filter((p) => !changes.some((c) => c.month === p.month)), ...changes]);
}
export const clearPendingChanges = (db: Db, month?: string) => setSetting(db, CHANGES_KEY, month ? pendingChanges(db).filter((p) => p.month !== month) : []);

export function setMonth(db: Db, month: string, b: Record<string, unknown>) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Månaden ska vara ÅÅÅÅ-MM.");
  const n = (k: string) => {
    const v = b[k] ?? 0;
    if (typeof v !== "number" || !(v >= 0 && v <= 400)) throw new Error(`${k} ska vara timmar.`);
    return v;
  };
  const obHours = (b.obHours ?? {}) as Record<string, number>;
  const values = {
    hours: n("hours"),
    vacationHours: n("vacationHours"),
    atfHours: n("atfHours"),
    overtimePassHours: n("overtimePassHours"),
    obHours: JSON.stringify(obHours),
    hoursMode: b.hoursMode === "shifts" ? ("shifts" as const) : ("manual" as const),
    updatedAt: new Date().toISOString(),
  };
  return db.insert(salaryMonths).values({ month, ...values }).onConflictDoUpdate({ target: salaryMonths.month, set: values }).returning().get();
}

export function removeMonth(db: Db, month: string) {
  db.delete(salaryMonths).where(eq(salaryMonths.month, month)).run();
}
