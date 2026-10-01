import { query, useAnalysis } from "./common";
import type { ViewProps } from "./AnalysisView";
import { IncompleteImports } from "./averages/IncompleteImports";
import { AverageFigures } from "./averages/AverageFigures";
import { SourceTable } from "./averages/SourceTable";
import { CategoryAverages } from "./averages/CategoryAverages";
import type { AveragesData } from "./averages/types";

/**
 * Snitt (Design v2): averages per week and per month over whole weeks
 * (Mon–Sun) and whole months only, per account and per category.
 */
export function Averages({ from, to, share }: ViewProps) {
  const { data, error } = useAnalysis<AveragesData>(`averages?${query({ from, to, share })}`);
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;
  return (
    <div className="@container space-y-4">
      <IncompleteImports incomplete={data.incomplete} />
      <AverageFigures data={data} />
      <SourceTable data={data} />
      <CategoryAverages data={data} />
    </div>
  );
}
