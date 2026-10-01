import { useEffect, useRef } from "react";

/** True while the user is typing in a field (single-key shortcuts must not fire then). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/**
 * Matches 'mod+k', 'ctrl+1', '?', 'shift+x'. 'mod' is ⌘ on a Mac and Ctrl
 * elsewhere; both ⌘ and Ctrl are accepted for it so it works either way.
 */
export function matchesHotkey(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const want = new Set(parts);
  const mod = e.metaKey || e.ctrlKey;
  if (want.has("mod") ? !mod : want.has("ctrl") ? !e.ctrlKey : want.has("meta") ? !e.metaKey : mod) return false;
  if (want.has("alt") !== e.altKey) return false;
  // '?' needs shift on most layouts; only check shift when asked for letters.
  if (want.has("shift") && !e.shiftKey) return false;
  if (!want.has("shift") && e.shiftKey && /^[a-z0-9]$/.test(key)) return false;
  const pressed = e.key.toLowerCase();
  // Digits by code, so ⌃1 works whatever the layout makes of it.
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || pressed === key;
  return pressed === key;
}

/**
 * Global keyboard shortcuts. Combos without a modifier are ignored while a
 * field has focus.
 */
export function useHotkeys(bindings: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      for (const [combo, fn] of Object.entries(ref.current)) {
        const hasModifier = /(^|\+)(mod|ctrl|meta|alt)\+/.test(combo);
        if (!hasModifier && isTyping(e.target)) continue;
        if (matchesHotkey(e, combo)) {
          e.preventDefault();
          fn(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
