import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { parseKr, sendJson, type SalarySettings } from "../../../api";
import { Switch } from "../../../components/Switch";
import { cn } from "../../../lib/cn";
import { Field } from "../compact";
import { BUTTON, FIELD } from "../ui";

type LevelDraft = { code: string; name: string; rates: { from: string; rate: string }[] };
type Draft = { levels: LevelDraft[]; shiftLimit: string; weekLimit: string; quarter: boolean; notice: string };

const text = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const kronor = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");

const toDraft = (s: SalarySettings): Draft => ({
  levels: Object.entries(s.obLevels).map(([code, l]) => ({ code, name: l.name, rates: l.rates.map((r) => ({ from: r.from, rate: kronor(r.rate) })) })),
  shiftLimit: text(s.shiftLimit),
  weekLimit: text(s.weekLimit),
  quarter: s.quarterOvertime,
  notice: text(s.scheduleNoticeDays),
});

/**
 * Inställningar › Lön, the employment agreement: what differs between
 * agreements and doesn't stand on the payslips. OB per level (the löneart,
 * a name, and the rate from each work month), the hour limits for overtime
 * per shift and week, the quarter rule and the notice for the work schedule.
 * All empty from the start, and every part is optional: a part left out is
 * simply not counted.
 */
export function Agreement({ settings, onSaved }: { settings: SalarySettings; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const change = (next: Draft) => (setSaved(false), setDraft(next));
  const setLevel = (i: number, level: LevelDraft) => change({ ...draft, levels: draft.levels.map((l, j) => (j === i ? level : l)) });

  const save = async () => {
    setError(null);
    const obLevels: SalarySettings["obLevels"] = {};
    for (const l of draft.levels) {
      const rates = l.rates.map((r) => ({ from: r.from.trim(), rate: parseKr(r.rate) }));
      if (rates.some((r) => r.rate === null)) return setError(`${l.code || "OB-nivå"}: skriv satserna i kronor per timme, till exempel 25,87.`);
      obLevels[l.code.trim()] = { name: l.name, rates: rates.map((r) => ({ from: r.from, rate: r.rate! })) };
    }
    const [shiftLimit, weekLimit, notice] = [num(draft.shiftLimit), num(draft.weekLimit), num(draft.notice)];
    if ([shiftLimit, weekLimit, notice].some((v) => v !== null && !Number.isFinite(v))) return setError("Skriv gränserna som tal, eller lämna dem tomma.");
    try {
      await sendJson("PUT", "/salary/settings", { obLevels, shiftLimit, weekLimit, quarterOvertime: draft.quarter, scheduleNoticeDays: notice });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3" data-testid="agreement">
      <div>
        <h3 className="text-xs font-medium text-ink-2">Avtalet</h3>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-2">
          Det som skiljer mellan avtal och inte står på specen. Tomt från början, och varje del är valfri: det du lämnar tomt räknas inte med. OB-satserna kan också läsas ur
          specarna, men med dem här räknas månader som ännu inte haft någon spec.
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] text-ink-2">OB per timme, per nivå</h4>
        {draft.levels.length === 0 && <p className="text-[12px] text-ink-3">Inga nivåer än. Lönearten är specens kod (150, 151, 15h …).</p>}
        {draft.levels.map((l, i) => (
          <div key={i} className="space-y-2 rounded-inset bg-card-inset p-3" data-testid="ob-level">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Löneart" className="w-20">
                <input aria-label={`Löneart, nivå ${i + 1}`} className={FIELD} value={l.code} onChange={(e) => setLevel(i, { ...l, code: e.target.value })} />
              </Field>
              <Field label="Namn" className="min-w-0 flex-1 basis-40">
                <input aria-label={`Namn, nivå ${i + 1}`} className={FIELD} value={l.name} onChange={(e) => setLevel(i, { ...l, name: e.target.value })} />
              </Field>
              <button type="button" className={cn(BUTTON.danger, "mb-2.5 inline-flex items-center gap-1")} onClick={() => change({ ...draft, levels: draft.levels.filter((_, j) => j !== i) })}>
                <Trash2 className="size-3" aria-hidden /> Ta bort
              </button>
            </div>
            {l.rates.map((r, k) => (
              <div key={k} className="flex flex-wrap items-end gap-2">
                <Field label={k === 0 ? "Gäller från arbetsmånad (ÅÅÅÅ-MM)" : "Från"} className="w-44">
                  <input
                    aria-label={`Från månad, nivå ${i + 1} sats ${k + 1}`}
                    className={FIELD}
                    placeholder="2026-06"
                    value={r.from}
                    onChange={(e) => setLevel(i, { ...l, rates: l.rates.map((x, j) => (j === k ? { ...x, from: e.target.value } : x)) })}
                  />
                </Field>
                <Field label="Kronor per timme" className="w-32">
                  <input
                    aria-label={`Sats, nivå ${i + 1} sats ${k + 1}`}
                    inputMode="decimal"
                    className={cn(FIELD, "text-right tabular-nums")}
                    value={r.rate}
                    onChange={(e) => setLevel(i, { ...l, rates: l.rates.map((x, j) => (j === k ? { ...x, rate: e.target.value } : x)) })}
                  />
                </Field>
                {l.rates.length > 1 && (
                  <button type="button" className={cn(BUTTON.danger, "mb-2.5")} onClick={() => setLevel(i, { ...l, rates: l.rates.filter((_, j) => j !== k) })}>
                    Ta bort sats
                  </button>
                )}
              </div>
            ))}
            <button type="button" className={cn(BUTTON.link, "inline-flex items-center gap-1")} onClick={() => setLevel(i, { ...l, rates: [...l.rates, { from: "", rate: "" }] })}>
              <Plus className="size-3" aria-hidden /> Ny sats från en månad
            </button>
          </div>
        ))}
        <button
          type="button"
          className={cn(BUTTON.link, "inline-flex items-center gap-1")}
          onClick={() => change({ ...draft, levels: [...draft.levels, { code: "", name: "", rates: [{ from: "", rate: "" }] }] })}
        >
          <Plus className="size-3" aria-hidden /> Ny OB-nivå
        </button>
      </div>

      <div className="grid grid-cols-2 items-end gap-3 @[40rem]:grid-cols-3">
        <Field label="Övertid över (timmar per pass)">
          <input aria-label="Övertid per pass" inputMode="decimal" className={cn(FIELD, "text-right tabular-nums")} value={draft.shiftLimit} onChange={(e) => change({ ...draft, shiftLimit: e.target.value })} />
        </Field>
        <Field label="Övertid över (timmar per vecka)">
          <input aria-label="Övertid per vecka" inputMode="decimal" className={cn(FIELD, "text-right tabular-nums")} value={draft.weekLimit} onChange={(e) => change({ ...draft, weekLimit: e.target.value })} />
        </Field>
        <Field label="Schemat klart (dagar före månaden)">
          <input aria-label="Schemat klart dagar före" inputMode="numeric" className={cn(FIELD, "text-right tabular-nums")} value={draft.notice} onChange={(e) => change({ ...draft, notice: e.target.value })} />
        </Field>
      </div>
      <Switch checked={draft.quarter} onCheckedChange={(on) => change({ ...draft, quarter: on })} label="Övertid per kvartal">
        Övertid när kvartalets timmar passerar heltid i snitt (mertid plus 50 %, regleras med kvartalets sista månad)
      </Switch>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON.blue} onClick={save}>
          Spara avtalet
        </button>
        {saved && <span className="text-[12px] text-positive-text">Sparat.</span>}
        {error && <span className="text-[12px] text-alarm">{error}</span>}
      </div>
    </div>
  );
}
