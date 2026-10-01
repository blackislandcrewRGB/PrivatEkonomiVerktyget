import { useCallback, useEffect, useState } from "react";
import { getJson, type BalanceSheet } from "../../../api";
import { usePersistentState } from "../../../usePersistentState";
import type { ViewId } from "../../../shell/routes";
import { AheadCard } from "./AheadCard";
import { EnduranceCard } from "./EnduranceCard";
import { FlowCard } from "./FlowCard";
import { HistoryCard } from "./HistoryCard";
import { ManualCard } from "./ManualCard";
import { MoneyTotal } from "./MoneyTotal";
import { Sheet } from "./Sheet";

/**
 * Översikt › Ekonomisk situation: balansräkningen.
 *
 * Min del, aldrig hushållets. What is owned, what is owed, and the two nets —
 * with the student loan and without it, always both, because they answer
 * different questions: what could be settled this year, and what is owed in a
 * lifetime.
 *
 * Nothing here moves by the day. A net worth is a monthly thing, so there is
 * no change since yesterday and nothing is green or red for having moved.
 * The only colour is on a debt, which is what a debt is.
 */

export function Situation({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [data, setData] = useState<BalanceSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showIlliquid, setShowIlliquid] = usePersistentState("situation.illiquid", false);

  const load = useCallback(() => {
    getJson<BalanceSheet>("/networth").then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError((e as Error).message),
    );
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>;
  if (!data) return null;

  const money = data.totals.moneyOre + (showIlliquid ? data.totals.illiquidOre : 0);

  return (
    <div className="space-y-5">
      <MoneyTotal data={data} showIlliquid={showIlliquid} onIlliquid={setShowIlliquid} />
      {data.ahead && data.ahead.items.length > 0 && <AheadCard ahead={data.ahead} start={money} />}
      <Sheet data={data} showIlliquid={showIlliquid} />
      <EnduranceCard onNavigate={onNavigate} />
      <FlowCard />
      <div className="grid gap-5 lg:grid-cols-2">
        <HistoryCard />
        <ManualCard reload={data} onSaved={load} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
