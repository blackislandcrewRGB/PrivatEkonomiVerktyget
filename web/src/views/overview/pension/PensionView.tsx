import { useEffect, useState } from "react";
import { getJson, type PensionEntry, type PensionOverview } from "../../../api";
import { Landmark, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/EmptyState";
import { EntriesCard } from "./EntriesCard";
import { ForecastCard } from "./ForecastCard";
import { InflowCard } from "./InflowCard";
import { LockedCard } from "./LockedCard";
import { RegionCard } from "./RegionCard";
import { StatementsCard } from "./StatementsCard";
import { PensionEntryDialog } from "./PensionEntryDialog";

/**
 * Pension (?flik=pension): its own tab on Översikt, next to Ekonomisk
 * situation, since it is never counted there — what is locked until 65+,
 * minPension's forecast, what goes in every month, the placeable capital per
 * region, the entries and the envelopes, each a card.
 *
 * Shown and never counted: it is not in the net worth and not in how long
 * the money would last, because it cannot be spent for decades. Nothing here
 * assumes a return either — the only thing said about the future is what is
 * being paid in, because that is the part that is known.
 */
export function Pension() {
  const [data, setData] = useState<PensionOverview | null>(null);
  // The entry being written down; "new" for one that isn't there yet.
  const [editing, setEditing] = useState<PensionEntry | "new" | null>(null);
  const load = () => getJson<PensionOverview>("/networth/pension").then(setData, () => setData(null));
  const dialog = (
    <PensionEntryDialog
      entry={editing === "new" ? null : editing}
      open={editing !== null}
      onOpenChange={(open) => !open && setEditing(null)}
      onSaved={() => void load()}
    />
  );
  useEffect(() => {
    void load();
    // Loaded once with the view; an envelope saved or removed reloads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return null;
  if (data.entries.length === 0)
    return (
      <>
        <EmptyState
          icon={Landmark}
          title="Inga pensionsvärden inlagda än"
          action={
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> Lägg till pensionspost
            </Button>
          }
        >
          Värdena skrivs av från minpension.se, ungefär en gång om året.
        </EmptyState>
        {dialog}
      </>
    );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <LockedCard data={data} className="lg:col-span-7" />
      <ForecastCard forecasts={data.forecasts} onChanged={() => void load()} className="lg:col-span-5" />
      {data.inflow && <InflowCard inflow={data.inflow} className="lg:col-span-7" />}
      {data.regions.length > 0 && <RegionCard data={data} className={data.inflow ? "lg:col-span-5" : "lg:col-span-12"} />}
      <div className="min-w-0 lg:col-span-12">
        <EntriesCard entries={data.entries} onEdit={setEditing} onAdd={() => setEditing("new")} />
      </div>
      <div className="min-w-0 lg:col-span-12">
        <StatementsCard checks={data.statements} capOre={data.inflow?.capOre ?? null} capYear={data.inflow?.baseAmount.year ?? null} onChanged={() => void load()} />
      </div>
      {dialog}
    </div>
  );
}
