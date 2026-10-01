import type { ReactNode } from "react";
import { cn } from "../../../lib/cn";
import { pct, wholeKr } from "../common";
import { fixedFigures, incomeBar, type FixedData, type Segment, type Spread } from "./figures";

const SEGMENT: Record<Segment["key"], { name: string; className: string }> = {
  fixed: { name: "Fasta", className: "bg-ink text-card" },
  variable: { name: "Rörliga", className: "bg-caution text-white" },
  net: { name: "Netto", className: "bg-positive-soft text-positive-text" },
};

/** '6 023', whole kronor without 'kr'. */
const plain = (ore: number) => wholeKr(ore).replace(/\s*kr$/, "");
/** 'dec'. */
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");
const range = (s: Spread) => (s.min && s.max ? `${plain(s.min.value)}–${plain(s.max.value)}` : "");

function Box({ label, value, hint, tone, testId }: { label: string; value: ReactNode; hint: ReactNode; tone?: "positive" | "alarm"; testId: string }) {
  return (
    <div
      className={cn("min-w-0 rounded-inset px-3.5 py-3", tone === "positive" ? "bg-positive-soft" : tone === "alarm" ? "bg-alarm-soft" : "bg-card-inset")}
      data-box={testId}
    >
      <p className={cn("text-[11px]", tone === "positive" ? "text-positive-text" : tone === "alarm" ? "text-alarm" : "text-ink-2")}>{label}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-3 tabular-nums">{hint}</p>
    </div>
  );
}

/**
 * Fasta mot rörliga's hero (Design v2): the income in the period and where
 * it went, as one bar of fixed, variable and what was left (each labelled
 * with kronor and its share of the income). When more went out than came in
 * nothing is left: the bar is the spending, with a red edge and by how much.
 * Under it four boxes over the whole months: the fixed share with its
 * lowest and highest month, the fixed, the variable and the net per month
 * with their range.
 */
export function IncomeHero({ data, to }: { data: FixedData; to: string }) {
  const t = data.total;
  const { segments, over } = incomeBar(t);
  const f = fixedFigures(data, to);
  const months = data.months.length;
  const netTone = f.net.average !== null && f.net.average < 0 ? "alarm" : "positive";

  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="income-hero-title" data-card="hero">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <h2 id="income-hero-title" className="text-[13px] font-semibold text-ink-2">
            Vart inkomsten tog vägen
          </h2>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums" data-testid="income">
              {wholeKr(t.income)}
            </span>
            <span className="text-[15px] text-ink-2">
              in på {months} {months === 1 ? "månad" : "månader"}
            </span>
          </p>
        </div>
        <p className="max-w-md text-[11px] text-ink-3">Fasta = dragningar som matchats mot en fast utgift (konto eller kort). Rörliga = allt annat.</p>
      </div>

      <div>
        <div
          className={cn("flex h-[26px] w-full gap-0.5 overflow-hidden rounded-[13px]", over > 0 && "ring-2 ring-alarm ring-offset-2 ring-offset-card")}
          role="img"
          aria-label={segments.map((s) => `${SEGMENT[s.key].name} ${wholeKr(s.ore)}`).join(", ") + (over > 0 ? `, ${wholeKr(over)} mer ut än in` : "")}
          data-over={over > 0 || undefined}
        >
          {segments
            .filter((s) => s.width > 0)
            .map((s) => (
              <span
                key={s.key}
                className={cn("flex min-w-0 items-center px-3 text-[12px] font-semibold", SEGMENT[s.key].className)}
                style={{ width: `${s.width * 100}%` }}
                data-segment={s.key}
                data-ore={s.ore}
                data-width={s.width}
                title={`${SEGMENT[s.key].name} ${wholeKr(s.ore)}${s.ofIncome !== null ? ` · ${pct(s.ofIncome)}` : ""}`}
              >
                {/* On a narrow card the labels are in a list under the bar instead. */}
                <span className="hidden truncate tabular-nums @[40rem]:inline">
                  {SEGMENT[s.key].name} {wholeKr(s.ore)}
                  {s.ofIncome !== null && ` · ${pct(s.ofIncome)}`}
                </span>
              </span>
            ))}
        </div>
        <ul className="mt-2 space-y-0.5 text-[12px] @[40rem]:hidden" aria-hidden>
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-2 tabular-nums">
              <span className={cn("size-2.5 shrink-0 rounded-[3px]", SEGMENT[s.key].className)} />
              <span className="flex-1">{SEGMENT[s.key].name}</span>
              <span className="font-semibold">{wholeKr(s.ore)}</span>
              <span className="w-12 text-right text-ink-3">{s.ofIncome !== null ? pct(s.ofIncome) : ""}</span>
            </li>
          ))}
        </ul>
        {over > 0 && (
          <p className="mt-2 text-[12px] font-semibold text-alarm tabular-nums" data-testid="over">
            {wholeKr(over)} mer ut än in
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 @[44rem]:grid-cols-4">
        <Box
          testId="share"
          label="Andel av inkomsten som är fast"
          value={pct(t.fixedShareOfIncome)}
          hint={f.share.min && f.share.max ? `lägst ${pct(f.share.min.value)} (${monthName(f.share.min.month)}) · högst ${pct(f.share.max.value)} (${monthName(f.share.max.month)})` : "ingen hel månad med inkomst"}
        />
        <Box testId="fixed" label="Fasta per månad" value={f.fixed.average === null ? "–" : wholeKr(f.fixed.average)} hint={f.fixed.average === null ? "ingen hel månad" : `snitt · ${range(f.fixed)}`} />
        <Box
          testId="variable"
          label="Rörliga per månad"
          value={f.variable.average === null ? "–" : wholeKr(f.variable.average)}
          hint={f.variable.average === null ? "ingen hel månad" : `snitt · ${range(f.variable)}`}
        />
        <Box
          testId="net"
          tone={netTone}
          label="Netto per månad"
          value={f.net.average === null ? "–" : wholeKr(f.net.average)}
          hint={f.net.average === null ? "ingen hel månad" : `${f.positive} av ${f.wholeMonths} ${f.wholeMonths === 1 ? "månad" : "månader"} positiva`}
        />
      </div>
    </section>
  );
}
