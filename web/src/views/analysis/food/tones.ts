/**
 * Mat's pills. A change against last year: up is orange (more spent, or a
 * larger share eaten out), down green, and within the threshold grey.
 */
export type ChangeTone = "up" | "down" | "flat";

export const changeTone = (delta: number, threshold: number): ChangeTone => (Math.abs(delta) <= threshold ? "flat" : delta > 0 ? "up" : "down");

export const CHANGE_CLASS: Record<ChangeTone, string> = {
  up: "bg-caution-soft text-caution-text",
  down: "bg-positive-soft text-positive-text",
  flat: "bg-segment text-ink-2",
};

/** '+2,8' / '−2,8' with one decimal; zero without a sign. */
export const signed = (n: number, digits = 1) => {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const s = Math.abs(r).toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return r > 0 ? `+${s}` : r < 0 ? `−${s}` : s;
};

/**
 * The share eaten out as a tone, by the figure shown (one decimal): under
 * 20 % green, 20 % up to 30 % grey, 30–40 % orange, over 40 % red.
 */
export type ShareTone = "low" | "normal" | "high" | "very-high";

export function shareTone(share: number): ShareTone {
  const p = Math.round(share * 1000) / 10;
  return p < 20 ? "low" : p < 30 ? "normal" : p <= 40 ? "high" : "very-high";
}

/** The tones as token colours: a pill's background and text, for HTML and for SVG. */
export const SHARE_TONE: Record<ShareTone, { className: string; fill: string; text: string; label: string }> = {
  low: { className: "bg-positive-soft text-positive-text", fill: "var(--color-positive-soft)", text: "var(--color-positive-text)", label: "under 20 %" },
  normal: { className: "bg-segment text-ink-2", fill: "var(--color-segment)", text: "var(--color-ink-2)", label: "20–30 %" },
  high: { className: "bg-caution-soft text-caution-text", fill: "var(--color-caution-soft)", text: "var(--color-caution-text)", label: "30–40 %" },
  "very-high": { className: "bg-heat-high text-caution-text", fill: "var(--color-heat-high)", text: "var(--color-caution-text)", label: "över 40 %" },
};

/** '41,9 %', as the tone reads it. */
export const shareText = (share: number) => `${(Math.round(share * 1000) / 10).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
