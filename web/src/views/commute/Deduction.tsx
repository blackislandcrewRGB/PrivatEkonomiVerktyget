import { useCallback, useEffect, useState } from "react";
import { ArrowDown, Check, ChevronRight, Pencil } from "lucide-react";
import { getJson, parseKr, sendJson, type CommuteDeduction } from "../../api";
import { Button } from "../../components/ui/button";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { Card } from "../../components/Card";
import { SegmentedControl } from "../../components/SegmentedControl";
import { downloadCsv } from "../../csv";
import { thresholdBar } from "./threshold";
import { dm, kr } from "../overview/format";

const input = "h-8 rounded-[9px] border border-neutral-bar/70 bg-card px-2 text-sm text-ink outline-none focus:border-accent";
const mil = (v: number) => v.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
const krPerMil = (ore: number) => `${(ore / 100).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} kr/mil`;
const percent = (v: number) => `${(v * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
const fromKr = (s: string) => parseKr(s);
/** A forecast to the nearest hundred kronor: '~14 000 kr'. */
const about = (ore: number) => `~${kr(Math.round(ore / 10_000) * 10_000)}`;
const signed = (ore: number) => (ore === 0 ? "±0 kr" : `${ore > 0 ? "+" : "−"}${kr(Math.abs(ore))}`);

/**
 * Pendling › Reseavdrag: per income year the deductible amount so far
 * (shifts × mil per shift × the flat rate, less the year's threshold), the tax it
 * saves at my marginal tax, a bar of how much of the amount the threshold
 * takes, the conditions, and the shifts per month as the basis for the tax
 * return ('Underlag per månad', folded out in the card). Rate, thresholds and
 * marginal tax are editable here.
 */
export function Deduction() {
  const [data, setData] = useState<CommuteDeduction | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [basis, setBasis] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const load = useCallback(() => getJson<CommuteDeduction>("/fuel/deduction").then(setData, () => setData(null)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!data?.years.length) return null;
  const y = data.years.find((x) => x.year === year) ?? data.years[0];
  const s = data.settings;
  const years = [...new Set([...Object.keys(s.thresholds), ...data.years.map((x) => x.year)])].sort();

  const edit = () => {
    setDraft({
      rate: String(s.ratePerMil / 100).replace(".", ","),
      tax: String(Math.round(s.marginalTax * 1000) / 10).replace(".", ","),
      ...Object.fromEntries(years.map((yr) => [`t${yr}`, String((s.thresholds[yr] ?? y.threshold) / 100)])),
    });
    setEditing(true);
  };
  const save = async () => {
    const rate = fromKr(draft.rate);
    const tax = Number(draft.tax.replace(",", "."));
    const thresholds: Record<string, number> = {};
    for (const yr of years) {
      const v = fromKr(draft[`t${yr}`] ?? "");
      if (v === null) return notify({ text: `Skriv tröskeln för ${yr} i kronor.` });
      thresholds[yr] = v;
    }
    if (rate === null || !Number.isFinite(tax)) return notify({ text: "Skriv schablonen i kronor och marginalskatten i procent." });
    try {
      await sendJson("PUT", "/fuel/deduction/settings", { ratePerMil: rate, marginalTax: tax / 100, thresholds });
      setEditing(false);
      load();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  const bar = thresholdBar(y.gross, y.threshold);
  const okDistance = data.oneWayKm >= data.conditions.minOneWayKm;
  const thisYear = y.year === String(new Date().getFullYear());
  const csvRows = () => [
    ...y.months.map((m) => [m.month, m.shifts, m.days.join(" "), String(Math.round(m.shifts * y.milPerShift * 10) / 10).replace(".", ",")]),
    ["Totalt", y.shifts, "", String(Math.round(y.shifts * y.milPerShift * 10) / 10).replace(".", ",")],
  ];

  return (
    <Card aria-labelledby="deduction-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="deduction-title" className="text-[13px] font-medium text-ink-2">
          Reseavdrag
        </h2>
        {data.years.length > 1 && (
          <SegmentedControl
            label="Inkomstår"
            size="sm"
            appearance="v2"
            options={data.years.map((x) => ({ value: x.year, label: x.year }))}
            value={y.year}
            onChange={setYear}
          />
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-ink-2">Schablon, egen bil</span>
              <span className="flex items-center gap-2">
                <input aria-label="Schablon" inputMode="decimal" className={cn(input, "w-20 text-right tabular-nums")} value={draft.rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} />
                <span className="text-xs text-ink-2">kr/mil</span>
              </span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-ink-2">Marginalskatt</span>
              <span className="flex items-center gap-2">
                <input aria-label="Marginalskatt" inputMode="decimal" className={cn(input, "w-20 text-right tabular-nums")} value={draft.tax} onChange={(e) => setDraft((d) => ({ ...d, tax: e.target.value }))} />
                <span className="text-xs text-ink-2">%</span>
              </span>
            </label>
            {years.map((yr) => (
              <label key={yr} className="grid gap-1 text-sm">
                <span className="text-xs text-ink-2">Tröskel {yr}</span>
                <span className="flex items-center gap-2">
                  <input
                    aria-label={`Tröskel ${yr}`}
                    inputMode="decimal"
                    className={cn(input, "w-24 text-right tabular-nums")}
                    value={draft[`t${yr}`] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [`t${yr}`]: e.target.value }))}
                  />
                  <span className="text-xs text-ink-2">kr</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} className="h-8 rounded-[9px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
              Spara
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Avbryt
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-[12px] bg-positive-soft px-4 py-3.5" data-figure="deductible">
            <p className="text-[12px] font-semibold text-positive-text">
              Avdragsgillt {thisYear ? "hittills" : y.year}
            </p>
            <p className="mt-0.5 text-[34px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{kr(y.deductible)}</p>
            <p className="text-[12px] text-ink-2">
              skatteeffekt <b className="font-semibold text-ink tabular-nums">{kr(y.taxEffect)}</b> vid {percent(s.marginalTax)} marginalskatt
            </p>
            {thisYear && data.forecast && (
              <p className="mt-2 border-t border-positive-text/15 pt-2 text-[12px] text-ink-2" data-testid="deduction-forecast">
                Troligt avdrag i deklarationen mars {data.forecast.declareYear}:{" "}
                <b className="font-semibold text-ink tabular-nums">{about(data.forecast.deductible)}</b>, värt{" "}
                <b className="font-semibold text-ink tabular-nums">{about(data.forecast.taxEffect)}</b> i skatt
                <span className="block text-[11px] text-ink-3 tabular-nums">
                  {data.forecast.shifts} pass: {y.shifts} ifyllda
                  {data.forecast.monthsEstimated > 0 && ` + ${data.forecast.monthsEstimated} ${data.forecast.monthsEstimated === 1 ? "månad" : "månader"} à ${mil(data.forecast.perMonth)} pass (snittet hittills)`}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-1.5" data-threshold={bar.reached ? "over" : "under"}>
            <p className="flex flex-wrap justify-between gap-x-3 text-[11px] text-ink-2">
              <span className="tabular-nums">
                {y.shifts} pass × {mil(y.milPerShift)} mil × {krPerMil(s.ratePerMil)} = {kr(y.gross)}
              </span>
              <span className="tabular-nums">
                tröskel {kr(y.threshold)}
                {y.thresholdYear && y.thresholdYear !== y.year && ` (som ${y.thresholdYear})`}
              </span>
            </p>
            <div className="relative flex h-2 overflow-visible rounded-full bg-track" role="img" aria-label={bar.reached ? `${kr(y.threshold)} upp till tröskeln, ${kr(y.deductible)} avdragsgillt` : `${kr(bar.toGo)} kvar till tröskeln`}>
              <span data-part="grey" className="h-full rounded-l-full bg-neutral-bar first:rounded-l-full last:rounded-r-full" style={{ width: `${bar.grey * 100}%` }} />
              {bar.green > 0 && <span data-part="green" className="h-full rounded-r-full bg-positive" style={{ width: `${bar.green * 100}%` }} />}
              {bar.marker !== null && <span data-part="marker" aria-hidden className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${bar.marker * 100}%` }} />}
            </div>
            {bar.reached ? (
              <p className="text-[11px] text-ink-3">grått = upp till tröskeln (ger inget) · grönt = avdragsgillt</p>
            ) : (
              <p className="text-[11px] font-medium text-caution-text">
                {bar.toGo > 0 ? `${kr(bar.toGo)} kvar till tröskeln` : "precis vid tröskeln"} · avdrag först efter {y.shiftsToThreshold} pass, {Math.max(0, y.shiftsToThreshold - y.shifts)} kvar
              </p>
            )}
          </div>
        </>
      )}

      {(data.declared.length > 0 || data.backtest.declared !== null || data.backtest.computed !== null) && (
        <div className="space-y-1 rounded-inset bg-card-inset px-3.5 py-3 text-[12px]" data-testid="deduction-declared">
          {data.declared.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-ink-2">
              {data.declared.map((d) => (
                <span key={d.year} className="tabular-nums">
                  Deklarerat {d.year}: <b className="font-semibold text-ink">{kr(d.amount)}</b>
                </span>
              ))}
            </p>
          )}
          <p className="text-[11px] text-ink-2 tabular-nums" data-testid="deduction-backtest">
            {(() => {
              const b = data.backtest;
              const basis = `${b.shifts} pass, ${b.months} ${b.months === 1 ? "månad" : "månader"}`;
              if (b.declared !== null && b.computed !== null)
                return `${b.year}: verktyget räknade ${kr(b.computed)}, deklarerat ${kr(b.declared)}, differens ${signed(b.computed - b.declared)} (${basis}${b.months < 12 ? " ifyllda" : ""})`;
              if (b.declared !== null) return `${b.year}: deklarerat ${kr(b.declared)}; passen för ${b.year} saknas i Pendling, så verktyget kan inte räkna om året.`;
              if (b.computed !== null) return `${b.year}: verktyget räknar ${kr(b.computed)} (${basis}); deklarationen för ${b.year} är inte inläst.`;
              return null;
            })()}
          </p>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-ink-2">
        {okDistance && <Check className="mt-px size-3.5 shrink-0 text-positive-text" aria-hidden />}
        <span>
          Villkor: minst {data.conditions.minOneWayKm} km enkel väg (du har {mil(data.oneWayKm)} km) och minst {data.conditions.minTimeSavedHours} timmars tidsvinst per dag jämfört med
          kollektivtrafik. Tidsvinsten kontrollerar du själv.
        </span>
      </p>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-[13px]">
        <button type="button" aria-expanded={basis} onClick={() => setBasis((b) => !b)} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
          Underlag per månad <ChevronRight className={cn("size-3.5 transition-transform", basis && "rotate-90")} aria-hidden />
        </button>
        <span className="flex items-center gap-1 text-ink-3">
          <button type="button" onClick={() => downloadCsv(`reseavdrag-${y.year}`, ["Månad", "Pass", "Dagar", "Mil"], csvRows())} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline" title="Ladda ner underlaget som CSV (semikolon, decimalkomma)">
            <ArrowDown className="size-3.5" aria-hidden /> CSV
          </button>
          ·
          {!editing && (
            <button type="button" onClick={edit} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              <Pencil className="size-3.5" aria-hidden /> Ändra
            </button>
          )}
        </span>
      </div>

      {basis &&
        (y.months.length === 0 ? (
          <p className="text-[13px] text-ink-3">Inga pass ifyllda för {y.year}.</p>
        ) : (
          <table className="w-full text-[13px]" aria-label={`Pass ${y.year}`}>
            <tbody>
              {y.months.map((m) => (
                <tr key={m.month} className="border-t border-hairline">
                  <td className="py-1.5 pr-3 first-letter:uppercase">{monthName(m.month)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{m.shifts} pass</td>
                  <td className="py-1.5 text-[11px] text-ink-3">{m.days.length ? m.days.map(dm).join(", ") : ""}</td>
                </tr>
              ))}
              <tr className="border-t border-hairline font-semibold">
                <td className="py-1.5 pr-3">Totalt</td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{y.shifts} pass</td>
                <td className="py-1.5 text-[11px] font-normal text-ink-3">{mil(y.shifts * y.milPerShift)} mil</td>
              </tr>
            </tbody>
          </table>
        ))}
    </Card>
  );
}
