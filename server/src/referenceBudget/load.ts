import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  REFERENCE_BUDGET_CONDITIONS,
  REFERENCE_BUDGET_SCOPES,
  referenceBudgetAdjustments,
  referenceBudgetAmounts,
  referenceBudgetItems,
  referenceBudgetYears,
} from "../db/schema.js";
import { SCB_KPI } from "../prices/scb.js";

/**
 * Konsumentverkets referensbudget, one JSON file per year in
 * `server/reference-budget/`. A new year is a new file and a restart — no
 * code. The file is the truth: a year whose file changed is replaced whole,
 * in one transaction, so a corrected typo reaches the database and a
 * half-read year never does.
 *
 * Amounts in the file are whole kronor per month, as Konsumentverket prints
 * them; they are stored in öre. A cell the publication leaves empty is left
 * out of the file and has no row. The published totals are not in the file:
 * they are worked out from the items.
 */

export const REFERENCE_BUDGET_DIR = path.resolve(import.meta.dirname, "../../reference-budget");

type Scope = (typeof REFERENCE_BUDGET_SCOPES)[number];
type Condition = (typeof REFERENCE_BUDGET_CONDITIONS)[number];

export interface ReferenceBudgetFile {
  year: number;
  source: { title: string; url: string };
  note?: string;
  /** A month to read the figures' price level at; left out, the year's KPI average is used. */
  priceBase?: string;
  priceBaseNote?: string;
  ageGroups: { key: string; label: string }[];
  householdSizes: number[];
  items: { key: string; scope: Scope; choice?: string; name: string; description?: string; kpi?: string; amounts: Record<string, number> }[];
  adjustments?: { item: string; condition: Condition; amount: number; note?: string }[];
}

export class ReferenceBudgetError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Checks a year's file and returns it typed. Everything that would make a
 * figure wrong is refused rather than guessed at: an amount that is not a
 * whole number of kronor, an age group or household size the file does not
 * declare, an item twice, or a footnote the calculation does not understand.
 */
export function parseReferenceBudget(text: string, fileName = "filen"): ReferenceBudgetFile {
  const fail = (why: string): never => {
    throw new ReferenceBudgetError(`${fileName}: ${why}`);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail(`inte giltig JSON (${(e as Error).message})`);
  }
  if (!isObject(raw)) return fail("ska vara ett objekt");

  const year = raw.year;
  if (!Number.isInteger(year) || (year as number) < 2000 || (year as number) > 2100) fail("year ska vara ett årtal");
  if (!isObject(raw.source) || !isText(raw.source.title) || !isText(raw.source.url)) fail("source ska ha title och url");
  if (raw.note !== undefined && typeof raw.note !== "string") fail("note ska vara text");
  if (raw.priceBase !== undefined && (typeof raw.priceBase !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.priceBase))) fail("priceBase ska vara en månad, ÅÅÅÅ-MM");
  // A KPI group must be one SCB is asked for, or the adjustment would have nothing to go on.
  const kpiCodes = new Set(SCB_KPI.series.map((x) => x.coicop));

  if (!Array.isArray(raw.ageGroups) || raw.ageGroups.length === 0) fail("ageGroups saknas");
  const ageKeys = new Set<string>();
  for (const g of raw.ageGroups as unknown[]) {
    if (!isObject(g) || !isText(g.key) || !isText(g.label)) fail("varje åldersgrupp ska ha key och label");
    const key = (g as { key: string }).key;
    if (ageKeys.has(key)) fail(`åldersgruppen ${key} finns två gånger`);
    ageKeys.add(key);
  }

  if (!Array.isArray(raw.householdSizes) || raw.householdSizes.length === 0) fail("householdSizes saknas");
  const sizeKeys = new Set<string>();
  for (const s of raw.householdSizes as unknown[]) {
    if (!Number.isInteger(s) || (s as number) < 1) fail(`hushållsstorleken ${String(s)} är inget antal personer`);
    if (sizeKeys.has(String(s))) fail(`hushållsstorleken ${String(s)} finns två gånger`);
    sizeKeys.add(String(s));
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) fail("items saknas");
  const itemKeys = new Set<string>();
  for (const it of raw.items as unknown[]) {
    if (!isObject(it) || !isText(it.key) || !isText(it.name)) fail("varje post ska ha key och name");
    const item = it as Record<string, unknown> & { key: string };
    if (itemKeys.has(item.key)) fail(`posten ${item.key} finns två gånger`);
    itemKeys.add(item.key);
    if (!REFERENCE_BUDGET_SCOPES.includes(item.scope as Scope)) fail(`${item.key}: scope ska vara individual eller household`);
    if (item.choice !== undefined && !isText(item.choice)) fail(`${item.key}: choice ska vara text`);
    if (item.description !== undefined && typeof item.description !== "string") fail(`${item.key}: description ska vara text`);
    if (item.kpi !== undefined && (typeof item.kpi !== "string" || !kpiCodes.has(item.kpi))) {
      fail(`${item.key}: KPI-gruppen ${String(item.kpi)} hämtas inte från SCB (lägg till den i server/src/prices/scb-kpi.json)`);
    }
    if (!isObject(item.amounts) || Object.keys(item.amounts).length === 0) fail(`${item.key}: amounts saknas`);
    const brackets = item.scope === "individual" ? ageKeys : sizeKeys;
    for (const [bracket, amount] of Object.entries(item.amounts as Record<string, unknown>)) {
      if (!brackets.has(bracket)) fail(`${item.key}: ${bracket} är ${item.scope === "individual" ? "ingen åldersgrupp" : "ingen hushållsstorlek"} i filen`);
      if (!Number.isInteger(amount) || (amount as number) < 0) fail(`${item.key} ${bracket}: beloppet ska vara hela kronor, 0 eller mer`);
    }
  }

  if (raw.adjustments !== undefined && !Array.isArray(raw.adjustments)) fail("adjustments ska vara en lista");
  const seen = new Set<string>();
  for (const a of (raw.adjustments ?? []) as unknown[]) {
    if (!isObject(a)) return fail("varje justering ska vara ett objekt");
    if (!isText(a.item) || !itemKeys.has(a.item)) fail(`justeringen gäller ${String(a.item)}, som inte är en post i filen`);
    if (!REFERENCE_BUDGET_CONDITIONS.includes(a.condition as Condition)) {
      fail(`${String(a.item)}: villkoret ${String(a.condition)} känns inte igen (${REFERENCE_BUDGET_CONDITIONS.join(", ")})`);
    }
    if (!Number.isInteger(a.amount)) fail(`${String(a.item)} ${String(a.condition)}: beloppet ska vara hela kronor`);
    const k = `${String(a.item)}|${String(a.condition)}`;
    if (seen.has(k)) fail(`${String(a.item)} ${String(a.condition)} finns två gånger`);
    seen.add(k);
  }

  return raw as unknown as ReferenceBudgetFile;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Replaces one year with what the file says, in the caller's transaction. */
function writeYear(db: Db, file: ReferenceBudgetFile, hash: string): void {
  // Children first: the cascade needs foreign keys on, and this must not depend on it.
  db.delete(referenceBudgetAdjustments).where(eq(referenceBudgetAdjustments.year, file.year)).run();
  db.delete(referenceBudgetAmounts).where(eq(referenceBudgetAmounts.year, file.year)).run();
  db.delete(referenceBudgetItems).where(eq(referenceBudgetItems.year, file.year)).run();
  db.delete(referenceBudgetYears).where(eq(referenceBudgetYears.year, file.year)).run();

  db.insert(referenceBudgetYears)
    .values({
      year: file.year,
      sourceTitle: file.source.title,
      sourceUrl: file.source.url,
      note: file.note ?? null,
      ageGroups: JSON.stringify(file.ageGroups.map(({ key, label }) => ({ key, label }))),
      householdSizes: JSON.stringify(file.householdSizes),
      sourceHash: hash,
      priceBase: file.priceBase ?? null,
    })
    .run();
  file.items.forEach((it, i) => {
    db.insert(referenceBudgetItems)
      .values({ year: file.year, key: it.key, scope: it.scope, choice: it.choice ?? null, name: it.name, description: it.description ?? null, sortOrder: i, kpi: it.kpi ?? null })
      .run();
    for (const [bracket, kronor] of Object.entries(it.amounts)) {
      db.insert(referenceBudgetAmounts).values({ year: file.year, itemKey: it.key, bracket, amountOre: kronor * 100 }).run();
    }
  });
  for (const a of file.adjustments ?? []) {
    db.insert(referenceBudgetAdjustments).values({ year: file.year, itemKey: a.item, condition: a.condition, amountOre: a.amount * 100, note: a.note ?? null }).run();
  }
}

export interface ReferenceBudgetSync {
  /** Years written: new, or replaced because the file changed. */
  loaded: { year: number; replaced: boolean }[];
  unchanged: number[];
  /** Files that could not be read; the year in the database, if any, is left as it was. */
  errors: string[];
  /** Years in the database with no file any more. Left alone: nothing is deleted behind your back. */
  withoutFile: number[];
}

/**
 * Reads every `<year>.json` in the folder and brings the database in line:
 * a new year is added, a year whose file changed is replaced, an unchanged
 * one is left. A bad file is reported and skipped — the rest still load,
 * and the start of the server is never stopped by it.
 */
export function syncReferenceBudgets(db: Db, dir = REFERENCE_BUDGET_DIR): ReferenceBudgetSync {
  const out: ReferenceBudgetSync = { loaded: [], unchanged: [], errors: [], withoutFile: [] };
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort() : [];
  const stored = new Map(db.select({ year: referenceBudgetYears.year, hash: referenceBudgetYears.sourceHash }).from(referenceBudgetYears).all().map((r) => [r.year, r.hash]));
  const inFiles = new Set<number>();

  for (const name of files) {
    // By the name, so that a year whose file is broken is not also reported as having none.
    inFiles.add(Number(name.slice(0, 4)));
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const file = parseReferenceBudget(text, name);
      if (String(file.year) !== name.slice(0, 4)) throw new ReferenceBudgetError(`${name}: filen säger år ${file.year}`);
      const hash = sha256(text);
      if (stored.get(file.year) === hash) {
        out.unchanged.push(file.year);
        continue;
      }
      db.transaction((tx) => writeYear(tx as unknown as Db, file, hash));
      out.loaded.push({ year: file.year, replaced: stored.has(file.year) });
    } catch (e) {
      if (!(e instanceof ReferenceBudgetError)) throw e;
      out.errors.push(e.message);
    }
  }
  out.withoutFile = [...stored.keys()].filter((y) => !inFiles.has(y)).sort();
  return out;
}
