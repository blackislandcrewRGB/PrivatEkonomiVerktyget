import { useState } from "react";
import { sendJson } from "../../api";
import { notify } from "../../components/Toast";
import { monthLabel, query, useAnalysis } from "./common";
import type { ViewProps } from "./AnalysisView";
import { FoodIndexCard } from "./prices/FoodIndexCard";
import { SubgroupsCard } from "./prices/SubgroupsCard";
import { DieselCard } from "./prices/DieselCard";
import { fillMarks, type PricesData } from "./prices/types";

export { fillMarks };

/**
 * Priser (Design v2): mina siffror mot SCB:s index och kommissionens rikssnitt.
 *
 * Every chart here holds my own series next to the official one — that is the
 * whole reason the tab exists. Nothing on it watches a price: there is no
 * alert, no 'up 3 % this month', no news. What it answers is whether my own
 * costs moved the way prices did.
 */
export function Prices({ from, to }: ViewProps) {
  const { data, error, reload } = useAnalysis<PricesData>(`prices?${query({ from, to })}`);
  const [syncing, setSyncing] = useState(false);
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await sendJson<{ sources: { source: string; ok: boolean; added: number; revised: number; error?: string; skipped?: string }[] }>("POST", "/analysis/prices/sync", {});
      const said = r.sources.map((s) => `${s.source}: ${s.error ?? s.skipped ?? `${s.added} nya, ${s.revised} reviderade`}`).join(" · ");
      notify({ text: said || "Inget att hämta." });
      reload();
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <FoodIndexCard food={data.food} syncing={syncing} onSync={() => void sync()} />
      <SubgroupsCard subgroups={data.food.subgroups} base={monthLabel(data.food.base.month, true)} />
      <DieselCard fuel={data.fuel} />
    </div>
  );
}
