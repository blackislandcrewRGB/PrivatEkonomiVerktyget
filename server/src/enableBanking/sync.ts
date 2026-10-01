import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, bankAccounts, bankConnections, bankPending, transactions } from "../db/schema.js";
import { runImport, type CoreResult } from "../import/importCore.js";
import { normalizeForMatch } from "../import/matchKey.js";
import { maskLongNumbers, parseAmountToOre } from "../import/text.js";
import { pairUnreferencedTransfers } from "../transfers/transfers.js";
import { addDays, daysBetween, todayLocal } from "../overview/dates.js";
import { getSetting, setSetting } from "../settings.js";
import { sendNtfy } from "../notify.js";
import { EbApiError, type EbBalance, type EbClient, type EbSettings, type EbTransaction, type EbTransactionsPage, type PsuHeaders } from "./client.js";
import { mapTransaction, withKeys, type MappedRow } from "./map.js";

/**
 * Sync: per connected account, the transactions since the latest booking date
 * fetched minus 7 days (the overlap catches late bookings; the first time as
 * far back as the bank allows), page by page, and the balance. Booked rows go
 * through the same import as the files (rules, transfers, fixed expenses, and
 * linking to rows a file already brought in). Pending rows are kept aside,
 * never in sums. Errors and a consent running out (under 14 days) are noted on
 * the connection and sent to ntfy.
 */

export const OVERLAP_DAYS = 7;

/**
 * The schedule, in Swedish time. Swedbank allows four fetches a day per
 * consent and service (transactions, balances) without the user present, and
 * a *Synka nu* from localhost counts as one of them — the dev server's proxy
 * gives the backend no address of the user to pass on. Three runs leave the
 * fourth for the button; four left none (seen 2026-09-20: 00, 06, a manual
 * sync at 09:48 and 12 used the day, and 18:00 was refused).
 */
export const SYNC_HOURS = [6, 12, 18] as const;
export const SYNC_CRON = `0 ${SYNC_HOURS.join(",")} * * *`;

/** The next scheduled run after `now`, as 'kl. 12' or 'i morgon kl. 06'. */
export function nextSyncText(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Stockholm" }).format(now));
  const next = SYNC_HOURS.find((h) => h > hour);
  const pad = (h: number) => String(h).padStart(2, "0");
  return next === undefined ? `i morgon kl. ${pad(SYNC_HOURS[0])}` : `kl. ${pad(next)}`;
}

/** An IBAN anywhere in a text: 'SE21 8000 0820 …' or run together. */
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[0-9A-Z]{4}){2,7}(?:[ ]?[0-9A-Z]{1,4})?\b/g;

/** Account numbers masked to their last four digits: the bank's error texts carry whole IBANs. */
export function maskAccountText(text: string): string {
  return maskLongNumbers(text.replace(IBAN, (m) => `••${m.replace(/\D/g, "").slice(-4)}`));
}

/**
 * What a failed call says, in Swedish where it is one we know, and never with
 * an account number in it — the text is stored, shown in Att göra and sent to
 * ntfy.
 */
export function bankErrorText(e: unknown, bank: string, now: Date): string {
  if (e instanceof EbApiError && e.code === "ASPSP_RATE_LIMIT_EXCEEDED") {
    const what = /BALANCES/i.test(e.message) ? "saldot" : /TRANSACTIONS/i.test(e.message) ? "transaktionerna" : "kontot";
    return `${bank} tillåter fyra hämtningar av ${what} per dygn när du inte är inloggad, och dagens är använda. Nästa försök ${nextSyncText(now)}.`;
  }
  const message = e instanceof EbApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : (e as Error).message;
  return maskAccountText(message);
}

export const CONSENT_WARN_DAYS = 14;
/**
 * Swedbank pages a few days at a time (two years ≈ 200 pages), starting with
 * empty pages and giving the same continuation_key on every page (the position
 * is kept at Enable Banking), so neither an empty page nor a repeated key means
 * the end: only no key does. This is a guard against a loop, not a limit.
 */
const MAX_PAGES = 1000;

export interface AccountReport {
  bankAccountId: number;
  maskedRef: string | null;
  accountId: number | null;
  accountName: string | null;
  from: string | null;
  pages: number;
  fetched: number;
  booked: number;
  pending: number;
  /** Other statuses (rejected, scheduled…): not imported. */
  other: number;
  rowsNew: number;
  rowsLinked: number;
  rowsSkipped: number;
  transfersPaired: number;
  balance: { amount: number; type: string } | null;
  error: string | null;
}

export interface SyncReport {
  at: string;
  dryRun: boolean;
  connections: { id: number; bank: string; status: string; error: string | null; accounts: AccountReport[] }[];
}

// ---------- Notifications (ntfy) ----------

/** At most once a day per subject. */
export async function notify(db: Db, settings: EbSettings, subject: string, title: string, message: string, today = todayLocal()) {
  if (!settings.ntfyTopic) return;
  const sent = getSetting<Record<string, string>>(db, "eb_notified", {});
  if (sent[subject] === today) return;
  if (await sendNtfy(settings.ntfyTopic, { title, message, tags: ["bank"] })) setSetting(db, "eb_notified", { ...sent, [subject]: today });
}

// ---------- Fetching ----------

export async function fetchTransactions(client: EbClient, uid: string, from: string | null, psu: PsuHeaders | null) {
  const all: EbTransaction[] = [];
  let key: string | null = null;
  let pages = 0;
  do {
    const q = new URLSearchParams();
    if (from) q.set("date_from", from);
    else q.set("strategy", "longest");
    if (key) q.set("continuation_key", key);
    const page: EbTransactionsPage = await client.request<EbTransactionsPage>("GET", `/accounts/${uid}/transactions?${q}`, { psu });
    all.push(...(page.transactions ?? []));
    key = page.continuation_key || null;
    pages++;
  } while (key && pages < MAX_PAGES);
  return { transactions: all, pages };
}

/**
 * The available balance first: it's what the user reads in the bank's app and
 * types in (Privatkonto: available 216,89, booked 316,89 with a card purchase
 * reserved), and for 'kvar att leva på' a reserved purchase is already spent.
 */
const BALANCE_ORDER = ["ITAV", "CLAV", "XPCD", "ITBD", "CLBD", "OPAV", "OPBD"];
export function pickBalance(balances: EbBalance[]): EbBalance | null {
  return [...balances].sort((a, b) => rank(a.balance_type) - rank(b.balance_type))[0] ?? null;
}
const rank = (t: string) => (BALANCE_ORDER.includes(t) ? BALANCE_ORDER.indexOf(t) : BALANCE_ORDER.length);

// ---------- Sync ----------

export async function syncBanks(
  db: Db,
  client: EbClient,
  settings: EbSettings,
  opts: {
    dryRun?: boolean;
    psu?: PsuHeaders | null;
    connectionId?: number;
    now?: Date;
    /** The schedule: accounts never fetched wait for the first fetch by hand (after its preview). */
    onlySynced?: boolean;
  } = {},
): Promise<SyncReport> {
  const now = opts.now ?? new Date();
  const today = todayLocal(now);
  const dryRun = opts.dryRun ?? false;
  const report: SyncReport = { at: now.toISOString(), dryRun, connections: [] };
  const conns = db
    .select()
    .from(bankConnections)
    .all()
    .filter((c) => c.status === "active" && (opts.connectionId === undefined || c.id === opts.connectionId));

  for (const conn of conns) {
    const entry = { id: conn.id, bank: conn.aspspName, status: conn.status as string, error: null as string | null, accounts: [] as AccountReport[] };
    report.connections.push(entry);
    const setConn = (patch: Partial<typeof bankConnections.$inferInsert>) => {
      if (!dryRun) db.update(bankConnections).set(patch).where(eq(bankConnections.id, conn.id)).run();
    };

    if (conn.validUntil && Date.parse(conn.validUntil) <= now.getTime()) {
      entry.status = "expired";
      entry.error = "Samtycket har gått ut. Förnya det under Inställningar › Bankkopplingar.";
      setConn({ status: "expired", lastError: entry.error, lastErrorAt: now.toISOString() });
      if (!dryRun) await notify(db, settings, `expired:${conn.id}`, `${conn.aspspName}: samtycket har gått ut`, entry.error, today);
      continue;
    }
    if (conn.validUntil) {
      const left = daysBetween(today, conn.validUntil.slice(0, 10));
      if (left < CONSENT_WARN_DAYS && !dryRun) {
        await notify(db, settings, `consent:${conn.id}`, `${conn.aspspName}: samtycket går ut om ${left} dagar`, `Förnya det under Inställningar › Bankkopplingar före ${conn.validUntil.slice(0, 10)}.`, today);
      }
    }

    const errors: string[] = [];
    for (const ba of db.select().from(bankAccounts).where(eq(bankAccounts.connectionId, conn.id)).all()) {
      const account = ba.accountId === null ? undefined : db.select().from(accounts).where(eq(accounts.id, ba.accountId)).get();
      const from = ba.lastBookingDate ? addDays(ba.lastBookingDate, -OVERLAP_DAYS) : null;
      const r: AccountReport = {
        bankAccountId: ba.id,
        maskedRef: ba.maskedRef,
        accountId: account?.id ?? null,
        accountName: account?.name ?? null,
        from,
        pages: 0,
        fetched: 0,
        booked: 0,
        pending: 0,
        other: 0,
        rowsNew: 0,
        rowsLinked: 0,
        rowsSkipped: 0,
        transfersPaired: 0,
        balance: null,
        error: null,
      };
      entry.accounts.push(r);
      if (!account) {
        r.error = "Inte kopplat till något konto här. Välj konto under Inställningar › Bankkopplingar.";
        continue;
      }
      if (opts.onlySynced && !ba.lastBookingDate) {
        r.error = "Väntar på första hämtningen (Synka nu under Inställningar › Bankkopplingar).";
        continue;
      }
      try {
        const fetched = await fetchTransactions(client, ba.uid, from, opts.psu ?? null);
        r.pages = fetched.pages;
        r.fetched = fetched.transactions.length;
        const own = db.select().from(accounts).all();
        const kind = account.kind === "credit_card" ? "card" : "bank";
        const mapped = fetched.transactions.map((t) => mapTransaction(t, { accountId: account.id, kind, own, accountRef: account.accountRef ?? ba.maskedRef })).filter((m): m is MappedRow => m !== null);
        const booked = mapped.filter((m) => m.status === "BOOK");
        const pending = mapped.filter((m) => m.status === "PDNG");
        r.booked = booked.length;
        r.pending = pending.length;
        r.other = fetched.transactions.length - booked.length - pending.length;
        const rows = withKeys(booked);
        const bankDays = booked.map((m) => m.postedDate ?? m.bookingDate).sort();
        const period = rows.length ? { from: from ?? bankDays[0], to: today } : null;
        const run = (dry: boolean): CoreResult =>
          db.transaction((txn) =>
            runImport(txn as unknown as Db, {
              source: account.source === "norwegian" ? "norwegian" : "swedbank",
              filename: `Enable Banking · ${conn.aspspName} ${ba.maskedRef ?? ""}`.trim(),
              period,
              rows,
              dryRun: dry,
              via: "enable_banking",
            }),
          );
        // A sync that brings nothing new leaves no import in the history.
        let core = run(true);
        if (!dryRun && (core.rowsNew > 0 || core.rowsLinked > 0)) {
          core = run(false);
          if (core.importId !== null) {
            const ids = db
              .select({ id: transactions.id })
              .from(transactions)
              .where(eq(transactions.importId, core.importId))
              .all()
              .map((x) => x.id);
            r.transfersPaired = pairUnreferencedTransfers(db, ids, normalizeForMatch);
          }
        }
        r.rowsNew = core.rowsNew;
        r.rowsLinked = core.rowsLinked;
        r.rowsSkipped = core.rowsSkipped - core.rowsLinked;

        // The balance on its own: a refusal here must not undo what the
        // transactions just brought — the day fetched to, the pending rows.
        let balanceError: unknown = null;
        try {
          const balances = await client.request<{ balances: EbBalance[] }>("GET", `/accounts/${ba.uid}/balances`, { psu: opts.psu ?? null });
          const b = pickBalance(balances.balances ?? []);
          const ore = b ? parseAmountToOre(b.balance_amount.amount) : null;
          if (b && ore !== null) r.balance = { amount: ore, type: b.balance_type };
        } catch (e) {
          if (e instanceof EbApiError && e.consentGone) throw e;
          balanceError = e;
        }

        if (!dryRun) {
          db.transaction((txn) => {
            const tx = txn as unknown as Db;
            tx.delete(bankPending).where(eq(bankPending.bankAccountId, ba.id)).run();
            for (const p of pending) {
              tx.insert(bankPending).values({ bankAccountId: ba.id, date: p.bookingDate, amount: p.amount, description: p.descriptionClean, raw: p.bankRaw ?? "{}" }).run();
            }
            const latest = bankDays.at(-1);
            tx.update(bankAccounts)
              .set({ lastSyncAt: now.toISOString(), ...(latest && (!ba.lastBookingDate || latest > ba.lastBookingDate) ? { lastBookingDate: latest } : {}) })
              .where(eq(bankAccounts.id, ba.id))
              .run();
            // The balance, so it needn't be typed in (not for an account whose balance isn't followed).
            if (r.balance && account.trackBalance) {
              tx.update(accounts).set({ balance: r.balance.amount, balanceUpdatedAt: now.toISOString() }).where(eq(accounts.id, account.id)).run();
            }
          });
        }
        if (balanceError !== null) {
          r.error = bankErrorText(balanceError, conn.aspspName, now);
          errors.push(`${ba.maskedRef ?? "konto"}: ${r.error}`);
        }
      } catch (e) {
        const message = bankErrorText(e, conn.aspspName, now);
        r.error = message;
        errors.push(`${ba.maskedRef ?? "konto"}: ${message}`);
        if (e instanceof EbApiError && e.consentGone) {
          entry.status = "expired";
          setConn({ status: "expired" });
          break;
        }
      }
    }

    // The same refusal for every account reads once, not once per account.
    const texts = errors.map((x) => x.replace(/^[^:]+: /, ""));
    entry.error = errors.length ? (errors.length > 1 && texts.every((t) => t === texts[0]) ? texts[0] : errors.join(" · ")) : null;
    setConn(errors.length ? { lastSyncAt: now.toISOString(), lastError: entry.error, lastErrorAt: now.toISOString() } : { lastSyncAt: now.toISOString(), lastError: null, lastErrorAt: null });
    if (errors.length && !dryRun) await notify(db, settings, `error:${conn.id}`, `${conn.aspspName}: synken misslyckades`, entry.error!, today);
  }
  return report;
}
