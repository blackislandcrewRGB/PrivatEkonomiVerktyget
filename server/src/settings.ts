import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { contacts, settings } from "./db/schema.js";
import { normalizePhone } from "./categorize/counterparty.js";

const PARTNER_NUMBERS = "partner_swish_numbers";

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: Db, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  db.insert(settings).values({ key, value: json }).onConflictDoUpdate({ target: settings.key, set: { value: json } }).run();
}

/** The partner's Swish numbers in +46 form. Incoming Swish from these is 'Inkomst › Från partner'. */
export function getPartnerNumbers(db: Db): string[] {
  return getSetting<string[]>(db, PARTNER_NUMBERS, []);
}

/** Normalizes and stores the numbers. Returns the stored list, or throws on an invalid number. */
export function setPartnerNumbers(db: Db, numbers: string[]): string[] {
  const normalized: string[] = [];
  for (const n of numbers.map((s) => s.trim()).filter(Boolean)) {
    const p = normalizePhone(n);
    if (!p) throw new Error(`Ogiltigt telefonnummer: ${n}`);
    if (!normalized.includes(p)) normalized.push(p);
  }
  setSetting(db, PARTNER_NUMBERS, normalized);
  return normalized;
}

const SETTLEMENT_START = "settlement_start_month";

/**
 * First month of the shared economy's running balance: earlier months are
 * shown but carry nothing forward. Stored the first time it is needed (the
 * month before `today`), so results don't shift as time passes.
 */
export function getSettlementStart(db: Db, today: string): string {
  const stored = getSetting<string | null>(db, SETTLEMENT_START, null);
  if (stored && /^\d{4}-\d{2}$/.test(stored)) return stored;
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  setSetting(db, SETTLEMENT_START, prev);
  return prev;
}

export function setSettlementStart(db: Db, month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Månaden ska vara ÅÅÅÅ-MM.");
  setSetting(db, SETTLEMENT_START, month);
  return month;
}

const OWN_NAME = "own_name";

/** My own name as I entered it (Inställningar › Partner), for my initial in Delad ekonomi; null when not given. */
export function getOwnName(db: Db): string | null {
  const name = getSetting<string | null>(db, OWN_NAME, null);
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Stores my name (trimmed, at most 40 characters); empty clears it. */
export function setOwnName(db: Db, name: string | null): string | null {
  const clean = (name ?? "").trim().slice(0, 40);
  setSetting(db, OWN_NAME, clean || null);
  return clean || null;
}

/** The partner's display name: the contact for her Swish number, else 'partnern'. */
export function getPartnerName(db: Db): string {
  const number = getPartnerNumbers(db)[0];
  if (!number) return "partnern";
  return db.select().from(contacts).where(eq(contacts.counterparty, number)).get()?.name ?? "partnern";
}

// ---------- Modules ----------

/**
 * Parts of the tool that are built for one kind of household and off in a new
 * database: Lön (the salary forecast from payslips and the collective
 * agreement's rates) and Pendling & bränsle (shifts and the fuel they need).
 * Switched on under Inställningar › Moduler; a database that was in use
 * before the switches existed has both on (data migration).
 */
export const MODULE_IDS = ["salary", "commute"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export type Modules = Record<ModuleId, boolean>;

const MODULES = "modules";

export function getModules(db: Db): Modules {
  const s = getSetting<Partial<Modules>>(db, MODULES, {});
  return { salary: s.salary === true, commute: s.commute === true };
}

/** Switches modules on or off; anything but true/false for a known module is refused. */
export function setModules(db: Db, patch: Record<string, unknown>): Modules {
  const next = getModules(db);
  for (const [key, value] of Object.entries(patch)) {
    if (!(MODULE_IDS as readonly string[]).includes(key)) throw new Error(`Okänd modul: ${key}.`);
    if (typeof value !== "boolean") throw new Error(`Modulen ${key} är på eller av.`);
    next[key as ModuleId] = value;
  }
  setSetting(db, MODULES, next);
  return next;
}
