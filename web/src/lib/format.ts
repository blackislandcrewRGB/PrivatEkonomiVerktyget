/** Narrow no-break space: the thin thousands separator ('1 234,56 kr'). */
const THIN = " ";
const MINUS = "−";

/**
 * Öre as Swedish kronor: '−1 234,56 kr', with a real minus sign and a thin
 * space between thousands. sign: 'always' adds '+' to positive amounts
 * (incomes); whole drops ',00' from whole kronor.
 */
export function formatKr(ore: number, opts: { sign?: "auto" | "always"; whole?: boolean } = {}): string {
  const value = Math.abs(ore) / 100;
  let body = value
    .toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/[\s ]/g, THIN);
  if (opts.whole && body.endsWith(",00")) body = body.slice(0, -3);
  const sign = ore < 0 && Math.round(Math.abs(ore)) !== 0 ? MINUS : ore > 0 && opts.sign === "always" ? "+" : "";
  return `${sign}${body} kr`;
}

const WEEKDAYS = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** '2026-09-16' -> 'Onsdag 16 september' (with the year when it isn't `currentYear`). */
export function longDate(iso: string, currentYear = new Date().getFullYear()): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}${y !== currentYear ? ` ${y}` : ""}`;
}

/** True on a Mac, where shortcuts use ⌘ instead of Ctrl. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
