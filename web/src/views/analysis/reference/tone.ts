import type { ReferenceDiff } from "../../../api";

/**
 * A difference against the reference as a tone: over orange, under green,
 * none grey. By the kronor, whole: a krona either way is nothing.
 */
export type RefTone = "over" | "under" | "even";
export const refTone = (d: ReferenceDiff | null): RefTone => {
  const kr = d?.ore == null ? 0 : Math.round(d.ore / 100);
  return kr > 0 ? "over" : kr < 0 ? "under" : "even";
};

export const TONE = {
  over: { text: "text-caution-text", soft: "bg-caution-soft", pill: "bg-caution-soft text-caution-text", bar: "bg-caution" },
  under: { text: "text-positive-text", soft: "bg-positive-soft", pill: "bg-positive-soft text-positive-text", bar: "bg-positive" },
  even: { text: "text-ink-2", soft: "bg-card-inset", pill: "bg-segment text-ink-2", bar: "bg-neutral-bar" },
} as const;
