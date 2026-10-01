import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Enable Banking's API (https://enablebanking.com/docs/api/reference/): every
 * call carries a JWT signed RS256 with the application's private key, kid =
 * the application id. The key is read when a token is made and never logged.
 */

export const API_BASE = "https://api.enablebanking.com";
/** Tokens live an hour (the API allows up to 24 h). */
const TOKEN_SECONDS = 3600;

export interface EbSettings {
  appId: string;
  privateKeyPath: string;
  redirectUrl: string;
  publicBaseUrl: string;
  ntfyTopic: string;
}

export const isConfigured = (s: EbSettings) => !!(s.appId && s.privateKeyPath && s.redirectUrl);

export function makeJwt(appId: string, privateKeyPem: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = part({ typ: "JWT", alg: "RS256", kid: appId });
  const body = part({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: nowSeconds, exp: nowSeconds + TOKEN_SECONDS });
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKeyPem).toString("base64url");
  return `${head}.${body}.${signature}`;
}

/** An error answer from the API ({ message, code, error, detail }). */
export class EbApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly detail: unknown = null,
  ) {
    super(message);
    this.name = "EbApiError";
  }
  /** The session or consent no longer works: the user must connect again. */
  get consentGone() {
    return this.status === 401 || this.code === "EXPIRED_SESSION" || this.code === "CLOSED_SESSION" || this.code === "REVOKED_SESSION" || this.code === "EXPIRED_ACCESS";
  }
}

/** The user at the screen (manual sync): banks then allow more than the unattended ~4 fetches a day. */
export interface PsuHeaders {
  ip: string;
  userAgent: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export class EbClient {
  private token: { value: string; until: number } | null = null;
  constructor(
    private readonly settings: EbSettings,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }),
  ) {}

  private jwt(): string {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || this.token.until - now < 60) {
      this.token = { value: makeJwt(this.settings.appId, readFileSync(this.settings.privateKeyPath, "utf8"), now), until: now + TOKEN_SECONDS };
    }
    return this.token.value;
  }

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, opts: { body?: unknown; psu?: PsuHeaders | null } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.jwt()}`, Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.psu) {
      headers["Psu-Ip-Address"] = opts.psu.ip;
      headers["Psu-User-Agent"] = opts.psu.userAgent;
    }
    const res = await this.fetchImpl(`${API_BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 400) {
      const message = typeof data.message === "string" ? data.message : `HTTP ${res.status}`;
      throw new EbApiError(res.status, message, typeof data.error === "string" ? data.error : null, data.detail ?? null);
    }
    return data as T;
  }
}

// ---------- The parts of the API's answers we use ----------

export interface AspspData {
  name: string;
  country: string;
  /** Seconds. */
  maximum_consent_validity: number;
  psu_types?: string[];
  required_psu_headers?: string[];
}

export interface AccountIdentification {
  iban?: string;
  other?: { identification: string; scheme_name: string };
}

export interface SessionAccount {
  uid: string;
  account_id?: AccountIdentification;
  all_account_ids?: { identification: string; scheme_name: string }[];
  name?: string;
  details?: string;
  product?: string;
  currency?: string;
  cash_account_type?: string;
}

export interface AuthorizeSessionResponse {
  session_id: string;
  accounts: SessionAccount[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
}

export interface EbAmount {
  currency: string;
  amount: string;
}

export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  merchant_category_code?: string | null;
  transaction_amount: EbAmount;
  creditor?: { name?: string | null } | null;
  creditor_account?: AccountIdentification | null;
  debtor?: { name?: string | null } | null;
  debtor_account?: AccountIdentification | null;
  bank_transaction_code?: { description?: string | null; code?: string | null; sub_code?: string | null } | null;
  credit_debit_indicator: "CRDT" | "DBIT";
  status: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  balance_after_transaction?: EbAmount | null;
  reference_number?: string | null;
  remittance_information?: string[] | null;
  note?: string | null;
}

export interface EbTransactionsPage {
  transactions: EbTransaction[];
  continuation_key?: string | null;
}

export interface EbBalance {
  name?: string;
  balance_amount: EbAmount;
  balance_type: string;
  last_change_date_time?: string | null;
  reference_date?: string | null;
}
