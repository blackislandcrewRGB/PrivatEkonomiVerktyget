import type { ReactNode } from "react";
import type { FuelMonth } from "../../../api";
import { cn } from "../../../lib/cn";
import { wholeKr } from "../common";
import { GAUGE_MARK, fuelFigures, l100Text, monthList } from "./figures";

const card = "min-w-0 rounded-[14px] bg-card px-4 py-3.5 text-ink shadow-card";

function Figure({ label, value, hint, testId, className }: { label: string; value: ReactNode; hint: ReactNode; testId: string; className?: string }) {
  return (
    <div className={cn(card, className)} data-figure={testId}>
      <p className="text-[12px] text-ink-2">{label}</p>
      <div className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.01em] tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-ink-3">{hint}</div>
    </div>
  );
}

/**
 * Bränsle's four key figures (Design v2): the fuel bought (per month with a
 * fill-up), per shift (with the months, shifts and km behind it), the average
 * l/100 km against the table value with a gauge (the table value's black
 * mark at three quarters), and the trips, which are left out, in a muted
 * card.
 */
export function FuelFigures({ months, base }: { months: FuelMonth[]; base: number }) {
  const f = fuelFigures(months, base);
  return (
    <div className="grid grid-cols-2 gap-3 @[48rem]:grid-cols-4" aria-label="Nyckeltal">
      <Figure
        testId="spent"
        label="Tankat under perioden"
        value={wholeKr(f.spent)}
        hint={f.perMonth === null ? "ingen tankning" : `${wholeKr(f.perMonth)}/mån · ${f.filledMonths} ${f.filledMonths === 1 ? "månad" : "månader"} med tankning`}
      />
      <Figure
        testId="per-shift"
        label="Per pass"
        value={f.perShift === null ? "–" : wholeKr(f.perShift)}
        hint={
          f.perShift === null
            ? "ingen månad med pass och tankning"
            : `${f.shiftMonths} ${f.shiftMonths === 1 ? "månad" : "månader"} med pass · ${f.shifts} pass · ${f.km.toLocaleString("sv-SE")} km`
        }
      />
      <Figure
        testId="l100"
        label="Snitt l/100 km"
        value={
          <span className="flex flex-wrap items-baseline gap-x-2">
            {l100Text(f.avgL100)}
            {f.diff !== null && f.tone && (
              <span
                className={cn("text-[12px] font-semibold", f.tone === "under" ? "text-positive-text" : f.tone === "over" ? "text-caution-text" : "text-ink-2")}
                data-tone={f.tone}
              >
                {f.diff > 0 ? "+" : f.diff < 0 ? "−" : "±"}
                {l100Text(Math.abs(f.diff))} mot tabellvärdet {l100Text(base)}
              </span>
            )}
          </span>
        }
        hint={
          f.avgL100 === null ? (
            `tabellvärdet ${l100Text(base)}`
          ) : (
            <span className="relative mt-1.5 block h-1.5 rounded-full bg-track" role="img" aria-label={`${l100Text(f.avgL100)} mot tabellvärdet ${l100Text(base)}`}>
              <span
                className={cn("block h-full rounded-full", f.tone === "over" ? "bg-caution" : "bg-positive")}
                style={{ width: `${f.fill * 100}%` }}
                data-fill={f.fill}
              />
              <span className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink" style={{ left: `calc(${GAUGE_MARK * 100}% - 1px)` }} data-mark={GAUGE_MARK} />
            </span>
          )
        }
      />
      <Figure
        testId="trips"
        className="border border-dashed border-neutral-bar bg-card-inset shadow-none"
        label="Resor, räknas inte"
        value={<span className="text-ink-2">{wholeKr(f.trips)}</span>}
        hint={f.tripMonths.length ? `tankningar märkta resa · ${monthList(f.tripMonths)}` : "inga tankningar märkta resa"}
      />
    </div>
  );
}
