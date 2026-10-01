import type { SharedMonth } from "../../api";

/** How a month stands: open, settled even (kvitt), settled and carried over, or settled but the figures have moved since. */
export type SettleState = "open" | "even" | "carried" | "deviates";

/** The shown month's state. */
export function monthState(data: Pick<SharedMonth, "settlement" | "deviates">): SettleState {
  if (!data.settlement) return "open";
  if (data.deviates) return "deviates";
  return data.settlement.carryForward ? "carried" : "even";
}

/** A month in 'Senaste avstämningarna'. */
export const historyState = (h: SharedMonth["history"][number]): SettleState => (h.deviates ? "deviates" : h.status);

/** The pill's words and colours per state; the open one says its month in the hero ('september · öppen'). */
export const STATE_PILL: Record<SettleState, { label: string; className: string }> = {
  open: { label: "öppen", className: "bg-accent-soft text-accent" },
  even: { label: "avstämd, kvitt", className: "bg-positive-soft text-positive-text" },
  carried: { label: "förd över", className: "bg-card-inset text-ink-2" },
  deviates: { label: "avviker", className: "bg-alarm-soft text-caution-text" },
};
