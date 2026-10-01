import { useEffect, useState } from "react";
import { getJson, parseKr, sendJson, type TaxYearRules } from "../../../api";
import { cn } from "../../../lib/cn";
import { formatKr } from "../../../lib/format";
import { Field } from "../compact";
import { BUTTON, FIELD } from "../ui";

const kr = (ore: number) => formatKr(ore, { whole: true });
const pct = (v: number | null) => (v === null ? "–" : `${v.toLocaleString("sv-SE", { maximumFractionDigits: 3 })} %`);
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const coef = (v: number) => v.toLocaleString("sv-SE", { maximumFractionDigits: 4 });
const text = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

type Draft = { pbb: string; ibb: string; threshold: string; source: string; municipal: string; region: string; burial: string; church: string; ratesSource: string };

/**
 * Inställningar › Lön, the final tax's rules per income year: the amounts
 * (Skatteverket's for the year) and the rates where one was registered
 * (municipal, regional, burial fee, church fee), each with its source. The
 * job tax credit's coefficients come with the year's code and are shown.
 */
export function TaxRules() {
  const [years, setYears] = useState<TaxYearRules[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<{ years: TaxYearRules[] }>("/tax/rules").then((d) => setYears(d.years), () => setYears(null));
  }, []);
  if (!years) return null;

  const start = (r: TaxYearRules) => {
    setError(null);
    setEditing(r.year);
    setDraft({
      pbb: String(r.pbbOre / 100),
      ibb: String(r.ibbOre / 100),
      threshold: String(r.stateThresholdOre / 100),
      source: r.source,
      municipal: text(r.municipalPct),
      region: text(r.regionPct),
      burial: text(r.burialPct),
      church: text(r.churchPct),
      ratesSource: r.ratesSource,
    });
  };
  const save = async () => {
    if (!draft || editing === null) return;
    const amounts = [parseKr(draft.pbb), parseKr(draft.ibb), parseKr(draft.threshold)];
    const rates = [num(draft.municipal), num(draft.region), num(draft.burial), num(draft.church)];
    if (amounts.some((a) => a === null)) return setError("Skriv beloppen i kronor.");
    if (rates.some((r) => r !== null && !Number.isFinite(r))) return setError("Skriv satserna i procent, till exempel 18,25.");
    try {
      const d = await sendJson<{ years: TaxYearRules[] }>("PUT", `/tax/rules/${editing}`, {
        pbbOre: amounts[0],
        ibbOre: amounts[1],
        stateThresholdOre: amounts[2],
        source: draft.source,
        municipalPct: rates[0],
        regionPct: rates[1],
        burialPct: rates[2],
        churchPct: rates[3],
        ratesSource: draft.ratesSource,
      });
      setYears(d.years);
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const input = (key: keyof Draft, label: string, wide = false) => (
    <Field label={label}>
      <input
        aria-label={label}
        inputMode={wide ? undefined : "decimal"}
        className={cn(FIELD, !wide && "text-right tabular-nums")}
        value={draft?.[key] ?? ""}
        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))}
      />
    </Field>
  );

  return (
    <div className="mt-4 space-y-2 border-t border-hairline pt-4" data-testid="tax-rules">
      <h3 className="text-[13px] font-semibold">Slutlig skatt per inkomstår</h3>
      <p className="text-[12px] leading-snug text-ink-2">
        Används för den uppskattade skatteåterbäringen. Beloppen är Skatteverkets för året; satserna är de där du var folkbokförd 1 november året innan
        (Skatteverkets lista Skattesatser kommuner). Preliminärskatten tas från lönespecarnas faktiska skatt, inte från en tabell.
      </p>
      <ul className="divide-y divide-hairline text-[13px]">
        {[...years].reverse().map((r) => (
          <li key={r.year} className="py-2" data-tax-year={r.year}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="w-10 font-semibold tabular-nums">{r.year}</span>
              <span className={cn("tabular-nums", r.municipalPct === null && "text-caution-text")}>
                {r.municipalPct === null ? "satserna saknas" : `kommun ${pct(r.municipalPct)} + region ${pct(r.regionPct)} · begravning ${pct(r.burialPct)} · kyrka ${pct(r.churchPct ?? 0)}`}
              </span>
              <button type="button" className={cn(BUTTON.link, "ml-auto")} onClick={() => start(r)} aria-label={`Ändra skattereglerna för ${r.year}`}>
                Ändra
              </button>
            </div>
            <p className="mt-0.5 text-[11px] text-ink-3 tabular-nums">
              PBB {kr(r.pbbOre)} · IBB {kr(r.ibbOre)} · skiktgräns {kr(r.stateThresholdOre)} · jobbskatteavdrag {coef(r.jobTaxCredit.lowRate)} / {coef(r.jobTaxCredit.midBase)} +{" "}
              {coef(r.jobTaxCredit.midRate)} / {coef(r.jobTaxCredit.top)} PBB · {r.source}
              {r.municipalPct !== null && ` · satser: ${r.ratesSource}`}
            </p>
            {editing === r.year && draft && (
              <div className="mt-2 space-y-3 rounded-inset bg-card p-3" data-testid="tax-rules-form">
                <div className="grid grid-cols-2 items-end gap-3 @[40rem]:grid-cols-4">
                  {input("municipal", "Kommunalskatt (%)")}
                  {input("region", "Regionskatt (%)")}
                  {input("burial", "Begravningsavgift (%)")}
                  {input("church", "Kyrkoavgift (%)")}
                </div>
                {input("ratesSource", "Källa för satserna", true)}
                <div className="grid grid-cols-2 items-end gap-3 @[40rem]:grid-cols-3">
                  {input("pbb", "Prisbasbelopp (kr)")}
                  {input("ibb", "Inkomstbasbelopp (kr)")}
                  {input("threshold", "Skiktgräns (kr)")}
                </div>
                {input("source", "Källa för beloppen", true)}
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className={BUTTON.blue} onClick={save}>
                    Spara
                  </button>
                  <button type="button" className={BUTTON.link} onClick={() => setEditing(null)}>
                    Avbryt
                  </button>
                  {error && <span className="text-[12px] text-alarm">{error}</span>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
