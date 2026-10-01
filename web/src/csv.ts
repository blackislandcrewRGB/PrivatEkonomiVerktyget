/** A CSV cell: text as is, numbers with a decimal comma. Amounts in öre go through `kronor`. */
type Cell = string | number | null | undefined;

/** Öre as kronor with a decimal comma, e.g. 123456 -> '1234,56'. */
export const kronor = (ore: number | null | undefined): string => (ore == null ? "" : (ore / 100).toFixed(2).replace(".", ","));

/** A share 0..1 as percent with a decimal comma, e.g. 0.253 -> '25,3'. */
export const percent = (share: number | null | undefined): string => (share == null ? "" : (share * 100).toFixed(1).replace(".", ","));

function cell(v: Cell): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v).replace(".", ",") : v;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Downloads a CSV file the way Swedish Excel opens it: semicolon separated,
 * decimal comma, UTF-8 with BOM.
 */
export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

export function downloadCsv(filename: string, header: string[], rows: Cell[][]): void {
  const text = toCsv(header, rows);
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
