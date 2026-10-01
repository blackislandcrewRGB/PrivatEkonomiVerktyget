import { useState, type ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { cn } from "../../../lib/cn";
import { CsvButton, chart } from "../common";
import { SourceNote, day, dayLong, fillMarks, krona, litre, ore, type Fill, type PricesData } from "./types";

const AVERAGE = "var(--color-accent)";
const UNDER = "var(--color-positive)";
const OVER = "var(--color-alarm)";
const RING = "var(--color-ink-3)";
/** Rows in the table before 'Visa alla'. */
const ROWS = 8;

/** A fill-up against the week's average: under green, over red, on it grey. */
export const fillTone = (diffOre: number | null) => (diffOre === null || diffOre === 0 ? "same" : diffOre < 0 ? "under" : "over");
const DOT = { under: UNDER, over: OVER, same: RING };
const PILL = { under: "bg-positive-soft text-positive-text", over: "bg-caution-soft text-caution-text", same: "bg-segment text-ink-2" };

function Box({ label, value, hint, tone, testId }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "over" | "under"; testId: string }) {
  const bg = tone === "over" ? "bg-caution-soft" : tone === "under" ? "bg-positive-soft" : "bg-card-inset";
  const text = tone === "over" ? "text-caution-text" : tone === "under" ? "text-positive-text" : "text-ink-2";
  return (
    <div className={cn("min-w-0 rounded-inset px-3.5 py-3", bg)} data-box={testId}>
      <p className={cn("text-[11px]", text)}>{label}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

/** A price per litre; on a phone without 'kr/l', which the heading says. */
function PerLitre({ ore: v }: { ore: number | null }) {
  if (v === null) return <>–</>;
  return (
    <>
      {(v / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      <span className="hidden @[36rem]:inline"> kr/l</span>
    </>
  );
}

/** Dagens långa förklaring, now behind 'Så läser du diagrammet ›'. */
function HowToRead() {
  return (
    <p className="text-[12px] leading-relaxed text-ink-2">
      Den fyllda pricken är <strong className="font-medium text-ink">vad kortet faktiskt drogs</strong> när tankningen har ett kvitto: totalen delad med litern, alltså efter rabatt,
      grön under veckans rikssnitt och röd över. Ringen ovanför är pumppriset före rabatt, och strecket mellan dem är rabatten. Rikssnittet är ett listpris, så ringen säger hur
      din mack ligger mot landet och pricken vad du själv betalar — skillnaden mellan de två talen är din rabatt. Saknas kvitto finns bara ringen: priset du lagt in i Pendling &
      bränsle för den dagen, vilket är pumpens listpris och inte vad du betalade. En tankning utan både kvitto och pris räknas inte med; ett senare pris vore en gissning.
      Tankningar märkta resa ingår inte.
    </p>
  );
}

/**
 * Diesel mot rikssnittet (Design v2): what I pay against the country's
 * average (orange over, green under), what it is worth a month at the
 * current shifts, and the station's pump price. The chart: the weekly average
 * as a blue line over a faint area, each fill-up as a dot at what the card
 * was charged (green under the week's average, red over), the pump's price
 * as a ring above it with a thin stroke between them (the discount); a
 * fill-up without a receipt only as its ring. The table has the eight latest
 * with the difference as a pill, and all of them on request.
 */
export function DieselCard({ fuel }: { fuel: PricesData["fuel"] }) {
  const [all, setAll] = useState(false);
  const asTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const weekLine = fuel.weeks.map((w) => ({ t: asTime(w.week), ore: w.ore }));
  // Both series read x from `t` and y from `ore`, which is what the two axes
  // are keyed on — a point with its price under another name would be drawn at no height at all.
  const marks = fillMarks(fuel.fills, asTime);
  const times = [...weekLine.map((w) => w.t), ...marks.pump.map((f) => f.t), ...marks.paid.map((f) => f.t)];
  const newest = [...fuel.fills].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const rows = all ? newest : newest.slice(0, ROWS);
  const avg = fuel.average.diffOre;

  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="diesel-title" data-card="diesel">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="diesel-title" className="text-[15px] font-semibold">
            Diesel mot rikssnittet
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">ditt literpris vid varje tankning mot Sveriges genomsnittliga dieselpris samma vecka</p>
        </div>
        <CsvButton
          filename="diesel-mot-rikssnitt"
          header={["Datum", "Tankning", "Liter", "Ditt pris kr/l", "Källa", "Pumppris kr/l", "Rikssnitt kr/l", "Skillnad öre/l"]}
          rows={() =>
            fuel.fills.map((f) => [
              f.date,
              f.description,
              f.litres === null ? "" : f.litres.toFixed(2).replace(".", ","),
              (f.mineOre / 100).toFixed(2).replace(".", ","),
              f.source === "receipt" ? "kvitto" : "inlagt pris",
              f.listOre === null ? "" : (f.listOre / 100).toFixed(2).replace(".", ","),
              f.avgOre === null ? "" : (f.avgOre / 100).toFixed(2).replace(".", ","),
              f.diffOre ?? "",
            ])
          }
        />
      </div>

      {fuel.missing ? (
        <p className="text-sm text-caution-text">{fuel.missing}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-3">
            <Box
              testId="paid"
              tone={avg === null || avg === 0 ? undefined : avg > 0 ? "over" : "under"}
              label="Du betalar"
              value={ore(avg)}
              hint={`${avg !== null && avg < 0 ? "under" : "över"} rikssnittet · ${fuel.average.count} tankningar${fuel.average.skipped ? `, ${fuel.average.skipped} utan pris den dagen` : ""}`}
            />
            <Box
              testId="monthly"
              label="Vid nuvarande passtakt"
              value={fuel.monthly ? `${fuel.monthly.ore > 0 ? "+" : fuel.monthly.ore < 0 ? "−" : ""}${krona(Math.abs(fuel.monthly.ore))}/mån` : "–"}
              hint={fuel.monthly ? `${fuel.monthly.shifts} pass ≈ ${fuel.monthly.litres.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} liter` : "Inga pass inlagda för månaden"}
            />
            {fuel.average.discountOre !== null ? (
              <Box
                testId="pump"
                label="Pumppriset på din mack"
                value={ore(fuel.average.listDiffOre)}
                hint={`${(fuel.average.listDiffOre ?? 0) < 0 ? "under" : "över"} rikssnittet · du får ${fuel.average.discountOre} öre/l i rabatt, ${fuel.average.receipts} kvitton`}
              />
            ) : (
              <Box testId="pump" label="Senaste rikssnitt" value={litre(fuel.weeks.at(-1)?.ore ?? null)} hint={fuel.weeks.at(-1) ? `veckan från ${day(fuel.weeks.at(-1)!.week)}` : undefined} />
            )}
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer>
              <ComposedChart margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} stroke={chart.grid} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={times.length ? [Math.min(...times), Math.max(...times)] : ["auto", "auto"]}
                  tickFormatter={(t) => day(new Date(t).toISOString().slice(0, 10))}
                  tick={chart.tick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  dataKey="ore"
                  orientation="right"
                  tickFormatter={(v) => (v / 100).toLocaleString("sv-SE", { maximumFractionDigits: 0 })}
                  tick={chart.tick}
                  width={30}
                  axisLine={false}
                  tickLine={false}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-hairline)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as { t: number; ore?: number } & Partial<Fill>;
                    const date = new Date(p.t).toISOString().slice(0, 10);
                    const lines: [string, ReactNode][] =
                      p.mineOre === undefined
                        ? [["Rikssnitt", litre(p.ore ?? null)]]
                        : [
                            [p.source === "receipt" ? "Ditt pris" : "Ditt pris (inlagt)", litre(p.mineOre ?? null)],
                            ["Pumppris", litre(p.source === "receipt" ? (p.listOre ?? null) : (p.mineOre ?? null))],
                            ["Rikssnitt", litre(p.avgOre ?? null)],
                            ["Skillnad", ore(p.diffOre ?? null)],
                          ];
                    return (
                      <div className="min-w-48 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                        <p className="mb-1.5 font-semibold">{p.mineOre === undefined ? `Veckan från ${dayLong(date)}` : `${dayLong(date)} · ${p.description ?? "Tankning"}`}</p>
                        <ul className="space-y-0.5">
                          {lines.map(([name, v]) => (
                            <li key={name} className="flex justify-between gap-4">
                              <span className="text-ink-2">{name}</span>
                              <span className="tabular-nums">{v}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  }}
                />
                <Area data={weekLine} dataKey="ore" type="linear" stroke="none" fill={AVERAGE} fillOpacity={0.08} baseValue="dataMin" isAnimationActive={false} activeDot={false} />
                <Line data={weekLine} dataKey="ore" type="linear" stroke={AVERAGE} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
                {marks.discounts.map((d) => (
                  <ReferenceLine
                    key={d.t}
                    segment={[
                      { x: d.t, y: d.from },
                      { x: d.t, y: d.to },
                    ]}
                    stroke={RING}
                    strokeWidth={1}
                  />
                ))}
                <Scatter
                  data={marks.pump}
                  dataKey="ore"
                  isAnimationActive={false}
                  shape={(props: { cx?: number; cy?: number; payload?: Fill }) => (
                    <circle cx={props.cx} cy={props.cy} r={4} fill="var(--color-card)" stroke={RING} strokeWidth={1.5} data-ring={props.payload?.id} />
                  )}
                />
                <Scatter
                  data={marks.paid}
                  dataKey="ore"
                  isAnimationActive={false}
                  shape={(props: { cx?: number; cy?: number; payload?: Fill }) => {
                    const tone = fillTone(props.payload?.diffOre ?? null);
                    return <circle cx={props.cx} cy={props.cy} r={4.5} fill={DOT[tone]} data-dot={props.payload?.id} data-tone={tone} />;
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-positive" aria-hidden /> Du betalade, under rikssnittet
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-alarm" aria-hidden /> över rikssnittet
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border-[1.5px] border-ink-3" aria-hidden /> Pumppris före rabatt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full bg-accent" aria-hidden /> Rikssnitt per vecka
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="ml-auto font-medium text-accent hover:underline">
                  Så läser du diagrammet ›
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] p-4">
                <HowToRead />
              </PopoverContent>
            </Popover>
          </div>

          {fuel.fills.length > 0 && (
            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="w-full text-[12px] @[36rem]:text-[13px]" aria-label="Tankningar mot rikssnittet">
                <thead>
                  <tr className="border-b border-hairline text-[11px] text-ink-3">
                    <th className="py-2 pl-4 pr-2 text-left font-normal @[36rem]:pl-6">Datum</th>
                    <th className="px-2 py-2 text-left font-normal">Tankning</th>
                    <th className="hidden px-3 py-2 text-right font-normal @[36rem]:table-cell">Liter</th>
                    <th className="px-2 py-2 text-right font-normal">Ditt pris<span className="@[36rem]:hidden"> kr/l</span></th>
                    <th className="hidden px-3 py-2 text-right font-normal @[36rem]:table-cell">Pumppris</th>
                    <th className="px-2 py-2 text-right font-normal">Rikssnitt<span className="@[36rem]:hidden"> kr/l</span></th>
                    <th className="py-2 pl-2 pr-4 text-right font-normal @[36rem]:pr-6">Skillnad</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => {
                    const tone = fillTone(f.diffOre);
                    return (
                      <tr key={f.id} className="border-b border-hairline" data-fill={f.id}>
                        <td className="whitespace-nowrap py-2 pl-4 pr-2 text-ink-2 @[36rem]:pl-6">{day(f.date)}</td>
                        <td className="max-w-20 truncate px-2 py-2 @[36rem]:max-w-52" title={f.description}>
                          {f.description}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2 @[36rem]:table-cell">
                          {f.litres === null ? "–" : `${f.litres.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} l`}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums" title={f.source === "receipt" ? "Från kvittot: totalen delad med litern" : "Inlagt literpris, inte vad du betalade"}>
                          <PerLitre ore={f.mineOre} />
                          {f.source === "entered" && <span className="ml-1 text-[11px] font-normal text-ink-3">≈</span>}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2 @[36rem]:table-cell">{f.listOre === null ? "–" : litre(f.listOre)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-2">
                          <PerLitre ore={f.avgOre} />
                        </td>
                        <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right @[36rem]:pr-6">
                          <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums @[36rem]:px-2", PILL[tone])} data-diff={f.diffOre ?? undefined} data-tone={tone}>
                            {ore(f.diffOre)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {!fuel.missing && fuel.fills.length > ROWS ? (
          <button type="button" onClick={() => setAll((v) => !v)} className="text-[12px] font-medium text-accent hover:underline">
            {all ? "Visa de 8 senaste ›" : `Visa alla ${fuel.fills.length} tankningar ›`}
          </button>
        ) : (
          <span />
        )}
        <SourceNote source={fuel.source} period={(w) => `veckan från ${dayLong(w)}`} />
      </div>
    </section>
  );
}
