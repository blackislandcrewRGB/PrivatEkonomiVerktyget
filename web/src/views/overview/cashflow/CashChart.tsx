import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, useXAxisScale, useYAxisScale, usePlotArea, XAxis, YAxis } from "recharts";
import type { CashEvent, Cashflow as Data } from "../../../api";
import { dm, kr, plusDays, weekday } from "../format";
import { bigDrops, paydays, placeBox, yTicks, type Box, type Drop } from "./chartMarks";

export interface SeriesPoint {
  date: string;
  balance: number;
  /** With the tänk om-purchase: from the day before it leaves the bank. */
  scenario?: number;
  day: Data["days"][number];
}

/** The tänk om-purchase drawn on the curve (not saved). */
export interface ChartScenario {
  description: string;
  lowest: { date: string; balance: number };
}

const KIND: Record<CashEvent["kind"], string> = { income: "inkomst", fixed: "fast", invoice: "kortfaktura", planned: "planerad", partner: "delad ekonomi" };

/** '25k', '−5k', '0'. */
const kTick = (ore: number) => (ore === 0 ? "0" : `${(ore / 100000).toLocaleString("sv-SE")}k`);

const tick = { fill: "var(--v2-ink-3)", fontSize: 11 };

/** Width of a one-line label at 10–11 px (the SF-like stack runs about 5.6 px a character). */
const textWidth = (s: string, size = 10) => Math.ceil(s.length * size * 0.56) + 4;

/**
 * Kassaflöde's curve: the balance 90 days ahead as an area, paydays as faint
 * green lines, today dashed, the lowest point in red with a callout, the
 * largest falls ringed and named, and a tänk om-purchase as an orange dashed
 * line. The figures are also in its label and in the list under it.
 */
export function CashChart({ data, series, scenario, bankLabel }: { data: Data; series: SeriesPoint[]; scenario: ChartScenario | null; bankLabel: string }) {
  const pays = useMemo(() => paydays(data.days), [data.days]);
  const drops = useMemo(() => bigDrops(data.days, [data.lowest.date]), [data.days, data.lowest.date]);
  const values = series.flatMap((p) => (p.scenario === undefined ? [p.balance] : [p.balance, p.scenario]));
  const ticks = yTicks(Math.min(...values), Math.max(...values));
  const end = data.days.at(-1)!;
  const label =
    `Saldot 90 dagar framåt: i dag ${kr(data.start)}, lägst ${kr(data.lowest.balance)} den ${dm(data.lowest.date)}, ${kr(end.balance)} den ${dm(end.date)}.` +
    (pays.length ? ` Lön ${pays.map(dm).join(", ")}.` : "") +
    (drops.length ? ` Stora dragningar: ${drops.map((d) => `${d.label} ${kr(-d.fall)}`).join(", ")}.` : "") +
    (scenario ? ` Med tänk om-köpet ${scenario.description}: lägst ${kr(scenario.lowest.balance)} den ${dm(scenario.lowest.date)}.` : "");

  return (
    <figure aria-label={label} className="m-0">
      <div className="h-72 w-full sm:h-80" data-testid="cashflow-chart">
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ top: 22, right: 8, bottom: 0, left: 16 }}>
            <defs>
              <linearGradient id="cashflow-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--v2-accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--v2-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--v2-hairline)" />
            <XAxis dataKey="date" tickFormatter={dm} tick={tick} axisLine={false} tickLine={false} interval={14} tickMargin={8} />
            <YAxis orientation="right" ticks={ticks} domain={[ticks[0], ticks.at(-1)!]} tickFormatter={kTick} tick={tick} axisLine={false} tickLine={false} width={40} />
            {ticks[0] < 0 && <ReferenceLine y={0} stroke="var(--v2-ink-3)" strokeOpacity={0.5} />}
            {data.buffer > 0 && (
              <ReferenceLine y={data.buffer} stroke="var(--v2-caution)" strokeDasharray="4 4" label={{ value: "buffert", position: "insideBottomLeft", fill: "var(--v2-ink-3)", fontSize: 10 }} />
            )}
            {pays.map((p) => (
              <ReferenceLine key={p} x={p} stroke="var(--v2-positive)" strokeOpacity={0.25} strokeWidth={4} />
            ))}
            <ReferenceLine x={data.today} stroke="var(--v2-ink)" strokeDasharray="3 3" strokeWidth={1} />
            <Tooltip content={<CurveTooltip />} cursor={{ stroke: "var(--v2-ink-3)", strokeWidth: 1 }} isAnimationActive={false} />
            <Area type="linear" dataKey="balance" stroke="var(--v2-accent)" strokeWidth={2.5} fill="url(#cashflow-fill)" dot={false} activeDot={{ r: 4, fill: "var(--v2-accent)", stroke: "var(--v2-card)", strokeWidth: 2 }} isAnimationActive={false} />
            {scenario && (
              <Area type="linear" dataKey="scenario" stroke="var(--v2-caution)" strokeWidth={2} strokeDasharray="6 4" fill="none" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            )}
            <Marks data={data} series={series} drops={drops} pays={pays} scenario={scenario} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-[2.5px] w-4 rounded-full bg-accent" aria-hidden /> {bankLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-caution" aria-hidden /> Tänk om-köp (ej sparat)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-1 rounded-full bg-positive/40" aria-hidden /> Lönedag
        </span>
        <span className="text-ink-3 sm:ml-auto">Dra i kurvan för att se saldot en viss dag</span>
      </figcaption>
    </figure>
  );
}

function CurveTooltip({ active, payload }: { active?: boolean; payload?: { payload: SeriesPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="max-w-64 rounded-[10px] bg-card px-3 py-2.5 text-xs text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-hairline">
      <p className="text-[11px] text-ink-2">
        {weekday(p.date)} {dm(p.date)}
      </p>
      <p className="text-[15px] font-bold tabular-nums">{kr(p.balance)}</p>
      {p.scenario !== undefined && p.scenario !== p.balance && <p className="text-caution-text tabular-nums">med tänk om-köpet {kr(p.scenario)}</p>}
      {(p.day.events.length > 0 || p.day.variable > 0) && (
        <ul className="mt-1.5 space-y-0.5 border-t border-hairline pt-1.5">
          {p.day.events.map((e, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">
                {e.name} <span className="text-ink-3">{KIND[e.kind]}</span>
              </span>
              <span className={e.amount > 0 ? "text-positive-text tabular-nums" : "tabular-nums"}>{kr(e.amount)}</span>
            </li>
          ))}
          {p.day.variable > 0 && (
            <li className="flex justify-between gap-3 text-ink-2">
              <span>Rörligt</span>
              <span className="tabular-nums">{kr(-p.day.variable)}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

const BUBBLE = { width: 150, height: 44 };
/** On a phone: a smaller callout, and the falls without their names (the tooltip and the list have them). */
const NARROW = 480;
const SMALL_BUBBLE = { width: 118, height: 36 };

/** The marks drawn in the chart's own coordinates: today, the falls, the lowest point and the tänk om-purchase. */
function Marks({ data, series, drops, pays, scenario }: { data: Data; series: SeriesPoint[]; drops: Drop[]; pays: string[]; scenario: ChartScenario | null }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot) return null;
  const at = (date: string, value: number) => ({ x: xScale(date, { position: "middle" }) ?? 0, y: yScale(value) ?? 0 });
  // What a label must not cover: the curves, and the labels already placed.
  const taken = [
    ...series.map((p) => at(p.date, p.balance)),
    ...series.filter((p) => p.scenario !== undefined).map((p) => at(p.date, p.scenario!)),
  ];
  // The buffer line and its label.
  if (data.buffer > 0) {
    const yb = yScale(data.buffer) ?? 0;
    for (let x = plot.x; x <= plot.x + plot.width; x += 8) taken.push({ x, y: yb });
    for (let x = plot.x; x <= plot.x + 44; x += 8) taken.push({ x, y: yb - 8 });
  }
  const take = (b: Box) => {
    for (let fx = 0; fx <= 1; fx += 0.25) for (let fy = 0; fy <= 1; fy += 0.5) taken.push({ x: b.x + b.width * fx, y: b.y + b.height * fy });
  };
  const area: Box = { x: plot.x, y: plot.y - 16, width: plot.width, height: plot.height + 16 };

  const narrow = plot.width < NARROW;

  // 'lön 23/10' at the top of each payday line, to its right (left near the edge), skipping one that would run into the one before.
  const payLabels: { x: number; anchor: "start" | "end"; text: string }[] = [];
  let free = -Infinity;
  for (const p of pays) {
    const x = xScale(p, { position: "middle" }) ?? 0;
    const text = `lön ${dm(p)}`;
    const width = textWidth(text);
    const flip = x + 6 + width > plot.x + plot.width;
    const from = flip ? x - 6 - width : x + 6;
    if (from < free) continue;
    payLabels.push({ x: flip ? x - 6 : x + 6, anchor: flip ? "end" : "start", text });
    free = from + width + 8;
  }

  // A label that fits nowhere stays inside the chart all the same.
  const clamp = <B extends Box>(b: B): B => ({ ...b, x: Math.min(Math.max(b.x, area.x), area.x + area.width - b.width) });

  const today = at(series[0].date, series[0].balance);
  const low = at(data.lowest.date, data.lowest.balance);
  const placed = placeBox(low, narrow ? SMALL_BUBBLE : BUBBLE, area, taken, narrow ? 10 : 14);
  // On a phone there may be no room beside it that leaves the curve free: then the dot alone (the box above has the figure).
  const bubble = narrow && placed.covered > 0 ? null : placed;
  if (bubble) take(bubble);

  const rings = drops.map((d) => {
    const p = at(d.date, d.balance);
    if (narrow) return { d, p, box: null };
    // Right beside its ring or not at all: a name far from its point reads as another's.
    const placed = placeBox(p, { width: textWidth(d.label), height: 12 }, area, taken, 6, 0);
    // (One point grazing its edge is fine: the line runs just under the text.)
    if (placed.covered > 1) return { d, p, box: null };
    take(placed);
    return { d, p, box: placed };
  });

  let think: { start: { x: number; y: number }; low: { x: number; y: number }; box: Box; text: string } | null = null;
  if (scenario) {
    const first = series.find((p) => p.scenario !== undefined && p.scenario !== p.balance);
    if (first) {
      // On a phone without the description (it is in the field right under).
      const text = narrow ? `tänk om → lägst ${kr(scenario.lowest.balance)}` : `tänk om: ${scenario.description} → lägst ${kr(scenario.lowest.balance)}`;
      const lowAt = at(scenario.lowest.date, scenario.lowest.balance);
      const box = clamp(placeBox(lowAt, { width: textWidth(text), height: 12 }, area, taken, 8));
      take(box);
      think = { start: at(first.date, first.scenario!), low: lowAt, box, text };
    }
  }

  // A pointer on the bubble's side towards the dot; lifted higher up, a thin line down to it.
  const pointer = bubble && {
    x: bubble.side === "left" ? bubble.x + bubble.width : bubble.x,
    y: Math.min(Math.max(low.y, bubble.y + 10), bubble.y + bubble.height - 10),
    dir: bubble.side === "left" ? 1 : -1,
  };
  return (
    <g aria-hidden>
      {payLabels.map((l) => (
        <text key={l.text} x={l.x} y={plot.y - 8} textAnchor={l.anchor} fontSize={10} fontWeight={600} fill="var(--v2-positive-text)">
          {l.text}
        </text>
      ))}
      <circle cx={today.x} cy={today.y} r={4.5} fill="var(--v2-ink)" stroke="var(--v2-card)" strokeWidth={2} />
      {rings.map(({ d, p, box }) => (
        <g key={d.date} data-drop={d.date}>
          <circle cx={p.x} cy={p.y} r={4} fill="var(--v2-card)" stroke={d.tone === "invoice" ? "var(--v2-alarm)" : "var(--v2-ink)"} strokeWidth={1.75} />
          {box && (
            <text x={box.x} y={box.y + 9} fontSize={10} fill="var(--v2-ink-2)">
              {d.label}
            </text>
          )}
        </g>
      ))}
      {think && (
        <g>
          <circle cx={think.start.x} cy={think.start.y} r={4} fill="var(--v2-card)" stroke="var(--v2-caution)" strokeWidth={1.75} />
          <circle cx={think.low.x} cy={think.low.y} r={3.5} fill="var(--v2-card)" stroke="var(--v2-alarm)" strokeWidth={1.75} />
          <text x={think.box.x} y={think.box.y + 9} fontSize={10} fill="var(--v2-caution-text)">
            {think.text}
          </text>
        </g>
      )}
      <circle cx={low.x} cy={low.y} r={11} fill="var(--v2-alarm)" opacity={0.16} />
      <circle cx={low.x} cy={low.y} r={5} fill="var(--v2-alarm)" stroke="var(--v2-card)" strokeWidth={2} />
      {bubble && pointer && (
        <g data-testid="lowest-callout">
          {Math.abs(pointer.y - low.y) > 1 && <line x1={pointer.x} y1={pointer.y} x2={low.x} y2={low.y} stroke="var(--v2-ink)" strokeWidth={1} />}
          <rect x={bubble.x} y={bubble.y} width={bubble.width} height={bubble.height} rx={10} fill="var(--v2-ink)" />
          <path d={`M${pointer.x},${pointer.y - 6} L${pointer.x + pointer.dir * 6},${pointer.y} L${pointer.x},${pointer.y + 6} Z`} fill="var(--v2-ink)" />
          <text x={bubble.x + (narrow ? 9 : 12)} y={bubble.y + (narrow ? 14 : 17)} fontSize={narrow ? 10 : 11} fill="var(--v2-card)" opacity={0.8}>
            {narrow ? "Lägst" : "Lägsta punkt"} · {weekday(data.lowest.date)} {dm(data.lowest.date)}
          </text>
          <text x={bubble.x + (narrow ? 9 : 12)} y={bubble.y + (narrow ? 29 : 35)} fontSize={narrow ? 13 : 15} fontWeight={700} fill="var(--v2-card)">
            {kr(data.lowest.balance)}
          </text>
        </g>
      )}
    </g>
  );
}

/** The series for the curve: the balance, and with a tänk om-purchase the balance with it from the day before it counts. */
export function withScenario(
  days: Data["days"],
  change: { date: string; amount: number }[],
): SeriesPoint[] {
  const first = change.length ? change.reduce((a, b) => (b.date < a.date ? b : a)).date : null;
  return days.map((d) => ({
    date: d.date,
    balance: d.balance,
    scenario: first !== null && d.date >= plusDays(first, -1) ? d.balance + change.reduce((s, c) => s + (d.date >= c.date ? c.amount : 0), 0) : undefined,
    day: d,
  }));
}
