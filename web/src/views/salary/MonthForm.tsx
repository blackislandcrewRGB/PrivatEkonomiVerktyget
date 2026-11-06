import { useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SalaryModel, SalaryMonth, SalaryOverview, WeekOvertimeResult } from "../../api";
import { Card } from "../../components/Card";
import { Switch } from "../../components/Switch";
import { cn } from "../../lib/cn";
import { dm, kr } from "../overview/format";
import type { Draft } from "./draft";
import { h, monthName, monthOnly } from "./format";
import { pickerMonths } from "./payMonths";
import { Sick } from "./Sick";
import { UnitInput } from "./UnitInput";

type Field = "hours" | "vacationHours" | "atfHours" | "overtimePassHours";

/**
 * 'Lägg in arbetsmånad' (Design v2): the fields on one row with the unit in
 * them, the month a picker starting on the first missing one; the hours
 * from Pendling's shifts as a switch in the heading row; the OB hours per
 * level fold out under the row. The forecast shows in the hero while typing
 * (and under the fields where the hero is out of sight, on a narrow screen).
 */
export function MonthForm({
  info,
  months,
  draft,
  setDraft,
  preview,
  fromShifts,
  days,
  showOb,
  setShowOb,
  onSave,
  onClear,
  onSickChanged,
}: {
  info: SalaryOverview;
  months: SalaryMonth[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  preview: SalaryModel | null;
  /** The hours Pendling's shifts give for the month, or null without shifts. */
  fromShifts: number | null;
  /** The overtime per shift/week from the days marked in Pendling, or null. */
  days: WeekOvertimeResult | null;
  showOb: boolean;
  setShowOb: Dispatch<SetStateAction<boolean>>;
  onSave: () => Promise<void>;
  onClear: () => void;
  /** A sick day was set or taken away: the months and the forecast are read again. */
  onSickChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showSick, setShowSick] = useState(false);
  const sickHours = draft.month ? info.sickDays.filter((d) => d.date.startsWith(draft.month)).reduce((a, d) => a + d.hours, 0) : 0;
  const shifts = info.shifts[draft.month] ?? null;
  const fromShiftsOn = draft.hoursMode === "shifts" && fromShifts !== null;
  const daysApply = fromShiftsOn && days !== null;
  const limits = [info.settings.shiftLimit !== null && `över ${h(info.settings.shiftLimit)} tim/pass`, info.settings.weekLimit !== null && `${h(info.settings.weekLimit)} tim/vecka`].filter(Boolean);
  const entered = new Set(months.map((m) => m.month));
  const set = (key: Field) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const field = (key: Field, label: string, props: { value?: string; disabled?: boolean } = {}) => (
    <label className="grid min-w-0 flex-1 basis-[96px] gap-1">
      <span className="text-[11px] text-ink-2">{label}</span>
      <UnitInput aria-label={label} value={props.value ?? draft[key]} disabled={props.disabled} onChange={set(key)} />
    </label>
  );
  const save = async () => {
    setBusy(true);
    try {
      await onSave();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="salary-input-title" className="@container space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="salary-input-title" className="scroll-mt-4 text-base font-semibold">
          Lägg in arbetsmånad
        </h2>
        <Switch
          checked={fromShiftsOn}
          disabled={shifts === null}
          onCheckedChange={(on) => setDraft((d) => ({ ...d, hoursMode: on ? "shifts" : "manual" }))}
          className={cn(shifts === null && "text-ink-3")}
        >
          {shifts === null ? `inga pass i Pendling för ${draft.month ? monthOnly(draft.month) : "månaden"}` : `timmar från passen i Pendling (${shifts} st${info.overtimeFromDays[draft.month] ? ", dagarna markerade" : ""})`}
        </Switch>
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <label className="grid min-w-0 flex-[1.4] basis-[140px] gap-1">
          <span className="text-[11px] text-ink-2">Arbetsmånad</span>
          <span className="relative block">
            <select
              aria-label="Arbetsmånad"
              value={draft.month}
              onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))}
              className="h-9 w-full appearance-none rounded-[9px] border border-neutral-bar/70 bg-card pl-3 pr-8 text-[13px] text-ink outline-none focus:border-accent"
            >
              {pickerMonths(info.today, [...entered], draft.month).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                  {entered.has(m) ? " · inlagd" : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          </span>
        </label>
        {field("hours", "Timmar totalt", fromShiftsOn ? { value: h(fromShifts!), disabled: true } : {})}
        {field("vacationHours", "Varav semester")}
        {field("atfHours", "Uttag ATF")}
        {field("overtimePassHours", "Övertid pass/vecka", daysApply ? { value: h(days!.hours), disabled: true } : {})}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2 @[40rem]:ml-auto">
          <button type="button" className="flex h-9 items-center gap-0.5 whitespace-nowrap text-[13px] font-medium text-accent hover:underline" onClick={() => setShowOb((v) => !v)} aria-expanded={showOb}>
            <ChevronRight className={cn("size-3.5 transition-transform", showOb && "rotate-90")} aria-hidden /> OB-timmar per nivå
          </button>
          <button type="button" className="flex h-9 items-center gap-0.5 whitespace-nowrap text-[13px] font-medium text-accent hover:underline" onClick={() => setShowSick((v) => !v)} aria-expanded={showSick}>
            <ChevronRight className={cn("size-3.5 transition-transform", showSick && "rotate-90")} aria-hidden /> Sjuk{sickHours > 0 ? ` · ${h(sickHours)} tim` : ""}
          </button>
          <button
            type="button"
            disabled={!preview || busy}
            onClick={save}
            className="h-9 whitespace-nowrap rounded-[9px] bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
          >
            Spara {draft.month ? monthName(draft.month) : ""}
          </button>
        </div>
      </div>

      {showOb && (
        <div className="flex flex-wrap gap-3 rounded-inset bg-card-inset p-3" data-testid="ob-fields">
          {Object.keys(info.obRates).length === 0 && <p className="text-[12px] text-ink-3">Inga OB-nivåer än: de läses ur specarna, eller läggs in under Inställningar › Lön › Avtalet.</p>}
          {Object.entries(info.obRates).map(([code, r]) => (
            <label key={code} className="grid w-44 gap-1">
              <span className="truncate text-[11px] text-ink-2" title={r.source}>
                {code} {r.name} ({kr(r.rate)}/tim)
              </span>
              <UnitInput aria-label={`OB ${code}`} value={draft.ob[code] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, ob: { ...d.ob, [code]: e.target.value } }))} />
            </label>
          ))}
        </div>
      )}

      {showSick && draft.month && <Sick info={info} month={draft.month} onChanged={onSickChanged} />}

      <div className="space-y-0.5 text-[11px] text-ink-3">
        {fromShiftsOn && (
          <p data-testid="hours-from-shifts">
            Timmar: {shifts} pass × {h(info.settings.shiftHours)}
            {info.sickShiftExtra[draft.month] ? ` + ${h(info.sickShiftExtra[draft.month])} sjuk` : ""} = {h(fromShifts!)} tim
          </p>
        )}
        {daysApply && (
          <p data-testid="overtime-from-days">
            Övertid från kalendern: {h(days!.hours)} tim
            {days!.weeks.length ? ` – ${days!.weeks.map((w) => `v. ${dm(w.from)}–${dm(w.to)} ${w.shifts} pass, ${h(w.hours)} tim`).join("; ")}` : info.settings.weekLimit !== null ? ` – ingen vecka över ${h(info.settings.weekLimit)} tim` : ""}
          </p>
        )}
        <p className="flex flex-wrap items-baseline justify-between gap-x-4">
          <span>
            {limits.length ? `Övertid: ${limits.join(" eller ")}.` : "Övertidsgränser kan läggas in under Inställningar › Lön › Avtalet."} Prognosen räknas direkt när du skriver.
          </span>
          <button type="button" onClick={onClear} className="text-[13px] font-medium text-ink-2 hover:text-ink hover:underline">
            Rensa
          </button>
        </p>
        {preview && (
          <p className="text-[13px] text-ink-2 @[56rem]:hidden" data-testid="form-forecast">
            Prognos: <b className="font-semibold text-ink tabular-nums">{kr(preview.net)}</b> landar {dm(preview.payDate)}
          </p>
        )}
      </div>
    </Card>
  );
}
