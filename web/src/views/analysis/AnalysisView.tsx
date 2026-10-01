import { useEffect, useRef } from "react";
import { usePersistentState } from "../../usePersistentState";
import { useShowPrivate } from "../../privacy";
import { DEFAULT_PERIOD, PeriodDates, PeriodPicker, periodFromSearch, periodRange, periodSearch, shareNote, type Period, type Share } from "./common";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SHARE_OPTIONS, useShare } from "../../lib/share";
import { cn } from "../../lib/cn";
import { HeaderActions, HeaderTabs } from "../../shell/PageHeader";
import { navigate, setSearch, useSearch } from "../../shell/routes";
import { CategoryChart } from "./CategoryChart";
import { Averages } from "./Averages";
import { Food } from "./Food";
import { Products } from "./Products";
import { FixedVariable } from "./FixedVariable";
import { Merchants } from "./Merchants";
import { Compare } from "./Compare";
import { Fuel } from "./Fuel";
import { Savings } from "./Savings";
import { Prices } from "./Prices";
import { Reference } from "./Reference";

/**
 * The eleven tabs as one segmented control (Design v2). On a narrow screen it
 * scrolls sideways, and the chosen tab is brought into view.
 */
function TabBar({ tab, onTab }: { tab: TabId; onTab: (slug: string) => void }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const r = row.current;
    if (!el || !r || r.scrollWidth <= r.clientWidth) return;
    // Only when the row doesn't fit: the chosen tab into view, not past its start.
    if (el.offsetLeft < r.scrollLeft || el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollTo?.({ left: el.offsetLeft - 24, behavior: "smooth" });
  }, [tab]);
  return (
    <nav aria-label="Flikar" className="-mx-4 px-4 nav:mx-0 nav:px-0">
      <div ref={row} className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-segment p-[3px] [scrollbar-width:none] nav:inline-flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => onTab(t.slug)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] text-ink transition-colors",
              tab === t.id ? "bg-segment-on font-semibold shadow-segment" : "hover:bg-segment-on/50",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** Filters for the transaction list (see TransactionList). */
export interface TxFilters {
  period: string;
  from: string;
  to: string;
  categoryId: string;
  q: string;
}
export type OpenTransactions = (filters: Partial<TxFilters>) => void;

export interface ViewProps {
  from: string;
  to: string;
  period: Period;
  share: Share;
  showPrivate: boolean;
  openTransactions: OpenTransactions;
}

const TABS = [
  { id: "categories", slug: "", label: "Per kategori" },
  { id: "averages", slug: "snitt", label: "Snitt" },
  { id: "food", slug: "mat", label: "Mat" },
  { id: "products", slug: "matvaror", label: "Matvaror" },
  { id: "fixed", slug: "fasta", label: "Fasta mot rörliga" },
  { id: "merchants", slug: "topplista", label: "Topplista" },
  { id: "fuel", slug: "bransle", label: "Bränsle" },
  { id: "savings", slug: "sparande", label: "Sparande" },
  { id: "prices", slug: "priser", label: "Priser" },
  { id: "reference", slug: "konsumentverket", label: "Konsumentverket" },
  { id: "compare", slug: "jamfor", label: "Jämför perioder" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Analys: eleven tabs (in the URL, ?flik=mat), one period for all of them and
 * the app-wide 'Min del | Hushållet' in the header. 'Jämför perioder' has its
 * own two periods, and 'Konsumentverket' its own rolling averages up to a
 * whole month.
 */
export function AnalysisView({ openTransactions }: { openTransactions: OpenTransactions }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  // The Prylar tab is gone: Prylar's calendar shows the same per month and category.
  const oldItemsTab = params.get("flik") === "prylar";
  useEffect(() => {
    if (oldItemsTab) navigate("items", { replace: true, search: "?visa=kalender" });
  }, [oldItemsTab]);
  const tab: TabId = TABS.find((t) => t.slug && t.slug === params.get("flik"))?.id ?? "categories";
  // The period is in the address (?period=6m), so a reload or a link keeps it; without one, the session's.
  const [stored, setStored] = usePersistentState<Period>("analysis.period", DEFAULT_PERIOD);
  const period = periodFromSearch(params) ?? stored;
  const setPeriod = (p: Period) => {
    setStored(p);
    setSearch(periodSearch(p, window.location.search), { replace: true });
  };
  const showTab = (slug: string) => {
    const q = new URLSearchParams(window.location.search);
    if (slug) q.set("flik", slug);
    else q.delete("flik");
    const s = q.toString();
    setSearch(s ? `?${s}` : "");
  };
  const [share, setShare] = useShare();
  const showPrivate = useShowPrivate();
  const { from, to } = periodRange(period);
  const props: ViewProps = { from, to, period, share, showPrivate, openTransactions };
  const usesPeriod = tab !== "compare" && tab !== "reference";

  return (
    <div className="space-y-4">
      {usesPeriod && (
        <HeaderTabs>
          <div className="pt-2">
            <PeriodDates value={period} onChange={setPeriod} />
          </div>
        </HeaderTabs>
      )}
      <HeaderActions>
        {usesPeriod && <PeriodPicker value={period} onChange={setPeriod} />}
        <SegmentedControl label="Vems utgifter" appearance="v2" options={SHARE_OPTIONS} value={share} onChange={setShare} size="sm" />
      </HeaderActions>

      <TabBar tab={tab} onTab={showTab} />


      {tab === "categories" ? (
        <CategoryChart {...props} />
      ) : tab === "averages" ? (
        <Averages {...props} />
      ) : tab === "food" ? (
        <Food {...props} />
      ) : tab === "products" ? (
        <Products {...props} />
      ) : tab === "fixed" ? (
        <FixedVariable {...props} />
      ) : tab === "merchants" ? (
        <Merchants {...props} />
      ) : tab === "fuel" ? (
        <Fuel {...props} />
      ) : tab === "savings" ? (
        <Savings {...props} />
      ) : tab === "prices" ? (
        <Prices {...props} />
      ) : tab === "reference" ? (
        <Reference {...props} />
      ) : (
        <Compare {...props} />
      )}

      {/* Konsumentverket says how it counts in its own notes: it counts what Mio paid, which the rest of Analys does not. Topplista puts it after its own. */}
      {tab !== "reference" && tab !== "merchants" && (
        <p className="text-[11px] text-ink-3" data-testid="share-note">
          {shareNote(share)}
        </p>
      )}
    </div>
  );
}
