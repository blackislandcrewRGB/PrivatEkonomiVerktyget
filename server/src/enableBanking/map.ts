import type { Account } from "../db/schema.js";
import { extractCounterparty } from "../categorize/counterparty.js";
import { assignOccurrenceIndexes, fingerprint } from "../import/fingerprint.js";
import type { ImportRow } from "../import/importCore.js";
import { isNorwegianPaymentText } from "../import/norwegianKey.js";
import { maskAccountNumber, normalizeWhitespace, parseAmountToOre } from "../import/text.js";
import { counterRefFromReference } from "../transfers/transfers.js";
import type { AccountIdentification, EbTransaction } from "./client.js";

/**
 * An API transaction as an import row, with the text the files have so the
 * rules hit (and the rows are recognised, see matchKey). Checked against the
 * real answers (2026-09-19):
 * - Swedbank: the transaction type is in bank_transaction_code.description
 *   ('Kortköp/uttag', 'Swish skickad', 'Överföring via internet'…) and the
 *   message in remittance_information. The CSV's Beskrivning is the message,
 *   'Swish …' types put the type first ('Swish Avanza', 'Swish skickad +46…'),
 *   and a transfer's message is the other account's number (the CSV's Referens)
 *   with the type as text. creditor_account is the account itself, not the
 *   counterpart, so the counterpart comes from that number.
 * - Bank Norwegian: a purchase's text is creditor.name (the message adds town
 *   and country), otherwise the message's last line ('Inbetalning', 'Från …').
 *   The merchant category is in bank_transaction_code.description, payments
 *   have the code 'Betalning'. Rows are dated by purchase day like the files
 *   (the bank's booking day is the posting day).
 * - Swedbank sometimes answers in another shape (seen 2026-09-19 18:00, the
 *   same transactions as at 12:09): no bank_transaction_code, the type as the
 *   message's last line ('Kortköp/uttag', 'swish skickad'), and the card
 *   ('SHOPNAME K0784') or the Swish reference ('Gameshop 1832252314270587')
 *   after the text. Read back to the same text as the other shape.
 * Amounts in öre, negative out (DBIT). Account numbers are only kept masked,
 * also in the stored JSON.
 */

export type AccountKind = "bank" | "card";

export interface MappedRow extends Omit<ImportRow, "fingerprint" | "occurrenceIndex"> {
  status: string;
}

/** The digits of an account identification: an IBAN without country and check digits, or the other id. */
function accountDigits(id: AccountIdentification | null | undefined): string | null {
  const raw = id?.iban ? id.iban.replace(/\s/g, "").slice(4) : id?.other?.identification;
  const digits = raw?.replace(/\D/g, "") ?? "";
  return digits.length >= 6 ? digits : null;
}

/** Masked, like the files' 'Referens': my own account's 'clearing-••1234' when it is one, else the first five digits. */
export function counterRefFor(id: AccountIdentification | null | undefined, own: Pick<Account, "clearing" | "accountRef">[], self?: string | null): string | null {
  const digits = accountDigits(id);
  if (!digits) return null;
  const last4 = digits.slice(-4);
  // Swedbank gives the account itself here: that's no counterpart.
  if (self && self.slice(-4) === last4) return null;
  const mine = own.find((a) => a.clearing && a.accountRef?.slice(-4) === last4 && digits.includes(a.clearing));
  return mine ? `${mine.clearing}-••${last4}` : `${digits.slice(0, 5)}-••${last4}`;
}

/** The last four digits of an account in the session (IBAN or other id), masked: '••1234'. */
export function maskedRefOf(id: AccountIdentification | null | undefined, all?: { identification: string }[]): string | null {
  const digits = accountDigits(id) ?? all?.map((a) => a.identification.replace(/\D/g, "")).find((d) => d.length >= 6) ?? null;
  return digits ? maskAccountNumber(digits) : null;
}

const ACCOUNT_KEYS = new Set(["iban", "identification", "bban"]);
/** An account number on its own ('800001234561234' in Swedbank's message and name fields). */
const isAccountNumber = (s: string) => /^\d{10,17}$/.test(s.replace(/[\s-]/g, ""));
/** The transaction as stored: every account number masked to its last four digits. */
export function maskRaw(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => maskRaw(v, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskRaw(v, k)]));
  if (typeof value === "string" && ((ACCOUNT_KEYS.has(key) && /\d{5,}/.test(value)) || isAccountNumber(value))) return maskAccountNumber(value);
  return value;
}

const lines = (t: EbTransaction) => (t.remittance_information ?? []).map(normalizeWhitespace).filter(Boolean);
const typeOf = (t: EbTransaction) => normalizeWhitespace(t.bank_transaction_code?.description ?? "");

/** Swedbank's transaction types (bank_transaction_code.description, or the last message line in the other shape). */
const SWEDBANK_TYPES =
  /^(Överföring via internet|Kortköp\/uttag|Autogiro|Swish( mottagen| skickad| utbetalning| betalning| inbetalning)?|Bg-bet\. via internet|Pg-bet\. via internet|Lön|Debiteringsavgift|Insättning|Sparränta|Bg kontoinsättning|Preliminär skatt|Uttag)$/i;

/** A bank row's message lines and type, from either of Swedbank's shapes. */
function messageAndType(t: EbTransaction): { message: string; type: string } {
  const ls = lines(t);
  const own = typeOf(t);
  if (own || ls.length === 0 || !SWEDBANK_TYPES.test(ls.at(-1)!)) return { message: ls.join(" "), type: own };
  const last = ls.at(-1)!;
  return {
    type: last[0].toLocaleUpperCase("sv") + last.slice(1),
    // Without the card ('K0784') or a reference number after the text.
    message: ls
      .slice(0, -1)
      .map((l) => l.replace(/\s+K\d{4}$/, "").replace(/\s+\d{10,}$/, ""))
      .join(" "),
  };
}

/** The text as the files have it (see the top of the file). */
export function descriptionOf(t: EbTransaction, kind: AccountKind): string {
  if (kind === "card") {
    const name = normalizeWhitespace((t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name) ?? "");
    return name || lines(t).at(-1) || typeOf(t) || "(ingen text från banken)";
  }
  const { message, type } = messageAndType(t);
  if (/^swish\b/i.test(type)) return message ? `${type} ${message}` : type;
  if (isAccountNumber(message)) return type || "Överföring";
  return message || type || normalizeWhitespace((t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name) ?? "") || "(ingen text från banken)";
}

/** The counterpart of a bank account's row, masked: the number in a transfer's message, else the other side's account. */
function bankCounterRef(t: EbTransaction, own: Pick<Account, "clearing" | "accountRef">[], self: string | null, amount: number): string | null {
  const { message } = messageAndType(t);
  if (isAccountNumber(message)) return counterRefFromReference(message);
  return counterRefFor(amount < 0 ? t.creditor_account : t.debtor_account, own, self);
}

export function mapTransaction(
  t: EbTransaction,
  ctx: { accountId: number; kind: AccountKind; own: Pick<Account, "clearing" | "accountRef">[]; accountRef?: string | null },
): MappedRow | null {
  const ore = parseAmountToOre(t.transaction_amount.amount.replace(/^-/, ""));
  const bankDay = t.booking_date ?? t.value_date ?? t.transaction_date ?? null;
  if (ore === null || !bankDay) return null;
  const amount = t.credit_debit_indicator === "DBIT" ? -ore : ore;
  const descriptionRaw = descriptionOf(t, ctx.kind);
  const descriptionClean = normalizeWhitespace(descriptionRaw);
  const card = ctx.kind === "card";
  const payment = card && amount > 0 && (t.bank_transaction_code?.code === "Betalning" || isNorwegianPaymentText(descriptionClean));
  return {
    status: t.status,
    accountId: ctx.accountId,
    bookingDate: card ? (t.transaction_date ?? bankDay) : bankDay,
    transactionDate: t.transaction_date ?? null,
    postedDate: card ? bankDay : null,
    descriptionRaw,
    descriptionClean,
    counterparty: card ? (payment ? "Bank Norwegian" : descriptionClean) : extractCounterparty(descriptionClean),
    amount,
    currency: t.transaction_amount.currency || "SEK",
    cardMasked: null,
    // The card's merchant category, as in the Norwegian files ('GROCERY STORES/SUPERMARKETS').
    merchantCategory: card && !payment ? typeOf(t) || null : null,
    counterRef: card ? null : bankCounterRef(t, ctx.own, ctx.accountRef ?? null, amount),
    defaultShared: card,
    forced: payment ? { categoryKey: "card_payment", isTransfer: true, shared: false } : undefined,
    entryReference: t.entry_reference ?? t.transaction_id ?? null,
    bankRaw: JSON.stringify(maskRaw(t)),
  };
}

/**
 * Fingerprints for API rows: account, dates, amount and text, numbered like the
 * files' (two identical purchases the same day get 1 and 2). A row without an
 * entry reference gets one made from its fingerprint, so it is recognised later.
 */
export function withKeys(rows: MappedRow[]): ImportRow[] {
  const keyed = rows.map((r) => ({
    ...r,
    fingerprint: fingerprint(["enable_banking", r.accountId ?? "", r.bookingDate, r.transactionDate ?? "", r.amount, r.descriptionClean]),
  }));
  return assignOccurrenceIndexes(keyed).map(({ status: _, ...r }) => ({
    ...r,
    entryReference: r.entryReference ?? `fp:${r.fingerprint.slice(0, 16)}:${r.occurrenceIndex}`,
  }));
}
