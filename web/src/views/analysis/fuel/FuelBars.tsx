import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FuelMonth } from "../../../api";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { navigate } from "../../../shell/routes";
import { Money, chart, monthLabel, useChartAnimation, wholeKr } from "../common";
import { TONE_CLASS, consumptionTone, l100Text } from "./figures";

const FUEL = "var(--color-caution)";
const EMPTY = "var(--color-segment)";
const shortMonth = (m: string) => monthLabel(m).replace(".", "");

interface BarShape {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: FuelMonth;
}

/** A month's bar with rounded top corners; a month without fuel as a grey 3 px line on the baseline. */
function FuelBar({ x, y, width, height, payload }: BarShape) {
  if (!width) return null;
  if (!payload.spent) return <rect x={x} y={y + Math.max(0, height) - 3} width={width} height={3} rx={1.5} fill={EMPTY} data-bar={payload.month} data-empty />;
  // While the bars grow from nothing there may be no height yet.
  const r = Math.min(4, width / 2, Math.max(0, height));
  const d = height > 0 ? `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z` : "";
  return (
    <g data-bar={payload.month} data-value={payload.spent}>
      {d && <path d={d} fill={FUEL} />}
    </g>
  );
}

/**
 * Bränsle › Tankat per månad (Design v2): a bar per month in orange (a
 * month without fuel a grey line), kronor per shift over it, the current
 * month's label blue; the tooltip has the kronor, shifts, km, per shift and
 * l/100 km. Under it, in the same columns, the consumption per month as a
 * toned box against the table value (green under, orange over, grey the
 * same or none). The line on its own axis is gone.
 */
export function FuelBars({ months, base, narrow }: { months: FuelMonth[]; base: number; narrow: boolean }) {
  const animation = useChartAnimation();
  const current = todayIso().slice(0, 7);

  const Tick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const m = payload?.value ?? "";
    const now = m === current;
    return (
      <text x={x} y={(y ?? 0) + 12} textAnchor="middle" fontSize={11} fill={now ? "var(--color-accent)" : "var(--color-ink-3)"} fontWeight={now ? 600 : 400}>
        {shortMonth(m)}
      </text>
    );
  };

  const PerShift = (p: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
    const m = months[p.index ?? -1];
    if (!m || m.perShift === null || !m.spent) return null;
    return (
      <text x={Number(p.x) + Number(p.width) / 2} y={Number(p.y) - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-ink-2)" data-per-shift={m.month}>
        {wholeKr(m.perShift)}
      </text>
    );
  };

  // What the row is; on a phone it stands under the row, which scrolls with the chart.
  const explanation = (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[11px]", narrow ? "-mt-2" : "mb-2")}>
      <p className="text-ink-2">
        <b className="font-semibold text-ink">Förbrukning l/100 km</b> · avslutade månader med pass och tankning
      </p>
      <p className="text-ink-3">grön under tabellvärdet {l100Text(base)} · orange över · en full tank hamnar i en enda månad, så spridningen är väntad</p>
    </div>
  );

  return (
    <section className="space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="fuel-bars-title" data-card="bars">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="fuel-bars-title" className="text-[15px] font-semibold">
            Tankat per månad
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            kategorin Bil › Drivmedel, per köpdag, utan tankningar märkta resa · hela beloppet oavsett Min del / Hushållet · kronor per pass står ovanför
          </p>
        </div>
        <button type="button" onClick={() => navigate("commute")} className="shrink-0 text-[12px] font-medium text-accent hover:underline">
          Kalibrering i Pendling & bränsle ›
        </button>
      </div>

      {/* On a phone the chart and the consumption row scroll sideways together. */}
      <div className={cn(narrow && "-mx-5 overflow-x-auto px-5 [scrollbar-width:none]")}>
        <div className={cn(narrow && "min-w-[36rem]")}>
          <div className="h-60 w-full">
            <ResponsiveContainer>
              <BarChart data={months} margin={{ top: 20, right: 0, bottom: 0, left: 0 }} barCategoryGap="8%">
                <XAxis dataKey="month" tick={<Tick />} tickLine={false} axisLine={false} interval={0} height={24} />
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip
                  cursor={chart.cursor}
                  content={({ active, label }) => {
                    if (!active) return null;
                    const m = months.find((x) => x.month === label);
                    if (!m) return null;
                    const lines: [string, React.ReactNode][] = [
                      ["Tankat", m.spent ? <Money ore={m.spent} /> : "–"],
                      ["Pass", m.shifts ?? "–"],
                      ["Km", m.km === null ? "–" : m.km.toLocaleString("sv-SE")],
                      ["Per pass", m.perShift === null ? "–" : <Money ore={m.perShift} />],
                      ["l/100 km", l100Text(m.l100)],
                    ];
                    return (
                      <div className="min-w-44 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                        <p className="mb-1.5 font-semibold first-letter:uppercase">{monthLabel(String(label), true)}</p>
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
                <Bar dataKey="spent" shape={(p: unknown) => <FuelBar {...(p as BarShape)} />} {...animation}>
                  <LabelList dataKey="spent" content={PerShift} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 border-t border-hairline pt-3">
            {!narrow && explanation}
            {/* The bars' columns: a box as wide as its bar (8 % of the column on each side, as barCategoryGap). */}
            <ol className="grid" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }} aria-label="Förbrukning per månad">
              {months.map((m) => {
                const tone = m.l100 === null ? null : consumptionTone(m.l100, base);
                return (
                  <li key={m.month} className="px-[8%]">
                    <span
                      className={cn("block rounded-[6px] py-1 text-center text-[12px] font-semibold tabular-nums", tone ? TONE_CLASS[tone] : "bg-segment text-ink-3")}
                      data-consumption={m.month}
                      data-tone={tone ?? "none"}
                      title={`${monthLabel(m.month, true)}: ${m.l100 === null ? "inget värde" : `${l100Text(m.l100)} l/100 km`}`}
                    >
                      {l100Text(m.l100)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
      {narrow && explanation}
    </section>
  );
}
