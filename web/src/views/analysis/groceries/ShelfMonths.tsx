import { useState } from "react";
import { Bar, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { GrocerySummary } from "../../../api";
import { cn } from "../../../lib/cn";
import { useWidth } from "../../../lib/useWidth";
import { Money, chart, monthLabel, useChartAnimation } from "../common";
import { Segment, type SegmentProps } from "../categories/CategoryBars";
import { totalLabel } from "../categories/bars";
import { shelfColour } from "./shelves";

const NONE = "none";
const keyOf = (id: number | null) => (id === null ? NONE : String(id));
const shortMonth = (m: string) => monthLabel(m).replace(".", "");

/** The months without receipts as ranges: 'sep 25 – maj 26, jul 26'. */
export function missingRanges(months: GrocerySummary["months"]): string {
  const ranges: string[][] = [];
  let run: string[] = [];
  for (const m of months) {
    if (m.receipts === 0) run.push(m.month);
    else if (run.length) {
      ranges.push(run);
      run = [];
    }
  }
  if (run.length) ranges.push(run);
  return ranges.map((r) => (r.length === 1 ? shortMonth(r[0]) : `${shortMonth(r[0])} – ${shortMonth(r.at(-1)!)}`)).join(", ");
}

/**
 * Per shelf, the left column: a row each with its colour, a 6 px bar against
 * the largest shelf, the kronor, the share and the rows.
 */
export function ShelfList({ groups }: { groups: GrocerySummary["groups"] }) {
  const total = groups.reduce((s, g) => s + g.totalOre, 0);
  const largest = Math.max(0, ...groups.map((g) => g.totalOre));
  return (
    <div className="min-w-0" data-part="shelves">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1.5">
        <h3 className="text-[13px] font-semibold">Per hylla</h3>
        <span className="text-[11px] text-ink-3">kronor · andel · rader</span>
      </div>
      <ul>
        {groups.map((g) => {
          const width = largest > 0 ? Math.max(0, g.totalOre) / largest : 0;
          return (
            <li key={keyOf(g.id)} className="grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto_2.75rem_2.25rem] items-center gap-x-3 border-b border-hairline py-1.5 text-[12px]" data-shelf={keyOf(g.id)}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: shelfColour(g) }} aria-hidden />
                <span className="truncate">{g.name}</span>
              </span>
              <span className="block h-1.5 rounded-full bg-track">
                <span className="block h-full rounded-full" style={{ width: `${width * 100}%`, background: shelfColour(g) }} data-bar={width} />
              </span>
              <span className="text-right font-semibold tabular-nums">
                <Money ore={g.totalOre} />
              </span>
              <span className="text-right text-ink-3 tabular-nums">{total > 0 ? `${Math.round((g.totalOre / total) * 100)} %` : "–"}</span>
              <span className="text-right text-ink-3 tabular-nums">{g.times}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Per month, the right column: the months that have a receipt, a stacked bar
 * each per shelf with its total above and 'N kvitton' under it. The months
 * without are left out and named under the chart. The tooltip lists the
 * month's shelves, the hovered one in bold.
 */
export function ShelfMonths({ groups, months }: { groups: GrocerySummary["groups"]; months: GrocerySummary["months"] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const animation = useChartAnimation();
  const shown = months.filter((m) => m.receipts > 0);
  const missing = missingRanges(months);
  const rows = shown.map((m) => ({ month: m.month, total: m.totalOre, receipts: m.receipts, ...m.groups }));
  // The largest shelf at the bottom, as in the list.
  const order = [...groups];
  const topOf = (row: Record<string, number>) => [...order].reverse().find((g) => (row[keyOf(g.id)] ?? 0) > 0);

  // A narrow bar gets the month and the receipts on two lines.
  const [measure, width] = useWidth(600);
  const twoLines = shown.length > 0 && width / shown.length < 110;
  const Tick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const m = shown.find((s) => s.month === payload?.value);
    if (!m) return null;
    const receipts = `${m.receipts} ${m.receipts === 1 ? "kvitto" : "kvitton"}`;
    return (
      <text x={x} y={(y ?? 0) + 12} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)">
        {twoLines ? (
          <>
            <tspan x={x}>{shortMonth(m.month)}</tspan>
            <tspan x={x} dy={12}>
              {receipts}
            </tspan>
          </>
        ) : (
          `${shortMonth(m.month)} · ${receipts}`
        )}
      </text>
    );
  };

  return (
    <div className="min-w-0" data-part="months">
      <h3 className="border-b border-transparent pb-1.5 text-[13px] font-semibold">Per månad, de månader som har kvitton</h3>
      {shown.length === 0 ? (
        <p className="py-6 text-[12px] text-ink-3">Inga kvitton i perioden.</p>
      ) : (
        <div ref={measure} className="h-56 w-full">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 20, right: 0, bottom: 0, left: 0 }} barCategoryGap="6%">
              <XAxis dataKey="month" tick={<Tick />} tickLine={false} axisLine={false} interval={0} height={twoLines ? 34 : 22} />
              <Tooltip
                cursor={chart.cursor}
                content={({ active, label }) => {
                  if (!active) return null;
                  const m = shown.find((s) => s.month === label);
                  if (!m) return null;
                  const lines = groups.map((g) => ({ g, v: m.groups[keyOf(g.id)] ?? 0 })).filter((x) => x.v !== 0);
                  return (
                    <div className="min-w-52 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                      <p className="mb-1.5 font-semibold first-letter:uppercase">
                        {monthLabel(m.month, true)} · {m.receipts} {m.receipts === 1 ? "kvitto" : "kvitton"}
                      </p>
                      <ul className="space-y-0.5">
                        {lines.map(({ g, v }) => (
                          <li key={keyOf(g.id)} className={cn("flex items-center gap-2", hovered && hovered !== keyOf(g.id) && "text-ink-3")}>
                            <span className="size-2 shrink-0 rounded-full" style={{ background: shelfColour(g) }} />
                            <span className={cn("min-w-0 flex-1 truncate", hovered === keyOf(g.id) && "font-semibold")}>{g.name}</span>
                            <Money ore={v} />
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 flex justify-between border-t border-hairline pt-1.5 font-semibold">
                        <span>Allt</span>
                        <Money ore={m.totalOre} />
                      </p>
                    </div>
                  );
                }}
              />
              {order.map((g) => (
                <Bar
                  key={keyOf(g.id)}
                  dataKey={keyOf(g.id)}
                  stackId="shelves"
                  fill={shelfColour(g)}
                  onMouseEnter={() => setHovered(keyOf(g.id))}
                  onMouseLeave={() => setHovered(null)}
                  shape={(p: unknown) => {
                    const row = (p as SegmentProps).payload as unknown as Record<string, number> & { month: string };
                    return (
                      <g data-bar={`${row.month}:${keyOf(g.id)}`}>
                        <Segment {...(p as SegmentProps)} top={topOf(row)?.id === g.id} />
                      </g>
                    );
                  }}
                  {...animation}
                />
              ))}
              <Line type="linear" dataKey="total" stroke="none" dot={false} activeDot={false} isAnimationActive={false}>
                <LabelList dataKey="total" position="top" offset={8} formatter={(v: unknown) => totalLabel(Number(v))} fontSize={10} fill="var(--color-ink-2)" />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-3" data-missing={missing || undefined}>
        {missing && `${missing} saknar kvitton och visas inte. `}Hovra på ett segment för hyllan.
      </p>
    </div>
  );
}
