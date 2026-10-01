import { useEffect, useState } from "react";

// Kept in memory for the session (survives switching tabs), mirrored to
// sessionStorage so a reload keeps it too when storage is available.
const memory = new Map<string, unknown>();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function read<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw !== null) {
      const stored: unknown = JSON.parse(raw);
      // An object is merged onto the default, so a new field added later gets
      // its default value. Anything else (a string, a number) is the value
      // itself — spreading a string would turn it into a map of its letters.
      return (isRecord(fallback) && isRecord(stored) ? { ...fallback, ...stored } : stored) as T;
    }
  } catch {
    // Storage blocked or corrupt: use the default.
  }
  return fallback;
}

export function usePersistentState<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    memory.set(key, value);
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not persisted beyond this page load; fine.
    }
  }, [key, value]);
  return [value, setValue];
}

/**
 * Forgets what this session remembers. Only tests need it; a page load starts
 * empty anyway.
 *
 * sessionStorage is cleared as well: it outlives a test in jsdom, so a tab
 * chosen in one test would still be chosen in the next, and the failure lands
 * somewhere far from the cause.
 */
export function clearPersistentState(): void {
  memory.clear();
  try {
    sessionStorage.clear();
  } catch {
    // Storage blocked: nothing to forget.
  }
}

/** Set a persisted value from outside its component (e.g. preset filters before navigating). */
export function presetPersistentState<T>(key: string, value: T): void {
  memory.set(key, value);
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // In memory only.
  }
}
