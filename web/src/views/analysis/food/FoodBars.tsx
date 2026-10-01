import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Switch } from "../../../components/Switch";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { useWidth } from "../../../lib/useWidth";
import { Money, chart, kTick, monthLabel, pct, useChartAnimation } from "../common";
import { Segment, type SegmentProps } from "../categories/CategoryBars";
import { SHARE_TONE, shareText, shareTone } from "./tones";
import { FOOD_KINDS, foodTotal, type FoodData, type FoodKind, type FoodMonth } from "./types";

const shortMonth = (m: string) => monthLabel(m).replace(".", "");

/** The kind drawn on top in a month: its segment gets the rounded corners. */
const topKind = (m: FoodMonth): FoodKind | null => [...FOOD_KINDS].reverse().find((k) => m[k.key] > 0)?.key ?? null;

/**
 * Mat › Per månad (Design v2): livsmedel, restaurang & café and hämtmat
 * stacked per month in kronor, 1 px apart with the top one rounded; the
 * share eaten out over each bar as a pill in its tone. The current month's
 * label is blue. The tooltip has the three amounts and the share. The old
 * line for the share can be shown on its own axis (off to begin with).
 */
export function FoodBars({ data }: { data: FoodData }) {
  const [line, setLine] = useState(false);
  const [measure, width] = useWidth(1000);
  const animation = useChartAnimation();
  const current = todayIso().slice(0, 7);
  const narrow = width < 520;
  const rows = data.months.map((m) => ({ ...m, total: foodTotal(m), sharePct: m.outShare === null ? null : Math.round(m.outShare * 1000) / 10 }));

  const Tick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const m = payload?.value ?? "";
    const now = m === current;
    return (
      <text x={x} y={(y ?? 0) + 12} textAnchor="middle" fontSize={11} fill={now ? "var(--color-accent)" : "var(--color-ink-3)"} fontWeight={now ? 600 : 400}>
        {shortMonth(m)}
      </text>
    );
  };

  /** The share over a bar as a pill in its tone. */
  const SharePill = (p: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
    const m = data.months[p.index ?? -1];
    if (!m || m.outShare === null) return null;
    const tone = SHARE_TONE[shareTone(m.outShare)];
    const text = shareText(m.outShare);
    const w = text.length * 5.6 + 12;
    const cx = Number(p.x) + Number(p.width) / 2;
    const top = Number(p.y) - 22;
    return (
      <g data-share-pill={m.month} data-tone={shareTone(m.outShare)}>
        <rect x={cx - w / 2} y={top} width={w} height={16} rx={8} fill={tone.fill} />
        <text x={cx} y={top + 11.5} textAnchor="middle" fontSize={10} fontWeight={600} fill={tone.text}>
          {text}
        </text>
      </g>
    );
  };

  return (
    <section className="space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="food-bars-title" data-card="bars">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 id="food-bars-title" className="text-[15px] font-semibold">
            Per månad
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {/* The pills don't fit over the bars on a phone. */}
            {narrow ? "staplarna är kronor; tryck på en stapel för andelen ute och hämtmat" : "staplarna är kronor; andelen ute och hämtmat står ovanför"}
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="Förklaring">
          {FOOD_KINDS.map((k) => (
            <li key={k.key} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", k.dot)} aria-hidden />
              {k.name}
            </li>
          ))}
        </ul>
      </div>
      <div ref={measure} className="h-72 w-full" data-line={line}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 28, right: line ? 0 : narrow ? 14 : 4, bottom: 0, left: 0 }} barCategoryGap="12%">
            <CartesianGrid vertical={false} stroke={chart.grid} />
            <XAxis dataKey="month" tick={<Tick />} tickLine={false} axisLine={false} interval={width < 400 ? 2 : narrow ? 1 : 0} height={24} />
            <YAxis yAxisId="kr" tickFormatter={kTick} tick={chart.tick} width={40} axisLine={false} tickLine={false} />
            {line && <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v} %`} tick={chart.tick} width={48} axisLine={false} tickLine={false} />}
            <Tooltip
              cursor={chart.cursor}
              content={({ active, label }) => {
                if (!active) return null;
                const m = data.months.find((x) => x.month === label);
                if (!m) return null;
                return (
                  <div className="min-w-52 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                    <p className="mb-1.5 font-semibold first-letter:uppercase">{monthLabel(String(label), true)}</p>
                    <ul className="space-y-0.5">
                      {FOOD_KINDS.map((k) => (
                        <li key={k.key} className="flex items-center gap-2">
                          <span className={cn("size-2 shrink-0 rounded-full", k.dot)} />
                          <span className="min-w-0 flex-1 truncate">{k.name}</span>
                          <Money ore={m[k.key]} />
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 flex justify-between border-t border-hairline pt-1.5 font-semibold">
                      <span>Ute & hämtmat</span>
                      <span className="tabular-nums">{pct(m.outShare)}</span>
                    </p>
                  </div>
                );
              }}
            />
            {FOOD_KINDS.map((k) => (
              <Bar
                key={k.key}
                yAxisId="kr"
                dataKey={k.key}
                stackId="food"
                fill={k.colour}
                shape={(p: unknown) => {
                  const m = (p as SegmentProps).payload as unknown as FoodMonth;
                  return (
                    <g data-bar={`${m.month}:${k.key}`} data-value={m[k.key]}>
                      <Segment {...(p as SegmentProps)} top={topKind(m) === k.key} />
                    </g>
                  );
                }}
                {...animation}
              />
            ))}
            {/* An invisible line along the tops carries the pills; with 'Visa andel som linje' the share as a dotted line. */}
            <Line yAxisId="kr" type="linear" dataKey="total" stroke="none" dot={false} activeDot={false} isAnimationActive={false}>
              {/* On a narrow screen the pills would run into each other: the tooltip has the share. */}
              {!narrow && <LabelList dataKey="total" content={SharePill} />}
            </Line>
            {line && (
              <Line yAxisId="pct" type="linear" dataKey="sharePct" stroke="var(--color-ink-3)" strokeWidth={1.5} strokeDasharray="2 3" dot={{ r: 2, fill: "var(--color-ink-3)" }} connectNulls isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-end border-t border-hairline pt-3">
        <Switch checked={line} onCheckedChange={setLine} label="Visa andel som linje">
          <span className="text-[12px] text-ink-2">Visa andel som linje</span>
        </Switch>
      </div>
    </section>
  );
}
