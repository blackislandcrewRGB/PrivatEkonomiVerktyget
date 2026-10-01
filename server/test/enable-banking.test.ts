import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { accounts, bankAccounts, bankConnections, bankPending, categories, imports, transactions } from "../src/db/schema.js";
import { EbClient, makeJwt, type EbSettings, type EbTransaction, type FetchLike } from "../src/enableBanking/client.js";
import { mapTransaction, maskRaw } from "../src/enableBanking/map.js";
import { completeConnection, EbError, startConnection } from "../src/enableBanking/connect.js";
import { bankErrorText, maskAccountText, nextSyncText, SYNC_CRON, syncBanks } from "../src/enableBanking/sync.js";
import { EbApiError } from "../src/enableBanking/client.js";
import { importSwedbankCsv } from "../src/import/importSwedbank.js";
import { parseSwedbankCsv } from "../src/import/swedbank.js";
import { pairByMatch } from "../src/import/matchKey.js";
import { buildOverview } from "../src/overview/overview.js";
import { createApp } from "../src/app.js";
import { createBankService } from "../src/enableBanking/service.js";
import { freshDb, swedbankSample } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const APP_ID = "11111111-2222-3333-4444-555555555555";
let settings: EbSettings;
let publicKey: string;

beforeAll(() => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-"));
  const keyPath = path.join(dir, `${APP_ID}.pem`);
  fs.writeFileSync(keyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }));
  publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  settings = { appId: APP_ID, privateKeyPath: keyPath, redirectUrl: "https://example.ts.net/api/enable-banking/callback", publicBaseUrl: "https://example.ts.net", ntfyTopic: "" };
});
// A fixed clock: the fake bank's consent runs to 18/3 2027, and a sync
// without its own 'now' checks it against the clock (a warning from 4/3, expired from 18/3).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------- A fake Enable Banking ----------

interface FakeBank {
  /** Per account uid: its transactions (paged 100 at a time) and balance. */
  accounts: Record<string, { ids: { iban: string }; txs: EbTransaction[]; balance?: string }>;
  calls: string[];
  validUntil?: string;
}

function fakeApi(bank: FakeBank): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    bank.calls.push(`${init.method} ${u.pathname}${u.search}`);
    const ok = (body: unknown) => ({ status: 200, json: async () => body });
    if (u.pathname === "/aspsps") return ok({ aspsps: [{ name: "Swedbank", country: "SE", maximum_consent_validity: 15552000 }, { name: "Bank Norwegian", country: "SE", maximum_consent_validity: 15552000 }] });
    if (u.pathname === "/auth") return ok({ url: "https://auth.enablebanking.com/ais/start?sessionid=x" });
    if (u.pathname === "/sessions" && init.method === "POST") {
      const code = JSON.parse(init.body!).code;
      if (code === "bad") return { status: 422, json: async () => ({ message: "Authorization code is invalid", code: 422, error: "WRONG_AUTHORIZATION_CODE" }) };
      return ok({
        session_id: "sess-1",
        accounts: Object.entries(bank.accounts).map(([uid, a]) => ({ uid, account_id: a.ids, product: "Privatkonto", currency: "SEK" })),
        aspsp: { name: "Swedbank", country: "SE" },
        access: { valid_until: bank.validUntil ?? "2027-03-18T10:00:00+00:00" },
      });
    }
    const m = /^\/accounts\/([^/]+)\/(transactions|balances)$/.exec(u.pathname);
    if (m) {
      const acc = bank.accounts[m[1]];
      // As Swedbank answers: booked (ITBD) and available (ITAV).
      if (m[2] === "balances") return ok({ balances: [{ balance_type: "ITBD", balance_amount: { currency: "SEK", amount: "316.89" } }, { balance_type: "ITAV", balance_amount: { currency: "SEK", amount: acc.balance ?? "0.00" } }] });
      const from = u.searchParams.get("date_from");
      const all = acc.txs.filter((t) => !from || (t.booking_date ?? "") >= from);
      const start = Number(u.searchParams.get("continuation_key") ?? 0);
      const next = start + 100 < all.length ? String(start + 100) : null;
      return ok({ transactions: all.slice(start, start + 100), continuation_key: next });
    }
    if (init.method === "DELETE") return ok({});
    return { status: 404, json: async () => ({ message: `no route ${u.pathname}` }) };
  };
}

const iban = (digits: string) => `SE12800${digits}`;

/**
 * A Swedbank CSV row as Swedbank's API really gives it (checked 2026-09-19): the
 * type in bank_transaction_code, the message in remittance_information ('Swish
 * skickad +46…' is type 'Swish skickad' + message '+46…'; a transfer's message
 * is the other account's number), the account itself as creditor_account, no
 * entry reference.
 */
function asApi(r: ReturnType<typeof parseSwedbankCsv>["rows"][number], self: string): EbTransaction {
  const refDigits = r.reference.replace(/[\s-]/g, "");
  const swish = /^(Swish(?: skickad| mottagen| utbetalning)?) (.*)$/.exec(r.descriptionClean);
  const transfer = /^\d{10,17}$/.test(refDigits) && r.descriptionClean === "Överföring via internet";
  const [type, message] = swish ? [swish[1], swish[2]] : transfer ? ["Överföring via internet", refDigits] : ["Kortköp/uttag", r.descriptionClean.toUpperCase()];
  return {
    entry_reference: null,
    transaction_amount: { currency: "SEK", amount: (Math.abs(r.amount) / 100).toFixed(2) },
    credit_debit_indicator: r.amount < 0 ? "DBIT" : "CRDT",
    status: "BOOK",
    booking_date: r.bookingDate,
    transaction_date: r.transactionDate,
    value_date: r.valueDate,
    bank_transaction_code: { description: type, code: null, sub_code: null },
    remittance_information: [message],
    creditor_account: { iban: iban(self) },
  };
}

/**
 * The same transaction in Swedbank's other shape (seen 2026-09-19 18:00): an
 * entry reference, no bank_transaction_code, the type as the message's last
 * line (Swish types in lower case), the card or a Swish reference after the text.
 */
function asOtherShape(t: EbTransaction, n: number): EbTransaction {
  const type = t.bank_transaction_code!.description!;
  const message = t.remittance_information?.[0] ?? "";
  const swish = /^swish/i.test(type);
  const text = type === "Kortköp/uttag" ? `${message}        K0431` : swish ? `${message}    18326${String(n).padStart(11, "0")}` : message;
  return {
    ...t,
    entry_reference: `00E3${String(n).padStart(22, "0")}`,
    bank_transaction_code: null,
    remittance_information: type === "Överföring via internet" ? [type] : [text, swish ? type.toLowerCase() : type],
  };
}

function bankFromSample() {
  const parsed = parseSwedbankCsv(swedbankSample().bytes);
  const byAccount = new Map<string, EbTransaction[]>();
  parsed.rows.forEach((r) => byAccount.set(r.accountNumber, [...(byAccount.get(r.accountNumber) ?? []), asApi(r, `80000${r.accountNumber}`)]));
  const bank: FakeBank = { accounts: {}, calls: [] };
  for (const [number, txs] of byAccount) bank.accounts[`uid-${number.slice(-4)}`] = { ids: { iban: iban(`80000${number}`) }, txs, balance: "216.89" };
  return { bank, rows: parsed.rows.length };
}

async function connect(db: Db, bank: FakeBank) {
  const client = new EbClient(settings, fakeApi(bank));
  await startConnection(db, client, settings, "Swedbank");
  const state = db.select().from(bankConnections).get()!.state!;
  await completeConnection(db, client, { code: "ok", state });
  return client;
}

const count = (db: Db) => db.select({ n: sql<number>`count(*)` }).from(transactions).get()!.n;
const bindSwedbank = (db: Db) => {
  db.update(accounts).set({ accountRef: "••1234", clearing: "80000" }).where(eq(accounts.name, "Swedbank Privatkonto")).run();
  db.update(accounts).set({ accountRef: "••5678", clearing: "80000" }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
};

// ---------- Tests ----------

describe("Enable Banking: JWT", () => {
  it("RS256 with kid = the app id, iss/aud as the API wants, an hour, verifiable with the public key", () => {
    const jwt = makeJwt(APP_ID, fs.readFileSync(settings.privateKeyPath, "utf8"), 1_800_000_000);
    const [h, b, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: APP_ID });
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
    expect(jwt).not.toMatch(/[=+/]/);
  });
});

describe("Enable Banking: connecting", () => {
  it("sends the bank's full consent time, then matches the accounts on their last four digits", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const { bank } = bankFromSample();
    const client = new EbClient(settings, fakeApi(bank));
    const { url } = await startConnection(db, client, settings, "swedbank");
    expect(url).toMatch(/^https:\/\/auth\.enablebanking\.com/);
    const pending = db.select().from(bankConnections).get()!;
    expect(pending).toMatchObject({ aspspName: "Swedbank", status: "pending" });
    const r = await completeConnection(db, client, { code: "ok", state: pending.state! });
    // The sample is Privatkonto's export: one account.
    expect(r.accounts.map((a) => [a.maskedRef, a.accountName])).toEqual([["••1234", "Swedbank Privatkonto"]]);
    expect(db.select().from(bankConnections).get()).toMatchObject({ status: "active", sessionId: "sess-1", state: null, validUntil: "2027-03-18T10:00:00+00:00" });
    // Only masked numbers are kept.
    expect(JSON.stringify(db.select().from(bankAccounts).all())).not.toMatch(/\d{6,}/);
  });

  it("a callback with an unknown state, an error from the bank or a bad code connects nothing", async () => {
    const db = freshDb({ seeded: true });
    const { bank } = bankFromSample();
    const client = new EbClient(settings, fakeApi(bank));
    await startConnection(db, client, settings, "Swedbank");
    await expect(completeConnection(db, client, { code: "ok", state: "fel-state" })).rejects.toThrow(EbError);
    const state = db.select().from(bankConnections).get()!.state!;
    await expect(completeConnection(db, client, { state, error: "access_denied", error_description: "Cancelled by user" })).rejects.toThrow("Swedbank: Cancelled by user");
    expect(db.select().from(bankConnections).get()).toMatchObject({ status: "error", state: null, sessionId: null });
    // The used state can't be used again.
    await expect(completeConnection(db, client, { code: "ok", state })).rejects.toThrow(/Okänt eller redan använt/);
    expect(bank.calls.some((c) => c.startsWith("POST /sessions"))).toBe(false);

    await startConnection(db, client, settings, "Swedbank");
    const again = db.select().from(bankConnections).where(eq(bankConnections.status, "pending")).get()!;
    await expect(completeConnection(db, client, { code: "bad", state: again.state! })).rejects.toThrow("Authorization code is invalid");
  });
});

describe("Enable Banking: sync against the files", () => {
  it("CSV first, then the API with the same rows: nothing new, every row linked, the user's edits kept", async () => {
    const db = freshDb({ seeded: true });
    const sample = swedbankSample();
    const csv = importSwedbankCsv(db, sample.bytes, sample.name);
    const before = count(db);
    expect(csv.rowsNew).toBe(before);
    // Something done by hand on a row.
    const edited = db.select().from(transactions).get()!;
    const food = db.select().from(categories).where(eq(categories.systemKey, "groceries")).get()!;
    db.update(transactions).set({ note: "Min anteckning", label: "Mitt namn", categoryId: food.id, categorySource: "manual", shared: true }).where(eq(transactions.id, edited.id)).run();

    const { bank, rows } = bankFromSample();
    const client = await connect(db, bank);
    const preview = await syncBanks(db, client, settings, { dryRun: true });
    const sum = (k: "rowsNew" | "rowsLinked") => preview.connections[0].accounts.reduce((s, a) => s + a[k], 0);
    expect(sum("rowsNew")).toBe(0);
    expect(sum("rowsLinked")).toBe(rows);
    expect(count(db)).toBe(before);

    const report = await syncBanks(db, client, settings);
    expect(report.connections[0].accounts.reduce((s, a) => s + a.rowsNew, 0)).toBe(0);
    expect(count(db)).toBe(before);
    expect(db.select({ n: sql<number>`count(*)` }).from(transactions).where(eq(transactions.source, "both")).get()!.n).toBe(rows);
    expect(db.select().from(transactions).where(eq(transactions.id, edited.id)).get()).toMatchObject({
      note: "Min anteckning",
      label: "Mitt namn",
      categoryId: food.id,
      shared: true,
      source: "both",
      // Swedbank gives no entry reference: one is made from the fingerprint.
      entryReference: expect.stringMatching(/^fp:[0-9a-f]{16}:\d+$/),
    });
    // Pages of 100 followed (195 rows are two pages: one continuation in each of the two syncs); the first sync as far back as the bank allows.
    expect(bank.calls.filter((c) => c.includes("continuation_key=")).length).toBe(2);
    expect(bank.calls.find((c) => c.includes("/transactions"))).toMatch(/strategy=longest/);
    // The balance came along.
    expect(db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.balance).toBe(21689);

    // Next sync: from the latest booking day minus 7, still nothing new; and the file again: nothing either.
    bank.calls.length = 0;
    await syncBanks(db, client, settings);
    const last = db.select().from(bankAccounts).get()!.lastBookingDate!;
    const from = new Date(Date.parse(`${last}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    expect(bank.calls.find((c) => c.includes("/transactions"))).toContain(`date_from=${from}`);
    expect(count(db)).toBe(before);
    expect(importSwedbankCsv(db, sample.bytes, sample.name)).toMatchObject({ rowsNew: 0, rowsLinked: 0 });
    // A sync with nothing new leaves no import in the history.
    expect(db.select().from(imports).where(eq(imports.via, "enable_banking")).all().length).toBe(1);
  });

  it("the API first, then the CSV with the same rows: nothing new, every row linked", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const { bank, rows } = bankFromSample();
    const client = await connect(db, bank);
    await syncBanks(db, client, settings);
    expect(count(db)).toBe(rows);
    expect(db.select().from(transactions).where(eq(transactions.source, "enable_banking")).all().length).toBe(rows);
    // Transfers to my e-savings account are known from the account number in the API row.
    const esparId = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id;
    expect(db.select().from(transactions).where(eq(transactions.counterAccountId, esparId)).all().length).toBeGreaterThan(0);

    const sample = swedbankSample();
    const csv = importSwedbankCsv(db, sample.bytes, sample.name);
    expect(csv).toMatchObject({ rowsNew: 0, rowsLinked: rows });
    expect(count(db)).toBe(rows);
    expect(importSwedbankCsv(db, sample.bytes, sample.name)).toMatchObject({ rowsNew: 0, rowsLinked: 0 });
    await syncBanks(db, client, settings);
    expect(count(db)).toBe(rows);
  });
});

describe("Enable Banking: the bank sends the same transactions again under new references", () => {
  it("in Swedbank's other shape, a day later: nothing new; a real new purchase the same day still comes in", async () => {
    const db = freshDb({ seeded: true });
    const sample = swedbankSample();
    importSwedbankCsv(db, sample.bytes, sample.name);
    const { bank } = bankFromSample();
    const client = await connect(db, bank);
    await syncBanks(db, client, settings);
    const before = count(db);

    // The next answer: every transaction again, in the other shape with entry references.
    for (const a of Object.values(bank.accounts)) a.txs = a.txs.map((t, i) => asOtherShape(t, i));
    const acc = Object.values(bank.accounts)[0];
    const last = acc.txs.map((t) => t.booking_date!).sort().at(-1)!;
    const fresh: EbTransaction = {
      entry_reference: "00E3NEW",
      transaction_amount: { currency: "SEK", amount: "12.34" },
      credit_debit_indicator: "DBIT",
      status: "BOOK",
      booking_date: last,
      transaction_date: last,
      remittance_information: ["NY BUTIK       K0431", "Kortköp/uttag"],
    };
    acc.txs.push(fresh);
    const report = await syncBanks(db, client, settings);
    expect(report.connections[0].accounts.reduce((s, a) => s + a.rowsNew, 0)).toBe(1);
    expect(count(db)).toBe(before + 1);
    expect(db.select().from(transactions).where(eq(transactions.entryReference, "00E3NEW")).get()).toMatchObject({ descriptionClean: "NY BUTIK", amount: -1234 });
    // And again: still nothing.
    await syncBanks(db, client, settings);
    expect(count(db)).toBe(before + 1);
  });
});

describe("Enable Banking: the text as the files have it (real answers, names made up)", () => {
  const base = (o: Partial<EbTransaction>): EbTransaction => ({
    transaction_amount: { currency: "SEK", amount: "100.00" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-09-17",
    transaction_date: "2026-09-16",
    ...o,
  });
  const own = [{ clearing: "80000", accountRef: "••5678" }];
  const bank = (o: Partial<EbTransaction>) => mapTransaction(base(o), { accountId: 1, kind: "bank", own, accountRef: "••1234" })!;
  const card = (o: Partial<EbTransaction>) => mapTransaction(base(o), { accountId: 4, kind: "card", own: [] })!;

  it("Swedbank: the message, Swish types first, a transfer's number as its counterpart", () => {
    expect(bank({ bank_transaction_code: { description: "Kortköp/uttag" }, remittance_information: ["Amazon Prime"], creditor: { name: "Amazon Prime" }, creditor_account: { iban: "SE1280000800001234561234" } })).toMatchObject({ descriptionClean: "Amazon Prime", counterRef: null });
    expect(bank({ bank_transaction_code: { description: "Swish" }, remittance_information: ["Avanza"] }).descriptionClean).toBe("Swish Avanza");
    expect(bank({ bank_transaction_code: { description: "Swish skickad" }, remittance_information: ["+46701234567"] }).descriptionClean).toBe("Swish skickad +46701234567");
    expect(bank({ bank_transaction_code: { description: "Överföring via internet" }, remittance_information: ["800001234565678"], creditor: { name: "KONTOHAVARE" } })).toMatchObject({
      descriptionClean: "Överföring via internet",
      counterRef: "80000-••5678",
    });
    expect(bank({ credit_debit_indicator: "CRDT", bank_transaction_code: { description: "Sparränta" }, remittance_information: [] }).descriptionClean).toBe("Sparränta");
  });

  it("Swedbank's other shape (type as the last line, card or reference after the text) gives the same text", () => {
    expect(bank({ remittance_information: ["NETFLIX         K0431", "Kortköp/uttag"] }).descriptionClean).toBe("NETFLIX");
    expect(bank({ remittance_information: ["GOOGLE*CLOUD KLMVNK K0123", "Kortköp/uttag"] }).descriptionClean).toBe("GOOGLE*CLOUD KLMVNK");
    expect(bank({ remittance_information: ["DEEPSEEKAPI           12345678901", "Kortköp/uttag"] }).descriptionClean).toBe("DEEPSEEKAPI");
    expect(bank({ remittance_information: ["+46701234567    1832657027684083", "swish skickad"] }).descriptionClean).toBe("Swish skickad +46701234567");
    expect(bank({ remittance_information: ["Exempelbutiken  1832252314270587", "swish"] }).descriptionClean).toBe("Swish Exempelbutiken");
    expect(bank({ remittance_information: ["Överföring via internet"] }).descriptionClean).toBe("Överföring via internet");
    // A message that only looks like a type stays a message when the bank gives the type itself.
    expect(bank({ bank_transaction_code: { description: "Swish" }, remittance_information: ["Lön"] }).descriptionClean).toBe("Swish Lön");
  });

  it("Bank Norwegian: the merchant's name without town, the merchant category, 'Betalning' a card payment", () => {
    expect(
      card({ bank_transaction_code: { code: "Köp", description: "Grocery Stores, Supermarkets        " }, creditor: { name: "ICA KVANTUM EXEMPEL" }, remittance_information: ["ICA KVANTUM EXEMPEL      EXEMPELSTAD   SE"] }),
    ).toMatchObject({ descriptionClean: "ICA KVANTUM EXEMPEL", merchantCategory: "Grocery Stores, Supermarkets", bookingDate: "2026-09-16", postedDate: "2026-09-17" });
    expect(card({ credit_debit_indicator: "CRDT", bank_transaction_code: { code: "Betalning", description: null }, creditor: null, remittance_information: ["KONTOHAVARE", "Inbetalning"] })).toMatchObject({
      descriptionClean: "Inbetalning",
      counterparty: "Bank Norwegian",
      merchantCategory: null,
      forced: { categoryKey: "card_payment" },
    });
    expect(card({ credit_debit_indicator: "CRDT", bank_transaction_code: { code: "Betalning" }, remittance_information: ["Från KONTOHAVARE"] })).toMatchObject({ descriptionClean: "Från KONTOHAVARE", forced: { categoryKey: "card_payment" } });
    expect(card({ status: "PDNG", booking_date: null, bank_transaction_code: { code: "Reserverat" }, creditor: { name: "" }, remittance_information: ["09-19 10:30:24 Systembolaget EXEMPELSTAD SE", "Systembolaget"] }).descriptionClean).toBe("Systembolaget");
  });

  it("account numbers are masked everywhere in the stored JSON, phone numbers and texts left", () => {
    expect(maskRaw({ remittance_information: ["800001234561234", "+46701234567", "SK1234567890"], creditor: { name: "800001234565678" }, debtor_account: { iban: "SE1280000800001234561234" } })).toEqual({
      remittance_information: ["••1234", "+46701234567", "SK1234567890"],
      creditor: { name: "••5678" },
      debtor_account: { iban: "••1234" },
    });
  });
});

describe("Enable Banking: paging like Swedbank", () => {
  it("empty pages first and the same continuation_key on every page: fetched until there is no key", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const bank: FakeBank = { accounts: { "uid-1234": { ids: { iban: iban("800001234561234") }, txs: [] } }, calls: [] };
    const client = await connect(db, bank);
    // Swedbank: five empty pages, then rows, the key the same throughout.
    const pages = [[], [], [], [], [], ["2026-09-01", "2026-09-02"], ["2026-09-03"]];
    let served = 0;
    const swedbank: FetchLike = async (url, init) => {
      if (!url.includes("/transactions")) return fakeApi(bank)(url, init);
      const days = pages[served++];
      const rows = days.map((d) => ({ transaction_amount: { currency: "SEK", amount: "10.00" }, credit_debit_indicator: "DBIT" as const, status: "BOOK", booking_date: d, transaction_date: d, bank_transaction_code: { description: "Kortköp/uttag" }, remittance_information: [`KIOSK ${d}`] }));
      return { status: 200, json: async () => ({ transactions: rows, continuation_key: served < pages.length ? "samma-nyckel" : null }) };
    };
    const report = await syncBanks(db, new EbClient(settings, swedbank), settings);
    expect(report.connections[0].accounts[0]).toMatchObject({ pages: 7, fetched: 3, rowsNew: 3 });
  });
});

describe("Enable Banking: the schedule", () => {
  it("never makes the first fetch of an account: that waits for Synka nu and its preview", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const { bank } = bankFromSample();
    const client = await connect(db, bank);
    const r = await syncBanks(db, client, settings, { onlySynced: true });
    expect(r.connections[0].accounts[0].error).toMatch(/Väntar på första hämtningen/);
    expect(bank.calls.some((c) => c.includes("/transactions"))).toBe(false);
    expect(count(db)).toBe(0);
    await syncBanks(db, client, settings);
    const after = count(db);
    await syncBanks(db, client, settings, { onlySynced: true });
    expect(count(db)).toBe(after);
    expect(bank.calls.filter((c) => c.includes("/transactions") && c.includes("date_from=")).length).toBeGreaterThan(0);
  });
});

describe("Enable Banking: the rows", () => {
  const tx = (o: Partial<EbTransaction> & { amount: string; date: string; text: string }): EbTransaction => ({
    entry_reference: o.entry_reference ?? `${o.date}-${o.text}`,
    transaction_amount: { currency: "SEK", amount: o.amount.replace("-", "") },
    credit_debit_indicator: o.amount.startsWith("-") ? "DBIT" : "CRDT",
    status: o.status ?? "BOOK",
    booking_date: o.date,
    transaction_date: o.date,
    remittance_information: [o.text],
  });

  it("pending (PDNG) rows are kept aside, out of every sum, until they come back booked", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const bank: FakeBank = { accounts: { "uid-1234": { ids: { iban: iban("800001234561234") }, txs: [tx({ amount: "-89.00", date: "2026-09-18", text: "ICA NARA", status: "PDNG", entry_reference: "p1" })] } }, calls: [] };
    const client = await connect(db, bank);
    await syncBanks(db, client, settings);
    expect(count(db)).toBe(0);
    expect(db.select().from(bankPending).all()).toMatchObject([{ amount: -8900, description: "ICA NARA" }]);

    bank.accounts["uid-1234"].txs = [tx({ amount: "-89.00", date: "2026-09-19", text: "ICA NARA", entry_reference: "b1" })];
    await syncBanks(db, client, settings);
    expect(db.select().from(transactions).all()).toMatchObject([{ amount: -8900, bookingDate: "2026-09-19", source: "enable_banking", entryReference: "b1" }]);
    expect(db.select().from(bankPending).all()).toEqual([]);
  });

  it("transfers without account numbers pair on amount, day and text between my two accounts", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const bank: FakeBank = {
      accounts: {
        "uid-1234": { ids: { iban: iban("800001234561234") }, txs: [tx({ amount: "400.00", date: "2026-09-17", text: "Överföring via internet" })] },
        "uid-5678": { ids: { iban: iban("800001234565678") }, txs: [tx({ amount: "-400.00", date: "2026-09-17", text: "Överföring via internet" })] },
      },
      calls: [],
    };
    const client = await connect(db, bank);
    const report = await syncBanks(db, client, settings);
    expect(report.connections[0].accounts.reduce((s, a) => s + a.transfersPaired, 0)).toBe(1);
    const rows = db.select().from(transactions).all();
    expect(rows.every((r) => r.isTransfer && r.transferPairId !== null)).toBe(true);
  });

  it("links on day and amount when the texts differ, if only one row on each side has them", () => {
    const ex = [
      { id: 1, matchKey: "2026-09-04|-15400|pizzeriaroma", bookingDate: "2026-09-04", amount: -15400 },
      { id: 2, matchKey: "2026-09-04|-5000|kiosk", bookingDate: "2026-09-04", amount: -5000 },
      { id: 3, matchKey: "2026-09-04|-5000|kiosk", bookingDate: "2026-09-04", amount: -5000 },
    ];
    const pairs = pairByMatch(
      [
        { bookingDate: "2026-09-04", amount: -15400, descriptionClean: "PIZZERIA ROMA" },
        { bookingDate: "2026-09-04", amount: -5000, descriptionClean: "Kiosken" },
      ],
      ex,
    );
    // The pizza is the only -154 kr that day; two kiosk rows are ambiguous, so nothing is guessed.
    expect([...pairs]).toEqual([[0, 1]]);
  });
});

describe("Enable Banking: consent", () => {
  it("a consent that has run out stops the sync and shows in Att göra; under 14 days left is a task too", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const { bank } = bankFromSample();
    bank.validUntil = "2026-09-25T10:00:00+00:00";
    const client = await connect(db, bank);
    expect(buildOverview(db, "2026-09-19").tasks.filter((t) => t.kind === "bank").map((t) => t.text)).toEqual(["Swedbank: samtycket går ut om 6 dagar (25/9)"]);

    const report = await syncBanks(db, client, settings, { now: new Date("2026-09-26T08:00:00Z") });
    expect(report.connections[0]).toMatchObject({ status: "expired", accounts: [] });
    expect(bank.calls.some((c) => c.includes("/transactions"))).toBe(false);
    expect(buildOverview(db, "2026-09-26").tasks.filter((t) => t.kind === "bank").map((t) => t.text)).toEqual([
      "Swedbank: samtycket har gått ut – förnya det så hämtas raderna igen",
    ]);
  });

  it("the API: status, a sync failing at the bank is noted on the connection and sent to ntfy", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const { bank } = bankFromSample();
    const failing: FetchLike = async (url, init) =>
      url.includes("/transactions") ? { status: 429, json: async () => ({ message: "Too many requests", error: "ASPSP_RATE_LIMIT_EXCEEDED" }) } : fakeApi(bank)(url, init);
    const s = { ...settings, ntfyTopic: "min-topic" };
    const client = new EbClient(s, failing);
    await startConnection(db, client, s, "Swedbank");
    await completeConnection(db, client, { code: "ok", state: db.select().from(bankConnections).get()!.state! });
    const ntfy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", ntfy);
    const app = createApp(db, { databasePath: ":memory:", bankService: createBankService(db, s, client) });
    const r = await (await app.request("/api/enable-banking/sync", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).json();
    expect(r.connections[0].error).toMatch(/Swedbank tillåter fyra hämtningar av kontot per dygn/);
    expect(ntfy).toHaveBeenCalledWith("https://ntfy.sh", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((ntfy.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ topic: "min-topic", title: "Swedbank: synken misslyckades" });
    const status = await (await app.request("/api/enable-banking/status")).json();
    expect(status.connections[0]).toMatchObject({ bank: "Swedbank", status: "active", lastError: expect.stringMatching(/dagens är använda/) });
    expect(buildOverview(db, "2026-09-19").tasks.some((t) => t.kind === "bank" && /synken misslyckades/.test(t.text))).toBe(true);
  });

  it("the callback route answers with a redirect to Inställningar, also on an error", async () => {
    const db = freshDb({ seeded: true });
    const { bank } = bankFromSample();
    const client = new EbClient(settings, fakeApi(bank));
    const app = createApp(db, { databasePath: ":memory:", bankService: createBankService(db, settings, client) });
    const res = await app.request("/api/enable-banking/callback?state=okänd&code=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/installningar\?bank=fel&meddelande=.+#banks$/);
    expect((await app.request("/privacy")).status).toBe(200);
    expect(await (await app.request("/terms")).text()).toContain("Villkor");
  });
});

// A card account through the API: purchase day as the booking date, like the Norwegian files.
describe("Enable Banking: card rows", () => {
  it("Bank Norwegian: dated by purchase day, shared by default, the bank's day as the posting day", async () => {
    const db = freshDb({ seeded: true });
    const bank: FakeBank = {
      accounts: {
        "uid-card": {
          ids: { iban: "NO9386011117947" },
          txs: [{ entry_reference: "n1", transaction_amount: { currency: "SEK", amount: "142.50" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-09-17", transaction_date: "2026-09-16", remittance_information: ["COOP EXEMPELVAGEN"] }],
        },
      },
      calls: [],
    };
    const client = new EbClient(settings, fakeApi(bank));
    await startConnection(db, client, settings, "Bank Norwegian");
    await completeConnection(db, client, { code: "ok", state: db.select().from(bankConnections).get()!.state! });
    await syncBanks(db, client, settings);
    expect(db.select().from(transactions).all()).toMatchObject([{ bookingDate: "2026-09-16", postedDate: "2026-09-17", amount: -14250, shared: true, source: "enable_banking" }]);
  });
});

describe("Enable Banking: the bank's daily limit", () => {
  // Made-up accounts, in the shape of Swedbank's real refusal (2026-09-20 18:00).
  const refusal = (ref: string) => ({
    status: 429,
    json: async () => ({ message: `Consent daily limit 4 is exceeded for SE2180000800001234560${ref} account service BALANCES`, error: "ASPSP_RATE_LIMIT_EXCEEDED" }),
  });

  it("runs three times a day, leaving the fourth fetch for Synka nu", () => {
    expect(SYNC_CRON).toBe("0 6,12,18 * * *");
    // Swedish time, summer and winter.
    expect(nextSyncText(new Date("2026-09-20T16:00:00Z"))).toBe("i morgon kl. 06");
    expect(nextSyncText(new Date("2026-09-21T06:15:00Z"))).toBe("kl. 12");
    expect(nextSyncText(new Date("2026-12-01T05:30:00Z"))).toBe("kl. 12");
  });

  it("a refused balance keeps what the transactions brought, and says so in Swedish without an account number", async () => {
    const db = freshDb({ seeded: true });
    bindSwedbank(db);
    const bank: FakeBank = {
      accounts: {
        "uid-1234": { ids: { iban: iban("800001234561234") }, txs: [] },
        "uid-5678": { ids: { iban: iban("800001234565678") }, txs: [] },
      },
      calls: [],
    };
    const client = await connect(db, bank);
    const day = (d: string, text: string, status = "BOOK") => ({
      entry_reference: `${d}-${text}`,
      transaction_amount: { currency: "SEK", amount: "25.00" },
      credit_debit_indicator: "DBIT" as const,
      status,
      booking_date: d,
      transaction_date: d,
      remittance_information: [text],
    });
    bank.accounts["uid-1234"].txs = [day("2026-09-19", "KIOSK"), day("2026-09-20", "ICA NARA", "PDNG")];
    const limited: FetchLike = async (url, init) => {
      const m = /\/accounts\/uid-(\d{4})\/balances/.exec(url);
      return m ? refusal(m[1]) : fakeApi(bank)(url, init);
    };

    const report = await syncBanks(db, new EbClient(settings, limited), settings, { now: new Date("2026-09-20T16:00:00Z") });
    const privat = report.connections[0].accounts.find((a) => a.maskedRef === "••1234")!;
    // The transactions came in, and the account knows how far it has got.
    expect(privat.rowsNew).toBe(1);
    const row = db.select().from(bankAccounts).where(eq(bankAccounts.maskedRef, "••1234")).get()!;
    expect(row.lastBookingDate).toBe("2026-09-19");
    expect(row.lastSyncAt).toBe("2026-09-20T16:00:00.000Z");
    expect(db.select().from(bankPending).all()).toMatchObject([{ description: "ICA NARA" }]);

    // One sentence for both accounts, in Swedish, with the next attempt.
    const conn = db.select().from(bankConnections).get()!;
    expect(conn.lastError).toBe("Swedbank tillåter fyra hämtningar av saldot per dygn när du inte är inloggad, och dagens är använda. Nästa försök i morgon kl. 06.");
    expect(conn.lastError).not.toMatch(/\d{5,}/);
  });

  it("never lets an account number through in any other error either", () => {
    expect(maskAccountText("Account SE21 8000 0820 1612 3456 0834 not found; see 800001234565678")).toBe("Account ••0834 not found; see ••5678");
    const e = new EbApiError(400, "Wrong account SE2180000800001234560834", "WRONG_ACCOUNT");
    expect(bankErrorText(e, "Swedbank", new Date())).toBe("Wrong account ••0834 (WRONG_ACCOUNT)");
  });
});
