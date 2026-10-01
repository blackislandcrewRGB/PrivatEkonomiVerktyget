import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { cn } from "../../../lib/cn";
import { useResolvedTheme } from "../../../lib/theme";
import { todayIso } from "../../../lib/today";
import { useWidth } from "../../../lib/useWidth";
import { Money, Section, chart, kTick, kr, monthLabel, useChartAnimation } from "../common";
import { monthShares, shareRows, topSeries, totalLabel } from "./bars";
import { chartColor } from "./colors";
import type { CategoryData, Series } from "./types";

type Mode = "bars" | "shares";
/** What is left of the other categories when one is hovered. */
const DIMMED = 0.4;
/** The top segment's corners (px). */
const RADIUS = 4;

const shortMonth = (m: string) => monthLabel(m).replace(".", "");

/**
 * Per kategori's chart card (Design v2): stacked bars per month in the
 * categories' colours with a 1 px gap between segments, the top one rounded,
 * the month's total over each bar; or 'Andelar', every month as 100 %. The
 * current month's label is blue. The tooltip gives each category's amount
 * and share of the month. A bar opens its transactions. The legend is chips
 * with each category's sum over the period; a chip drills into the
 * subcategories (then '‹ Tillbaka' first), and 'Totalt' shows the total as a
 * line (off to begin with).
 */
export function CategoryBars({
  data,
  title,
  subtitle,
  clickable,
  onOpen,
  onDrill,
  legendEnd,
}: {
  data: CategoryData;
  title: string;
  subtitle?: string;
  clickable: boolean;
  onOpen: (s: Series, month: string) => void;
  onDrill: (categoryId: number | null) => void;
  /** Last in the legend's row (Per kategori's 'Visa prylarna ›'). */
  legendEnd?: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("bars");
  const [line, setLine] = useState(false);
  const [hover, setHovered] = useState<string | null>(null);
  // A category hovered before a drill-down is gone from the chart: nothing is hovered then.
  const hovered = hover && data.series.some((s) => s.key === hover) ? hover : null;
  const drill = (id: number | null) => {
    setHovered(null);
    onDrill(id);
  };
  const [measure, width] = useWidth(1000);
  const theme = useResolvedTheme();
  const animation = useChartAnimation();
  const current = todayIso().slice(0, 7);
  const colour = (s: Series) => chartColor(s.color, theme);
  const shares = mode === "shares";
  const rows = shares ? shareRows(data) : data.data;
  const sum = (key: string) => data.data.reduce((a, d) => a + (d[key] ?? 0), 0);
  const drillable = (s: Series) => data.parent === null && s.categoryId !== null && s.key !== "unknown" && s.key !== "none";
  const narrow = width < 520;

  const Tick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const m = payload?.value ?? "";
    const now = m === current;
    return (
      <text x={x} y={(y ?? 0) + 12} textAnchor="middle" fontSize={11} fill={now ? "var(--color-accent)" : "var(--color-ink-3)"} fontWeight={now ? 600 : 400}>
        {shortMonth(m)}
      </text>
    );
  };

  return (
    <Section
      title={title}
      subtitle={subtitle}
      actions={
        <SegmentedControl<Mode>
          appearance="v2"
          size="sm"
          label="Visa som"
          value={mode}
          onChange={setMode}
          options={[
            { value: "bars", label: "Staplar" },
            { value: "shares", label: "Andelar" },
          ]}
        />
      }
    >
      <div ref={measure} className="h-80 w-full" data-mode={mode}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 22, right: narrow ? 14 : 4, bottom: 0, left: 0 }} stackOffset={shares ? "expand" : undefined} barCategoryGap="12%">
            <CartesianGrid vertical={false} stroke={chart.grid} />
            <XAxis dataKey="month" tick={<Tick />} tickLine={false} axisLine={false} interval={width < 400 ? 2 : narrow ? 1 : 0} height={24} />
            <YAxis
              tickFormatter={shares ? (v: number) => `${Math.round(v * 100)} %` : kTick}
              tick={chart.tick}
              width={40}
              axisLine={false}
              tickLine={false}
              domain={shares ? [0, 1] : undefined}
            />
            <Tooltip
              cursor={chart.cursor}
              content={({ active, label }) => {
                if (!active) return null;
                const row = data.data.find((d) => d.month === label);
                if (!row) return null;
                const part = monthShares(row, data.series);
                const lines = data.series
                  .map((s) => ({ s, v: row[s.key] ?? 0 }))
                  .filter((x) => x.v !== 0)
                  .sort((a, b) => b.v - a.v);
                return (
                  <div className="min-w-56 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                    <p className="mb-1.5 font-semibold first-letter:uppercase">{monthLabel(String(label), true)}</p>
                    <ul className="space-y-0.5">
                      {lines.map(({ s, v }) => (
                        <li key={s.key} className={cn("flex items-center gap-2", hovered && hovered !== s.key && "text-ink-3")}>
                          <span className="size-2 shrink-0 rounded-full" style={{ background: colour(s) }} />
                          <span className={cn("min-w-0 flex-1 truncate", hovered === s.key && "font-semibold")}>{s.name}</span>
                          <Money ore={v} />
                          <span className="w-10 text-right text-ink-3 tabular-nums">{v > 0 ? `${Math.round(part[s.key] * 100)} %` : ""}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 flex justify-between border-t border-hairline pt-1.5 font-semibold">
                      <span>Totalt</span>
                      <span className="tabular-nums">{kr(row.total)}</span>
                    </p>
                  </div>
                );
              }}
            />
            {data.series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="a"
                fill={colour(s)}
                fillOpacity={hovered && hovered !== s.key ? DIMMED : 1}
                cursor={clickable ? "pointer" : "default"}
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
                onClick={(entry) => clickable && onOpen(s, (entry as unknown as { payload: { month: string } }).payload.month)}
                shape={(p: unknown) => <Segment {...(p as SegmentProps)} top={topSeries((p as SegmentProps).payload, data.series) === s.key} />}
                {...animation}
              />
            ))}
            {!shares && (
              <Line
                type="linear"
                dataKey="total"
                stroke={line ? chart.line : "none"}
                strokeOpacity={hovered ? DIMMED : 1}
                strokeWidth={2}
                dot={line ? { r: 2, fill: chart.line } : false}
                activeDot={false}
                isAnimationActive={false}
              >
                {/* On a narrow screen the totals would run into each other: the tooltip has them. */}
                {!narrow && <LabelList dataKey="total" position="top" offset={8} formatter={(v: unknown) => totalLabel(Number(v))} fontSize={10} fill="var(--color-ink-2)" />}
              </Line>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-1.5 border-t border-hairline pt-3" aria-label="Kategorier">
        {data.parent && (
          <li>
            <button type="button" onClick={() => drill(null)} className="inline-flex h-7 items-center gap-1 rounded-full bg-card-inset px-3 text-[12px] font-medium text-accent hover:bg-segment">
              <ChevronLeft className="size-3.5" aria-hidden /> Tillbaka
            </button>
          </li>
        )}
        {data.series.map((s) => {
          const body = (
            <>
              <span className="size-2 shrink-0 rounded-full" style={{ background: colour(s) }} aria-hidden />
              <span className="truncate">{s.name}</span>
              <span className="text-ink-3 tabular-nums">{totalLabel(sum(s.key)) || "0"}</span>
            </>
          );
          return (
            <li key={s.key} data-legend={s.key} onMouseEnter={() => setHovered(s.key)} onMouseLeave={() => setHovered(null)}>
              {drillable(s) ? (
                <button
                  type="button"
                  onClick={() => drill(s.categoryId)}
                  title="Visa underkategorierna"
                  className="inline-flex h-7 max-w-64 items-center gap-1.5 rounded-full bg-card-inset px-3 text-[12px] text-ink hover:bg-segment"
                >
                  {body}
                  <ChevronRight className="size-3 shrink-0 text-ink-3" aria-hidden />
                </button>
              ) : (
                <span className="inline-flex h-7 max-w-64 items-center gap-1.5 rounded-full bg-card-inset px-3 text-[12px] text-ink">{body}</span>
              )}
            </li>
          );
        })}
        {!shares && (
          <li>
            <button
              type="button"
              aria-pressed={line}
              onClick={() => setLine((v) => !v)}
              title={line ? "Dölj linjen för totalen" : "Visa totalen som en linje"}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px]", line ? "bg-ink text-card" : "bg-card-inset text-ink hover:bg-segment")}
            >
              <span className={cn("h-0.5 w-3", line ? "bg-card" : "bg-ink")} aria-hidden />
              Totalt <span className={cn("tabular-nums", line ? "text-card/70" : "text-ink-3")}>{totalLabel(sum("total"))}</span>
            </button>
          </li>
        )}
        {legendEnd && <li>{legendEnd}</li>}
      </ul>
    </Section>
  );
}

export interface SegmentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  fillOpacity?: number;
  payload: Record<string, number>;
  top?: boolean;
}

/** A segment with 1 px of air above it; the top one with rounded corners. */
export function Segment({ x, y, width, height, fill, fillOpacity, top }: SegmentProps) {
  if (!height || height <= 0 || !width) return null;
  const h = Math.max(0, height - 1);
  const yy = y + 1;
  if (!top || h < RADIUS) return <rect x={x} y={yy} width={width} height={h} fill={fill} fillOpacity={fillOpacity} />;
  const r = Math.min(RADIUS, width / 2);
  const d = `M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + width - r} Q${x + width},${yy} ${x + width},${yy + r} V${yy + h} Z`;
  return <path d={d} fill={fill} fillOpacity={fillOpacity} />;
}
