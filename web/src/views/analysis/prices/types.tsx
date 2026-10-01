/** GET /api/analysis/prices. */
export interface FoodMonth {
  month: string;
  mineOre: number | null;
  mineIndex: number | null;
  kpiIndex: number | null;
}
export interface Subgroup {
  key: string;
  name: string;
  months: { month: string; index: number | null }[];
  changePctE2: number | null;
}
export interface Source {
  name: string;
  fetchedAt: string | null;
  latest: string | null;
}
export interface Fill {
  id: number;
  date: string;
  description: string;
  week: string;
  mineOre: number;
  source: "receipt" | "entered";
  priceDate: string;
  listOre: number | null;
  discountOre: number | null;
  litres: number | null;
  avgOre: number | null;
  diffOre: number | null;
}
/**
 * What the diesel chart draws for each fill-up.
 *
 * A receipt gives two prices: what the card was charged, and the pump's price
 * before the discount. Both go in, one above the other, and the stroke
 * between them is the discount — so the chart shows where the station sits
 * against the country and how much of that the discount takes back. A
 * fill-up with only an entered price has the pump's price and nothing else,
 * and is drawn as that: a ring with no dot beneath it.
 */
export function fillMarks(fills: Fill[], asTime: (iso: string) => number) {
  const paid: (Fill & { t: number; ore: number })[] = [];
  const pump: (Fill & { t: number; ore: number })[] = [];
  const discounts: { t: number; from: number; to: number }[] = [];
  for (const f of fills) {
    const t = asTime(f.date);
    if (f.source === "receipt") {
      paid.push({ ...f, t, ore: f.mineOre });
      if (f.listOre !== null) {
        pump.push({ ...f, t, ore: f.listOre });
        if (f.listOre > f.mineOre) discounts.push({ t, from: f.mineOre, to: f.listOre });
      }
    } else {
      pump.push({ ...f, t, ore: f.mineOre });
    }
  }
  return { paid, pump, discounts };
}

export interface PricesData {
  food: {
    base: { month: string; mineOre: number | null; kpi: number | null };
    months: FoodMonth[];
    through: string | null;
    change: { mine: number | null; kpi: number | null };
    subgroups: Subgroup[];
    source: Source | null;
    missing: string | null;
  };
  fuel: {
    fills: Fill[];
    weeks: { week: string; ore: number }[];
    average: { diffOre: number | null; count: number; skipped: number; listDiffOre: number | null; listCount: number; discountOre: number | null; receipts: number };
    monthly: { shifts: number; month: string; litres: number; ore: number } | null;
    source: Source | null;
    missing: string | null;
  };
  series: { key: string; name: string; unit: string; source: string; fetchedAt: string | null; latest: string | null; count: number }[];
  settings: { baseMonth: string | null };
}

/** A change in hundredths of a percent, with its sign: '+1,9 %'. */
export const pctE2 = (v: number | null, digits = 1) =>
  v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v / 100).toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;

/** An index in hundredths as it is read: 10830 -> '108,3'. */
export const indexLabel = (v: number | null) => (v === null ? "–" : (v / 100).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export const litre = (ore: number | null) => (ore === null ? "–" : `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/l`);
export const ore = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("sv-SE")} öre/l`);
export const krona = (v: number) => `${(v / 100).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} kr`;
export const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
export const dayLong = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });

/** 'Källa: SCB · hämtat 21 september 2026 · senaste period augusti 2026'. */
export function SourceNote({ source, period }: { source: Source | null; period?: (latest: string) => string }) {
  if (!source) return <p className="text-[11px] text-ink-3">Ingen hämtning gjord ännu.</p>;
  return (
    <p className="text-[11px] text-ink-3">
      Källa: {source.name}
      {source.fetchedAt ? ` · hämtat ${dayLong(source.fetchedAt.slice(0, 10))}` : " · aldrig hämtat"}
      {source.latest ? ` · senaste ${period ? period(source.latest) : dayLong(source.latest)}` : ""}
    </p>
  );
}


/** A group's change as a tone: within ±0,2 % grey, down green, up orange. */
export type ChangeTone = "down" | "up" | "flat";
export const changeTone = (changePctE2: number | null): ChangeTone => (changePctE2 === null || Math.abs(changePctE2) <= 20 ? "flat" : changePctE2 < 0 ? "down" : "up");
export const CHANGE_TONE: Record<ChangeTone, { className: string; line: string }> = {
  down: { className: "bg-positive-soft text-positive-text", line: "var(--color-positive)" },
  up: { className: "bg-caution-soft text-caution-text", line: "var(--color-caution)" },
  // On the grey box: the card's own background, or the pill would vanish in the dark theme.
  flat: { className: "bg-card text-ink-2", line: "var(--color-ink-3)" },
};
