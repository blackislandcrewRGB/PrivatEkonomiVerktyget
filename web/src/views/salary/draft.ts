import type { SalaryMonth } from "../../api";
import { h, num } from "./format";

/** The form's work month as typed. */
export interface Draft {
  /** Empty until the months are in: then the first missing one. */
  month: string;
  /** 'shifts': hours from Pendling's shifts × hours per shift. */
  hoursMode: "manual" | "shifts";
  hours: string;
  vacationHours: string;
  atfHours: string;
  overtimePassHours: string;
  ob: Record<string, string>;
}

export const emptyDraft = (month = ""): Draft => ({ month, hoursMode: "manual", hours: "", vacationHours: "", atfHours: "", overtimePassHours: "", ob: {} });

/** An entered month back in the form (Ändra). */
export const draftOf = (m: SalaryMonth): Draft => ({
  month: m.month,
  hoursMode: m.hoursMode,
  hours: h(m.hours),
  vacationHours: m.vacationHours ? h(m.vacationHours) : "",
  atfHours: m.atfHours ? h(m.atfHours) : "",
  overtimePassHours: m.overtimePassHours ? h(m.overtimePassHours) : "",
  ob: Object.fromEntries(Object.entries(m.obHours).map(([k, v]) => [k, h(v)])),
});

/** The draft as the API takes it; from the shifts, the hours are the shifts × hours per shift. */
export const toInput = (d: Draft, fromShifts: number | null, overtimeFromDays: number | null) => ({
  month: d.month,
  hoursMode: d.hoursMode,
  hours: d.hoursMode === "shifts" && fromShifts !== null ? fromShifts : num(d.hours),
  vacationHours: num(d.vacationHours),
  atfHours: num(d.atfHours),
  overtimePassHours: d.hoursMode === "shifts" && fromShifts !== null && overtimeFromDays !== null ? overtimeFromDays : num(d.overtimePassHours),
  obHours: Object.fromEntries(Object.entries(d.ob).map(([k, v]) => [k, num(v)]).filter(([, v]) => (v as number) > 0)),
});
