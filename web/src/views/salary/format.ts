/** 'september 2026'. */
export const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
/** 'september'. */
export const monthOnly = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
/** 'sep'. */
export const monthShort = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");
/** Hours as '157,5'. */
export const h = (v: number) => v.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
/** An hourly rate in öre as '275,21'. */
export const rate = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 });
/** A typed number ('157,5', '1 000'); empty is 0, anything else NaN. */
export const num = (s: string) => {
  const v = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() === "" ? 0 : Number.isFinite(v) ? v : NaN;
};
/** 25 -> '25:e', 1 -> '1:a', 22 -> '22:a'. */
export const ordinal = (n: number) => `${n}:${n % 10 <= 2 && n % 10 > 0 && Math.floor(n / 10) !== 1 ? "a" : "e"}`;
export const addMonth = (m: string, n = 1) => {
  const [y, mm] = m.split("-").map(Number);
  const i = y * 12 + mm - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
