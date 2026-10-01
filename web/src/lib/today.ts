/**
 * Today as 'YYYY-MM-DD' in local time. Not toISOString(), which is UTC: in
 * Sweden that is yesterday from midnight to 01 or 02.
 */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
