import type { ReactNode } from "react";
import type { SalaryModel, SalaryMonth, SalaryOverview } from "../../api";
import { AnimatedNumber } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";
import { dm, kr } from "../overview/format";
import { h, monthName, monthOnly } from "./format";
import { HoursBar } from "./HoursBar";
import { hoursBar } from "./hours";
import { lastPaid } from "./payMonths";
import { payStatus, payStatusLabel } from "./payStatus";
import { hourValue, QuarterOvertime } from "./Quarter";

/** What the hero shows: a month's forecast and its hours, saved or being typed. */
export interface HeroForecast {
  model: SalaryModel;
  hours: number;
  /** Being typed in the form, not saved. */
  preview: boolean;
}

/**
 * Lön's hero: the next salary's forecast (net in large type, gross and tax
 * beside it), the month's hours against the working time and full time, and
 * two grey boxes: the latest salary in and the average of twelve. While the
 * form is filled in, the forecast being typed.
 * Without a forecast for the month the next salary is for: a way to it.
 */
export function NextSalary({
  info,
  months,
  next,
  forecast,
  onAdd,
}: {
  info: SalaryOverview;
  months: SalaryMonth[];
  /** The work month the next salary is for. */
  next: string;
  forecast: HeroForecast | null;
  onAdd: (month: string) => void;
}) {
  const f = forecast?.model;
  const c = info.constants.at(-1)!;
  const shifts = f ? (info.shifts[f.workMonth] ?? null) : null;
  const tax = f?.taxSource.replace(/ kolumn.*$/, "");
  return (
    <Card aria-labelledby="next-salary-title" className="@container flex flex-col gap-4" data-testid={forecast?.preview ? "salary-forecast" : undefined}>
      {f && forecast ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <h2 id="next-salary-title" className="text-[13px] font-medium text-ink-2">
                {forecast.preview ? "Förhandsvisning" : "Nästa lön"} · {dm(f.payDate)} · prognos för {monthOnly(f.workMonth)}
              </h2>
              <p className="mt-1 text-[52px] font-bold leading-none tracking-[-0.03em] tabular-nums" data-figure="net">
                <AnimatedNumber value={f.net} format={kr} />
              </p>
            </div>
            <div className="pb-1 text-[12px] text-ink-2 @[40rem]:text-right">
              <p>
                brutto <b className="font-semibold text-ink tabular-nums">{kr(f.gross)}</b> · skatt {tax}
              </p>
              {hourValue(f.thresholds) && <p data-hour-value>{hourValue(f.thresholds)}</p>}
            </div>
          </div>

          <Hours month={f.workMonth} hours={forecast.hours} shifts={shifts} measure={f.thresholds.hoursPerMonth} full={f.thresholds.fullTimeHours} />
          <QuarterOvertime t={f.thresholds} />
        </>
      ) : (
        <div className="space-y-2">
          <h2 id="next-salary-title" className="text-[13px] font-medium text-ink-2">
            Nästa lön · {monthName(next)}
          </h2>
          <p className="text-[22px] font-semibold leading-tight" data-testid="no-forecast">
            Lägg in {monthOnly(next)} för att få en prognos
          </p>
          <button type="button" onClick={() => onAdd(next)} className="text-[13px] font-semibold text-accent hover:underline">
            Till formuläret ›
          </button>
          <p className="text-[11px] text-ink-3">
            Mått {h(c.hoursPerMonth)} tim · heltid {h(c.fullTimeHours)} tim
          </p>
        </div>
      )}

      <div className="grid gap-2.5 @[26rem]:grid-cols-2">
        <LastPaid months={months} />
        <Average info={info} />
      </div>
    </Card>
  );
}

function Hours({ month, hours, shifts, measure, full }: { month: string; hours: number; shifts: number | null; measure: number; full: number }) {
  const b = hoursBar(hours, measure, full);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-[12px] text-ink-2">
        <p>
          Timmar i {monthOnly(month)} <b className="font-semibold text-ink tabular-nums">{h(hours)}</b>
          {shifts !== null && ` · ${shifts} pass`}
          {b.state === "over" && (
            <b className="font-semibold text-caution-text" data-over>
              {" "}
              · +{h(b.over)} tim över heltid
            </b>
          )}
        </p>
        <p className="tabular-nums">
          mått {h(measure)} · heltid {h(full)}
        </p>
      </div>
      <HoursBar hours={hours} measure={measure} full={full} />
    </div>
  );
}

function Box({ label, value, sub, tone = "grey", testId }: { label: ReactNode; value: ReactNode; sub: ReactNode; tone?: "grey" | "green"; testId: string }) {
  return (
    <div data-box={testId} className={cn("min-w-0 rounded-[10px] px-3.5 py-3", tone === "green" ? "bg-positive-soft" : "bg-card-inset")}>
      <p className={cn("text-[11px]", tone === "green" ? "text-positive-text" : "text-ink-2")}>{label}</p>
      <p className="mt-0.5 text-[17px] font-bold tabular-nums">{value}</p>
      <p className="text-[10px] leading-snug text-ink-3">{sub}</p>
    </div>
  );
}

/** The latest salary in: green when it came in to the krona. */
function LastPaid({ months }: { months: SalaryMonth[] }) {
  const m = lastPaid(months);
  if (!m?.actual) return <Box testId="last-paid" label="Senast utbetalt" value="–" sub="ingen inlagd månad har kommit in än" />;
  const s = payStatus(m);
  return (
    <Box
      testId="last-paid"
      tone={s.kind === "exact" ? "green" : "grey"}
      label={`Senast utbetalt · ${dm(m.forecast?.payDate ?? m.actual.bookingDate)}`}
      value={kr(m.actual.amount)}
      sub={`${monthOnly(m.month)}, ${h(m.effectiveHours)} tim · ${payStatusLabel(s)}`}
    />
  );
}

/** The salaries in over twelve months (as Fasta utgifter's usual salary over six). */
function Average({ info }: { info: SalaryOverview }) {
  const a = info.average;
  if (!a) return <Box testId="average" label="Snitt 12 mån" value="–" sub="ingen lön har kommit in än" />;
  return (
    <Box
      testId="average"
      label={`Snitt ${a.count} mån`}
      value={kr(a.average)}
      sub={
        <span title={`Lönerna som kom in ${monthName(a.from)}–${monthName(a.to)}; bruttot från specarna eller prognosen`}>
          netto{a.gross !== null && ` · ${kr(a.gross).replace(/\s*kr$/, "")} brutto`}
        </span>
      }
    />
  );
}
