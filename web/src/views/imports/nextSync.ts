import type { BankConnection } from "../../api";

const pad = (h: number) => String(h).padStart(2, "0");

/** The hour in Stockholm, whatever time zone the browser is in (and across the summer time switch). */
function stockholmHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Stockholm" }).format(now));
}

/**
 * The next scheduled bank sync after `now`, in Swedish time: 'i dag 18:00'
 * or, after the last one of the day, 'i morgon 06:00'. A run's own hour
 * counts as done (it is running or has run), as on the server.
 */
export function nextSync(now: Date, hours: readonly number[]): { day: "i dag" | "i morgon"; time: string } | null {
  if (hours.length === 0) return null;
  const sorted = [...hours].sort((a, b) => a - b);
  const hour = stockholmHour(now);
  const next = sorted.find((h) => h > hour);
  return next === undefined ? { day: "i morgon", time: `${pad(sorted[0])}:00` } : { day: "i dag", time: `${pad(next)}:00` };
}

/** 'kl 06, 12 och 18'. */
export function hoursText(hours: readonly number[]): string {
  const h = [...hours].sort((a, b) => a - b).map(pad);
  return `kl ${h.length > 1 ? `${h.slice(0, -1).join(", ")} och ${h[h.length - 1]}` : h[0]}`;
}

/** Days before the consent runs out that the header warns instead of telling the next sync. */
export const CONSENT_HEADER_DAYS = 30;

/** The connection whose consent runs out first, when that is within 30 days (or already has). */
export function expiringConsent(connections: BankConnection[]): BankConnection | null {
  const soon = connections
    .filter((c) => c.validUntil && c.daysLeft !== null && (c.status === "expired" || c.daysLeft <= CONSENT_HEADER_DAYS))
    .sort((a, b) => a.validUntil!.localeCompare(b.validUntil!));
  return soon[0] ?? null;
}
