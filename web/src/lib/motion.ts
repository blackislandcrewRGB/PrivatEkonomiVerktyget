import { useRef, useState, useSyncExternalStore } from "react";
import type { MotionProps, Transition } from "motion/react";

/**
 * Shared motion settings. Animation here is meant to show *what happened* —
 * a value changed, a row moved, something was removed — never to decorate,
 * so nothing animates unless the user did something.
 *
 * Three lengths, ease-out throughout (movement starts fast and settles):
 * - `micro` for hover, press and colour changes;
 * - `number` for a figure counting to its new value;
 * - `layout` for a row sliding to its new place, or a list appearing.
 *
 * Everything goes through `useTransition`, which returns an instant
 * transition when the system asks for less motion (the CSS in index.css does
 * the same for plain transitions and keyframes).
 */

export type MotionPreset = "micro" | "number" | "layout";

/** Seconds, as Motion counts them. */
export const DURATION: Record<MotionPreset, number> = { micro: 0.18, number: 0.4, layout: 0.3 };

/** One step per 25 ms in a staggered list, and never more rows than this animated. */
export const STAGGER = 0.025;
export const STAGGER_MAX = 15;

export const TRANSITION: Record<MotionPreset, Transition> = {
  micro: { duration: DURATION.micro, ease: "easeOut" },
  number: { duration: DURATION.number, ease: "easeOut" },
  layout: { duration: DURATION.layout, ease: "easeOut" },
};

/** No movement at all: the end state, at once. */
export const INSTANT: Transition = { duration: 0 };

const QUERY = "(prefers-reduced-motion: reduce)";
const media = () => (typeof window === "undefined" ? undefined : window.matchMedia?.(QUERY));

function listen(onChange: () => void) {
  const m = media();
  m?.addEventListener?.("change", onChange);
  return () => m?.removeEventListener?.("change", onChange);
}

/**
 * Does the system ask for less motion? Read live (not cached at start-up), so
 * turning it on in the system settings takes effect at once.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    listen,
    () => media()?.matches ?? false,
    () => false,
  );
}

/** The transition for one preset, or an instant one when the user asked for less motion. */
export function useTransition(preset: MotionPreset): Transition {
  return usePrefersReducedMotion() ? INSTANT : TRANSITION[preset];
}

/**
 * Whether to move at all. Components that would otherwise fade or slide in
 * use this to render their end state directly.
 */
export function useMotionOn(): boolean {
  return !usePrefersReducedMotion();
}

/** The delay of row number `i` in a staggered list; rows past the first few appear at once. */
export const staggerDelay = (i: number, on = true) => (on && i < STAGGER_MAX ? i * STAGGER : 0);

/**
 * How long after a list changed its rows may still animate in. Covers the
 * whole staggered entrance (the last row starts at STAGGER_MAX × STAGGER and
 * takes `layout` to finish) with a little room for a slow render.
 */
const ENTRANCE_WINDOW_MS = 900;

/** Fade and a 4 px rise: the entrance of one row. */
const ENTRANCE: Pick<MotionProps, "initial" | "animate"> = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } };

/**
 * Rows fade and rise when a list first appears and when what it shows changes
 * — a new month, a new filter — but never while scrolling. `key` is what the
 * list is showing; when it changes, rows animate in for as long as the
 * entrance lasts. The transaction list is virtualised, so rows that mount
 * later (scrolling, or a row being re-used) fall outside that window and
 * appear at once, which is what you want: nothing animates unless something
 * happened.
 */
export function useListEntrance(key: string): (index: number) => Partial<MotionProps> {
  const on = useMotionOn();
  const state = useRef({ key: "", at: 0 });
  if (state.current.key !== key) state.current = { key, at: performance.now() };
  const at = state.current.at;
  return (index: number) => {
    if (!on || index >= STAGGER_MAX || performance.now() - at > ENTRANCE_WINDOW_MS) return {};
    return { ...ENTRANCE, transition: { ...TRANSITION.layout, delay: staggerDelay(index) } };
  };
}

/**
 * A row on its way out: it collapses and fades instead of vanishing. The list
 * reloads when it is gone (see COLLAPSE_MS), so the rows below slide up once.
 */
export const COLLAPSE_MS = Math.round(DURATION.layout * 1000);
export const collapsing: Partial<MotionProps> = { animate: { height: 0, opacity: 0 }, style: { overflow: "hidden" } };

/**
 * The entrance props for one row, frozen for as long as the row is mounted.
 * A component that renders its own element (a table row, say) uses this; the
 * `Entering` component does the same for rows written inline in a list.
 */
export function useEntrance(entrance: (index: number) => Partial<MotionProps>, index: number): Partial<MotionProps> {
  const [props] = useState(() => entrance(index));
  return props;
}
