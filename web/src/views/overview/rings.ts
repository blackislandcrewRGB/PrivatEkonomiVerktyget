/**
 * An activity ring: what was spent against the usual for the same days of
 * the month. A full ring is the usual; past it the ring stays full in its
 * own colour and what is over is drawn as a second lap in red from the top
 * — at most one lap, so twice the usual or more is a full red lap.
 */
export interface Ring {
  /** Spent over the usual, in whole percent; null without a usual to go by. */
  percent: number | null;
  /** The first lap, 0–1. */
  lap: number;
  /** The second, red lap, 0–1. */
  over: number;
}

export function ring(spent: number, usual: number | undefined | null): Ring {
  if (!usual || usual <= 0) return { percent: null, lap: 0, over: 0 };
  const share = Math.max(0, spent) / usual;
  return { percent: Math.round(share * 100), lap: Math.min(1, share), over: Math.min(1, Math.max(0, share - 1)) };
}

/** A stroke-dasharray that draws `fraction` of a circle of radius r from its start. */
export function arc(r: number, fraction: number): string {
  const c = 2 * Math.PI * r;
  return `${(c * fraction).toFixed(2)} ${c.toFixed(2)}`;
}
