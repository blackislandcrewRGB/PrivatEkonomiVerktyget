import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { getJson, type ApiCosts as ApiCostsData, type Digest, type Overview } from "../../api";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { SHARE_OPTIONS, useShare } from "../../lib/share";
import { HeaderActions } from "../../shell/PageHeader";
import { openTransactions } from "../../shell/openTransactions";
import { setSearch, useSearch, type ViewId } from "../../shell/routes";
import { cn } from "../../lib/cn";
import { GettingStarted } from "./GettingStarted";
import { Cashflow } from "./cashflow/CashflowView";
import { Situation } from "./situation/SituationView";
import { Pension } from "./pension/PensionView";
import { ManualData } from "./manual/ManualDataView";
import { SituationCard } from "./SituationCard";
import { MoneyCard } from "./MoneyCard";
import { MonthRings } from "./MonthRings";
import { Balances } from "./Balances";
import { onManualSaved, openManualEntry } from "./ManualEntry";
import { MonthBars } from "./MonthBars";
import { Tasks } from "./Tasks";
import { Timeline } from "./Timeline";
import { WeekDigest } from "./WeekDigest";
import { ApiCosts } from "./ApiCosts";
import { OverviewSkeleton } from "../skeletons";

/**
 * Översikt, top down: the answer (left to live on until payday), what needs
 * doing, the next 14 days, balances, this month by category and the week
 * that went (the Sunday digest). The tab
 * Kassaflöde (?flik=kassaflode) looks 90 days ahead; Ekonomisk situation
 * (?flik=situation), Pension (?flik=pension) and Att fylla i
 * (?flik=att-fylla-i, what is typed in by hand) have tabs of their own.
 */
export function OverviewView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [apiCosts, setApiCosts] = useState<ApiCostsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useShare();
  // All three at once: the week and the API costs used to wait for the overview before asking.
  const load = useCallback(() => {
    getJson<Overview>("/overview").then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(String(e)),
    );
    getJson<Digest>("/digest").then(setDigest, () => setDigest(null));
    getJson<ApiCostsData>("/overview/api-costs").then(setApiCosts, () => setApiCosts(null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => onManualSaved(load), [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        load();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [load],
  );

  // A tab id rather than a boolean: there are five of them now, and the
  // overview itself is the one with no name in the address.
  const tab = new URLSearchParams(useSearch()).get("flik") ?? "";
  const overview = tab !== "kassaflode" && tab !== "situation" && tab !== "pension" && tab !== "att-fylla-i";

  return (
    <div className={tab === "att-fylla-i" ? "space-y-8" : "space-y-5"}>
      <HeaderActions>
        {overview && <SegmentedControl label="Vems utgifter" options={SHARE_OPTIONS} value={share} onChange={setShare} size="sm" appearance="v2" />}
        <Tooltip content="Registrera en engångsinkomst eller -utgift">
          <Button size="sm" onClick={openManualEntry} className="h-8 rounded-[10px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
            <Plus /> Registrera
          </Button>
        </Tooltip>
      </HeaderActions>
      {/* Design v2's segmented look; scrolls sideways on a phone. */}
      <nav className="-mt-3 flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-segment p-[3px] text-[13px] sm:w-fit" aria-label="Flikar">
        {[
          { label: "Översikt", search: "", on: overview },
          { label: "Kassaflöde 90 dagar", search: "?flik=kassaflode", on: tab === "kassaflode" },
          { label: "Ekonomisk situation", search: "?flik=situation", on: tab === "situation" },
          { label: "Pension", search: "?flik=pension", on: tab === "pension" },
          { label: "Att fylla i", search: "?flik=att-fylla-i", on: tab === "att-fylla-i" },
        ].map((t) => (
          <button
            key={t.label}
            type="button"
            aria-current={t.on ? "page" : undefined}
            onClick={() => setSearch(t.search)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-ink transition-colors",
              t.on ? "bg-segment-on font-semibold shadow-segment" : "hover:bg-segment-on/50",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "kassaflode" && <Cashflow onNavigate={onNavigate} />}
      {tab === "situation" && <Situation onNavigate={onNavigate} />}
      {tab === "pension" && <Pension />}
      {tab === "att-fylla-i" && <ManualData />}
      {overview && <GettingStarted onNavigate={onNavigate} />}
      {error && overview && <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {!data && !error && overview && <OverviewSkeleton />}
      {data && overview && (
        <>
          <div className="grid gap-5 lg:grid-cols-12">
            <MoneyCard data={data} onChanged={load} onNavigate={onNavigate} className="lg:col-span-7" />
            <MonthRings data={data} className="lg:col-span-5" />
          </div>
          <Tasks data={data} act={act} onNavigate={onNavigate} />
          <div className="grid gap-5 lg:grid-cols-12">
            <Timeline data={data} act={act} className="lg:col-span-7" />
            <Balances data={data} act={act} className="lg:col-span-5" />
          </div>
          <SituationCard data={data} />
          {/* Without API costs to show, the month takes the row. */}
          <div className="grid gap-5 lg:grid-cols-12">
            <MonthBars
              data={data}
              share={share}
              className="lg:col-span-7 lg:last:col-span-12"
              onOpen={(categoryId) => openTransactions({ period: "this", categoryId: categoryId === null ? "none" : String(categoryId) })}
            />
            <ApiCosts data={apiCosts} className="lg:col-span-5" />
          </div>
          <WeekDigest data={digest} />
        </>
      )}
    </div>
  );
}
