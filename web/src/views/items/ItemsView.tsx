import { useCallback, useEffect, useState } from "react";
import { Package, Plus, Search } from "lucide-react";
import { getJson, type ItemList, type Settings } from "../../api";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { EmptyState } from "../../components/EmptyState";
import { Entering } from "../../components/Entering";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { HeaderActions, HeaderTabs } from "../../shell/PageHeader";
import { useIntent } from "../../shell/intents";
import { formatKr } from "../../lib/format";
import { useListEntrance } from "../../lib/motion";
import { usePersistentState } from "../../usePersistentState";
import { onItemSaved, openNewItem } from "./ItemDialogHost";
import { ItemsCalendar } from "./ItemsCalendar";
import { ItemPanel } from "./ItemPanel";
import { ItemFilters } from "./ItemFilters";
import { ItemCard } from "./ItemCard";
import { ItemRow } from "./ItemRow";
import { activeFilters, filterQuery, longMonth, NO_FILTERS, sortItems, type Filters, type Sort } from "./filters";
import { todayIso } from "../../lib/today";

/**
 * Prylar: the things I bought and chose to write down. A gallery by default,
 * because a picture says which thing it is faster than a name does, and a
 * list when the figures matter more.
 *
 * Nothing on this page is money in the accounting sense — no sum here is part
 * of any total elsewhere in the tool. It answers 'what did I buy, when, and
 * what did it cost', not 'what did I spend'.
 */

type Layout = "gallery" | "list" | "calendar";

const today = todayIso;

export function ItemsView() {
  const [data, setData] = useState<ItemList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stored, setFilters] = usePersistentState<Filters>("items.filters", NO_FILTERS);
  // Filters remembered before there was a month or a merchant come back without them.
  const filters: Filters = { ...NO_FILTERS, ...stored };
  const [layout, setLayout] = usePersistentState<Layout>("items.layout", "gallery");
  const [sort, setSort] = usePersistentState<Sort>("items.sort", "date");
  // Where a bar in the calendar goes: the gallery or the list, whichever was used last.
  const [browse, setBrowse] = usePersistentState<"gallery" | "list">("items.browse", "gallery");
  const [openId, setOpenId] = useState<number | null>(null);
  const [partnerName, setPartnerName] = useState("partnern");
  const now = today();

  const query = filterQuery(filters);

  const load = useCallback(() => {
    getJson<ItemList>(`/items${query ? `?${query}` : ""}`).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  }, [query]);
  useEffect(() => load(), [load]);
  useEffect(() => {
    getJson<Settings>("/settings").then((s) => setPartnerName(s.partnerName), () => {});
  }, []);
  // A pryl saved anywhere (the dialog is one for the whole app) shows here at once.
  useEffect(() => onItemSaved((item) => {
    load();
    setOpenId(item.id);
  }), [load]);
  // 'Visa prylen' from Att göra. The filters are cleared on the way in, so the
  // thing that was asked for is also in the list behind its panel.
  useIntent("items.open", ({ itemId }) => {
    setFilters(NO_FILTERS);
    setOpenId(itemId);
  });

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  // ?visa=kalender (the old Analys › Prylar tab leads here): the calendar, then the address is left clean.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("visa") !== "kalender" || !data) return;
    showAs("calendar");
    q.delete("visa");
    const rest = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    // Once, when the list is in (the calendar picks its year from it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data !== null]);

  /**
   * The calendar is one year at a time, so switching to it picks a year if no
   * filter has: this one when there is anything in it, otherwise the newest.
   * The year is the ordinary filter, so the gallery agrees with the calendar.
   */
  const showAs = (next: Layout) => {
    if (next === "calendar") {
      // A month from a bar is let go of: the calendar shows the year.
      const thisYear = String(new Date().getFullYear());
      const year = filters.year || (data?.years.includes(thisYear) ? thisYear : (data?.years[0] ?? thisYear));
      if (year !== filters.year || filters.month) set({ year, month: "" });
    } else setBrowse(next);
    setLayout(next);
  };
  /** A bar in the calendar: that month's prylar, in the gallery or the list. */
  const showMonth = (month: string) => {
    set({ month, year: month.slice(0, 4) });
    setLayout(browse);
  };
  const filtered = activeFilters(filters) > 0;

  // The list animates in when it first appears and when what it shows changes
  // — a filter, the layout — never otherwise.
  const entrance = useListEntrance(`${layout}:${query}:${sort}`);
  const items = data?.items ?? [];
  const shown = sortItems(items, sort);

  return (
    <div className="space-y-4">
      {data && (
        <HeaderTabs>
          {/* The sum of what is shown. It is not an expense total: it never meets the rest of the tool. */}
          <p className="flex flex-wrap items-baseline gap-x-1.5 pt-2 text-[14px] text-ink-2" data-testid="items-summary">
            <span>
              {data.totals.count} {data.totals.count === 1 ? "pryl" : "prylar"}
            </span>
            <span>·</span>
            <AnimatedAmount ore={data.totals.priceOre} kind="neutral" whole size="md" className="font-semibold text-ink" />
            <span>·</span>
            <span>{filters.month ? longMonth(filters.month) : filters.year || "alla år"}</span>
            {data.totals.soldOre > 0 && <span>· sålt för {formatKr(data.totals.soldOre, { whole: true })}</span>}
          </p>
        </HeaderTabs>
      )}
      <HeaderActions>
        <label className="relative max-nav:w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            aria-label="Sök pryl"
            placeholder="Sök namn eller handlare"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            className="h-9 w-56 rounded-[10px] bg-segment pl-8 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent/30 max-nav:w-full"
          />
        </label>
        <SegmentedControl<Layout>
          appearance="v2"
          label="Visning"
          value={layout}
          onChange={showAs}
          options={[
            { value: "gallery", label: "Galleri" },
            { value: "list", label: "Lista" },
            { value: "calendar", label: "Kalender" },
          ]}
        />
        <button type="button" onClick={openNewItem} className="flex h-9 items-center gap-1 whitespace-nowrap rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
          <Plus className="size-4" aria-hidden /> Ny pryl
        </button>
      </HeaderActions>

      <ItemFilters filters={filters} set={set} onClear={() => setFilters(NO_FILTERS)} data={data} partnerName={partnerName} sort={sort} onSort={setSort} />

      {error && <p className="text-danger">{error}</p>}

      {data && items.length === 0 && layout !== "calendar" && (
        <EmptyState
          icon={Package}
          title={filtered ? "Ingen pryl matchar filtren" : "Inga prylar än"}
          action={
            filtered ? (
              <Button size="sm" onClick={() => setFilters(NO_FILTERS)}>
                Rensa filtren
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={openNewItem}>
                <Plus /> Ny pryl
              </Button>
            )
          }
        >
          {filtered ? "Prova ett annat år eller en annan kategori." : "Lägg in en sak du köpt, eller skapa den från transaktionen som betalade den."}
        </EmptyState>
      )}

      {data && layout === "calendar" && (
        <ItemsCalendar
          items={items}
          year={filters.year || String(new Date().getFullYear())}
          years={data.years}
          today={now}
          month={filters.month}
          onYear={(year) => set({ year })}
          onMonth={showMonth}
          onOpen={setOpenId}
        />
      )}

      {items.length > 0 &&
        layout !== "calendar" &&
        (layout === "gallery" ? (
          <div className="@container">
          <ul className="grid grid-cols-1 gap-4 @[26rem]:grid-cols-2 @[56rem]:grid-cols-4" aria-label="Prylar">
            {shown.map((item, i) => (
              <Entering key={item.id} as="li" index={i} entrance={entrance}>
                <ItemCard item={item} today={now} onOpen={() => setOpenId(item.id)} />
              </Entering>
            ))}
          </ul>
          </div>
        ) : (
          <ul className="@container overflow-hidden rounded-card bg-card shadow-card" aria-label="Prylar">
            {shown.map((item, i) => (
              <Entering key={item.id} as="li" index={i} entrance={entrance} className="border-t border-hairline first:border-t-0">
                <ItemRow item={item} today={now} onOpen={() => setOpenId(item.id)} />
              </Entering>
            ))}
          </ul>
        ))}

      <ItemPanel itemId={openId} today={now} partnerName={partnerName} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
