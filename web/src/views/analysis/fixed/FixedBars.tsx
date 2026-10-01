import { Bar, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { todayIso } from "../../../lib/today";
import { useWidth } from "../../../lib/useWidth";
import { Money, chart, monthLabel, useChartAnimation, wholeKr } from "../common";
import { Segment, type SegmentProps } from "../categories/CategoryBars";
import type { FixedData, FixedMonth } from "./figures";

const FIXED = "var(--color-ink)";
const VARIABLE = "var(--color-caution)";
const INCOME = "var(--color-positive)";
/** The bars' gap between months, as a share of a month's width. */
const GAP = 0.12;
const shortMonth = (m: string) => monthLabel(m).replace(".", "");

/** The net over a bar: '+9k', '−7k'; under 1 000 kr in whole kronor. */
export function netLabel(ore: number): string {
  const kr = Math.round(ore / 100);
  const sign = kr > 0 ? "+" : kr < 0 ? "−" : "±";
  const abs = Math.abs(kr);
  return `${sign}${abs >= 1000 ? `${Math.round(abs / 1000)}k` : abs}`;
}
export const netTone = (ore: number) => (Math.round(ore / 100) > 0 ? "positive" : Math.round(ore / 100) < 0 ? "negative" : "zero");
const NET_COLOURS = {
  positive: { fill: "var(--color-positive-soft)", text: "var(--color-positive-text)" },
  negative: { fill: "var(--color-alarm-soft)", text: "var(--color-alarm)" },
  zero: { fill: "var(--color-segment)", text: "var(--color-ink-2)" },
};

/**
 * Fasta mot rörliga › Per månad (Design v2): fixed and variable stacked per
 * month, the income as a 3 px green stroke across the bar at its level, and
 * the net over each bar as a pill (green up, red down). The current month's
 * label is blue; the tooltip has all four.
 */
export function FixedBars({ data }: { data: FixedData }) {
  const [measure, width] = useWidth(1000);
  const animation = useChartAnimation();
  const current = todayIso().slice(0, 7);
  const narrow = width < 520;
  const rows = data.months.map((m) => ({ ...m, top: Math.max(m.income, Math.max(0, m.fixed) + Math.max(0, m.variable)) }));
  // A month's band in pixels, for the income stroke's width (the plot is the width less the margins).
  const band = rows.length ? (width - (narrow ? 36 : 8)) / rows.length : 0;
  const stroke = Math.max(8, band * (1 - GAP));

  const Tick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const m = payload?.value ?? "";
    const now = m === current;
    return (
      <text x={x} y={(y ?? 0) + 12} textAnchor="middle" fontSize={11} fill={now ? "var(--color-accent)" : "var(--color-ink-3)"} fontWeight={now ? 600 : 400}>
        {shortMonth(m)}
      </text>
    );
  };

  /** The income as a stroke across the month. */
  const IncomeStroke = (p: { cx?: number; cy?: number; index?: number }) => {
    const m = data.months[p.index ?? -1];
    if (!m || m.income <= 0 || p.cx === undefined || p.cy === undefined) return null;
    return <rect x={p.cx - stroke / 2} y={p.cy - 1.5} width={stroke} height={3} rx={1.5} fill={INCOME} data-income={m.month} data-ore={m.income} />;
  };

  const NetPill = (p: { x?: number | string; y?: number | string; index?: number }) => {
    const m = data.months[p.index ?? -1];
    if (!m) return null;
    const tone = netTone(m.net);
    const text = netLabel(m.net);
    const w = text.length * 6 + 12;
    const cx = Number(p.x);
    const top = Number(p.y) - 24;
    return (
      <g data-net-pill={m.month} data-tone={tone}>
        <rect x={cx - w / 2} y={top} width={w} height={16} rx={8} fill={NET_COLOURS[tone].fill} />
        <text x={cx} y={top + 11.5} textAnchor="middle" fontSize={10} fontWeight={600} fill={NET_COLOURS[tone].text}>
          {text}
        </text>
      </g>
    );
  };

  return (
    <section className="space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="fixed-bars-title" data-card="bars">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 id="fixed-bars-title" className="text-[15px] font-semibold">
            Per månad
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {narrow ? "staplarna är utgifter, det gröna strecket är inkomsten – tryck på en stapel för nettot" : "staplarna är utgifter, det gröna strecket är inkomsten – nettot står ovanför"}
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="Förklaring">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-ink" aria-hidden /> Fasta
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-caution" aria-hidden /> Rörliga
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-[3px] w-3 rounded-full bg-positive" aria-hidden /> Inkomster
          </li>
        </ul>
      </div>
      <div ref={measure} className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 30, right: narrow ? 18 : 4, bottom: 0, left: narrow ? 18 : 4 }} barCategoryGap={`${GAP * 100}%`}>
            <XAxis dataKey="month" tick={<Tick />} tickLine={false} axisLine={false} interval={width < 400 ? 2 : narrow ? 1 : 0} height={24} />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              cursor={chart.cursor}
              content={({ active, label }) => {
                if (!active) return null;
                const m = data.months.find((x) => x.month === label) as FixedMonth | undefined;
                if (!m) return null;
                return (
                  <div className="min-w-52 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                    <p className="mb-1.5 font-semibold first-letter:uppercase">{monthLabel(String(label), true)}</p>
                    <ul className="space-y-0.5">
                      {(
                        [
                          ["Fasta", m.fixed, "bg-ink"],
                          ["Rörliga", m.variable, "bg-caution"],
                          ["Inkomster", m.income, "bg-positive"],
                        ] as const
                      ).map(([name, v, dot]) => (
                        <li key={name} className="flex items-center gap-2">
                          <span className={`size-2 shrink-0 rounded-full ${dot}`} />
                          <span className="min-w-0 flex-1">{name}</span>
                          <Money ore={v} />
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 flex justify-between border-t border-hairline pt-1.5 font-semibold">
                      <span>Netto</span>
                      <span className={`tabular-nums ${m.net < 0 ? "text-alarm" : "text-positive-text"}`}>{wholeKr(m.net)}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="fixed" stackId="spent" fill={FIXED} shape={(p: unknown) => <Segment {...(p as SegmentProps)} top={((p as SegmentProps).payload as unknown as FixedMonth).variable <= 0} />} {...animation} />
            <Bar dataKey="variable" stackId="spent" fill={VARIABLE} shape={(p: unknown) => <Segment {...(p as SegmentProps)} top />} {...animation} />
            <Line type="linear" dataKey="income" stroke="none" dot={<IncomeStroke />} activeDot={false} isAnimationActive={false} />
            {/* An invisible line along the tops (the income or the spending, the higher) carries the pills. */}
            <Line type="linear" dataKey="top" stroke="none" dot={false} activeDot={false} isAnimationActive={false}>
              {!narrow && <LabelList dataKey="top" content={NetPill} />}
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
