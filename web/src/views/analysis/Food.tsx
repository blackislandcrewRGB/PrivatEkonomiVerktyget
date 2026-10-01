import { query, useAnalysis } from "./common";
import type { ViewProps } from "./AnalysisView";
import { ShareCard } from "./food/ShareCard";
import { FoodBars } from "./food/FoodBars";
import { KindCards } from "./food/KindCards";
import { FoodTable } from "./food/FoodTable";
import type { FoodData } from "./food/types";

const yearBefore = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

/**
 * Groceries against restaurants & cafés and takeaway: the share not cooked at
 * home as a ring, against the same period a year earlier, then per month.
 */
export function Food({ from, to, share }: ViewProps) {
  const { data, error } = useAnalysis<FoodData>(`food?${query({ from, to, share })}`);
  const { data: before } = useAnalysis<FoodData>(`food?${query({ from: yearBefore(from), to: yearBefore(to), share })}`);
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="@container">
        <div className="grid gap-4 @[56rem]:grid-cols-12">
          <div className="@[56rem]:col-span-5">
            <ShareCard data={data} before={before} to={to} />
          </div>
          <div className="@[56rem]:col-span-7">
            <KindCards data={data} before={before} to={to} />
          </div>
        </div>
      </div>
      <FoodBars data={data} />

      <FoodTable data={data} />
    </div>
  );
}
