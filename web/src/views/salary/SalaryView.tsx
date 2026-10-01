import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson, type SalaryModel, type SalaryMonth, type SalaryOverview } from "../../api";
import { Button } from "../../components/ui/button";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { openSettings } from "../../shell/routes";
import { HeaderActions } from "../../shell/PageHeader";
import { draftOf, emptyDraft, toInput, type Draft } from "./draft";
import { h, monthName, ordinal } from "./format";
import { MonthForm } from "./MonthForm";
import { NextSalary, type HeroForecast } from "./NextSalary";
import { firstMissing, nextPayMonth } from "./payMonths";
import { MonthsTable } from "./MonthsTable";
import { Vacation } from "./Vacation";
import { AnnualIncome } from "./AnnualIncome";

/**
 * Lön (Design v2): the next salary's forecast beside the vacation left, the
 * form for a work month's hours (its forecast shows in the hero while it is
 * typed), and the months entered with what came in against the forecast.
 * The model comes from the payslips, see Inställningar › Lön.
 */
export function SalaryView() {
  const [info, setInfo] = useState<SalaryOverview | null>(null);
  const [months, setMonths] = useState<SalaryMonth[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [preview, setPreview] = useState<SalaryModel | null>(null);
  const [showOb, setShowOb] = useState(false);
  const load = useCallback(
    () =>
      Promise.all([
        getJson<SalaryOverview>("/salary").then(setInfo, () => setInfo(null)),
        getJson<SalaryMonth[]>("/salary/months").then(setMonths, () => setMonths([])),
      ]),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const shifts = info?.shifts[draft.month] ?? null;
  const shiftHours = info?.settings.shiftHours ?? 10.5;
  const fromShifts = shifts === null ? null : Math.round(shifts * shiftHours * 100) / 100;
  // With the days marked in Pendling: the overtime per shift/week from them.
  const days = info?.overtimeFromDays[draft.month] ?? null;
  const next = info && months ? nextPayMonth(months, info.today, info.settings.lagMonths, info.settings.payDay) : null;

  // The form starts on the first month missing, once the months are in (and again after a save or Rensa).
  useEffect(() => {
    if (draft.month === "" && months && next) setDraft((d) => ({ ...d, month: firstMissing(months.map((m) => m.month), next) }));
  }, [draft.month, months, next]);

  // The forecast while typing.
  useEffect(() => {
    const { hoursMode: _, ...i } = toInput(draft, fromShifts, days?.hours ?? null);
    if (!/^\d{4}-\d{2}$/.test(i.month) || !(i.hours > 0) || Object.values(i).some((v) => typeof v === "number" && Number.isNaN(v))) return setPreview(null);
    const t = setTimeout(() => sendJson<SalaryModel>("POST", "/salary/model", i).then(setPreview, () => setPreview(null)), 150);
    return () => clearTimeout(t);
  }, [draft, fromShifts, days?.hours]);

  if (!info || !months || !next) return null;
  if (info.constants.length === 0) {
    return (
      <section className="max-w-xl rounded-xl border border-border bg-surface p-6 text-sm">
        <h2 className="font-semibold">Inga lönekonstanter än</h2>
        <p className="mt-1 text-muted">Läs in dina lönespecar under Inställningar › Lön, så räknas månadslön, tillägg och à-priser fram ur dem.</p>
        <Button className="mt-3" variant="primary" onClick={() => openSettings("lon")}>
          Till Inställningar
        </Button>
      </section>
    );
  }

  const clear = () => {
    setDraft(emptyDraft());
    setShowOb(false);
  };
  const save = async () => {
    try {
      const { month, ...rest } = toInput(draft, fromShifts, days?.hours ?? null);
      await sendJson("PUT", `/salary/months/${month}`, rest);
      notify({ text: `${monthName(month)} är sparad.` });
      await load();
      clear();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const toForm = (month: string, from?: Draft) => {
    setDraft((d) => from ?? { ...d, month });
    document.getElementById("salary-input-title")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Timmar totalt"]:not(:disabled)')?.focus(), 50);
  };
  const edit = (m: SalaryMonth) => {
    toForm(m.month, draftOf(m));
    setShowOb(Object.keys(m.obHours).length > 0);
  };
  const remove = async (month: string) => {
    await sendJson("DELETE", `/salary/months/${month}`, {});
    load();
  };
  const c = info.constants.at(-1)!;
  const entry = months.find((m) => m.month === next);
  const hero: HeroForecast | null = preview
    ? { model: preview, hours: toInput(draft, fromShifts, days?.hours ?? null).hours, preview: true }
    : entry?.forecast
      ? { model: entry.forecast, hours: entry.effectiveHours, preview: false }
      : null;

  return (
    <div className="space-y-5">
      <HeaderActions>
        <p className="text-[12px] text-ink-3" data-testid="salary-terms">
          Arbetsmånaden betalas {info.settings.lagMonths === 1 ? `den ${ordinal(info.settings.payDay)} månaden efter` : `den ${ordinal(info.settings.payDay)} samma månad`} · mått {h(c.hoursPerMonth)} tim · heltid {h(c.fullTimeHours)} tim
        </p>
      </HeaderActions>
      <div className="@container">
        <div className="grid gap-4 @[56rem]:grid-cols-12">
          <div className={cn("flex min-w-0 [&>*]:flex-1", info.vacationPayout ? "@[56rem]:col-span-7" : "@[56rem]:col-span-12")}>
            <NextSalary info={info} months={months} next={next} forecast={hero} onAdd={toForm} />
          </div>
          {info.vacationPayout && (
            <div className="flex min-w-0 @[56rem]:col-span-5 [&>*]:flex-1">
              <Vacation p={info.vacationPayout} saved={info.settings.vacationSave} onSaved={load} />
            </div>
          )}
        </div>
      </div>

      <AnnualIncome />

      <MonthForm
        info={info}
        months={months}
        draft={draft}
        setDraft={setDraft}
        preview={preview}
        fromShifts={fromShifts}
        days={days}
        showOb={showOb}
        setShowOb={setShowOb}
        onSave={save}
        onClear={clear}
      />

      <MonthsTable months={months} measure={c.hoursPerMonth} full={c.fullTimeHours} onEdit={edit} onRemove={remove} />
    </div>
  );
}
