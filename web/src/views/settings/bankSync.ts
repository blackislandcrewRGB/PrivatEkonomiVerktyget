import { sendJson, type Account, type BankConnection, type BankStatus, type BankSyncReport } from "../../api";

/** Syncs (after a preview the first time, when nothing has been fetched yet). */
export async function syncNow(opts: { dryRun?: boolean } = {}): Promise<BankSyncReport> {
  return sendJson<BankSyncReport>("POST", "/enable-banking/sync", { dryRun: opts.dryRun === true });
}

/** Never synced accounts: the first sync is previewed (how many rows get linked to what the files brought in). */
export const needsPreview = (s: BankStatus) => s.connections.some((c) => c.status === "active" && c.accounts.some((a) => a.accountId !== null && !a.lastBookingDate));

/** A consent this close to its end (days) is shown in orange and badged. */
export const CONSENT_WARN_DAYS = 30;

/** '25 sep'. */
export const dayMonth = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(".", "");
/** '18 mars 2027'. */
export const longDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });

export type LinkTone = "green" | "orange" | "red" | "grey";
export interface LinkState {
  tone: LinkTone;
  label: string;
  sub: string;
  connection: BankConnection | null;
}

/**
 * How an account gets its rows: from Enable Banking (active, its consent
 * running out within 30 days, or run out or failing) or by hand (files,
 * the Mastercard's invoice PDF).
 */
export function linkState(a: Pick<Account, "id" | "source">, status: BankStatus | null): LinkState {
  const c = status?.connections.find((x) => x.accounts.some((b) => b.accountId === a.id)) ?? null;
  const link = c?.accounts.find((b) => b.accountId === a.id);
  if (!c || !link) return { tone: "grey", label: "manuell", sub: a.source === "mastercard" ? "faktura-PDF eller för hand" : "fil eller för hand", connection: null };
  const fetched = link.lastBookingDate ? `hämtat t.o.m. ${dayMonth(link.lastBookingDate)}` : "inte synkat än";
  const pending = link.pending.count > 0 ? ` · ${link.pending.count} ${link.pending.count === 1 ? "reserverad" : "reserverade"} räknas inte` : "";
  if (c.status === "expired" || c.status === "revoked" || (c.daysLeft !== null && c.daysLeft < 0))
    return { tone: "red", label: "Enable Banking · samtycket har gått ut", sub: `${fetched} · förnya samtycket`, connection: c };
  if (c.status === "error") return { tone: "red", label: "Enable Banking · fel", sub: c.lastError ?? fetched, connection: c };
  if (c.status === "pending") return { tone: "grey", label: "Enable Banking · väntar", sub: "samtycket är inte klart", connection: c };
  if (c.daysLeft !== null && c.daysLeft <= CONSENT_WARN_DAYS)
    return { tone: "orange", label: `Enable Banking · går ut om ${c.daysLeft} ${c.daysLeft === 1 ? "dag" : "dagar"}`, sub: `${fetched}${pending}`, connection: c };
  return { tone: "green", label: "Enable Banking · aktiv", sub: `${fetched}${pending}`, connection: c };
}

/** What waits under Konton: consents running out or gone, a failing sync, a bank account feeding no account here. */
export function accountsWaiting(status: BankStatus | null): number {
  if (!status) return 0;
  return status.connections.reduce(
    (n, c) =>
      n +
      (c.status === "expired" || c.status === "revoked" || c.status === "error" || c.lastError || (c.daysLeft !== null && c.daysLeft <= CONSENT_WARN_DAYS) ? 1 : 0) +
      c.accounts.filter((a) => a.accountId === null).length,
    0,
  );
}
