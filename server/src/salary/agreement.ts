import { addDays } from "../overview/dates.js";

/**
 * The terms of the employment agreement that the payslips don't always show:
 * OB per hour, the hour limits for overtime, the notice for the work schedule.
 * They differ between agreements, so none is built in: they are entered in
 * Inställningar › Lön (the settings below, empty from the start) and the
 * rest of the model follows them. OB rates also come from the payslips.
 */

export interface AgreementRate {
  /** The work month it holds from (YYYY-MM). */
  from: string;
  /** Öre per hour. */
  rate: number;
}

/** OB per hour by löneart ('150'): the name and the rates, each from a work month. */
export type ObLevels = Record<string, { name: string; rates: AgreementRate[] }>;

/** The löneart codes OB levels use on the payslips ('150', '151', '15h'). */
export const OB_CODES = /^15[0-9a-z]$/;

/** The amount holding for a work month: the latest from it or before, or none before the first. */
export function rateFor(rates: AgreementRate[], month: string): AgreementRate | null {
  return rates.filter((r) => r.from <= month).sort((a, b) => b.from.localeCompare(a.from))[0] ?? null;
}

/** 'fr o m 1/6 2026'. */
export const fromText = (month: string) => `fr o m 1/${Number(month.slice(5, 7))} ${month.slice(0, 4)}`;

/** Checks and cleans OB levels from the settings form; throws the message to show. */
export function validateObLevels(value: unknown): ObLevels {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("OB-nivåerna ska vara en lista.");
  const out: ObLevels = {};
  for (const [code, level] of Object.entries(value as Record<string, unknown>)) {
    const l = level as { name?: unknown; rates?: unknown };
    if (!OB_CODES.test(code)) throw new Error(`Lönearten ${code} ska vara 15 följt av en siffra eller bokstav, till exempel 150.`);
    if (typeof l?.name !== "string" || !l.name.trim()) throw new Error(`OB-nivån ${code} behöver ett namn.`);
    if (!Array.isArray(l.rates)) throw new Error(`OB-nivån ${code} behöver minst en sats.`);
    const rates = l.rates.map((r: { from?: unknown; rate?: unknown }) => {
      if (typeof r?.from !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.from)) throw new Error(`OB-nivån ${code}: månaden ska vara ÅÅÅÅ-MM.`);
      if (typeof r.rate !== "number" || !Number.isInteger(r.rate) || r.rate <= 0 || r.rate > 100_000) throw new Error(`OB-nivån ${code}: satsen ska vara öre per timme.`);
      return { from: r.from, rate: r.rate };
    });
    if (new Set(rates.map((r) => r.from)).size !== rates.length) throw new Error(`OB-nivån ${code} har två satser från samma månad.`);
    out[code] = { name: l.name.trim(), rates: rates.sort((a, b) => a.from.localeCompare(b.from)) };
  }
  return out;
}

/** The last day the schedule for a month is due: its first day minus the notice ('2026-11', 6 → '2026-10-26'). */
export const scheduleDeadline = (month: string, noticeDays: number) => addDays(`${month}-01`, -noticeDays);
