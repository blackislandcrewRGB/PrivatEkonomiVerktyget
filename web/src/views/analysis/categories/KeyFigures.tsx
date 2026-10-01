import type { ReactNode } from "react";
import type { Share } from "../common";
import { monthLabel, wholeKr as kr } from "../common";
import type { KeyFigures as Figures } from "./figures";

const card = "min-w-0 rounded-[14px] bg-card px-4 py-3.5 text-ink shadow-card";
/** 'nov 2025'. */
const monthYear = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short", year: "numeric" }).replace(".", "");

function Figure({ label, value, hint, testId }: { label: string; value: ReactNode; hint: ReactNode; testId: string }) {
  return (
    <div className={card} data-figure={testId}>
      <p className="text-[12px] text-ink-2">{label}</p>
      <p className="mt-1 truncate text-[22px] font-bold leading-tight tracking-[-0.01em] tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-3">{hint}</p>
    </div>
  );
}

/**
 * Per kategori's four key figures (Design v2), from the table's data: the
 * whole period's total; the average and median per month over the whole
 * months (the month so far left out, as Snitt does); the largest category
 * with its share; the dearest whole month and what made most of it. The
 * amounts are rounded to the krona, as the table's are.
 */
export function KeyFigures({ f, periodLabel, share, to }: { f: Figures; periodLabel: string; share: Share; to: string }) {
  const short = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");
  return (
    <div className="grid grid-cols-2 gap-3 @[48rem]:grid-cols-4" aria-label="Nyckeltal">
      <Figure testId="total" label={`Totalt ${periodLabel}`} value={kr(f.total)} hint={`${share === "mine" ? "min del" : "hushållet"}${f.partial ? ` · med ${short(f.partial)} t.o.m. ${Number(to.slice(8, 10))}/${Number(to.slice(5, 7))}` : ""}`} />
      <Figure
        testId="average"
        label="Snitt per månad"
        value={kr(f.average)}
        hint={
          <span title={f.partial ? `${f.whole} hela månader, utan ${monthLabel(f.partial, true)} som är påbörjad` : `${f.whole} hela månader`}>
            median {kr(f.median).replace(/\s*kr$/, "")} kr{f.partial ? ` · utan ${short(f.partial)}` : ""}
          </span>
        }
      />
      <Figure
        testId="largest"
        label="Största kategori"
        value={
          f.largest ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ background: f.largest.series.color }} aria-hidden />
              <span className="truncate">{f.largest.series.name}</span>
            </span>
          ) : (
            "–"
          )
        }
        hint={f.largest ? `${kr(f.largest.sum)} · ${Math.round(f.largest.share * 100)} %` : "inga utgifter"}
      />
      <Figure
        testId="dearest"
        label="Dyraste månad"
        value={f.dearest ? monthYear(f.dearest.month) : "–"}
        hint={f.dearest ? `${kr(f.dearest.total)}${f.dearest.top ? ` · ${f.dearest.top.series.name} ${kr(f.dearest.top.sum).replace(/\s*kr$/, "")}` : ""}` : "ingen hel månad"}
      />
    </div>
  );
}
