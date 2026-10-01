import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { getJson, type ManualDataItem } from "../../../api";
import { EmptyState } from "../../../components/EmptyState";
import { setSearch, useSearch } from "../../../shell/routes";
import { todayIso } from "../../../lib/today";
import { GroupCard } from "./GroupCard";
import { NeedsCard } from "./NeedsCard";
import { StatusFilter } from "./StatusFilter";
import { counts, matches, needsDoing, parseFilter, type StatusFilter as Filter } from "./status";

/**
 * Att fylla i (?flik=att-fylla-i): everything the tool cannot fetch and has
 * to be told — where the figure is found, what kind of input it is, when it
 * was last given and how old it is. What needs doing comes first; the rest
 * stands below by area, so the whole list is always there to look through.
 */
export function ManualData() {
  const search = useSearch();
  const filter = parseFilter(search);
  // In the address, next to the tab, so Att göra can link straight to a status.
  const setFilter = (f: Filter) => {
    const q = new URLSearchParams(search);
    if (f === "all") q.delete("status");
    else q.set("status", f);
    setSearch(q.size ? `?${q}` : "", { replace: true });
  };
  const [items, setItems] = useState<ManualDataItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<ManualDataItem[]>("/manual-data").then(setItems, (e) => setError(String(e)));
  }, []);

  if (error) return <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>;
  if (!items) return null;
  if (items.length === 0)
    return (
      <EmptyState icon={ClipboardCheck} title="Inget att fylla i än">
        Raderna dyker upp när du börjar använda en del av verktyget som behöver uppgifter för hand.
      </EmptyState>
    );

  const thisYear = todayIso().slice(0, 4);
  const shown = items.filter((i) => matches(i, filter));
  const now = shown.filter(needsDoing);
  const rest = shown.filter((i) => !needsDoing(i));
  // In the order they come, and only those with rows left after the filter.
  const groups = [...new Set(rest.map((i) => i.group))];
  const allNow = items.filter(needsDoing);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="min-w-0 text-[13px] text-ink-2">
          Allt verktyget inte kan hämta själv, med var uppgiften finns och hur gammal den är.{" "}
          {allNow.length === 0 && <span className="text-ink">Allt är aktuellt.</span>}
        </p>
        <StatusFilter value={filter} counts={counts(items)} onChange={setFilter} />
      </div>

      <NeedsCard items={now} thisYear={thisYear} />

      {groups.map((g) => (
        // Remounted with the filter, so a fold made while filtering doesn't outlive it.
        <GroupCard key={`${g}|${filter}`} group={g} items={rest.filter((i) => i.group === g)} thisYear={thisYear} filtered={filter !== "all"} />
      ))}

      <p className="text-[11px] text-ink-3">
        Grupper där allt är aktuellt eller bara behövs ibland är hopfällda — tryck på rubriken för att visa raderna, så minns den valet. Statuspricken: grön aktuell, orange snart
        dags, röd inaktuell eller aldrig ifylld, grå vid behov.
      </p>
    </div>
  );
}
