import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Pencil, Upload } from "lucide-react";
import { getJson, sendJson, type SalaryConstants, type SalaryOverview } from "../../../api";
import { Button } from "../../../components/ui/button";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { CompactRow } from "../compact";
import { Agreement } from "./Agreement";
import { TaxRules } from "./TaxRules";
import { salarySummary } from "../summaries";
import { BUTTON } from "../ui";
import { useReportBadge } from "../badges";
import type { SectionProps } from "./types";

const kr = (ore: number | null, decimals = false) =>
  ore === null ? "–" : `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 })} kr`;
const hours = (h: number | null) => (h === null ? "–" : `${h.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} tim`);
const pct = (v: number | null, d = 2) => (v === null ? "–" : `${(v * 100).toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
const input = "h-8 w-28 rounded-md border border-hairline bg-card px-2 text-right text-sm tabular-nums outline-none focus:border-ring";

type Field = { key: keyof SalaryConstants; label: string; kind: "kr" | "hours"; decimals?: boolean };
const FIELDS: Field[] = [
  { key: "monthlySalary", label: "Månadslön (011)", kind: "kr" },
  { key: "industrySupplement", label: "Fast tillägg (01d)", kind: "kr" },
  { key: "salarySupplement", label: "Lönetillägg (02f)", kind: "kr" },
  { key: "hoursPerMonth", label: "Månadsarbetstidsmått", kind: "hours" },
  { key: "fullTimeHours", label: "Heltid", kind: "hours" },
  { key: "mertidRate", label: "Mertid, à-pris (160)", kind: "kr", decimals: true },
  { key: "vacationHourlyRate", label: "Semestertimlön", kind: "kr", decimals: true },
];

/**
 * Inställningar › Lön: the payslips (import), the constants read from them
 * with where each comes from (editable), the lag, the tax table and the
 * curve from the payslips, and the backtest: the model against every payslip.
 */
export function SalarySection({ open, onToggle, match }: SectionProps) {
  const [data, setData] = useState<SalaryOverview | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => getJson<SalaryOverview>("/salary").then(setData, () => setData(null)), []);
  useEffect(() => {
    load();
  }, [load]);
  // New values from a payslip not looked at yet.
  const waiting = data?.pendingChanges?.length ?? 0;
  useReportBadge("lon", waiting);
  if (!data) return null;
  const summary = salarySummary(data);
  if (!match("Lön", "lönespec", "konstanter", "skattetabell", "kommunalskatt", "kyrkoavgift", "begravningsavgift", summary.summary, summary.hint)) return null;
  const fail = (e: unknown) => notify({ text: (e as Error).message });

  const upload = async (files: FileList) => {
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    const res = await fetch("/api/salary/payslips", { method: "POST", body: form });
    const body = (await res.json()) as { results: { filename: string; status: string; error?: string; unknownCodes?: string[] }[]; error?: string };
    if (!res.ok) return fail(new Error(body.error));
    const added = body.results.filter((r) => r.status === "new").length;
    const updated = body.results.filter((r) => r.status === "updated").length;
    const errors = body.results.filter((r) => r.status === "error");
    notify({
      text: `${added} ${added === 1 ? "spec inläst" : "specar inlästa"}${updated ? `, ${updated} ${updated === 1 ? "kompletterad" : "kompletterade"} med semestersaldot` : ""}${errors.length ? `, ${errors.length} kunde inte läsas (${errors[0].error})` : ""}.`,
    });
    load();
  };
  const fetchTable = async () => {
    setBusy(true);
    try {
      const year = data.settings.taxYear ?? Number(data.today.slice(0, 4));
      const r = await sendJson<{ rows: number }>("POST", "/salary/tax-table", { year });
      notify({ text: `Tabell ${data.settings.taxTable} för ${year} hämtad (${r.rows} rader).` });
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const setLag = (lagMonths: number) => sendJson("PUT", "/salary/settings", { lagMonths }).then(load, fail);
  const edit = (c: SalaryConstants) => {
    setEditing(c.id);
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, c[f.key] === null ? "" : String(f.kind === "kr" ? (c[f.key] as number) / 100 : c[f.key]).replace(".", ",")])));
  };
  const save = async (c: SalaryConstants) => {
    const patch: Record<string, number> = {};
    for (const f of FIELDS) {
      const raw = draft[f.key as string]?.replace(/\s/g, "").replace(",", ".");
      if (!raw) continue;
      const v = f.kind === "kr" ? Math.round(Number(raw) * 100) : Number(raw);
      if (!Number.isFinite(v)) return fail(new Error(`${f.label}: skriv ett tal.`));
      if (v !== c[f.key]) patch[f.key as string] = v;
    }
    try {
      if (Object.keys(patch).length) await sendJson("PUT", `/salary/constants/${c.id}`, patch);
      setEditing(null);
      load();
    } catch (e) {
      fail(e);
    }
  };

  const s = data.settings;
  const monthly = data.backtest.filter((b) => b.model);
  const worst = monthly.reduce((m, b) => Math.max(m, Math.abs(b.diff ?? 0)), 0);

  return (
    <CompactRow id="lon" name="Lön" summary={summary.summary} hint={summary.hint} badge={waiting} open={open} onToggle={onToggle}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-[12px] leading-snug text-ink-2">
          Konstanterna läses från lönespecarna (Hogias webbspec som .htm, eller PDF:en) med månaden de gäller från. Utan spec lägger du in dem för hand. Personnummer, namn, adress och anställningsnummer sparas aldrig.
        </p>
        <button type="button" className={BUTTON.grey} onClick={() => file.current?.click()}>
          <Upload className="size-3.5" aria-hidden /> Läs in specar
        </button>
        <input ref={file} type="file" accept=".htm,.html,.pdf" multiple className="hidden" onChange={(e) => (e.target.files?.length && upload(e.target.files), (e.target.value = ""))} />
      </div>

      <div className="space-y-6 text-[13px]">
        {/* Constants per revision */}
        <div>
          <h3 className="text-xs font-medium text-ink-2">Konstanter</h3>
          {data.constants.length === 0 ? (
            <p className="mt-1 text-ink-2">Inga ännu: läs in en lönespec med månadslön.</p>
          ) : (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-[13px]" aria-label="Lönekonstanter">
                <thead className="border-b border-hairline text-xs text-ink-2">
                  <tr>
                    <th className="py-1.5 pr-3 text-left font-medium">Gäller från arbetsmånad</th>
                    {data.constants.map((c) => (
                      <th key={c.id} className="py-1.5 pr-3 text-right font-medium">
                        {monthName(c.validFrom)}
                        {editing !== c.id && (
                          <button type="button" className="ml-1 align-middle text-ink-2 hover:text-foreground" aria-label={`Ändra ${monthName(c.validFrom)}`} onClick={() => edit(c)}>
                            <Pencil className="inline size-3" />
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {FIELDS.map((f) => (
                    <tr key={f.key as string}>
                      <td className="py-1.5 pr-3">{f.label}</td>
                      {data.constants.map((c) => (
                        <td key={c.id} className="py-1.5 pr-3 text-right tabular-nums" title={c.sources[f.key as string] ?? ""}>
                          {editing === c.id ? (
                            <input aria-label={`${f.label} ${c.validFrom}`} className={input} value={draft[f.key as string] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                          ) : (
                            <>
                              {f.kind === "kr" ? kr(c[f.key] as number | null, f.decimals) : hours(c[f.key] as number)}
                              <span className={cn("block text-[11px]", c.sources[f.key as string] === "ändrat för hand" ? "text-warning" : "text-ink-3")}>{c.sources[f.key as string] ?? ""}</span>
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 pr-3 text-ink-2">Sysselsättningsgrad (mått ÷ heltid)</td>
                    {data.constants.map((c) => (
                      <td key={c.id} className="py-1.5 pr-3 text-right tabular-nums text-ink-2">
                        {pct(c.employmentRate)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-ink-2">Grundtimlön (månadslön ÷ mått)</td>
                    {data.constants.map((c) => (
                      <td key={c.id} className="py-1.5 pr-3 text-right tabular-nums text-ink-2">
                        {kr(c.baseHourlyRate, true)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              {editing !== null && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => save(data.constants.find((c) => c.id === editing)!)}>
                    Spara
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Avbryt
                  </Button>
                </div>
              )}
              <p className="mt-2 text-xs text-ink-2">
                Mertidens à-pris står på specen. Måttet är de fasta delarna (011 + 01d + 02f) delat med à-priset. Hogias à-pris är ungefär 1 öre lägre än
                de fasta delarna delat med måttet, så à-priset läses från specen i stället för att räknas. Ändrar du månadslönen, ett tillägg eller måttet för hand räknas à-priset om ur dem, om du inte ändrat det själv. Heltid står inte på specen: den börjar på 173,3 och ändras i tabellen.
                {Object.keys(data.obRates).length > 0 &&
                  ` OB i månaden (avtalets satser, eller specen när den visat samma period): ${Object.entries(data.obRates)
                    .map(([code, r]) => `${code} ${r.name} ${kr(r.rate, true)} (${r.source})`)
                    .join(", ")}.`}
              </p>
            </div>
          )}
        </div>

        {/* Lag */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-ink-2">Eftersläpning</h3>
            <p className="mt-0.5">
              Lönen för en arbetsmånad betalas {s.lagMonths === 1 ? "den 25:e månaden efter" : "den 25:e samma månad"} (bankdagen före om den 25:e är helg).
            </p>
            <p className="text-xs text-ink-2">{s.lagManual ? "Satt för hand." : s.lagSource || "Inga specar än."}</p>
          </div>
          <select aria-label="Eftersläpning" className="h-8 rounded-md border border-hairline bg-card px-2 text-sm" value={s.lagMonths} onChange={(e) => setLag(Number(e.target.value))}>
            <option value={0}>0 månader</option>
            <option value={1}>1 månad</option>
          </select>
        </div>

        {/* Hours per shift */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-ink-2">Timmar per pass</h3>
            <p className="mt-0.5">När en månads timmar räknas från passen i Pendling & bränsle (valbart per månad under Lön).</p>
          </div>
          <input
            key={s.shiftHours}
            aria-label="Timmar per pass"
            inputMode="decimal"
            defaultValue={String(s.shiftHours).replace(".", ",")}
            className={input}
            onBlur={(e) => {
              const v = Number(e.target.value.replace(",", "."));
              if (v !== s.shiftHours) sendJson("PUT", "/salary/settings", { shiftHours: v }).then(load, fail);
            }}
          />
        </div>

        <Agreement settings={s} onSaved={load} />

        {/* Tax */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-ink-2">Skatt</h3>
            <p className="mt-0.5">
              Skatteverkets tabell {s.taxTable}, kolumn {s.taxColumn} (specens "Skattetabell 320"),{" "}
              {data.taxYears.length ? `hämtad för ${data.taxYears.join(", ")}` : "inte hämtad än"}. Utan tabell används kurvan från specarna.
            </p>
            <p className="text-xs text-ink-2">
              Kurvan: {data.curve.points.length} punkter, effektiv skatt {pct(data.curve.min, 1)}–{pct(data.curve.max, 1)} vid{" "}
              {data.curve.points.length ? `${kr(data.curve.points[0].gross)}–${kr(data.curve.points.at(-1)!.gross)}` : "–"} brutto.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={fetchTable} disabled={busy}>
            <Download /> Hämta tabell {s.taxYear ?? Number(data.today.slice(0, 4))}
          </Button>
        </div>

        {/* Backtest */}
        <div>
          <h3 className="text-xs font-medium text-ink-2">Backtest: modellen mot varje spec</h3>
          <p className="mt-0.5 text-xs text-ink-2">
            Modellen körs med timmarna från specen och konstanterna för arbetsmånaden. {monthly.length} specar med månadslön, största avvikelse i netto {kr(worst)}.
          </p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px] [&_td]:whitespace-nowrap" aria-label="Backtest">
              <thead className="border-b border-hairline text-xs text-ink-2">
                <tr>
                  <th className="py-1.5 pr-3 text-left font-medium">Spec</th>
                  <th className="py-1.5 pr-3 text-left font-medium">Arbetsmånad</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Timmar</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Brutto</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Skatt (tabellen)</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Netto</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Modellen</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Avvikelse</th>
                  <th className="py-1.5 text-left font-medium">Förklaring</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.backtest.map((b) => (
                  <tr key={b.payDate} data-payslip={b.payDate}>
                    <td className="py-1.5 pr-3 first-letter:uppercase">{b.name}</td>
                    <td className="py-1.5 pr-3">{b.workMonth ? monthName(b.workMonth) : "–"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{hours(b.hours)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{kr(b.actual.gross, true)}</td>
                    <td className={cn("py-1.5 pr-3 text-right tabular-nums", b.taxCheck.diff !== 0 && "text-warning")} title={b.taxCheck.source}>
                      {kr(b.actual.tax)}
                      <span className="block text-[11px] text-ink-2">{b.taxCheck.diff === 0 ? "stämmer" : `tabellen ${kr(b.taxCheck.tax)}`}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{kr(b.actual.net, true)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{b.model ? kr(b.model.net, true) : "–"}</td>
                    <td className={cn("py-1.5 pr-3 text-right font-medium tabular-nums", b.diff !== null && Math.abs(b.diff) > 20000 && "text-warning")}>
                      {b.diff === null ? "–" : b.diff === 0 ? "0 kr" : kr(b.diff, true)}
                    </td>
                    <td className="!whitespace-normal py-1.5 text-xs text-ink-2">{b.note ?? (b.diff === 0 ? "exakt" : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <TaxRules />
    </CompactRow>
  );
}
