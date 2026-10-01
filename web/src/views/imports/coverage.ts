import type { ImportCoverage } from "../../api";

export type Health = "ok" | "late" | "overdue" | "none";

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** A month later, the day kept where the month has it: 18/9 → 18/10, 31/1 → 28/2. */
export function addMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** The Swedish date of a timestamp. */
const swedishDate = (ts: string) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

/** Up to which day the account has its rows: the last import, or a later bank fetch that brought nothing new. */
export function coveredTo(c: ImportCoverage): string | null {
  const synced = c.via === "enable_banking" && c.syncedAt ? swedishDate(c.syncedAt) : null;
  return [c.importedTo, synced].filter((x): x is string => !!x).sort().at(-1) ?? null;
}

/** Whether the account is judged by its monthly invoice rather than by days: a credit card brought in by hand. */
export const byInvoice = (c: ImportCoverage) => c.via === "file" && c.kind === "credit_card";

export interface AccountState {
  to: string | null;
  /** Days since `to`. */
  gap: number | null;
  health: Health;
  /** Invoice accounts: when the next invoice is expected. */
  nextInvoice: string | null;
}

/**
 * The status dot. By days (the bank syncs, and bank accounts by hand): green
 * up to 1 day's gap, orange 2–7, red after that. A credit card brought in by
 * hand gets an invoice a month: green until the next one is expected (a
 * month after the last invoice's period), orange for the 7 days after, then red.
 */
export function accountState(c: ImportCoverage, today: string): AccountState {
  const to = coveredTo(c);
  if (!to) return { to: null, gap: null, health: "none", nextInvoice: null };
  const gap = Math.max(0, daysBetween(to, today));
  if (byInvoice(c)) {
    const nextInvoice = c.nextInvoiceTo ?? addMonth(c.lastInvoiceTo ?? to);
    const late = daysBetween(nextInvoice, today);
    return { to, gap, health: late <= 0 ? "ok" : late <= 7 ? "late" : "overdue", nextInvoice };
  }
  return { to, gap, health: gap <= 1 ? "ok" : gap <= 7 ? "late" : "overdue", nextInvoice: null };
}

/** 'inget glapp', '1 dags glapp', '7 dagars glapp'. */
export const gapText = (gap: number) => (gap === 0 ? "inget glapp" : `${gap} ${gap === 1 ? "dags" : "dagars"} glapp`);

/** How the account gets its data, from its configuration. */
export function feedText(c: ImportCoverage): string {
  if (c.via === "enable_banking") return "Enable Banking";
  if (c.source === "mastercard") return "faktura-PDF, manuellt";
  if (c.source === "norwegian") return "XLSX/faktura-PDF, manuellt";
  return "CSV, manuellt";
}
