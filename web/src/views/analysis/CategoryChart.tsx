import { useState } from "react";
import { navigate } from "../../shell/routes";
import { monthsBetween, query, useAnalysis } from "./common";
import type { ViewProps } from "./AnalysisView";
import { keyFigures } from "./categories/figures";
import { CategoryBars } from "./categories/CategoryBars";
import { CategoryTable } from "./categories/CategoryTable";
import { KeyFigures } from "./categories/KeyFigures";
import type { CategoryData as Data, Series } from "./categories/types";

/** 'Totalt 12 mån', 'Totalt i år', 'Totalt perioden'. */
const PERIOD_LABEL = { "3m": "3 mån", "6m": "6 mån", "12m": "12 mån", ytd: "i år", custom: "perioden" } as const;

/** The main category whose drill-down links to Prylar: its subcategories are what the things are bought in. */
const ITEMS_CATEGORY = "Prylar & hem";

/**
 * Analys › Per kategori (Design v2): the key figures, the chart card
 * (Staplar/Andelar, the legend drilling into subcategories) and the table
 * card, all from one dataset. A bar or a table cell opens the transactions
 * of that month and category. Drilled into Prylar & hem, the legend offers
 * 'Visa prylarna ›', to the things themselves.
 */
export function CategoryChart({ from, to, period, share, openTransactions }: ViewProps) {
  const [parent, setParent] = useState<number | null>(null);
  const months = Math.min(36, monthsBetween(from, to));
  const { data, error } = useAnalysis<Data>(`categories?${query({ months, to: period.preset === "custom" ? to : null, share, parent })}`);
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;

  const open = (s: Series, month: string) => openTransactions({ period: month, categoryId: s.categoryId === null ? "none" : String(s.categoryId) });

  return (
    <div className="@container space-y-4">
      <KeyFigures f={keyFigures(data, to)} periodLabel={PERIOD_LABEL[period.preset]} share={share} to={to} />
      <CategoryBars
        data={data}
        title={data.parent ? `${data.parent.name}: underkategorier per månad` : "Utgifter per huvudkategori och månad"}
        subtitle={data.parent ? "klicka på en stapel för transaktionerna" : "klicka på en kategori för underkategorierna, eller på en stapel för transaktionerna"}
        clickable
        onOpen={open}
        onDrill={setParent}
        legendEnd={
          data.parent?.name === ITEMS_CATEGORY && (
            <button type="button" onClick={() => navigate("items")} className="inline-flex h-7 items-center px-2 text-[12px] font-medium text-accent hover:underline">
              Visa prylarna ›
            </button>
          )
        }
      />

      <CategoryTable data={data} to={to} clickable onOpen={open} csvName={`kategorier-per-manad${data.parent ? `-${data.parent.name}` : ""}`} />
    </div>
  );
}
