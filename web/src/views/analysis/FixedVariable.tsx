import { query, useAnalysis } from "./common";
import type { ViewProps } from "./AnalysisView";
import { IncomeHero } from "./fixed/IncomeHero";
import { FixedBars } from "./fixed/FixedBars";
import { FixedTable } from "./fixed/FixedTable";
import type { FixedData } from "./fixed/figures";

/**
 * Fasta mot rörliga (Design v2): fixed (matched charges) against variable
 * spending, with the income, the net and the fixed share of the income, for
 * the period and per month.
 */
export function FixedVariable({ from, to, share }: ViewProps) {
  const { data, error } = useAnalysis<FixedData>(`fixed-variable?${query({ from, to, share })}`);
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <IncomeHero data={data} to={to} />
      <FixedBars data={data} />
      <FixedTable data={data} />
    </div>
  );
}
