import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, bankAccounts, bankConnections, bankPending } from "../db/schema.js";
import { daysBetween, todayLocal } from "../overview/dates.js";
import { EbClient, isConfigured, type EbSettings, type PsuHeaders } from "./client.js";
import { completeConnection, removeConnection, startConnection, type CallbackQuery } from "./connect.js";
import { CONSENT_WARN_DAYS, SYNC_HOURS, syncBanks, type SyncReport } from "./sync.js";

/** The banks the app knows how to read (Swedbank's accounts and Bank Norwegian's card). */
export const BANKS = ["Swedbank", "Bank Norwegian"] as const;

export type BankService = ReturnType<typeof createBankService>;

/** One per app: the client, and one sync at a time (the schedule and the button share it). */
export function createBankService(db: Db, settings: EbSettings, client = new EbClient(settings), hooks: { afterSync?: (r: SyncReport) => Promise<unknown> } = {}) {
  let running: Promise<SyncReport> | null = null;
  const configured = isConfigured(settings);

  const sync = (opts: { dryRun?: boolean; psu?: PsuHeaders | null; connectionId?: number; onlySynced?: boolean } = {}) => {
    if (!configured) return Promise.reject(new Error("Enable Banking är inte konfigurerat (EB_APP_ID, EB_PRIVATE_KEY_PATH, EB_REDIRECT_URL i .env)."));
    // A dry run doesn't write, so it needn't wait for (or block) a real one.
    if (opts.dryRun) return syncBanks(db, client, settings, opts);
    running ??= syncBanks(db, client, settings, opts)
      .then(async (r) => {
        // Vakt: what the new rows show (never stops the sync's answer).
        await hooks.afterSync?.(r).catch((e) => console.error(`Efter synken: ${(e as Error).message}`));
        return r;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const status = (today = todayLocal()) => {
    const pending = db
      .select({ bankAccountId: bankPending.bankAccountId, count: sql<number>`count(*)`, amount: sql<number>`sum(${bankPending.amount})` })
      .from(bankPending)
      .groupBy(bankPending.bankAccountId)
      .all();
    const all = db.select().from(accounts).all();
    return {
      configured,
      syncing: running !== null,
      /** The scheduled runs, Swedish time (the cron in index.ts). */
      syncHours: [...SYNC_HOURS],
      banks: [...BANKS],
      connections: db
        .select()
        .from(bankConnections)
        .all()
        .filter((c) => c.status !== "pending")
        .map((c) => ({
          id: c.id,
          bank: c.aspspName,
          status: c.status,
          validUntil: c.validUntil,
          daysLeft: c.validUntil ? daysBetween(today, c.validUntil.slice(0, 10)) : null,
          expiresSoon: !!c.validUntil && daysBetween(today, c.validUntil.slice(0, 10)) < CONSENT_WARN_DAYS,
          authorizedAt: c.authorizedAt,
          lastSyncAt: c.lastSyncAt,
          lastError: c.lastError,
          accounts: db
            .select()
            .from(bankAccounts)
            .where(eq(bankAccounts.connectionId, c.id))
            .all()
            .map((a) => {
              const p = pending.find((x) => x.bankAccountId === a.id);
              return {
                id: a.id,
                maskedRef: a.maskedRef,
                product: a.product,
                accountId: a.accountId,
                accountName: all.find((x) => x.id === a.accountId)?.name ?? null,
                lastBookingDate: a.lastBookingDate,
                lastSyncAt: a.lastSyncAt,
                pending: { count: p?.count ?? 0, amount: p?.amount ?? 0 },
              };
            }),
        })),
    };
  };

  return {
    configured,
    settings,
    sync,
    status,
    connect: (bank: string) => startConnection(db, client, settings, bank),
    callback: (q: CallbackQuery) => completeConnection(db, client, q),
    remove: (id: number) => removeConnection(db, client, id),
    /** Which account in the app a bank account feeds (null: none). */
    setAccount(bankAccountId: number, accountId: number | null) {
      if (accountId !== null && !db.select().from(accounts).where(eq(accounts.id, accountId)).get()) throw new Error("Kontot finns inte.");
      const row = db.update(bankAccounts).set({ accountId }).where(eq(bankAccounts.id, bankAccountId)).returning().get();
      if (!row) throw new Error("Bankkontot finns inte.");
      return row;
    },
  };
}
