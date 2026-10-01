import { useState } from "react";
import { parseKr, sendJson, type PensionForecast, type PensionOverview } from "../../../api";
import { Card } from "../../../components/Card";
import { Button } from "../../../components/ui/button";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { dm, kr } from "../format";

/** '2025-03-14' -> '14/3 2025': a forecast can be years old, so the year is said. */
const dmy = (iso: string) => `${dm(iso)} ${iso.slice(0, 4)}`;

export const field = "h-8 rounded-lg border border-ink-3/35 bg-card px-2.5 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/**
 * Prognos från minPension.
 *
 * Shown as minPension gave it — the monthly pension before tax at each
 * retirement age, the day it was made and the assumptions behind it — and
 * nothing else. The tool computes no forecast of its own: a return and a
 * wage growth are minPension's to assume, and they stand next to the figure
 * so that it is never read without them. One green box per age.
 */
export function ForecastCard({ forecasts, onChanged, className }: { forecasts: PensionOverview["forecasts"]; onChanged: () => void; className?: string }) {
  const [adding, setAdding] = useState(false);
  const empty = { madeOn: todayIso(), retirementAge: "", monthly: "", assumptions: "", note: "" };
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const retirementAge = Number(draft.retirementAge);
    const monthlyPensionOre = parseKr(draft.monthly);
    if (!Number.isInteger(retirementAge) || monthlyPensionOre === null) {
      setError("Fyll i uttagsåldern och pensionen i kronor per månad.");
      return;
    }
    try {
      await sendJson("POST", "/networth/pension/forecasts", { madeOn: draft.madeOn, retirementAge, monthlyPensionOre, assumptions: draft.assumptions, note: draft.note || null });
      setDraft({ ...empty, madeOn: draft.madeOn, assumptions: draft.assumptions });
      setError(null);
      notify({ text: `Prognosen för uttag vid ${retirementAge} år är inlagd.` });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (f: PensionForecast) => {
    await sendJson("DELETE", `/networth/pension/forecasts/${f.id}`, {});
    onChanged();
  };

  const add = (
    <button type="button" className="text-xs text-accent hover:underline" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
      Lägg in prognos
    </button>
  );

  return (
    <Card aria-labelledby="forecast-title" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="forecast-title" className="text-[13px] font-medium text-ink-2">
          Prognos från minPension
        </h2>
        {add}
      </div>

      {adding && (
        <form
          className="grid gap-2 rounded-inset bg-card-inset p-3 sm:grid-cols-[auto_auto_auto_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1 text-[11px] text-ink-2">
            Gjord
            <input aria-label="Prognosens datum" type="date" className={field} value={draft.madeOn} onChange={(e) => setDraft({ ...draft, madeOn: e.target.value })} />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-2">
            Uttagsålder
            <input aria-label="Uttagsålder" inputMode="numeric" placeholder="65" className={cn(field, "w-20 tabular-nums")} value={draft.retirementAge} onChange={(e) => setDraft({ ...draft, retirementAge: e.target.value })} />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-2">
            Kr/mån före skatt
            <input aria-label="Pension per månad" inputMode="decimal" className={cn(field, "w-32 text-right tabular-nums")} value={draft.monthly} onChange={(e) => setDraft({ ...draft, monthly: e.target.value })} />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-2">
            Antaganden (som minPension anger dem)
            <input aria-label="Antaganden" placeholder="t.ex. avkastning 3 %/år, löneutveckling 2 %/år" className={field} value={draft.assumptions} onChange={(e) => setDraft({ ...draft, assumptions: e.target.value })} />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-2 sm:col-span-3">
            Anteckning (valfri)
            <input aria-label="Anteckning" className={field} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <div className="flex items-end">
            <Button size="sm" type="submit">
              Spara
            </Button>
          </div>
          {error && <p className="text-xs text-caution-text sm:col-span-4">{error}</p>}
        </form>
      )}

      {forecasts.latest.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {forecasts.latest.map((f) => (
            <li key={f.id} className="rounded-wallet bg-positive-soft px-4 py-3.5" data-forecast={f.retirementAge}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold text-positive-text">Uttag vid {f.retirementAge} år</h3>
                <button type="button" onClick={() => void remove(f)} aria-label={`Ta bort prognosen för ${f.retirementAge} år`} className="text-[11px] text-ink-2 hover:text-alarm">
                  Ta bort
                </button>
              </div>
              <p className="mt-1 text-[34px] font-bold leading-tight tabular-nums">
                {kr(f.monthlyPensionOre).replace(/\s*kr$/, "")} <span className="text-[15px] font-normal text-ink-2">kr/mån före skatt</span>
              </p>
              <p className="mt-1 text-[11px] text-ink-2">
                prognos {dmy(f.madeOn)}
                {f.monthsOld > 0 && ` (${f.monthsOld} ${f.monthsOld === 1 ? "månad" : "månader"} sedan)`} · {f.assumptions}
                {f.note && ` · ${f.note}`}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        !adding && (
          <p className="rounded-inset bg-card-inset px-3.5 py-3 text-xs text-ink-2" data-testid="forecast-empty">
            Ingen prognos inlagd. Gör en på minpension.se och skriv av den med antagandena.{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => setAdding(true)}>
              Lägg in prognos
            </button>
          </p>
        )
      )}

      <p className="mt-auto text-[11px] text-ink-3">
        minPensions siffror och antaganden, avskrivna. Verktyget räknar ingen egen prognos.
        {forecasts.stale && ` Senaste prognosen är ${forecasts.stale.monthsOld} månader gammal. Gör en ny på minpension.se och skriv av den.`}
      </p>
    </Card>
  );
}
