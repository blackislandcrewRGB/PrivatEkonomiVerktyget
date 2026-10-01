import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, bankAccounts, bankConnections, type Account } from "../db/schema.js";
import type { AspspData, AuthorizeSessionResponse, EbClient, EbSettings, SessionAccount } from "./client.js";
import { maskedRefOf } from "./map.js";
import { maskAccountText } from "./sync.js";

/**
 * Connecting a bank: /auth gives the bank's login page; the bank sends the user
 * back to the callback with a code (or an error) and our state; /sessions turns
 * the code into a session with the accounts the consent covers. Each account is
 * matched to an account in the app on its last four digits.
 */

export class EbError extends Error {}

/** A pending connection older than this can't be completed (the user went away). */
const PENDING_MINUTES = 60;

export async function listBanks(client: EbClient, country = "SE"): Promise<AspspData[]> {
  return (await client.request<{ aspsps: AspspData[] }>("GET", `/aspsps?country=${country}&service=AIS`)).aspsps;
}

export async function startConnection(db: Db, client: EbClient, settings: EbSettings, aspspName: string, country = "SE"): Promise<{ url: string; connectionId: number }> {
  const aspsp = (await listBanks(client, country)).find((a) => a.name.toLocaleLowerCase("sv") === aspspName.toLocaleLowerCase("sv"));
  if (!aspsp) throw new EbError(`Hittar inte ${aspspName} bland bankerna hos Enable Banking.`);
  // As long as the bank allows (Swedbank and Bank Norwegian: 180 days), a minute short.
  const validUntil = new Date(Date.now() + aspsp.maximum_consent_validity * 1000 - 60_000).toISOString();
  const state = randomUUID();
  // An earlier attempt at the same bank that never came back is dropped.
  db.delete(bankConnections).where(and(eq(bankConnections.aspspName, aspsp.name), eq(bankConnections.status, "pending"))).run();
  const conn = db.insert(bankConnections).values({ aspspName: aspsp.name, aspspCountry: aspsp.country, status: "pending", state }).returning().get();
  const res = await client.request<{ url: string }>("POST", "/auth", {
    body: {
      access: { valid_until: validUntil },
      aspsp: { name: aspsp.name, country: aspsp.country },
      state,
      redirect_url: settings.redirectUrl,
      psu_type: "personal",
      language: "sv",
    },
  });
  return { url: res.url, connectionId: conn.id };
}

export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/** The app account for a bank account: the one whose number ends the same, or the bank's only card account. */
function matchAccount(all: Account[], bank: string, a: SessionAccount, maskedRef: string | null, sessionSize: number): number | null {
  if (maskedRef) {
    const byRef = all.filter((x) => x.accountRef && x.accountRef.slice(-4) === maskedRef.slice(-4));
    if (byRef.length === 1) return byRef[0].id;
  }
  if (/norwegian/i.test(bank) && sessionSize === 1) {
    const cards = all.filter((x) => x.source === "norwegian");
    if (cards.length === 1) return cards[0].id;
  }
  void a;
  return null;
}

export async function completeConnection(db: Db, client: EbClient, q: CallbackQuery) {
  if (!q.state) throw new EbError("Svaret från banken saknar state. Starta kopplingen igen.");
  const conn = db.select().from(bankConnections).where(and(eq(bankConnections.state, q.state), eq(bankConnections.status, "pending"))).get();
  if (!conn) throw new EbError("Okänt eller redan använt state. Starta kopplingen igen från Inställningar.");
  const fail = (message: string) => {
    db.update(bankConnections)
      .set({ status: "error", state: null, lastError: maskAccountText(message), lastErrorAt: new Date().toISOString() })
      .where(eq(bankConnections.id, conn.id))
      .run();
    return new EbError(message);
  };
  if (Date.now() - Date.parse(conn.createdAt) > PENDING_MINUTES * 60_000) throw fail("Kopplingen tog för lång tid. Starta den igen.");
  if (q.error) throw fail(q.error_description ? `${conn.aspspName}: ${q.error_description}` : `${conn.aspspName} avbröt kopplingen (${q.error}).`);
  if (!q.code) throw fail("Svaret från banken saknar kod.");

  const session = await client.request<AuthorizeSessionResponse>("POST", "/sessions", { body: { code: q.code } });
  const now = new Date().toISOString();
  const all = db.select().from(accounts).all();
  const replaced: string[] = [];
  const result = db.transaction((txn) => {
    const tx = txn as unknown as Db;
    // A renewed consent replaces the old connection to the same bank; where it
    // had got to per account carries over.
    const old = tx
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.aspspName, conn.aspspName), ne(bankConnections.id, conn.id), ne(bankConnections.status, "pending")))
      .all();
    const carried = new Map<number, string>();
    for (const o of old) {
      for (const ba of tx.select().from(bankAccounts).where(eq(bankAccounts.connectionId, o.id)).all()) {
        if (ba.accountId !== null && ba.lastBookingDate) carried.set(ba.accountId, ba.lastBookingDate);
      }
      if (o.sessionId) replaced.push(o.sessionId);
      tx.delete(bankConnections).where(eq(bankConnections.id, o.id)).run();
    }
    tx.update(bankConnections)
      .set({ status: "active", state: null, sessionId: session.session_id, validUntil: session.access.valid_until, authorizedAt: now, lastError: null, lastErrorAt: null })
      .where(eq(bankConnections.id, conn.id))
      .run();
    return session.accounts.map((a) => {
      const maskedRef = maskedRefOf(a.account_id, a.all_account_ids);
      const accountId = matchAccount(all, conn.aspspName, a, maskedRef, session.accounts.length);
      tx.insert(bankAccounts)
        .values({
          connectionId: conn.id,
          uid: a.uid,
          accountId,
          maskedRef,
          name: a.name ?? null,
          product: a.product ?? a.details ?? null,
          currency: a.currency ?? null,
          lastBookingDate: accountId !== null ? (carried.get(accountId) ?? null) : null,
        })
        .run();
      return { maskedRef, product: a.product ?? a.details ?? null, accountId, accountName: all.find((x) => x.id === accountId)?.name ?? null };
    });
  });
  // The bank's old consent is closed (best effort: it may be gone already).
  for (const id of replaced) await client.request("DELETE", `/sessions/${id}`).catch(() => undefined);
  return { connectionId: conn.id, bank: conn.aspspName, validUntil: session.access.valid_until, accounts: result };
}

/** Ends a connection: the session at Enable Banking (and the bank's consent) and the row here. Fetched rows stay. */
export async function removeConnection(db: Db, client: EbClient, id: number) {
  const conn = db.select().from(bankConnections).where(eq(bankConnections.id, id)).get();
  if (!conn) throw new EbError("Kopplingen finns inte.");
  if (conn.sessionId) await client.request("DELETE", `/sessions/${conn.sessionId}`).catch(() => undefined);
  db.delete(bankConnections).where(eq(bankConnections.id, id)).run();
}
