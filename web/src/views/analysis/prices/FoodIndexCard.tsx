import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "../../../lib/cn";
import { BUTTON } from "../../settings/ui";
import { chart, monthLabel } from "../common";
import { SourceNote, indexLabel, krona, pctE2, type FoodMonth, type PricesData } from "./types";

const MINE = "var(--color-positive)";
const KPI = "var(--color-ink-2)";
const shortMonth = (m: string) => monthLabel(m).replace(".", "");

function Box({ label, icon, value, hint, tone, testId }: { label: string; icon?: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "positive"; testId: string }) {
  return (
    <div className={cn("min-w-0 rounded-inset px-3.5 py-3", tone === "positive" ? "bg-positive-soft" : "bg-card-inset")} data-box={testId}>
      <p className={cn("flex items-center gap-2 text-[11px]", tone === "positive" ? "text-positive-text" : "text-ink-2")}>
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

/**
 * Mat mot konsumentprisindex (Design v2): my food and SCB's index for food
 * and non-alcoholic drinks, both 100 in the base month. Three boxes (my
 * change, theirs, my latest month against the first), and the two lines: mine
 * green, theirs grey and dashed, a dotted line at 100 and the ends marked.
 */
export function FoodIndexCard({ food, syncing, onSync }: { food: PricesData["food"]; syncing: boolean; onSync: () => void }) {
  const base = monthLabel(food.base.month, true);
  const through = food.through ? monthLabel(food.through, true) : null;
  const latest = food.months.find((m) => m.month === food.through);
  const lastMine = [...food.months].reverse().find((m) => m.mineIndex !== null)?.month;
  const lastKpi = [...food.months].reverse().find((m) => m.kpiIndex !== null)?.month;

  const End = (which: "mine" | "kpi") =>
    function EndDot(p: { cx?: number; cy?: number; payload?: FoodMonth }) {
      if (p.cx === undefined || p.cy === undefined || !p.payload) return null;
      if (p.payload.month !== (which === "mine" ? lastMine : lastKpi)) return null;
      return which === "mine" ? (
        <circle cx={p.cx} cy={p.cy} r={4} fill={MINE} data-end="mine" />
      ) : (
        <circle cx={p.cx} cy={p.cy} r={4} fill="var(--color-card)" stroke={KPI} strokeWidth={1.5} data-end="kpi" />
      );
    };

  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="food-index-title" data-card="food-index">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <h2 id="food-index-title" className="text-[15px] font-semibold">
            Mat mot konsumentprisindex
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            båda linjerna står i 100 i {base} · din linje är vad du handlade för, SCB:s är vad maten kostade – en månad du bunkrade rör din och inte deras
          </p>
        </div>
        <button type="button" className={BUTTON.grey} onClick={onSync} disabled={syncing} title="Hämtar index och rikssnitt nu, samma körning som klockan gör">
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} aria-hidden /> Hämta nu
        </button>
      </div>

      {food.missing ? (
        <p className="text-sm text-caution-text">{food.missing}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-3">
            <Box
              testId="mine"
              tone="positive"
              icon={<span className="h-0.5 w-3.5 rounded-full bg-positive" aria-hidden />}
              label="Din matkostnad"
              value={pctE2(food.change.mine)}
              hint={through ? `${base} → ${through}` : undefined}
            />
            <Box
              testId="kpi"
              icon={<span className="w-3.5 border-t-2 border-dashed border-ink-2" aria-hidden />}
              label="KPI livsmedel och alkoholfria drycker"
              value={pctE2(food.change.kpi)}
              hint={through ? "samma månader" : undefined}
            />
            <Box
              testId="latest"
              label={`Din matkostnad ${through ?? ""}`.trim()}
              value={latest?.mineOre ? krona(latest.mineOre) : "–"}
              hint={food.base.mineOre ? `${base}: ${krona(food.base.mineOre)}` : undefined}
            />
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer>
              <LineChart data={food.months} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} stroke={chart.grid} />
                <XAxis dataKey="month" tickFormatter={shortMonth} tick={chart.tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis orientation="right" tickFormatter={(v) => indexLabel(v).replace(/,0$/, "")} tick={chart.tick} width={36} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                <ReferenceLine y={10000} stroke="var(--color-ink-3)" strokeDasharray="1 3" label={{ value: "100", position: "insideTopLeft", fontSize: 10, fill: "var(--color-ink-3)" }} />
                <Tooltip
                  cursor={{ stroke: "var(--color-hairline)" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const m = payload[0].payload as FoodMonth;
                    return (
                      <div className="min-w-52 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                        <p className="mb-1.5 font-semibold first-letter:uppercase">{monthLabel(String(label), true)}</p>
                        <p className="flex items-center gap-2">
                          <span className="h-0.5 w-3 rounded-full bg-positive" />
                          <span className="flex-1">Din matkostnad</span>
                          <span className="tabular-nums">{indexLabel(m.mineIndex)}</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <span className="w-3 border-t-2 border-dashed border-ink-2" />
                          <span className="flex-1">KPI livsmedel</span>
                          <span className="tabular-nums">{indexLabel(m.kpiIndex)}</span>
                        </p>
                        <p className="mt-1.5 border-t border-hairline pt-1.5 text-ink-2">{m.mineOre !== null ? `Du handlade för ${krona(m.mineOre)}` : "Inga matinköp registrerade"}</p>
                      </div>
                    );
                  }}
                />
                <Line type="linear" dataKey="kpiIndex" stroke={KPI} strokeWidth={1.5} strokeDasharray="5 4" dot={End("kpi")} activeDot={false} connectNulls isAnimationActive={false} />
                <Line type="linear" dataKey="mineIndex" stroke={MINE} strokeWidth={2.5} dot={End("mine")} activeDot={{ r: 4, fill: MINE }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-ink-3">
            Maten räknas för hela hushållet, inte din del: priset på mat halveras inte för att räkningen gör det. Bara hela månader; en månad utan registrerade matinköp lämnas
            tom i stället för att ritas som noll.
          </p>
        </>
      )}
      <SourceNote source={food.source} period={(m) => monthLabel(m.slice(0, 7), true)} />
    </section>
  );
}
