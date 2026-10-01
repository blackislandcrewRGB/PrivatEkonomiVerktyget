import { useSyncExternalStore } from "react";

// The 'nav' breakpoint (index.css): under 900 px the layout is for phones.
const QUERY = "(max-width: 56.249rem)";

const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null);

/** True under 900 px (the tab bar layout): tables render as card lists. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = media();
      m?.addEventListener("change", l);
      return () => m?.removeEventListener("change", l);
    },
    () => media()?.matches ?? false,
    () => false,
  );
}
