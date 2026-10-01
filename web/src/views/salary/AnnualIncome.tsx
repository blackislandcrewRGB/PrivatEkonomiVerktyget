import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { getJson, type AnnualIncome as Data, type AnnualIncomeYear } from "../../api";
import { Card } from "../../components/Card";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { useTransition } from "../../lib/motion";
import { kr } from "../overview/format";
import { approx, pct, shortKr, thisYearChange } from "./annual";

/** The tallest bar, px. */
const BAR_PX = 120;

/**
 * Lön › Årsinkomst (Design v2): where this year is likely to land, with a
 * span, and a bar per income year: the salary declared (1.1), this year's in
 * two parts (paid so far, and the forecast for the rest). Under each bar the
 * change from the year before, nominal and, with KPI for both years, real.
 */
export function AnnualIncome() {
  const [data, setData] = useState<Data | null>(null);
  const grow = useTransition("number");
  useEffect(() => {
    // Only what has the years: anything else (an older server) leaves the card out.
    getJson<Data>("/salary/annual").then((d) => setData(Array.isArray(d?.years) ? d : null), () => setData(null));
  }, []);
  if (!data) return null;
  const c = data.current;
  const max = Math.max(1, ...data.years.map((y) => y.amount ?? 0), c.high);
  const change = thisYearChange(data);
  const diffs = data.years.filter((y) => y.declared !== null && y.payslips !== null);

  const tip = (y: AnnualIncomeYear) =>
    y.source === "forecast"
      ? `${y.year}: utbetalt ${kr(c.paid)} (${c.paidMonths} mån) + prognos ${kr(c.forecast + c.estimated)} = ${kr(c.expected)}`
      : y.amount === null
        ? `${y.year}: ingen deklaration eller hela året i lönespecar`
        : `${y.year}: ${kr(y.amount)} ${y.source === "declared" ? "deklarerat (1.1)" : "enligt lönespecarna"}`;

  return (
    <Card aria-labelledby="salary-annual-title" className="space-y-4" data-testid="annual-income">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h2 id="salary-annual-title" className="text-[13px] font-medium text-ink-2">
          Årsinkomst
        </h2>
        <p className="text-[11px] text-ink-3">brutto · deklarationens rad 1.1 och årets lönespecar</p>
      </div>

      <div>
        <p className="flex flex-wrap items-baseline gap-x-2" data-figure="annual">
          <span className="text-[15px] text-ink-2">{c.year} landar troligen på</span>
          <span className="text-[34px] font-bold leading-none tracking-[-0.02em] tabular-nums">~{approx(c.expected)}</span>
        </p>
        <p className="mt-1 text-[12px] text-ink-2 tabular-nums" data-testid="annual-span">
          {c.remainingMonths > 0 ? (
            <>
              mellan {approx(c.low)} och {approx(c.high)} · {c.remainingMonths} {c.remainingMonths === 1 ? "månad" : "månader"} kvar à {c.average !== null ? kr(c.average) : "–"} ± {kr(c.deviation)}
            </>
          ) : (
            "alla årets månader är utbetalda eller inlagda"
          )}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-2" data-testid="annual-change">
          {change && "year" in change && change.year.change ? (
            <>
              mot {change.vs}: <b className="font-semibold text-ink tabular-nums">{pct(change.year.change.nominal)}</b> nominellt
              {change.year.change.real !== null && (
                <>
                  {" "}
                  · <b className="font-semibold text-ink tabular-nums">{pct(change.year.change.real)}</b> realt
                </>
              )}
            </>
          ) : change && "missing" in change ? (
            <span className="text-ink-3">{change.missing} saknas: läs in deklarationskvittensen i Importer för att se förändringen</span>
          ) : null}
        </p>
      </div>

      <ul className="flex items-end gap-1.5 @container sm:gap-3" aria-label="Årsinkomst per år">
        {data.years.map((y) => {
          const current = y.source === "forecast";
          const height = y.amount === null ? 0 : Math.max(4, (y.amount / max) * BAR_PX);
          const paidShare = current && y.amount ? c.paid / y.amount : 1;
          return (
            <li key={y.year} data-year={y.year} data-amount={y.amount ?? ""} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className={cn("h-4 text-[10px] tabular-nums", current ? "font-semibold text-accent" : "text-ink-2")}>
                {y.amount === null ? "" : current ? `~${shortKr(y.amount)}` : shortKr(y.amount)}
              </span>
              <Tooltip content={tip(y)}>
                <div className="relative flex w-full max-w-14 justify-center" style={{ height: y.amount === null ? BAR_PX * 0.35 : height }} tabIndex={0} aria-label={tip(y)}>
                  {y.amount === null ? (
                    <span className="absolute inset-0 rounded-[6px] border border-dashed border-neutral-bar" />
                  ) : (
                    <motion.span className="absolute inset-0 flex origin-bottom flex-col overflow-hidden rounded-[6px]" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={grow}>
                      {current && <span className="w-full bg-accent-bar" style={{ height: `${(1 - paidShare) * 100}%` }} data-part="forecast" />}
                      <span className={cn("w-full flex-1", y.source === "payslips" ? "bg-accent/70" : "bg-accent")} data-part={current ? "paid" : y.source} />
                    </motion.span>
                  )}
                </div>
              </Tooltip>
              <span className={cn("text-[11px] font-medium tabular-nums", current ? "text-accent" : y.amount === null ? "text-ink-3" : "text-ink")}>{y.year}</span>
              <span className="h-3.5 text-[10px] leading-none text-ink-2 tabular-nums" data-change>
                {y.amount === null ? "saknas" : y.change ? pct(y.change.nominal, 0) : ""}
              </span>
              <span className="hidden h-3 text-[10px] leading-none text-ink-3 tabular-nums @[30rem]:block" data-real>
                {y.change?.real != null ? `${pct(y.change.real, 0)} realt` : ""}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-accent" /> deklarerat / utbetalt
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-accent-bar" /> prognos {c.year}
        </span>
        <span className="text-ink-3">realt: i fast penningvärde enligt KPI (SCB), {c.year} med månaderna hittills</span>
      </div>

      {diffs.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-ink-3" data-testid="annual-diffs">
          {diffs.map((y) => (
            <li key={y.year} className="tabular-nums">
              {y.year}: specarna {kr(y.payslips!)} · deklarerat {kr(y.declared!)} ({y.declared! - y.payslips! >= 0 ? "+" : "−"}
              {kr(Math.abs(y.declared! - y.payslips!))})
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
