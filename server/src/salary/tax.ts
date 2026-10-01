import { and, desc, eq, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { payslips, taxTableRows } from "../db/schema.js";

/**
 * Preliminary tax on a month's salary: Skatteverket's table (open data,
 * 'Skattetabeller för månadslön'), fetched on request and kept in the
 * database, or, without one, a curve from my own payslips: the effective
 * rate against gross, interpolated between the points. The table is read at
 * the gross in whole kronor, as the payslips do ('Beräknad på: 31507').
 */

export const SKV_DATASET = "https://skatteverket.entryscape.net/rowstore/dataset/88320397-5c32-4c16-ae79-d36d95b17b95/json";

type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface SkvRow {
  år: string;
  tabellnr: string;
  "antal dgr": string;
  "inkomst fr.o.m.": string;
  "inkomst t.o.m.": string;
  [column: string]: string;
}

/** Fetches a year's table and replaces what is stored for it. Returns the number of rows. */
export async function fetchTaxTable(db: Db, year: number, tableNo: number, fetchImpl: Fetch = fetch): Promise<number> {
  const rows: SkvRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const q = new URLSearchParams({ år: String(year), tabellnr: String(tableNo), _limit: "500", _offset: String(offset) });
    const res = await fetchImpl(`${SKV_DATASET}?${q}`);
    if (!res.ok) throw new Error("Skatteverket svarade inte.");
    const page = (await res.json()) as { results: SkvRow[] };
    rows.push(...page.results);
    if (page.results.length < 500) break;
  }
  if (rows.length === 0) throw new Error(`Skatteverket har ingen tabell ${tableNo} för ${year}.`);
  db.transaction((tx) => {
    tx.delete(taxTableRows).where(and(eq(taxTableRows.year, year), eq(taxTableRows.tableNo, tableNo))).run();
    for (const r of rows) {
      const columns = [1, 2, 3, 4, 5, 6].map((c) => Number(r[`kolumn ${c}`] || 0));
      tx.insert(taxTableRows)
        .values({ year, tableNo, kind: r["antal dgr"], incomeFrom: Number(r["inkomst fr.o.m."]), incomeTo: Number(r["inkomst t.o.m."]), columns: JSON.stringify(columns) })
        .onConflictDoNothing()
        .run();
    }
  });
  return rows.length;
}

/** The years stored for a table, newest first. */
export function storedTaxYears(db: Db, tableNo: number): number[] {
  return [...new Set(db.select({ year: taxTableRows.year }).from(taxTableRows).where(eq(taxTableRows.tableNo, tableNo)).all().map((r) => r.year))].sort((a, b) => b - a);
}

/** The tax (öre) by the table: the year's own, else the latest stored before it. Null without one. */
export function tableTax(db: Db, gross: number, year: number, tableNo: number, column: number): { tax: number; year: number } | null {
  const y = db
    .select({ year: taxTableRows.year })
    .from(taxTableRows)
    .where(and(eq(taxTableRows.tableNo, tableNo), lte(taxTableRows.year, year)))
    .orderBy(desc(taxTableRows.year))
    .get()?.year;
  if (y === undefined) return null;
  const kr = Math.floor(gross / 100);
  const rows = db.select().from(taxTableRows).where(and(eq(taxTableRows.year, y), eq(taxTableRows.tableNo, tableNo))).all();
  const hit = (kind: string) => rows.find((r) => r.kind === kind && r.incomeFrom <= kr && kr <= r.incomeTo);
  const b = hit("30B");
  if (b) return { tax: (JSON.parse(b.columns) as number[])[column - 1] * 100, year: y };
  // Above the table: a per cent of the income.
  const p = hit("30%");
  if (p) return { tax: Math.round(kr * (JSON.parse(p.columns) as number[])[column - 1]), year: y };
  return null;
}

export interface CurvePoint {
  payDate: string;
  gross: number;
  tax: number;
  rate: number;
}

/** The effective rate on every payslip, by gross. */
export function taxCurve(db: Db): CurvePoint[] {
  return db
    .select({ payDate: payslips.payDate, gross: payslips.gross, tax: payslips.tax })
    .from(payslips)
    .all()
    .filter((p) => p.gross > 0)
    .map((p) => ({ ...p, rate: p.tax / p.gross }))
    .sort((a, b) => a.gross - b.gross);
}

/** The curve's rate at a gross: linear between the nearest points, flat beyond them. */
export function curveRate(points: CurvePoint[], gross: number): number | null {
  if (points.length === 0) return null;
  if (gross <= points[0].gross) return points[0].rate;
  if (gross >= points.at(-1)!.gross) return points.at(-1)!.rate;
  const i = points.findIndex((p) => p.gross >= gross);
  const [a, b] = [points[i - 1], points[i]];
  return b.gross === a.gross ? a.rate : a.rate + ((b.rate - a.rate) * (gross - a.gross)) / (b.gross - a.gross);
}
