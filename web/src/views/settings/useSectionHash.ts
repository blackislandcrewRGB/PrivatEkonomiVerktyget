import { useCallback, useEffect, useRef, useState } from "react";
import { SECTIONS, sectionOf, type SectionId } from "./sections";

/**
 * The section in view, kept in the address (#vakt): from the address when the
 * page opens (scrolled to, once it is there), from a click in the nav, and
 * from scrolling. Scrolling replaces the address rather than adding to the
 * history, so Back leaves the page instead of stepping through its sections.
 */
export function useSectionHash() {
  const [active, setActive] = useState<SectionId>(() => sectionOf(window.location.hash) ?? "utseende");
  // While a click's smooth scroll runs, the sections passing by don't take over.
  const going = useRef<number | null>(null);

  const mark = useCallback((id: SectionId) => {
    setActive(id);
    const url = `${window.location.pathname}${window.location.search}#${id}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) window.history.replaceState(null, "", url);
  }, []);

  const go = useCallback(
    (id: SectionId) => {
      mark(id);
      if (going.current) window.clearTimeout(going.current);
      going.current = window.setTimeout(() => (going.current = null), 800);
      document.getElementById(id)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    },
    [mark],
  );

  // The address's section, once its card has come (cards wait for their
  // data), and again while the cards above it come in and push it down —
  // until the page has settled or you scroll yourself.
  useEffect(() => {
    const id = sectionOf(window.location.hash);
    if (!id) return;
    let stopped = false;
    const stop = () => (stopped = true);
    const events = ["wheel", "touchmove", "keydown", "mousedown"] as const;
    events.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    const timers: number[] = [];
    const at = (ms: number) =>
      timers.push(
        window.setTimeout(() => {
          const el = document.getElementById(id);
          if (stopped || !el) return;
          mark(id);
          going.current = window.setTimeout(() => (going.current = null), 400);
          el.scrollIntoView?.({ block: "start" });
        }, ms),
      );
    [0, 150, 400, 800, 1500, 2500].forEach(at);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      events.forEach((e) => window.removeEventListener(e, stop));
    };
  }, [mark]);

  // Scrolling: the topmost section in the upper part of the window.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        if (going.current) return;
        const first = SECTIONS.find((s) => seen.get(s.id));
        if (first) mark(first.id);
      },
      { rootMargin: "-15% 0px -60% 0px" },
    );
    const observe = () => SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    observe();
    // Cards come in as their data does.
    const again = window.setTimeout(observe, 1500);
    return () => {
      window.clearTimeout(again);
      io.disconnect();
    };
  }, [mark]);

  return { active, go };
}
