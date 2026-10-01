import { useState } from "react";
import { sendJson, type VacationPayout } from "../../api";
import { Card, InsetBox } from "../../components/Card";
import { notify } from "../../components/Toast";
import { dm, kr } from "../overview/format";
import { h, num, rate } from "./format";
import { UnitInput } from "./UnitInput";

/**
 * The vacation left at 31 March (Design v2): the hours the latest payslip
 * says are left in large type, what is paid out with the April salary if
 * nothing more is taken (the hours entered as vacation up to March and those
 * saved are not), why, and the hours to save to the next vacation year.
 */
export function Vacation({ p, saved, onSaved }: { p: VacationPayout; saved: Record<string, number>; onSaved: () => void }) {
  const [save, setSave] = useState(p.save ? h(p.save) : "");
  const year = p.workMonth.slice(0, 4);
  const value = num(save);
  const changed = Number.isFinite(value) && value !== p.save;
  const store = async () => {
    try {
      await sendJson("PUT", "/salary/settings", { vacationSave: { ...saved, [p.workMonth]: value } });
      notify({ text: value ? `${h(value)} tim sparas till nästa semesterår.` : "Inga timmar sparas." });
      onSaved();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const less = [p.planned > 0 && `${h(p.planned)} tim inlagda som semester fram till mars`, p.save > 0 && `${h(p.save)} tim sparas`].filter(Boolean);
  return (
    <Card aria-labelledby="salary-vacation-title" className="flex flex-col gap-3.5" data-testid="vacation-left">
      <div className="flex items-start justify-between gap-3">
        <h2 id="salary-vacation-title" className="text-[13px] font-medium text-ink-2">
          Semester kvar till 31 mars {year}
        </h2>
        <span className="shrink-0 rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-medium text-caution-text" title="Att det blir med aprillönen och skatt efter tabellen är antaget tills en spec visar det">
          antagen regel
        </span>
      </div>
      <div>
        <p className="flex flex-wrap items-baseline gap-x-2" data-figure="vacation">
          <span className="text-[34px] font-bold leading-none tracking-[-0.02em] tabular-nums">{h(p.remaining)}</span>
          <span className="text-[15px] text-ink-2">timmar · enligt {p.source}</span>
        </p>
        {less.length > 0 && <p className="mt-1 text-[12px] text-ink-2">{less.join(" · ")}</p>}
      </div>
      <InsetBox className="px-3.5 py-3" data-payout>
        {p.hours > 0 && p.rate !== null ? (
          <>
            <p className="text-[11px] text-ink-2">
              {less.length ? "Det som blir kvar" : "Om inget tas ut"}: betalas ut med lönen {dm(p.payDate)}
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-[18px] font-bold tabular-nums">{kr(p.amount)}</span>
              <span className="text-[11px] text-ink-2 tabular-nums">
                brutto · {h(p.hours)} × {rate(p.rate)}
              </span>
            </p>
          </>
        ) : (
          <p className="text-[13px] text-ink-2">Allt är inplanerat eller sparas: inget betalas ut.</p>
        )}
      </InsetBox>
      <p className="text-[11px] leading-snug text-ink-3">
        Outtagna timmar som inte sparas betalas ut i pengar efter 31 mars (enligt lönekontoret). Att det blir med aprillönen och att skatten dras efter tabellen är
        antaget tills en spec visar det.
        {p.savedEarlier ? ` Sparad semester från tidigare år, ${h(p.savedEarlier)} tim, betalas inte ut.` : ""}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-hairline pt-3.5 text-[13px]">
        <label htmlFor="vacation-save">Spara till nästa år</label>
        <UnitInput id="vacation-save" aria-label="Timmar att spara" placeholder="0" value={save} onChange={(e) => setSave(e.target.value)} className="w-[84px]" />
        <button
          type="button"
          disabled={!changed}
          onClick={store}
          className="h-9 rounded-[9px] bg-card-inset px-3.5 text-[13px] font-semibold text-ink hover:bg-segment disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-card-inset"
        >
          Spara
        </button>
        <span className="text-[11px] text-ink-3">meddela senast 1 april {year}</span>
      </div>
    </Card>
  );
}
