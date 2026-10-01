/** Where the month's fuel stands against what was reckoned. */
export type GaugeState = "under" | "exact" | "over";

/**
 * The fuel gauge: the green share is what was bought of what was reckoned
 * (öre), full when it is more. Compared in whole kronor, so 1 711,40 kr
 * bought of 1 711,00 kr is exact.
 */
export function fuelGauge(spent: number, expected: number): { state: GaugeState; share: number; left: number; over: number } {
  const s = Math.round(spent / 100);
  const e = Math.round(expected / 100);
  const state: GaugeState = s < e ? "under" : s === e ? "exact" : "over";
  return {
    state,
    share: e <= 0 ? (s > 0 ? 1 : 0) : Math.min(1, s / e),
    left: Math.max(0, e - s) * 100,
    over: Math.max(0, s - e) * 100,
  };
}
