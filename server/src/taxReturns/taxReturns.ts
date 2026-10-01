import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { taxReturns } from "../db/schema.js";
import { TAX_RETURN_BOXES, type TaxReturnBoxes } from "../import/taxReturn.js";
import { boxesOf } from "../import/importTaxReturn.js";

export class TaxReturnError extends Error {}

export interface TaxReturn {
  incomeYear: number;
  submittedAt: string | null;
  source: "pdf" | "manual";
  boxes: TaxReturnBoxes;
  updatedAt: string;
}

const toTaxReturn = (r: typeof taxReturns.$inferSelect): TaxReturn => ({
  incomeYear: r.incomeYear,
  submittedAt: r.submittedAt,
  source: r.source,
  boxes: boxesOf(r),
  updatedAt: r.updatedAt,
});

/** Every income year's return, newest first. */
export function listTaxReturns(db: Db): TaxReturn[] {
  return db.select().from(taxReturns).orderBy(desc(taxReturns.incomeYear)).all().map(toTaxReturn);
}

/** The income years' returns by year. */
export function taxReturnsByYear(db: Db): Map<number, TaxReturn> {
  return new Map(listTaxReturns(db).map((r) => [r.incomeYear, r]));
}

/**
 * A year entered or changed by hand: it is then the tool's own, no longer the
 * receipt's (the receipt's import can't be undone any more). Öre; a box left
 * empty is null.
 */
export function saveTaxReturn(db: Db, incomeYear: number, body: { submittedAt?: unknown; boxes?: Record<string, unknown> }, today: string): TaxReturn {
  if (!Number.isInteger(incomeYear) || incomeYear < 2000 || incomeYear > Number(today.slice(0, 4))) throw new TaxReturnError("Skriv ett inkomstår som har varit.");
  const submittedAt = body.submittedAt === null || body.submittedAt === undefined || body.submittedAt === "" ? null : String(body.submittedAt);
  if (submittedAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(submittedAt)) throw new TaxReturnError("Skriv datumet som ÅÅÅÅ-MM-DD.");
  const boxes = {} as TaxReturnBoxes;
  for (const k of Object.values(TAX_RETURN_BOXES)) {
    const v = body.boxes?.[k];
    if (v === null || v === undefined || v === "") boxes[k] = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0) boxes[k] = v;
    else throw new TaxReturnError("Beloppen ska vara noll kronor eller mer.");
  }
  if (Object.values(boxes).every((v) => v === null)) throw new TaxReturnError("Fyll i minst en rad.");
  const values = { submittedAt, ...boxes, source: "manual" as const, importId: null, previous: null, updatedAt: new Date().toISOString() };
  db.insert(taxReturns)
    .values({ incomeYear, ...values })
    .onConflictDoUpdate({ target: taxReturns.incomeYear, set: values })
    .run();
  return toTaxReturn(db.select().from(taxReturns).where(eq(taxReturns.incomeYear, incomeYear)).get()!);
}

export function deleteTaxReturn(db: Db, incomeYear: number): boolean {
  return db.delete(taxReturns).where(eq(taxReturns.incomeYear, incomeYear)).run().changes > 0;
}
