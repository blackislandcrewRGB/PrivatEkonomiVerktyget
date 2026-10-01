import { useEffect, useState } from "react";

/**
 * An element's width as it changes, through a callback ref (the element may
 * come and go). `fallback` until it is measured, and where ResizeObserver is
 * missing (tests).
 */
export function useWidth<T extends HTMLElement = HTMLDivElement>(fallback: number) {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, fallback]);
  return [setEl, width] as const;
}
