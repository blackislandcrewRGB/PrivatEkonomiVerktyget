import { useEffect, useState } from "react";
import { getJson, type Endurance, type EnduranceLevel } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { openSettings, type ViewId } from "../../../shell/routes";
import { kr } from "../format";

/** The bars' common scale: 36 months is a full bar. */
export const SCALE_MONTHS = 36;

/** A level's bar as a share of the scale, full at 36 months and never past it. */
export const barShare = (months: number) => Math.min(1, Math.max(0, months) / SCALE_MONTHS);

/** Months, or years once the months stop being a number anyone can feel: [number, unit]. */
export function span(months: number): [string, string] {
  if (months > 24) return [(months / 12).toLocaleString("sv-SE", { maximumFractionDigits: 1 }), "år"];
  return [months.toLocaleString("sv-SE", { maximumFractionDigits: 1 }), "månader"];
}

const TONES = {
  buffer: { box: "bg-caution-soft", label: "text-caution-text", bar: "bg-caution" },
  savings: { box: "bg-accent-soft", label: "text-accent", bar: "bg-accent" },
  akassa: { box: "bg-positive-soft", label: "text-positive-text", bar: "bg-positive" },
} as const;

/**
 * One of the three levels.
 *
 * Only the buffer's figure is coloured (under 3 months red, under 6 orange,
 * else green). Three months of expenses put aside is the thing worth a
 * grade; how long the whole portfolio would last is a fact.
 */
function Level({ title, level, tone, graded }: { title: string; level: EnduranceLevel; tone: keyof typeof TONES; graded?: boolean }) {
  const t = TONES[tone];
  const months = level.months;
  const colour = !graded || months === null ? "" : months < 3 ? "text-alarm" : months < 6 ? "text-caution-text" : "text-positive-text";
  return (
    <div className={cn("flex min-w-0 flex-col rounded-wallet px-4 py-3.5", t.box)} data-level={tone}>
      <h3 className={cn("text-xs font-semibold", t.label)}>{title}</h3>
      {months === null ? (
        <p className="mt-2 text-[15px] font-medium text-caution-text">{level.missing}</p>
      ) : (
        <>
          <p className={cn("mt-1 text-[34px] font-bold leading-tight tabular-nums", colour)} data-testid="level-value">
            {span(months)[0]} <span className="text-base font-normal text-ink-2">{span(months)[1]}</span>
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-card/70" role="img" aria-label={`${span(months).join(" ")} av skalan ${SCALE_MONTHS} månader`}>
            <div className={cn("h-1.5 min-w-1.5 rounded-full", t.bar)} style={{ width: `${barShare(months) * 100}%` }} data-bar />
          </div>
          {level.akassaMonths !== undefined && <p className="mt-2 text-[11px] text-ink-2">varav {span(level.akassaMonths).join(" ")} med a-kassa</p>}
        </>
      )}
      {level.formula && <p className={cn("text-[11px] text-ink-2", level.akassaMonths === undefined && "mt-2")}>{level.formula}</p>}
    </div>
  );
}

/**
 * Uthållighet: how long the money lasts if the income stops today, counted
 * on what would have to be paid (fixed + groceries): the buffer, with the
 * savings, and with the a-kassa, each as a figure and a bar on one scale.
 */
export function EnduranceCard({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [data, setData] = useState<Endurance | null>(null);
  useEffect(() => {
    getJson<Endurance>("/networth/endurance").then(setData, () => setData(null));
  }, []);
  if (!data) return null;

  const { cost, akassa } = data;
  // Only what would have to be spent: the rate spent now is not what a month without income would cost.
  const levels = data.essential;

  return (
    <Card aria-label="Uthållighet" className="@container flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold">
          Uthållighet <span className="text-[13px] font-normal text-ink-2">· hur länge pengarna räcker om inkomsten upphör i dag</span>
        </h2>
        <p className="rounded-full bg-card-inset px-3 py-1 text-xs text-ink-2 tabular-nums">
          Nödvändigt per månad <b className="font-semibold text-ink">{kr(levels.monthlyOre)}</b> · fasta {kr(cost.fixedOre)} + dagligvaror {kr(cost.groceriesOre)}
        </p>
      </div>

      <div className="grid gap-3 @[40rem]:grid-cols-3">
        <Level title="Buffert" level={levels.buffer} tone="buffer" graded />
        <Level title="Med sparandet" level={levels.withSavings} tone="savings" />
        <Level title="Med a-kassa" level={levels.withAkassa} tone="akassa" />
      </div>

      <p className="text-[11px] text-ink-3">
        Fasta {kr(cost.fixedOre)} är {cost.fixedCount} utgifter, delade till hälften. Inget annat rörligt, och inget bränsle — pendlingen slutar med jobbet.
        {akassa && (
          <>
            {" "}
            A-kassan räknas på {kr(akassa.qualifyingOre)}/mån{akassa.cappedByCeiling ? " (taket)" : ` — snittet av ${akassa.payslips} lönespecar`}
            {akassa.steps.map((s) => ` · ${Math.round(s.rate * 100)} % i ${s.days} dagar = ${kr(s.monthlyNetOre)}/mån netto`).join("")} · skatt{" "}
            {(akassa.taxRate * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %{akassa.taxFromPayslips && " enligt lönespecarna"}.{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => openSettings("uthallighet")}>
              Ändra
            </button>
            .
          </>
        )}{" "}
        Skalan i staplarna är {SCALE_MONTHS} månader.
      </p>
    </Card>
  );
}
