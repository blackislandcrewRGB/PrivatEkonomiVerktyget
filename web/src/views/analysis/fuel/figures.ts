import type { FuelMonth } from "../../../api";

/** The gauge: the table value stands at three quarters of the track, so a consumption over it still shows. */
export const GAUGE_MARK = 0.75;

/** l/100 km with one decimal. */
export const l100Text = (v: number | null) => (v === null ? "–" : v.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/**
 * A consumption against the table value, by the figures shown (one
 * decimal): under it green, over it orange, the same grey.
 */
export type ConsumptionTone = "under" | "over" | "same";
export function consumptionTone(l100: number, base: number): ConsumptionTone {
  const a = Math.round(l100 * 10);
  const b = Math.round(base * 10);
  return a < b ? "under" : a > b ? "over" : "same";
}
export const TONE_CLASS: Record<ConsumptionTone, string> = {
  under: "bg-positive-soft text-positive-text",
  over: "bg-caution-soft text-caution-text",
  same: "bg-segment text-ink-2",
};

/**
 * Bränsle's key figures, from the table's months: the fuel bought and per
 * month with a fill-up; per shift (the months that have one) with their
 * shifts and km; the average l/100 km against the table value, and the
 * gauge; the fill-ups marked as trips, which are left out, and their months.
 */
export function fuelFigures(months: FuelMonth[], base: number) {
  const spent = months.reduce((s, m) => s + m.spent, 0);
  const filled = months.filter((m) => m.spent > 0);
  const withShifts = months.filter((m) => m.perShift !== null);
  const measured = months.filter((m) => m.l100 !== null);
  const avgL100 = measured.length ? measured.reduce((s, m) => s + m.l100!, 0) / measured.length : null;
  const trips = months.filter((m) => m.trips > 0);
  return {
    spent,
    filledMonths: filled.length,
    perMonth: filled.length ? spent / filled.length : null,
    perShift: withShifts.length ? withShifts.reduce((s, m) => s + m.perShift!, 0) / withShifts.length : null,
    shiftMonths: withShifts.length,
    shifts: withShifts.reduce((s, m) => s + (m.shifts ?? 0), 0),
    km: withShifts.reduce((s, m) => s + (m.km ?? 0), 0),
    avgL100,
    diff: avgL100 === null ? null : Math.round(avgL100 * 10) / 10 - Math.round(base * 10) / 10,
    tone: avgL100 === null ? null : consumptionTone(avgL100, base),
    /** The gauge's fill, 0–1, with the table value at GAUGE_MARK. */
    fill: avgL100 === null || base <= 0 ? 0 : Math.min(1, (avgL100 / base) * GAUGE_MARK),
    trips: trips.reduce((s, m) => s + m.trips, 0),
    tripMonths: trips.map((m) => m.month),
  };
}

/** 'juli och augusti', 'juli, augusti och september'; with the year when they span more than one. */
export function monthList(months: string[]): string {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  const names = months.map((m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", years.size > 1 ? { month: "long", year: "numeric" } : { month: "long" }));
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} och ${names.at(-1)}`;
}
