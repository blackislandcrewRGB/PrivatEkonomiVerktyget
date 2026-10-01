import { query, useAnalysis } from "./common";
import { setSearch, useSearch } from "../../shell/routes";
import { PeriodCards } from "./compare/PeriodCards";
import { CompareHero } from "./compare/CompareHero";
import { CompareTable } from "./compare/CompareTable";
import type { CompareData } from "./compare/delta";
import { bName, bScale, fromSearch, periodName, resolveB, shortName, swap, toSearch, type BChoice, type Period } from "./compare/periods";
import type { ViewProps } from "./AnalysisView";

/**
 * Jämför perioder (Design v2): two periods, A and B, chosen in the cards
 * (and the address), the total's difference in large type with the largest
 * differences, and per category A against B with Δ = A − B.
 */
export function Compare({ share }: ViewProps) {
  // A and B stand in the address (?a=2026-08&b=ifjol), so a link or a reload keeps them.
  const search = useSearch();
  const { a: aPeriod, b: bChoice } = fromSearch(new URLSearchParams(search));
  const setChoice = (a: Period, b: BChoice) => setSearch(toSearch(window.location.search, a, b), { replace: true });
  const swapped = swap(aPeriod, bChoice);
  const bPeriod = resolveB(aPeriod, bChoice);
  const scale = bScale(aPeriod, bChoice);
  const a = { ...aPeriod, label: periodName(aPeriod) };
  const b = { ...bPeriod, label: bName(aPeriod, bChoice) };
  const shortA = shortName(aPeriod, bPeriod);
  const shortB = "relative" in bChoice && bChoice.relative === "snitt12" ? "snitt 12 mån" : shortName(bPeriod, aPeriod);
  const { data, error } = useAnalysis<CompareData>(`compare?${query({ aFrom: a.from, aTo: a.to, bFrom: b.from, bTo: b.to, share, bScale: scale === 1 ? null : scale })}`);

  return (
    <div className="@container space-y-4">
      <PeriodCards a={aPeriod} b={bChoice} onA={(p) => setChoice(p, bChoice)} onB={(nb) => setChoice(aPeriod, nb)} onSwap={swapped ? () => setChoice(swapped.a, swapped.b) : null} />
      {data && scale === 1 && data.days.a !== data.days.b && (
        <p className="text-xs text-caution-text">Perioderna är olika långa ({data.days.a} mot {data.days.b} dagar), så jämför summorna med det i åtanke.</p>
      )}
      {error && <p className="text-alarm">{error}</p>}
      {data && <CompareHero data={data} aName={a.label} bName={b.label} aShort={shortA} bShort={shortB} />}
      {data && <CompareTable data={data} aLabel={a.label} bLabel={b.label} aShort={shortA} bShort={shortB} />}
      <p className="text-[11px] text-ink-3">Δ-pillen: orange = mer utgifter i A, grön = mindre. Rader där båda är 0 döljs.</p>
    </div>
  );
}
