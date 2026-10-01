import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Scale } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getJson, sendJson, type ReferenceComparison, type ReferenceComparisonResponse, type ReferenceDiff, type ReferenceItem, type ReferenceMapping } from "../../api";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/EmptyState";
import { Switch } from "../../components/Switch";
import { notify } from "../../components/Toast";
import { openSettings } from "../../shell/routes";
import { todayIso } from "../../lib/today";
import { usePersistentState } from "../../usePersistentState";
import { ChartTooltip, CsvButton, Section, chart, kTick, kr, monthLabel, shiftMonth, th, td, totalRow } from "./common";
import type { ViewProps } from "./AnalysisView";
import { cn } from "../../lib/cn";
import { TONE, refTone } from "./reference/tone";
import { baseText, money, signedKr, signedPct, windowText } from "./reference/format";
import { ItemsCard } from "./reference/ItemsCard";

/** The last whole month: the month before this one. */
const lastWholeMonth = () => shiftMonth(todayIso().slice(0, 7), -1);


function Diff({ d }: { d: ReferenceDiff }) {
  if (d.ore === null) return <span className="text-ink-3">–</span>;
  return (
    <span className="tabular-nums">
      {signedKr(d.ore)}
      {d.pct !== null && <span className="ml-1 text-xs text-ink-2">{signedPct(d.pct)}</span>}
    </span>
  );
}

/**
 * Actual against the reference as two neutral marks on one scale: a filled
 * bar for what was spent, a line where the reference is. The same colour
 * either side of the line — above is not worse, below is not better.
 */
function Bar({ actual, reference, max }: { actual: number | null; reference: number; max: number }) {
  if (max <= 0) return null;
  const w = (v: number) => `${Math.min(100, (Math.max(0, v) / max) * 100)}%`;
  return (
    <div className="relative h-2 w-full min-w-24 rounded-full bg-card-inset" aria-hidden>
      {actual !== null && <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/30" style={{ width: w(actual) }} />}
      <div className="absolute -inset-y-0.5 w-0.5 rounded bg-foreground" style={{ left: `calc(${w(reference)} - 1px)` }} />
    </div>
  );
}

/**
 * Jämfört med Konsumentverket (?flik=konsumentverket).
 *
 * What we spend per item next to Konsumentverkets beräknade
 * hushållskostnader: the rolling 12- and 3-month average up to the last
 * whole month, the reference, and the difference in kronor and per cent.
 * Neutral on purpose — no red for over, no green for under. The point is to
 * see where we differ, not to be told off; the reference is a national
 * average that covers about 40 % of a household's spending.
 */
export function Reference({ share }: ViewProps) {
  const [through, setThrough] = useState(lastWholeMonth);
  // Off unless asked: the published figures are what Konsumentverket says; the adjustment is ours.
  const [kpi, setKpi] = usePersistentState<boolean>("reference.kpi", false);
  const [data, setData] = useState<ReferenceComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The mapping list in Utanför jämförelsen, opened from an item's Koppla kategori.
  const [mappingOpen, setMappingOpen] = useState(false);
  const [focus, setFocus] = useState<ReferenceItem | null>(null);
  const load = useCallback(() => {
    setError(null);
    getJson<ReferenceComparisonResponse>(`/reference-budget/comparison?share=${share}&through=${through}${kpi ? "&kpi=1" : ""}`).then(setData, (e) => setError(String(e)));
  }, [share, through, kpi]);
  useEffect(load, [load]);

  const toSettings = () => openSettings("referensbudget");

  if (error) return <p className="rounded-[12px] bg-alarm-soft p-3 text-sm text-alarm">{error}</p>;
  if (!data) return null;
  if (data.status !== "ready")
    return (
      <EmptyState
        icon={Scale}
        title="Jämförelsen går inte att visa än"
        action={
          data.status === "no_household" ? (
            <Button size="sm" onClick={toSettings}>
              Ställ in hushållet
            </Button>
          ) : undefined
        }
      >
        {data.message}
      </EmptyState>
    );

  const c = data.comparison;
  const latest = lastWholeMonth();
  return (
    <div className="space-y-4">
      {/* Design v2: the month as a segmented ‹ month › and the KPI adjustment as a switch. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]" data-part="toolbar">
        <span className="text-ink-2">Rullande snitt till och med</span>
        <span className="inline-flex items-center gap-0.5 rounded-[10px] bg-segment p-[3px]" role="group" aria-label="Månad">
          <button
            type="button"
            aria-label="Månaden före"
            onClick={() => setThrough(shiftMonth(through, -1))}
            className="grid size-7 place-items-center rounded-lg text-ink-2 hover:bg-segment-on/50 hover:text-ink"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <span className="min-w-28 rounded-lg bg-segment-on px-3 py-1 text-center font-semibold shadow-segment" aria-live="polite">
            {monthLabel(through, true)}
          </span>
          <button
            type="button"
            aria-label="Månaden efter"
            disabled={through >= latest}
            onClick={() => setThrough(shiftMonth(through, 1))}
            className="grid size-7 place-items-center rounded-lg text-ink-2 hover:bg-segment-on/50 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </span>
        <span className="ml-auto">
          <Switch checked={kpi} onCheckedChange={setKpi} label="KPI-justerad referens">
            <span className="text-[13px] text-ink-2">KPI-justerad referens</span>
          </Switch>
        </span>
      </div>

      {data.due && <NewYear year={data.due.year} latest={data.due.latest} />}
      <Overview c={c} />
      <ItemsCard
        c={c}
        onMap={(item) => {
          setFocus(item);
          setMappingOpen(true);
          // After the list has opened.
          requestAnimationFrame(() => document.getElementById("reference-mapping")?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
        }}
      />
      <div className="@container">
        <div className="grid gap-4 @[56rem]:grid-cols-12">
          <div className="min-w-0 @[56rem]:col-span-7">
            <Trend c={c} />
          </div>
          <div className="min-w-0 @[56rem]:col-span-5">
            <Outside c={c} onChanged={load} open={mappingOpen} setOpen={setMappingOpen} focus={focus} />
          </div>
        </div>
      </div>
      <Notes c={c} onSettings={toSettings} />
    </div>
  );
}

/**
 * A new year is expected and not in: how to add it. It is a file, not a
 * form, so the steps are said rather than a button that can't do them.
 */
function NewYear({ year, latest }: { year: number; latest: number }) {
  return (
    <section aria-label={`Referensvärden ${year}`} className="rounded-card bg-card shadow-card p-5 text-sm">
      <h2 className="font-semibold">Nya referensvärden från Konsumentverket – lägg in {year}</h2>
      <p className="mt-1 text-ink-2">Konsumentverket publicerar nästa års hushållskostnader i mitten av november. Tills {year} är inlagt jämförs med {latest}.</p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5">
        <li>Hämta PDF:en <em>Hushållskostnader {year}</em> från konsumentverket.se.</li>
        <li>
          Kopiera <code>server/reference-budget/{latest}.json</code> till <code>{year}.json</code>, sätt <code>year</code> och källans adress, och skriv in årets belopp (hela kronor, tomma celler utelämnas).
        </li>
        <li>Lägg till årets summarader i testet och kör <code>npm test</code>: summorna ska stämma med PDF:en.</li>
        <li>Starta om. Loggen säger <em>Referensbudget {year}: inläst</em>. README beskriver stegen.</li>
      </ol>
    </section>
  );
}


/**
 * The hero (Design v2): the 12-month average's difference against the
 * reference in large type (orange over, green under), what the reference
 * leaves out beside it, and three boxes: the reference, and the 12- and
 * 3-month averages with their difference, toned the same way.
 */
function Overview({ c }: { c: ReferenceComparison }) {
  const t12 = refTone(c.total.diff12);
  const t3 = refTone(c.total.diff3);
  const box = "min-w-0 rounded-inset px-3.5 py-3";
  const window = (w: { from: string; to: string; counted: number }, n: number) => windowText(w, n).replace(/\./g, "");
  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="reference-hero-title" data-card="hero">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="reference-hero-title" className="text-[13px] font-semibold text-ink-2">
            Jämfört med Konsumentverket · referensår {c.year}
            {c.fallback && ` (${c.fallback.wanted} är inte inlagt än, så ${c.year} används)`} · {c.persons.map((p) => `${p.name} ${p.ageGroup}`).join(", ")}
          </h2>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className={cn("text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums", TONE[t12].text)} data-testid="reference-hero" data-tone={t12}>
              {c.total.diff12.pct === null ? signedKr(c.total.diff12.ore) : signedPct(c.total.diff12.pct)}
            </span>
            <span className="text-[15px] text-ink-2">{t12 === "under" ? "under" : t12 === "over" ? "över" : "i nivå med"} referensen, snitt 12 månader</span>
          </p>
        </div>
        <p className="max-w-sm text-[11px] text-ink-3 @[44rem]:text-right">
          Referensen täcker ungefär 40 % av ett hushålls utgifter. Boende, transport, tandvård utöver ett årligt besök, restaurang och café, semester och presenter ingår inte.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-3">
        <div className={cn(box, "bg-card-inset")} data-box="reference">
          <p className="text-[11px] text-ink-2">Referens per månad</p>
          <p className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums">{kr(c.total.reference12Ore)}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            de poster som gäller er
            {c.kpi.on && c.kpi.adjusted > 0 && ` · KPI-justerad, snitt 12 mån${c.total.reference12Ore !== c.total.referenceOre ? ` (publicerat ${kr(c.total.referenceOre)})` : ""}`}
          </p>
        </div>
        {(
          [
            ["12", "Snitt 12 månader", c.total.actual12Ore, c.total.diff12, t12, window(c.months12, 12)],
            ["3", "Snitt 3 månader", c.total.actual3Ore, c.total.diff3, t3, window(c.months3, 3)],
          ] as const
        ).map(([n, label, actual, diff, tone, span]) => (
          <div key={n} className={cn(box, TONE[tone].soft)} data-box={`actual${n}`} data-tone={tone}>
            <p className={cn("text-[11px]", TONE[tone].text)}>
              {label} · {span}
            </p>
            <p className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums">{money(actual)}</p>
            <p className={cn("mt-0.5 text-[11px] font-semibold tabular-nums", TONE[tone].text)}>
              {signedKr(diff.ore)}
              {diff.pct !== null && ` · ${signedPct(diff.pct)}`}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Rullande snitt, totalt (Design v2): the 12-month average (black, 2,5 px)
 * and the 3-month one (orange) at every month's end, against the reference
 * as a dashed line with its amount (with KPI a line of its own, since it moves).
 */
function Trend({ c }: { c: ReferenceComparison }) {
  const data = c.series.map((s) => ({ month: s.month, r12: s.rolling12.total, r3: s.rolling3.total, ref: s.reference12 }));
  if (data.every((d) => d.r12 === null)) return null;
  const short = (m: string) => monthLabel(m).replace(".", "");
  return (
    <section className="h-full space-y-3 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="reference-trend-title" data-card="trend">
      <div>
        <h2 id="reference-trend-title" className="text-[15px] font-semibold">
          Rullande snitt, totalt
        </h2>
        <p className="mt-0.5 text-[12px] text-ink-3">snittet för 12 och 3 månader vid varje månadsskifte, mot referensen</p>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke={chart.grid} />
            <XAxis dataKey="month" tickFormatter={short} tick={chart.tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={32} />
            <YAxis orientation="right" tickFormatter={kTick} tick={chart.tick} width={36} axisLine={false} tickLine={false} domain={[0, "auto"]} />
            {!c.kpi.on && (
              <ReferenceLine
                y={c.total.referenceOre}
                stroke="var(--color-ink-2)"
                strokeDasharray="5 4"
                ifOverflow="extendDomain"
                label={{ value: `referens ${kr(c.total.referenceOre)}`, position: "insideBottomLeft", dy: 14, fontSize: 10, fill: "var(--color-ink-3)" }}
              />
            )}
            <Tooltip
              cursor={{ stroke: "var(--color-hairline)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    title={monthLabel(String(label), true)}
                    lines={[
                      { name: "Snitt 12 mån", value: money(payload[0]?.payload.r12 ?? null), color: "var(--color-ink)" },
                      { name: "Snitt 3 mån", value: money(payload[0]?.payload.r3 ?? null), color: "var(--color-caution)" },
                      { name: c.kpi.on ? "Referens, KPI" : "Referens", value: kr(payload[0]?.payload.ref ?? c.total.referenceOre), color: "var(--color-ink-2)", dashed: true },
                    ]}
                  />
                ) : null
              }
            />
            <Line type="linear" dataKey="r3" stroke="var(--color-caution)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey="r12" stroke="var(--color-ink)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
            {/* With KPI the reference moves with prices, so it is a line of its own rather than a flat one. */}
            {c.kpi.on && <Line type="linear" dataKey="ref" stroke="var(--color-ink-2)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 rounded-full bg-ink" aria-hidden /> 12 månader
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full bg-caution" aria-hidden /> 3 månader
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 border-t-2 border-dashed border-ink-2" aria-hidden /> Referens
        </span>
      </div>
    </section>
  );
}

/**
 * What is not in the comparison, said out loud: spending the reference
 * leaves out, and categories that have no answer yet — with the mapping to
 * change it.
 */
function Outside({
  c,
  onChanged,
  open,
  setOpen,
  focus,
}: {
  c: ReferenceComparison;
  onChanged: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  focus: ReferenceItem | null;
}) {
  const [mapping, setMapping] = useState<ReferenceMapping | null>(null);
  useEffect(() => {
    if (open && !mapping) getJson<ReferenceMapping>("/reference-budget/mapping").then(setMapping, () => setMapping(null));
  }, [open, mapping]);

  const change = async (categoryId: number, target: string) => {
    try {
      const r = await sendJson<ReferenceMapping>("PUT", `/reference-budget/mapping/categories/${categoryId}`, { target: target || null });
      setMapping(r);
      onChanged();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  // Without a category there is nothing to map: those purchases need a category first.
  const uncategorised = c.unmapped.find((u) => u.path === "Utan kategori");
  const unmapped = c.unmapped.filter((u) => u !== uncategorised);

  const compared = Math.max(0, c.total.actual12Ore ?? 0);
  const outside = Math.max(0, c.notIncluded.actual12Ore ?? 0);
  const share = compared + outside > 0 ? compared / (compared + outside) : 0;

  return (
    <section className="h-full space-y-3 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="reference-outside-title" data-card="outside">
      <h2 id="reference-outside-title" className="text-[15px] font-semibold">
        Utanför jämförelsen
      </h2>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[28px] font-bold leading-none tracking-[-0.01em] tabular-nums">{money(c.notIncluded.actual12Ore)}</span>
        <span className="text-[12px] text-ink-2">i månaden, snitt 12 mån</span>
      </p>
      <p className="text-[12px] text-ink-2">går till sådant referensen inte räknar med: boende, transport, restaurang och café, tandvård, vård och apotek, mjukvara och annat.</p>
      <div>
        <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-track" role="img" aria-label={`jämförs ${money(compared)}, utanför ${money(outside)}`} data-coverage={share}>
          <span className="h-full rounded-l-full bg-ink" style={{ width: `${share * 100}%` }} />
          <span className="h-full flex-1 rounded-r-full bg-neutral-bar" />
        </div>
        <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-ink-2 tabular-nums">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-ink" aria-hidden /> jämförs · {money(compared)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-neutral-bar" aria-hidden /> utanför · {money(outside)}
          </span>
        </div>
      </div>
      <div className="space-y-2 text-[12px]">
        {unmapped.length > 0 && (
          <p>
            <span className="font-medium">Saknar mappning:</span>{" "}
            {unmapped.map((u) => `${u.path} (${money(u.actual12Ore)})`).join(", ")}. <span className="text-ink-2">De räknas inte någonstans förrän de fått en post nedan.</span>
          </p>
        )}
        {uncategorised && (
          <p>
            <span className="font-medium">Utan kategori:</span> {money(uncategorised.actual12Ore)} i månaden.{" "}
            <span className="text-ink-2">Köp utan kategori kan inte jämföras. Ge dem en kategori under Att granska, så hamnar de på rätt post.</span>
          </p>
        )}
        <details id="reference-mapping" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="scroll-mt-24">
          <summary className="cursor-pointer font-medium text-accent hover:underline">Vilka kategorier räknas var</summary>
          {focus && (
            <p className="mt-2 rounded-inset bg-accent-soft px-3 py-2 text-[12px] text-ink" data-testid="mapping-focus">
              Koppla en kategori till <b>{focus.name}</b>: välj posten vid kategorin nedan.
            </p>
          )}
          {mapping && (
            <div className="mt-2 space-y-3">
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {mapping.categories
                  .filter((m) => m.kind !== "not_spending")
                  .map((m) => (
                    <li key={m.categoryId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{m.path}</span>
                      <select
                        aria-label={`${m.path}, post`}
                        className="h-7 max-w-52 shrink-0 rounded-md border border-hairline bg-card px-1.5 text-xs"
                        value={m.target ?? ""}
                        onChange={(e) => void change(m.categoryId, e.target.value)}
                      >
                        <option value="">Saknar mappning</option>
                        {mapping.targets.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
              </ul>
              {mapping.expenses.length > 0 && (
                <p className="text-xs text-ink-2">
                  Fasta utgifter som går före sin kategori:{" "}
                  {mapping.expenses.map((e) => `${e.name} → ${mapping.targets.find((t) => t.key === e.target)?.name ?? e.target}`).join(", ")}.
                </p>
              )}
            </div>
          )}
        </details>
      </div>
    </section>
  );
}

/**
 * The notes under the cards (Design v2), as one text: that the figures are
 * a national average, the KPI adjustment when it is on, what Din del or
 * Hushållet counts, what is not counted for you (with Ändra hushållet) and
 * the source.
 */
function Notes({ c, onSettings }: { c: ReferenceComparison; onSettings: () => void }) {
  return (
    <p className="text-[11px] leading-relaxed text-ink-3" data-testid="reference-notes">
      Siffrorna är riksgenomsnitt för en tvåa på cirka 60 kvm och skiljer inte på region eller kön. En skillnad visar var ni avviker från snittet, inte vad som är rätt.{" "}
      {c.kpi.on && (
        <>
          {c.kpi.reason ??
            (c.kpi.base.kind === "year"
              ? `KPI-justerad: varje post följer sin grupp i SCB:s KPI, mot gruppens snitt för ${c.kpi.base.year} (de tolv senaste publicerade månaderna tills året är slut). Konsumentverkets siffror är redan en prognos för årets prisnivå, så justeringen rättar bara det prognosen inte såg. Ett snitt i stället för en månad håller säsongerna utanför, som rean i juli.`
              : `KPI-justerad: varje post följer sin grupp i SCB:s KPI från ${monthLabel(c.kpi.base.month, true)}.`)}
          {c.kpi.unadjusted.length > 0 && !c.kpi.reason && ` Inte justerade (KPI saknas): ${c.kpi.unadjusted.join(", ")}.`}{" "}
        </>
      )}
      {c.share === "mine"
        ? "Din del: egna köp fullt, delade till hälften (också det Mio betalat och lagt in), det du betalat åt henne inte alls. Referensen är dina poster och hälften av de gemensamma. "
        : "Hela hushållet: allt som gått via dina konton och det Mio lagt in. Det hon köper från sina egna konton finns inte i verktyget, så hennes egna kläder, hygien och liknande saknas här medan referensen räknar med dem. "}
      {c.excluded.length > 0 && <>Räknas inte för er: {c.excluded.map((e) => e.name.toLowerCase()).join(", ")} · </>}
      <button type="button" className="text-accent hover:underline" onClick={onSettings}>
        Ändra hushållet
      </button>{" "}
      · Källa:{" "}
      <a href={c.source.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {c.source.title}
      </a>
      . Snittet delar med de månader som finns i datan.
    </p>
  );
}
