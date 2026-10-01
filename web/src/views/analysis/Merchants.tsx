import { useMemo, useState } from "react";
import { kronor } from "../../csv";
import { useLocalStorage } from "../../lib/useLocalStorage";
import { setSearch, useSearch } from "../../shell/routes";
import { CsvButton, kr, query, shareNote, useAnalysis } from "./common";
import type { ViewProps } from "./AnalysisView";
import { TopThree } from "./merchants/TopThree";
import { FIRST, MORE, MerchantTable } from "./merchants/MerchantTable";
import { Toolbar } from "./merchants/Toolbar";
import { fromSearch, inCategory, matches, merchants, sortMerchants, toSearch, type Choices } from "./merchants/list";
import type { Merchant, MerchantData } from "./merchants/types";

/**
 * Topplista (Design v2): the top three as cards, and every merchant with its
 * purchases, sum and average per purchase – searched, ordered and filtered by
 * category in the toolbar (and the address), merged per name or per bank text.
 */
export function Merchants({ from, to, share, showPrivate, openTransactions }: ViewProps) {
  const { data, error } = useAnalysis<MerchantData>(`merchants?${query({ from, to, share, showPrivate })}`);
  const choices = fromSearch(new URLSearchParams(useSearch()));
  const setChoices = (c: Choices) => setSearch(toSearch(window.location.search, c), { replace: true });
  const [merge, setMerge] = useLocalStorage("analysis.merchants.merge", true, (v) => (typeof v === "boolean" ? v : null));
  const [shown, setShown] = useState(FIRST);
  // A new search, order, category or merging starts from the first rows again.
  const listKey = `${choices.q}|${choices.sort}|${choices.category}|${merge}|${from}|${to}|${share}`;
  const [shownFor, setShownFor] = useState(listKey);
  if (shownFor !== listKey) {
    setShownFor(listKey);
    setShown(FIRST);
  }
  // The order and the category decide the places; the search only narrows the list.
  const ranked = useMemo(
    () => (data ? sortMerchants(merchants(data.pieces.filter((p) => inCategory(p, choices.category, data.categories)), merge), choices.sort) : []),
    [data, choices.category, choices.sort, merge],
  );
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;
  // The largest merged rows, as examples in the note.
  const merged = ranked
    .filter((m) => m.texts.length > 1)
    .slice(0, 3)
    .map((m) => m.label ?? m.name);
  const found = ranked.map((m, i) => ({ m, place: i + 1 })).filter(({ m }) => matches(m, choices.q));

  const openMerchant = (m: Merchant) => openTransactions({ period: "custom", from, to, q: m.key });

  return (
    <div className="@container space-y-4">
      <TopThree merchants={ranked} onOpen={openMerchant} />
      <section className="space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="merchants-title" data-card="merchants">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="merchants-title" className="text-[15px] font-semibold">
              Topplista handlare <span className="text-[12px] font-normal text-ink-3">· {ranked.length} handlare</span>
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-3">köp, inte återbetalningar · klicka på en rad för transaktionerna</p>
          </div>
          <CsvButton
            filename="topplista-handlare"
            header={["Plats", "Handlare", "Etikett", "Antal köp", "Summa", "Snitt per köp"]}
            rows={() => found.map(({ m, place }) => [place, m.name, m.label ?? "", m.count, kronor(m.total), kronor(m.avg)])}
          />
        </div>
        <Toolbar choices={choices} onChoices={setChoices} categories={data.categories} merge={merge} onMerge={setMerge} />
        <MerchantTable rows={found} first={ranked[0]} shown={shown} sort={choices.sort} categories={data.categories} onOpen={openMerchant} onMore={() => setShown(shown + MORE)} />
        {found.length === 0 && <p className="text-[13px] text-ink-3">Inga handlare {choices.q ? `som matchar ”${choices.q}”` : "i perioden"}.</p>}
        {data.private.count > 0 && (
          <p className="text-xs text-ink-2">
            {data.private.count} privata köp ({kr(data.private.total)}) ingår inte i listan. Visa privata (⌘K) tar med dem.
          </p>
        )}
      </section>
      <p className="text-[11px] text-ink-3" data-testid="share-note">
        {merge
          ? `”Slå ihop” använder namnreglerna: rader med samma namn räknas som en handlare${merged.length > 0 ? ` (${merged.join(", ")})` : ""}.`
          : "”Slå ihop” är av: varje text från banken är en egen handlare."}{" "}
        {shareNote(share)}
      </p>
    </div>
  );
}
