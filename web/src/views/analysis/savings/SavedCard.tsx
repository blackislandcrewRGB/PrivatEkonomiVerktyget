import type { ReactNode } from "react";
import { Bar, BarChart, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate, type SavingsMonth, type SavingsOverview } from "../../../api";
import { kronor } from "../../../csv";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { useWidth } from "../../../lib/useWidth";
import { CsvButton, chart, monthLabel, pct, useChartAnimation, wholeKr } from "../common";
import { signedKr } from "./ValueCard";

const UP = "var(--color-positive)";
const DOWN = "var(--color-alarm)";
const ZERO = "var(--color-neutral-bar)";
const shortMonth = (m: string) => monthLabel(m).replace(".", "");

/** The savings rate as a pill: '+31 %' green, '−23 %' red, '0 %' grey. */
export function rateLabel(rate: number | null): { text: string; tone: "up" | "down" | "zero" } {
  const r = rate === null ? 0 : Math.round(rate * 100);
  return { text: `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} %`, tone: r > 0 ? "up" : r < 0 ? "down" : "zero" };
}
export const RATE_PILL = {
  up: { className: "bg-positive-soft text-positive-text", fill: "var(--color-positive-soft)", text: "var(--color-positive-text)" },
  down: { className: "bg-alarm-soft text-alarm", fill: "var(--color-alarm-soft)", text: "var(--color-alarm)" },
  zero: { className: "bg-segment text-ink-2", fill: "var(--color-segment)", text: "var(--color-ink-2)" },
};

interface BarShape {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: SavingsMonth;
}

/** A month's net: up green with its top rounded, down red with its bottom rounded, nothing a grey 2 px line on zero. */
function NetBar({ x, y, width, height, payload }: BarShape) {
  if (!width) return null;
  const top = Math.min(y, y + height);
  const h = Math.abs(height);
  const r = Math.min(4, width / 2, h);
  const up = payload.net > 0;
  let body: ReactNode;
  if (Math.round(payload.net / 100) === 0 || h < 1) body = <rect x={x} y={y - 1} width={width} height={2} fill={ZERO} />;
  else if (up) body = <path d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${top + h} Z`} fill={UP} />;
  else body = <path d={`M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + width - r} Q${x + width},${top + h} ${x + width},${top + h - r} V${top} Z`} fill={DOWN} />;
  return (
    <g data-bar={payload.month} data-net={payload.net} data-direction={Math.round(payload.net / 100) === 0 ? "zero" : up ? "up" : "down"} className="cursor-pointer">
      {body}
    </g>
  );
}

function Box({ label, value, hint, tone, testId }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "positive" | "negative" | "accent"; testId: string }) {
  const bg = tone === "positive" ? "bg-positive-soft" : tone === "negative" ? "bg-alarm-soft" : tone === "accent" ? "bg-accent-soft" : "bg-card-inset";
  const label2 = tone === "positive" ? "text-positive-text" : tone === "negative" ? "text-alarm" : tone === "accent" ? "text-accent" : "text-ink-2";
  return (
    <div className={cn("min-w-0 rounded-inset px-3.5 py-3", bg)} data-box={testId}>
      <p className={cn("text-[11px]", label2)}>{label}</p>
      <p className="mt-0.5 text-[20px] font-bold leading-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3 tabular-nums">{hint}</p>}
    </div>
  );
}

/**
 * Sparat per månad (Design v2): put in, taken out, net (with the net since
 * the first saving) and the savings rate; the net per month as bars around
 * a zero line, green up and red down (a month with nothing a grey line),
 * the savings rate as a pill over each. A bar opens the month's rows. The
 * dashed line on its own axis is gone.
 */
export function SavedCard({ data, onOpen }: { data: SavingsOverview; onOpen: (month?: string) => void }) {
  const { months, total } = data;
  const animation = useChartAnimation();
  const [measure, width] = useWidth(1000);
  const current = todayIso().slice(0, 7);
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

  /** The rate in one row along the top. */
  const RatePill = (p: { x?: number | string; width?: number | string; index?: number }) => {
    const m = months[p.index ?? -1];
    if (!m) return null;
    const { text, tone } = rateLabel(m.rate);
    const w = text.length * 6 + 12;
    const cx = Number(p.x) + Number(p.width) / 2;
    return (
      <g data-rate-pill={m.month} data-tone={tone}>
        <rect x={cx - w / 2} y={2} width={w} height={16} rx={8} fill={RATE_PILL[tone].fill} />
        <text x={cx} y={13.5} textAnchor="middle" fontSize={10} fontWeight={600} fill={RATE_PILL[tone].text}>
          {text}
        </text>
      </g>
    );
  };

  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="saved-title" data-card="saved">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="saved-title" className="text-[15px] font-semibold">
            Sparat per månad
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">Överföringar & sparande › Sparande: in till Avanza minus uttag därifrån · e-sparkontot är buffert och räknas inte</p>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => onOpen()} className="text-[13px] font-medium text-accent hover:underline">
            Visa raderna
          </button>
          <CsvButton
            filename="sparande-per-manad"
            header={["Månad", "Insatt", "Uttaget", "Netto", "Inkomst", "Sparkvot %"]}
            rows={() => months.map((m) => [m.month, kronor(m.deposited), kronor(m.withdrawn), kronor(m.net), kronor(m.income), m.rate === null ? null : Math.round(m.rate * 1000) / 10])}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 @[44rem]:grid-cols-4">
        <Box testId="deposited" label="Insatt" value={wholeKr(total.deposited)} />
        <Box testId="withdrawn" label="Uttaget" value={wholeKr(total.withdrawn)} />
        <Box
          testId="net"
          tone={total.net < 0 ? "negative" : "positive"}
          label="Sparat netto"
          value={signedKr(total.net)}
          hint={data.allTime ? `${wholeKr(data.allTime.net)} sedan ${shortDate(data.allTime.since)} ${data.allTime.since.slice(0, 4)}` : undefined}
        />
        <Box testId="rate" tone="accent" label="Sparkvot" value={pct(total.rate)} hint={`av ${wholeKr(total.income)} i inkomst`} />
      </div>

      <div ref={measure} className="h-60 w-full">
        <ResponsiveContainer>
          <BarChart data={months} margin={{ top: narrow ? 8 : 28, right: narrow ? 16 : 0, bottom: 0, left: narrow ? 16 : 0 }} barCategoryGap="10%">
            <XAxis dataKey="month" tick={<Tick />} tickLine={false} axisLine={false} interval={width < 400 ? 2 : narrow ? 1 : 0} height={24} />
            <YAxis hide domain={["auto", "auto"]} />
            <ReferenceLine y={0} stroke={chart.grid} />
            <Tooltip
              cursor={chart.cursor}
              content={({ active, label }) => {
                if (!active) return null;
                const m = months.find((x) => x.month === label);
                if (!m) return null;
                const lines: [string, ReactNode, string?][] = [
                  ["Insatt", wholeKr(m.deposited)],
                  ["Uttaget", wholeKr(m.withdrawn)],
                  ["Netto", signedKr(m.net), m.net < 0 ? "text-alarm" : m.net > 0 ? "text-positive-text" : undefined],
                  ["Inkomst", wholeKr(m.income)],
                  ["Sparkvot", pct(m.rate)],
                ];
                return (
                  <div className="min-w-44 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                    <p className="mb-1.5 font-semibold first-letter:uppercase">{monthLabel(String(label), true)}</p>
                    <ul className="space-y-0.5">
                      {lines.map(([name, v, cls]) => (
                        <li key={name} className="flex justify-between gap-4">
                          <span className="text-ink-2">{name}</span>
                          <span className={cn("tabular-nums", cls)}>{v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }}
            />
            <Bar dataKey="net" shape={(p: unknown) => <NetBar {...(p as BarShape)} />} onClick={(m) => {
                const d = m as unknown as { month?: string; payload?: SavingsMonth };
                onOpen(d.month ?? d.payload?.month);
              }} {...animation}>
              {/* On a narrow screen the pills would run into each other: the tooltip has the rate. */}
              {!narrow && <LabelList dataKey="net" content={RatePill} />}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-positive" aria-hidden /> Sparat
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-alarm" aria-hidden /> Mer uttaget än insatt
        </span>
        <span className="text-ink-3">· {narrow ? "tryck på en stapel för sparkvoten" : "sparkvoten står ovanför varje stapel"}</span>
      </div>
    </section>
  );
}
