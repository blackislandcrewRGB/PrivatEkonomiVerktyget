/** GET /api/analysis/averages, in öre; null where there is no whole week or month. */
export interface Avg {
  total: number;
  perWeek: number | null;
  perMonth: number | null;
}

export interface AverageSource extends Avg {
  /** -1: the manual rows without an account. */
  accountId: number;
  name: string;
  kind: "bank" | "credit_card" | null;
  incompleteMonths: string[];
}

export interface AverageCategory extends Avg {
  key: string;
  categoryId: number | null;
  parentKey: string | null;
  name: string;
  /** As in Per kategori; a subcategory's a tone of its main category's. */
  color: string;
}

export interface AveragesData {
  from: string;
  to: string;
  weeks: { count: number; from: string | null; to: string | null };
  months: { count: number; list: string[] };
  total: Avg;
  bySource: AverageSource[];
  byCategory: AverageCategory[];
  incomplete: { source: string; months: string[] }[];
}

/** A part of a whole as a bar's width, 0–1; nothing for a refund or when the whole is nothing. */
export const shareOf = (part: number, whole: number) => (whole > 0 ? Math.min(1, Math.max(0, part) / whole) : 0);
