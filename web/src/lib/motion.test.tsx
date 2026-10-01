import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { DURATION, STAGGER, STAGGER_MAX, staggerDelay, useListEntrance, useMotionOn, useTransition } from "./motion";

/** Answers the reduced-motion query with `on`, leaving other queries as they were. */
function reducedMotion(on: boolean) {
  const real = window.matchMedia;
  vi.stubGlobal("matchMedia", (query: string) =>
    query.includes("prefers-reduced-motion") ? { ...real(query), matches: on } : real(query),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("motion presets", () => {
  it("gives each preset its own length, ease-out throughout", () => {
    reducedMotion(false);
    const { result } = renderHook(() => [useTransition("micro"), useTransition("number"), useTransition("layout")] as const);
    expect(result.current.map((t) => t.duration)).toEqual([DURATION.micro, DURATION.number, DURATION.layout]);
    expect(result.current.every((t) => t.ease === "easeOut")).toBe(true);
  });

  it("moves nothing when the system asks for less motion", () => {
    reducedMotion(true);
    const { result } = renderHook(() => ({ transition: useTransition("layout"), on: useMotionOn() }));
    expect(result.current.transition).toEqual({ duration: 0 });
    expect(result.current.on).toBe(false);
  });

  it("staggers the first rows only, and not at all when motion is off", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(4)).toBeCloseTo(0.1);
    expect(staggerDelay(STAGGER_MAX)).toBe(0);
    expect(staggerDelay(3, false)).toBe(0);
  });
});

describe("a list coming in", () => {
  it("fades and rises the first rows, staggered, and lets the rest appear at once", () => {
    reducedMotion(false);
    const { result } = renderHook(() => useListEntrance("september"));
    const first = result.current(0);
    expect(first.initial).toEqual({ opacity: 0, y: 4 });
    expect(first.animate).toEqual({ opacity: 1, y: 0 });
    expect(result.current(3).transition).toMatchObject({ delay: 3 * STAGGER, duration: DURATION.layout });
    expect(result.current(STAGGER_MAX)).toEqual({});
  });

  it("does nothing when the system asks for less motion", () => {
    reducedMotion(true);
    const { result } = renderHook(() => useListEntrance("september"));
    expect(result.current(0)).toEqual({});
  });

  it("only animates for a while after what the list shows changed", () => {
    reducedMotion(false);
    const { result, rerender } = renderHook(({ key }: { key: string }) => useListEntrance(key), { initialProps: { key: "september" } });
    expect(result.current(0).initial).toBeDefined();
    // A row that mounts long afterwards (scrolling a virtualised list) gets nothing.
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 5000);
    rerender({ key: "september" });
    expect(result.current(0)).toEqual({});
    // A new month starts the entrance over.
    rerender({ key: "oktober" });
    expect(result.current(0).initial).toBeDefined();
  });
});
