import { useState } from "react";
import { ChevronRight, Trash2, TriangleAlert } from "lucide-react";
import type { SalaryMonth } from "../../api";
import { Card } from "../../components/Card";
import { Entering } from "../../components/Entering";
import { cn } from "../../lib/cn";
import { useListEntrance } from "../../lib/motion";
import { useWidth } from "../../lib/useWidth";
import { dm, kr } from "../overview/format";
import { h, monthName } from "./format";
import { HoursBar } from "./HoursBar";
import { Payslip } from "./Payslip";
import { PAY_STATUS_STYLE, payStatus, payStatusLabel } from "./payStatus";
import { hourValue, QuarterOvertime } from "./Quarter";

/** The table's columns: all of them; on a phone, month (hours under it), pay day and net. */
const COLS = "grid-cols-[minmax(8.75rem,1.2fr)_minmax(7.5rem,1fr)_minmax(3rem,1.5fr)_minmax(8.5rem,1.2fr)_4.5rem_4.25rem_4.5rem] gap-x-3 @[60rem]:gap-x-4";
const COMPACT_COLS = "grid-cols-[minmax(0,1fr)_6.25rem_4.75rem] gap-x-3";
/** Under this width (px) the table drops the bar and the gross, and the actions move into the folded-out row. */
const COMPACT_PX = 560;
const bare = (ore: number) => kr(ore).replace(/\s*kr$/, "");

/**
 * 'Inlagda månader' (Design v2): a row per month with its hours as a bar
 * against the working time (blue once paid, light blue while a forecast),
 * when it is paid and how it came in, net and gross. A row folds out to the
 * net in large type with how the gross is made up, beside the forecast as
 * a payslip.
 */
export function MonthsTable({ months, measure, full, onEdit, onRemove }: { months: SalaryMonth[]; measure: number; full: number; onEdit: (m: SalaryMonth) => void; onRemove: (month: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [measureRef, width] = useWidth<HTMLElement>(1000);
  const compact = width < COMPACT_PX;
  const cols = compact ? COMPACT_COLS : COLS;
  // The months come in when they arrive, and again when one is added or removed.
  const entrance = useListEntrance(months.map((m) => m.month).join(","));
  return (
    <Card ref={measureRef} aria-labelledby="salary-months-title" className="@container overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-2 pt-4 sm:px-6 sm:pt-5">
        <h2 id="salary-months-title" className="text-base font-semibold">
          Inlagda månader
        </h2>
        {!compact && (
          <p className="text-[11px] text-ink-2">
            stapel = timmar mot måttet {h(measure)} (streck) och heltid {h(full)}
          </p>
        )}
      </div>
      {months.length === 0 ? (
        <p className="px-4 pb-5 text-[13px] text-ink-3 sm:px-6">Inga ännu.</p>
      ) : (
        <>
          <div className={cn("grid items-center px-4 py-2 text-[11px] text-ink-3 sm:px-6", cols)} aria-hidden>
            <span className="pl-6">Arbetsmånad</span>
            {!compact && (
              <>
                <span>Timmar</span>
                <span />
              </>
            )}
            <span>Utbetalning</span>
            <span className="text-right">Netto</span>
            {!compact && (
              <>
                <span className="text-right">Brutto</span>
                <span />
              </>
            )}
          </div>
          <ul aria-label="Inlagda månader">
            {months.map((m, i) => (
              <Entering as="li" key={m.month} index={i} entrance={entrance} data-month={m.month} className={cn("border-t border-hairline", open === m.month && "bg-row-current")}>
                <Row m={m} measure={measure} full={full} compact={compact} open={open === m.month} onToggle={() => setOpen(open === m.month ? null : m.month)} onEdit={() => onEdit(m)} onRemove={() => onRemove(m.month)} />
                {open === m.month && (m.forecast || compact) && <Detail m={m} compact={compact} onEdit={() => onEdit(m)} onRemove={() => onRemove(m.month)} />}
              </Entering>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Row({
  m,
  measure,
  full,
  compact,
  open,
  onToggle,
  onEdit,
  onRemove,
}: {
  m: SalaryMonth;
  measure: number;
  full: number;
  compact: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const f = m.forecast;
  const s = payStatus(m);
  // On a phone a month folds out also without a forecast: its Ändra and Ta bort are there.
  const folds = !!f || compact;
  const hours = (
    <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
      <span className={cn(!compact && "truncate")}>
        {h(m.effectiveHours)} tim{m.hoursFromShifts !== null && <span className="text-ink-3"> · {m.shifts} pass</span>}
      </span>
      {f?.thresholds.passes && (
        <span title="Kvartalet passerar heltid: övertid" className="shrink-0 text-caution-text">
          <TriangleAlert className="size-3.5" aria-label="övertid" />
        </span>
      )}
    </span>
  );
  const pill = (
    <span data-status={s.kind} className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", PAY_STATUS_STYLE[s.kind])}>
      {payStatusLabel(s)}
    </span>
  );
  return (
    <div className={cn("grid items-center px-4 py-2.5 text-[13px] sm:px-6", compact ? COMPACT_COLS : COLS)}>
      <button type="button" onClick={onToggle} aria-expanded={open} disabled={!folds} className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default">
        <ChevronRight className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-90", !folds && "invisible")} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{monthName(m.month)}</span>
          {compact && <span className="block text-[11px] text-ink-2">{hours}</span>}
        </span>
      </button>
      {!compact && hours}
      {!compact && <HoursBar size="row" hours={m.effectiveHours} measure={measure} full={full} forecast={!m.actual} />}
      {f ? (
        <span className={cn("flex min-w-0 tabular-nums", compact ? "flex-col items-start gap-0.5" : "items-center gap-2")}>
          <span>{dm(f.payDate)}</span>
          {pill}
        </span>
      ) : (
        <span className="text-ink-3">–</span>
      )}
      <span className="text-right font-semibold tabular-nums" data-net>
        {f ? kr(f.net) : "–"}
      </span>
      {!compact && (
        <>
          <span className="text-right text-ink-2 tabular-nums">{f ? kr(f.gross) : "–"}</span>
          <Actions month={m.month} onEdit={onEdit} onRemove={onRemove} />
        </>
      )}
    </div>
  );
}

function Actions({ month, onEdit, onRemove, className }: { month: string; onEdit: () => void; onRemove: () => void; className?: string }) {
  return (
    <span className={cn("flex items-center justify-end gap-1", className)}>
      <button type="button" onClick={onEdit} className="text-[13px] text-accent hover:underline">
        Ändra
      </button>
      <span className="text-ink-3" aria-hidden>
        ·
      </span>
      <button type="button" onClick={onRemove} aria-label={`Ta bort ${monthName(month)}`} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-card-inset hover:text-danger">
        <Trash2 className="size-4" />
      </button>
    </span>
  );
}

/** The folded-out month: the net with how the gross is made up, beside the payslip. */
function Detail({ m, compact, onEdit, onRemove }: { m: SalaryMonth; compact: boolean; onEdit: () => void; onRemove: () => void }) {
  const f = m.forecast;
  const actions = compact && <Actions month={m.month} onEdit={onEdit} onRemove={onRemove} className="justify-start" />;
  if (!f)
    return (
      <div className="space-y-1 px-4 pb-4 pl-10 text-[12px] text-ink-2">
        <p>Ingen prognos: inga lönekonstanter för månaden.</p>
        {actions}
      </div>
    );
  const base = f.lines.find((l) => l.code === "011")?.amount ?? null;
  const value = hourValue(f.thresholds);
  return (
    <div className="grid gap-x-10 gap-y-4 px-4 pb-5 pt-2 sm:px-6 sm:pl-12 @[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" data-testid="salary-detail">
      <div className="min-w-0 space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums">{kr(f.net)}</span>
          <span className="text-[12px] text-ink-2">landar {dm(f.payDate)}</span>
        </p>
        {value && <p className="text-[12px] text-ink-2">{value}</p>}
        {m.actual && (
          <p className="text-[12px] text-ink-2" data-actual>
            kom in {kr(m.actual.amount)} · {payStatusLabel(payStatus(m)).replace(/^kom in /, "")}
          </p>
        )}
        {base !== null && base <= f.gross && (
          <div className="space-y-1 pt-1">
            <div className="flex h-2 w-full overflow-hidden rounded-[4px] bg-segment" role="img" aria-label={`Grundlön ${kr(base)} av brutto ${kr(f.gross)}`}>
              <span className="bg-ink" style={{ width: `${(base / f.gross) * 100}%` }} />
              <span className="ml-0.5 flex-1 bg-accent" />
            </div>
            <p className="text-[11px] text-ink-3 tabular-nums">
              grundlön {bare(base)} · tillägg {bare(f.gross - base)} → brutto {bare(f.gross)} · skatt −{bare(f.tax)}
            </p>
          </div>
        )}
        <QuarterOvertime t={f.thresholds} />
        {actions}
      </div>
      <Payslip m={f} compact={compact} />
    </div>
  );
}
