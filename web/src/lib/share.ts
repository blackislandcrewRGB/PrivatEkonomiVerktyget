import { useSyncExternalStore } from "react";

/** Whose money the numbers show: my part (shared at half) or the whole household. */
export type Share = "mine" | "household";

export const SHARE_OPTIONS: { value: Share; label: string }[] = [
  { value: "mine", label: "Min del" },
  { value: "household", label: "Hushållet" },
];

// One switch for the whole app (Översikt, Analys), remembered in the browser.
const KEY = "privatekonomi.share";
const listeners = new Set<() => void>();

function initial(): Share {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "mine" || v === "household") return v;
    // The earlier per-session setting.
    if (JSON.parse(sessionStorage.getItem("overview.view") ?? "{}").household === true) return "household";
  } catch {
    // Storage blocked: the default.
  }
  return "mine";
}

let current: Share | null = null;

export function getShare(): Share {
  return (current ??= initial());
}

export function setShare(v: Share) {
  current = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Kept for this page load only.
  }
  listeners.forEach((l) => l());
}

export function useShare(): [Share, (v: Share) => void] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getShare,
  );
  return [v, setShare];
}
