/**
 * How a month stands against its category's average over the period:
 * under 80 % 'under', 120–200 % 'over', over 200 % 'far'; in between, an
 * empty month, a refund (below zero) or no average: no tone.
 */
export type Heat = "under" | "over" | "far" | null;

export function heat(value: number, average: number): Heat {
  if (value <= 0 || average <= 0) return null;
  const r = value / average;
  if (r < 0.8) return "under";
  if (r > 2) return "far";
  if (r >= 1.2) return "over";
  return null;
}

export const HEAT_CLASS: Record<Exclude<Heat, null>, string> = {
  under: "bg-positive-soft",
  over: "bg-caution-soft",
  far: "bg-heat-high text-caution-text",
};
