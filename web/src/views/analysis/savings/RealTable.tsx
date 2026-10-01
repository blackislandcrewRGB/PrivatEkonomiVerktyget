import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate, type RealSavings } from "../../../api";
import { cn } from "../../../lib/cn";
import { Money, chart, useChartAnimation, wholeKr } from "../common";
import { signedKr } from "./ValueCard";
import { longDate, signedPct } from "./RealCard";

const VALUE = "var(--color-accent)";
const KEEP = "var(--color-ink-3)";
const wide = "hidden @[36rem]:table-cell";
const num = "whitespace-nowrap px-1 py-2 text-right tabular-nums @[36rem]:px-3";

/** Real above nothing green, below red, nothing (to a tenth of a percent) grey. */
const realTone = (x: number | null) => {
  const v = x === null ? 0 : Math.round(x * 1000);
  return v > 0 ? "up" : v < 0 ? "down" : "zero";
};
const PILL = { up: "bg-positive-soft text-positive-text", down: "bg-alarm-soft text-alarm", zero: "bg-card-inset text-ink-2" } as const;

function RealPill({ real }: { real: number | null }) {
  const tone = realTone(real);
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums", PILL[tone])} data-tone={tone}>
      {signedPct(real)}
    </span>
  );
}

/**
 * Per kvartal (Design v2): the ISK's value at each reading against the line
 * of keeping up with prices – the start and the money put in since, carried
 * to that day's prices – and a table of the periods between the readings,
 * each year summed up under its quarters with its ISK tax. Newest first.
 */
export function RealTable({ data }: { data: RealSavings }) {
  const animation = useChartAnimation();
  const rows = data.points.map((p) => ({ date: p.date, value: p.valueOre / 100, debt: p.debtOre, keep: p.keepOre === null ? null : p.keepOre / 100, today: p.source === "today" }));
  const years = [...data.years].sort((a, b) => b.year - a.year);
  const periodYear = (p: RealSavings["periods"][number]) => {
    const d = new Date(`${p.to}T00:00:00`);
    if (!p.ongoing) d.setDate(d.getDate() - 1);
    return d.getFullYear();
  };
  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="real-table-title" data-card="real-table">
      <div className="space-y-3 px-5 pb-2 pt-4 sm:px-6">
        <div>
          <h2 id="real-table-title" className="text-[15px] font-semibold">
            Per kvartal
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">värdet mot linjen för att hålla köpkraften · real = nominell avkastning rensad från inflationen</p>
        </div>
        <div className="h-44 w-full" data-part="chart">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 0, left: 16 }}>
              <CartesianGrid vertical={false} stroke={chart.grid} />
              <XAxis
                dataKey="date"
                tick={chart.tick}
                // New Year's Day says the year: the quarters run over several.
                tickFormatter={(d: string) => (d.endsWith("-01-01") ? d.slice(0, 4) : shortDate(d))}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis hide domain={["dataMin - 5000", "dataMax + 5000"]} />
              <Tooltip
                cursor={{ stroke: "var(--color-hairline)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const r = payload[0].payload as (typeof rows)[number];
                  return (
                    <div className="min-w-48 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                      <p className="mb-1 font-semibold">{r.today ? `I dag, ${longDate(r.date)}` : longDate(r.date)}</p>
                      <p className="flex justify-between gap-4">
                        <span className="text-ink-2">{r.debt < 0 ? "Värde, minus krediten" : "Värde"}</span>
                        <Money ore={r.value * 100} />
                      </p>
                      {r.debt < 0 && (
                        <p className="flex justify-between gap-4">
                          <span className="text-ink-2">Skuld på krediten</span>
                          <Money ore={r.debt} />
                        </p>
                      )}
                      {r.keep !== null && (
                        <>
                          <p className="flex justify-between gap-4">
                            <span className="text-ink-2">För att hålla köpkraften</span>
                            <Money ore={r.keep * 100} />
                          </p>
                          <p className="flex justify-between gap-4">
                            <span className="text-ink-2">Över linjen</span>
                            <span className={cn("tabular-nums", r.value < r.keep ? "text-alarm" : "text-positive-text")}>{signedKr((r.value - r.keep) * 100)}</span>
                          </p>
                        </>
                      )}
                    </div>
                  );
                }}
              />
              <Line type="linear" dataKey="keep" stroke={KEEP} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls {...animation} />
              <Line type="linear" dataKey="value" stroke={VALUE} strokeWidth={2.5} dot={{ r: 3.5, fill: VALUE, strokeWidth: 0 }} activeDot={{ r: 5, fill: VALUE }} {...animation} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full bg-accent" aria-hidden /> Värdet på ISK:t
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-3.5 border-t-2 border-dashed border-ink-3" aria-hidden /> För att hålla köpkraften
          </li>
        </ul>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] @[36rem]:text-[13px]" aria-label="Avkastning per kvartal">
          <thead>
            <tr className="border-y border-hairline text-[11px] text-ink-3">
              <th className="py-2 pl-4 pr-2 text-left font-normal @[36rem]:pl-6">Period</th>
              <th className={cn(wide, num, "font-normal")}>Start</th>
              <th className={cn(wide, num, "font-normal")}>Insatt netto</th>
              <th className={cn(wide, num, "font-normal")}>Slut</th>
              <th className={cn(num, "font-normal")}>Nominell</th>
              <th className={cn(num, "font-normal")}>Inflation</th>
              <th className="py-2 pl-2 pr-4 text-right font-normal @[36rem]:pl-3 @[36rem]:pr-6">Real</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <YearRows key={y.year} year={y} periods={[...data.periods].filter((p) => periodYear(p) === y.year).reverse()} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[11px] text-ink-3 sm:px-6">
        Avkastningen i en period räknas på pengarna som fanns i den: startvärdet och insättningarna efter hur länge de var med. Åren är kvartalen länkade. Den pågående perioden slutar i dag, i
        senaste publicerade KPI-månadens priser. ISK-skatten betalas via slutskatten året efter och ingår inte i värdet.
      </p>
    </section>
  );
}

function YearRows({ year: y, periods }: { year: RealSavings["years"][number]; periods: RealSavings["periods"] }) {
  return (
    <>
      {periods.map((p) => (
        <tr key={p.from} className={cn("border-b border-hairline", p.ongoing && "bg-row-current")} data-period={p.from}>
          <td className="whitespace-nowrap py-2 pl-4 pr-2 @[36rem]:pl-6">
            {shortDate(p.from)}–{p.ongoing ? "i dag" : shortDate(p.to)}
          </td>
          <td className={cn(wide, num, "text-ink-2")}>{wholeKr(p.startOre)}</td>
          <td className={cn(wide, num, "text-ink-2")}>{signedKr(p.netOre)}</td>
          <td className={cn(wide, num)}>{wholeKr(p.endOre)}</td>
          <td className={num}>{signedPct(p.nominal)}</td>
          <td className={cn(num, "text-ink-2")}>{signedPct(p.inflation)}</td>
          <td className="whitespace-nowrap py-2 pl-2 pr-4 text-right @[36rem]:pl-3 @[36rem]:pr-6">
            <RealPill real={p.real} />
          </td>
        </tr>
      ))}
      <tr className="border-b border-ink bg-band font-semibold" data-year={y.year}>
        <td className="whitespace-nowrap py-2 pl-4 pr-2 @[36rem]:pl-6">
          {y.year}
          <span className="block text-[11px] font-normal text-ink-3 @[36rem]:inline @[36rem]:pl-2">
            ISK-skatt {y.iskTaxOre === null ? "–" : wholeKr(y.iskTaxOre)}
            {y.iskTaxEstimated ? " (beräknad)" : ""}
          </span>
        </td>
        <td className={wide} />
        <td className={wide} />
        <td className={wide} />
        <td className={num}>{signedPct(y.nominal)}</td>
        <td className={cn(num, "text-ink-2")}>{signedPct(y.inflation)}</td>
        <td className="whitespace-nowrap py-2 pl-2 pr-4 text-right @[36rem]:pl-3 @[36rem]:pr-6">
          <RealPill real={y.real} />
        </td>
      </tr>
    </>
  );
}
