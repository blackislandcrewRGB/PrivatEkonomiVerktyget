import { useEffect, useState } from "react";

/**
 * State kept in localStorage under `key`: remembered across visits in this
 * browser. `parse` turns what is stored back into a value, or null for
 * something it doesn't recognise (the fallback is used). Storage blocked or
 * full: it still works, it just isn't remembered.
 */
export function useLocalStorage<T>(key: string, fallback: T, parse: (stored: unknown) => T | null): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return (raw === null ? null : parse(JSON.parse(raw))) ?? fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not remembered; fine.
    }
  }, [key, value]);
  return [value, setValue];
}
