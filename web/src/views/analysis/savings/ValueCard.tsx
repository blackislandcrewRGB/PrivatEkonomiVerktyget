import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate, type SavingsOverview } from "../../../api";
import { cn } from "../../../lib/cn";
import { Money, chart, pct, useChartAnimation, wholeKr } from "../common";

const LINE = "var(--color-accent)";

/** '+1 078 kr' / '−2 396 kr', whole kronor with the sign. */
export const signedKr = (ore: number) => {
  const v = Math.round(ore / 100);
  return v === 0 ? "0 kr" : `${v > 0 ? "+" : "−"}${wholeKr(Math.abs(v) * 100)}`;
};
const tone = (ore: number | null) => (ore === null || Math.round(ore / 100) === 0 ? null : ore > 0 ? "positive" : "negative");

function Box({ label, value, hint, kind, testId }: { label: string; value: ReactNode; hint?: ReactNode; kind: "positive" | "negative" | null; testId: string }) {
  return (
    <div className={cn("min-w-0 rounded-inset px-3.5 py-3", kind === "positive" ? "bg-positive-soft" : kind === "negative" ? "bg-alarm-soft" : "bg-card-inset")} data-box={testId}>
      <p className={cn("text-[11px]", kind === "positive" ? "text-positive-text" : kind === "negative" ? "text-alarm" : "text-ink-2")}>{label}</p>
      <p className="mt-0.5 text-[20px] font-bold leading-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3 tabular-nums">{hint}</p>}
    </div>
  );
}

/**
 * Värdet på ditt sparande (Design v2): the value entered by hand, what was
 * put in since the first value, and the return beyond it (green up, red
 * down), with a simple curve over every reading. A reading with money put in
 * or taken out since the one before is marked on the curve.
 */
export function ValueCard({ portfolio: p }: { portfolio: NonNullable<SavingsOverview["portfolio"]> }) {
  const animation = useChartAnimation();
  const two = p.points.length > 1;
  const rows = p.points.map((pt) => ({ ...pt, kr: pt.value / 100 }));

  const Dot = (props: { cx?: number; cy?: number; index?: number }) => {
    const pt = p.points[props.index ?? -1];
    if (!pt || props.cx === undefined || props.cy === undefined) return null;
    const moved = pt.deposited !== null && Math.round(pt.deposited / 100) !== 0;
    return (
      <g data-point={pt.date} data-moved={moved || undefined}>
        {moved && <circle cx={props.cx} cy={props.cy} r={7} fill="none" stroke={pt.deposited! > 0 ? "var(--color-positive)" : "var(--color-alarm)"} strokeWidth={2} />}
        <circle cx={props.cx} cy={props.cy} r={3.5} fill={LINE} />
      </g>
    );
  };

  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="savings-value-title" data-card="value">
      <div>
        <h2 id="savings-value-title" className="text-[15px] font-semibold">
          Värdet på ditt sparande
        </h2>
        <p className="mt-0.5 text-[12px] text-ink-3">avkastningen räknas från första värdet ({shortDate(p.since)}): värdeförändringen minus det du satt in netto sedan dess</p>
      </div>
      <div className="grid grid-cols-2 gap-3 @[32rem]:grid-cols-4">
        <Box testId="value" label={`Värde ${shortDate(p.date)}`} value={wholeKr(p.value)} kind={null} />
        <Box testId="deposited" label="Insatt netto sedan start" value={signedKr(p.deposited)} hint={`start ${wholeKr(p.startValue)}`} kind={null} />
        <Box testId="return" label="Avkastning" value={two ? signedKr(p.return) : "–"} hint={two ? pct(p.returnRate) : "behöver två värden"} kind={two ? tone(p.return) : null} />
        <Box testId="change" label="Värdeförändring" value={two ? signedKr(p.change) : "–"} kind={two ? tone(p.change) : null} />
      </div>
      {p.depositedSinceValue !== 0 && (
        <p className="text-[12px] text-ink-2">
          Efter senaste värdet har du satt in netto <b className={p.depositedSinceValue > 0 ? "text-positive-text" : "text-alarm"}>{signedKr(p.depositedSinceValue)}</b>. Det räknas med när du
          för in nästa värde.
        </p>
      )}
      {two && (
        <div className="h-44 w-full">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 0, left: 16 }}>
              <CartesianGrid vertical={false} stroke={chart.grid} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--color-ink-3)" }}
                tickFormatter={(d: string) => `${shortDate(d)} · ${wholeKr(p.points.find((x) => x.date === d)?.value ?? 0).replace(/\s*kr$/, "")}`}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis hide domain={["dataMin - 2000", "dataMax + 2000"]} />
              <Tooltip
                cursor={{ stroke: "var(--color-hairline)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const pt = payload[0].payload as (typeof rows)[number];
                  return (
                    <div className="min-w-40 rounded-[12px] bg-card/95 px-3 py-2.5 text-[12px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
                      <p className="mb-1 font-semibold">{shortDate(pt.date)}</p>
                      <p className="flex justify-between gap-4">
                        <span className="text-ink-2">Värde</span>
                        <Money ore={pt.value} />
                      </p>
                      {pt.deposited !== null && pt.deposited !== 0 && (
                        <p className="flex justify-between gap-4">
                          <span className="text-ink-2">{pt.deposited > 0 ? "Insatt sedan förra" : "Uttaget sedan förra"}</span>
                          <span className="tabular-nums">{signedKr(pt.deposited)}</span>
                        </p>
                      )}
                      {pt.return !== null && (
                        <p className="flex justify-between gap-4">
                          <span className="text-ink-2">Avkastning</span>
                          <span className={cn("tabular-nums", pt.return < 0 ? "text-alarm" : "text-positive-text")}>{signedKr(pt.return)}</span>
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Line type="linear" dataKey="kr" stroke={LINE} strokeWidth={2} dot={<Dot />} activeDot={{ r: 5, fill: LINE }} {...animation} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[11px] text-ink-3">
        Kurvan växer för varje värde du för in{p.points.some((x) => x.deposited) ? "; en ring runt en punkt betyder att pengar satts in (grön) eller tagits ut (röd) sedan värdet före" : ""}. Avläsningarna
        står i sin egen lista.
      </p>
    </section>
  );
}
