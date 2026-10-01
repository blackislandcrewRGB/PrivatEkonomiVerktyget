import type { FuelMonth } from "../../../api";
import { kronor } from "../../../csv";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { CsvButton, monthLabel, wholeKr } from "../common";
import { TONE_CLASS, consumptionTone, l100Text } from "./figures";

const head = "whitespace-nowrap px-1.5 py-2 text-right font-normal @[36rem]:px-3";
const cell = "whitespace-nowrap px-1.5 py-2 text-right tabular-nums @[36rem]:px-3";
/** Km and the bar are left out on a narrow card (a phone). */
const wide = "hidden @[36rem]:table-cell";

/**
 * Bränsle's table (Design v2), newest first: shifts, km, the fuel bought as
 * a bar against the largest month and in kronor, per shift, l/100 km as a
 * pill toned against the table value, and the trips (not counted) in
 * tertiary. The current month light blue and bold. The CSV is as before.
 */
export function FuelTable({ months, base }: { months: FuelMonth[]; base: number }) {
  const current = todayIso().slice(0, 7);
  const largest = Math.max(0, ...months.map((m) => m.spent));
  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="fuel-table-title" data-card="table">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4 sm:px-6">
        <h2 id="fuel-table-title" className="text-[15px] font-semibold">
          Per månad
        </h2>
        <CsvButton
          filename="bransle-per-manad"
          header={["Månad", "Pass", "Km", "Tankat", "Per pass", "l/100 km", "Resor"]}
          rows={() => months.map((m) => [m.month, m.shifts, m.km, kronor(m.spent), m.perShift === null ? null : kronor(m.perShift), m.l100 === null ? null : Math.round(m.l100 * 10) / 10, kronor(m.trips)])}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] @[36rem]:text-[13px]" aria-label="Bränsle per månad">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="whitespace-nowrap py-2 pl-4 pr-2 text-left font-normal @[36rem]:pl-6 @[36rem]:pr-3">Månad</th>
              <th className={head}>Pass</th>
              <th className={cn(head, wide)}>Km</th>
              <th className={cn(wide, "w-[30%] px-3 py-2 text-left font-normal")}>Tankat</th>
              <th className={head}>kr</th>
              <th className={head}>Per pass</th>
              <th className="px-2 py-2 text-center font-normal @[36rem]:whitespace-nowrap @[36rem]:px-3">l/100 km</th>
              <th className="py-2 pl-2 pr-4 text-right font-normal @[36rem]:whitespace-nowrap @[36rem]:pl-3 @[36rem]:pr-6">Resor (ej med)</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => {
              const now = m.month === current;
              const tone = m.l100 === null ? null : consumptionTone(m.l100, base);
              const width = largest > 0 ? Math.max(0, m.spent) / largest : 0;
              return (
                <tr key={m.month} className={cn("border-b border-hairline last:border-b-0", now && "bg-row-current font-semibold")} data-month={m.month} aria-current={now ? "date" : undefined}>
                  <td className="whitespace-nowrap py-2 pl-4 pr-2 @[36rem]:pl-6 @[36rem]:pr-3">
                    <span className="hidden @[36rem]:inline">{monthLabel(m.month, true)}</span>
                    <span className="@[36rem]:hidden">{monthLabel(m.month).replace(".", "")}</span>
                  </td>
                  <td className={cn(cell, "text-ink-2")}>{m.shifts ?? "–"}</td>
                  <td className={cn(cell, wide, "text-ink-2")}>{m.km === null ? "–" : m.km.toLocaleString("sv-SE")}</td>
                  <td className={cn(wide, "px-3 py-2")}>
                    <span className="block h-1.5 rounded-full bg-track">
                      <span className="block h-full rounded-full bg-caution" style={{ width: `${width * 100}%` }} data-bar={width} />
                    </span>
                  </td>
                  <td className={cn(cell, "font-semibold")} data-spent={m.spent}>
                    {m.spent ? wholeKr(m.spent) : "–"}
                  </td>
                  <td className={cn(cell, "text-ink-2")}>{m.perShift === null ? "–" : wholeKr(m.perShift)}</td>
                  <td className="px-2 py-1.5 text-center @[36rem]:px-3">
                    <span className={cn("inline-block min-w-9 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums @[36rem]:min-w-10 @[36rem]:px-2 @[36rem]:text-[12px]", tone ? TONE_CLASS[tone] : "bg-segment text-ink-3")} data-tone={tone ?? "none"}>
                      {l100Text(m.l100)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pl-2 pr-4 text-right tabular-nums text-ink-3 @[36rem]:pl-3 @[36rem]:pr-6" data-trips={m.trips}>
                    {m.trips ? wholeKr(m.trips) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
