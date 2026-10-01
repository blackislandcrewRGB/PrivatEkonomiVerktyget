/** GET /api/analysis/categories: sums per category and month. Öre, positive = spent. */
export interface Series {
  key: string;
  categoryId: number | null;
  name: string;
  color: string;
}
export interface CategoryData {
  months: string[];
  series: Series[];
  data: (Record<string, number> & { month: string; total: number })[];
  parent: { id: number; name: string } | null;
}
