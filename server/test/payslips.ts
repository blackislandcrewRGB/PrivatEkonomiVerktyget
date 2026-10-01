import fs from "node:fs";
import path from "node:path";
import type { Db } from "../src/db/client.js";
import { setSetting } from "../src/settings.js";

/**
 * Fictional payslips ('Exempelbolaget AB', 'Kim Exempel') in the layout the
 * parser reads. 2603: an hourly month (the pay day 25 March, February's work)
 * with OB and ATF, no monthly salary. 2607: a monthly-salary month (the pay day
 * 24 July, June's work) with 17,5 hours of mertid.
 */
export const PAYSLIPS_DIR = path.resolve(import.meta.dirname, "fixtures/payslips");
export const readPayslip = (name: "Lonespec_2603.htm" | "Lonespec_2607.htm") => fs.readFileSync(path.join(PAYSLIPS_DIR, name), "utf8");
export const MARCH = readPayslip("Lonespec_2603.htm");
export const JULY = readPayslip("Lonespec_2607.htm");

/** An example agreement, entered the way a user does in Inställningar › Lön: OB per level, hour limits, the quarter rule and the schedule notice. */
export const EXAMPLE_AGREEMENT = {
  obLevels: {
    "150": { name: "Kväll/natt 18–06", rates: [{ from: "2025-06", rate: 2587 }, { from: "2026-06", rate: 2662 }] },
    "151": { name: "Helg dag 06–18", rates: [{ from: "2025-06", rate: 3932 }, { from: "2026-06", rate: 4046 }] },
    "15h": { name: "Helgnatt 18–06", rates: [{ from: "2025-06", rate: 4414 }, { from: "2026-06", rate: 4542 }] },
    "152": { name: "Storhelg", rates: [{ from: "2025-06", rate: 7643 }, { from: "2026-06", rate: 7865 }] },
    "15e": { name: "Nyårs-, midsommar- och julafton", rates: [{ from: "2025-06", rate: 17128 }, { from: "2026-06", rate: 17625 }] },
  },
  shiftLimit: 13,
  weekLimit: 52,
  quarterOvertime: true,
  scheduleNoticeDays: 6,
};

/**
 * The salary settings the tests are written against, set explicitly so they
 * do not depend on the defaults, with the example agreement. Not the lag: it
 * is read off the payslips.
 */
export function pinSalarySettings(db: Db) {
  setSetting(db, "salary_settings", { payDay: 25, fullTimeHours: 165.6, taxTable: 32, taxColumn: 1, taxYear: null, shiftHours: 10.5, vacationSave: {}, ...EXAMPLE_AGREEMENT });
}
