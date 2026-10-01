import { useSyncExternalStore } from "react";
import { getJson, type ReviewCounts } from "../api";

// 'Att granska' count for the sidebar badge. Refreshed on start, when the
// window gets focus again, and whenever a view calls refreshBadges().
let toReview: number | null = null;
const listeners = new Set<() => void>();

export function refreshBadges() {
  getJson<ReviewCounts>("/review/counts").then(
    (c) => {
      toReview = c.uncategorized + c.duplicates;
      listeners.forEach((l) => l());
    },
    () => {},
  );
}

export function useReviewCount(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toReview,
  );
}
