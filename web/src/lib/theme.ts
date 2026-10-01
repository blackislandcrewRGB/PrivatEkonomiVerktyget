import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "privatekonomi.theme";
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Storage blocked: follow the system.
  }
  return "system";
}

let preference: ThemePreference = readPreference();
const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;

export function resolvedTheme(pref: ThemePreference = preference): "light" | "dark" {
  return pref === "system" ? (media?.matches ? "dark" : "light") : pref;
}

/** Puts the 'dark' class on <html> when the resolved theme is dark. */
export function applyTheme() {
  document.documentElement.classList.toggle("dark", resolvedTheme() === "dark");
}

export function setThemePreference(pref: ThemePreference) {
  preference = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Kept for this page load only.
  }
  applyTheme();
  listeners.forEach((l) => l());
}

media?.addEventListener?.("change", () => {
  if (preference === "system") {
    applyTheme();
    listeners.forEach((l) => l());
  }
});

/** The chosen theme ('Följ systemet', 'Ljust', 'Mörkt'), stored per browser. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => preference,
  );
}

/** The theme in effect ('light' or 'dark'), following the system when that is chosen. */
export function useResolvedTheme(): "light" | "dark" {
  return resolvedTheme(useThemePreference());
}
