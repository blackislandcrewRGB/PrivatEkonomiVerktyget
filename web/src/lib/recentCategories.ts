const KEY = "privatekonomi.recentCategories";
const MAX = 5;

/** The categories picked most recently in this browser, newest first. */
export function recentCategories(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberCategory(id: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...recentCategories().filter((x) => x !== id)].slice(0, MAX)));
  } catch {
    // Not remembered; fine.
  }
}
