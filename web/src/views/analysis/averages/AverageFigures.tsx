import type { ReactNode } from "react";
import { monthLabel, periodText, wholeKr as whole } from "../common";

export interface AverageBasis {
  weeks: { count: number; from: string | null; to: string | null };
  months: { count: number; list: string[] };
  total: { total: number; perWeek: number | null; perMonth: number | null };
}

const card = "min-w-0 rounded-[14px] bg-card px-4 py-3.5 text-ink shadow-card";
/** 'sep 25'. */
const short = (m: string) => monthLabel(m).replace(".", "");

function Figure({ label, value, hint, title, testId }: { label: string; value: ReactNode; hint: ReactNode; title?: string; testId: string }) {
  return (
    <div className={card} data-figure={testId}>
      <p className="text-[12px] text-ink-2">{label}</p>
      <p className="mt-1 truncate text-[24px] font-bold leading-tight tracking-[-0.01em] tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-3" title={title}>
        {hint}
      </p>
    </div>
  );
}

/**
 * Snitt's three key figures (Design v2), the Totalt row's numbers with what
 * they are built on: the average per month over the whole months, per week
 * over the whole weeks (Mon–Sun), and the sum, the only figure that counts
 * the weeks and months begun.
 */
export function AverageFigures({ data }: { data: AverageBasis }) {
  const { weeks, months, total } = data;
  return (
    <div className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-3" aria-label="Nyckeltal">
      <Figure
        testId="per-month"
        label="Snitt per månad"
        value={total.perMonth === null ? "–" : whole(total.perMonth)}
        hint={months.count ? `${months.count} hela ${months.count === 1 ? "månad" : "månader"} · ${short(months.list[0])}${months.count > 1 ? ` – ${short(months.list.at(-1)!)}` : ""}` : "ingen hel månad i perioden"}
        title={months.count ? months.list.map((m) => monthLabel(m, true)).join(", ") : undefined}
      />
      <Figure
        testId="per-week"
        label="Snitt per vecka"
        value={total.perWeek === null ? "–" : whole(total.perWeek)}
        hint={weeks.count && weeks.from && weeks.to ? `${weeks.count} hela ${weeks.count === 1 ? "vecka" : "veckor"} mån–sön · ${periodText(weeks.from, weeks.to)}` : "ingen hel vecka i perioden"}
      />
      <Figure testId="sum" label="Summa i perioden" value={whole(total.total)} hint="påbörjade veckor och månader räknas bara här" />
    </div>
  );
}
