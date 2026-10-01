import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { kronor } from "../../../csv";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { cn } from "../../../lib/cn";
import { useResolvedTheme } from "../../../lib/theme";
import { useLocalStorage } from "../../../lib/useLocalStorage";
import { CsvButton, Money } from "../common";
import { chartColor } from "../categories/colors";
import { barWidths, sortCategories, type CategoryOrder } from "./sort";
import type { AverageCategory, AveragesData } from "./types";

const val = (n: number | null) => (n === null ? <span className="text-ink-3">–</span> : <Money ore={n} />);
const ORDERS: { value: CategoryOrder; label: string }[] = [
  { value: "largest", label: "Störst först" },
  { value: "az", label: "A–Ö" },
];

const head = "whitespace-nowrap py-2 font-normal";
/** Per vecka and the bar's column are left out on a narrow card (a phone); the bar goes under the name there. */
const wide = "hidden @[36rem]:table-cell";
const cell = "whitespace-nowrap py-2 tabular-nums";

/**
 * Snitt › Per kategori (Design v2): the main categories largest first (by
 * the average per month) or A–Ö, remembered in this browser; each with its
 * colour dot and a bar against the largest category's average per month. A
 * main category folds out its subcategories, indented, their bars against
 * the main category. The CSV is the same as before.
 */
export function CategoryAverages({ data }: { data: AveragesData }) {
  const [order, setOrder] = useLocalStorage<CategoryOrder>("analysis.averages.order", "largest", (v) => (v === "largest" || v === "az" ? v : null));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const theme = useResolvedTheme();
  const groups = sortCategories(data.byCategory, order, data.months.count);
  const widths = barWidths(groups, data.months.count);
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const row = (c: AverageCategory, child: boolean, hasChildren: boolean) => {
    const colour = chartColor(c.color, theme);
    const width = widths.get(c.key) ?? 0;
    const name = (
      <>
        <span className="size-2 shrink-0 rounded-full" style={{ background: colour }} aria-hidden data-dot />
        <span className="min-w-0">{c.name}</span>
      </>
    );
    return (
      <tr key={c.key} className={cn("border-b border-hairline", child && "text-ink-2")} data-category={c.key}>
        <td className={cn("py-2 pr-3", child ? "pl-12 sm:pl-[3.25rem]" : "pl-5 sm:pl-6")}>
          {hasChildren ? (
            <button type="button" onClick={() => toggle(c.key)} aria-expanded={open.has(c.key)} className="-ml-1 flex items-center gap-2 text-left hover:underline">
              <ChevronRight className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", open.has(c.key) && "rotate-90")} aria-hidden />
              {name}
            </button>
          ) : (
            <span className={cn("flex items-center gap-2", !child && "pl-[1.125rem]")}>{name}</span>
          )}
          {/* Under the name, where the text starts (past the chevron and the dot). */}
          <span className={cn("mt-1.5 block h-1.5 rounded-full bg-track @[36rem]:hidden", child ? "ml-4" : "ml-[2.125rem]")} aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${width * 100}%`, background: colour }} />
          </span>
        </td>
        <td className={cn(wide, "px-3 py-2")}>
          <span className="block h-1.5 rounded-full bg-track">
            <span className="block h-full rounded-full" style={{ width: `${width * 100}%`, background: colour }} data-bar={width} />
          </span>
        </td>
        <td className={cn(cell, "px-3 text-right text-ink-2")}>
          <Money ore={c.total} />
        </td>
        <td className={cn(cell, wide, "px-3 text-right text-ink-2")}>{val(c.perWeek)}</td>
        <td className={cn(cell, "pl-3 pr-5 text-right sm:pr-6", child ? "font-medium" : "font-semibold")}>{val(c.perMonth)}</td>
      </tr>
    );
  };

  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="average-categories-title">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pb-2 pt-4 sm:px-6">
        <div>
          <h2 id="average-categories-title" className="text-[15px] font-semibold">
            Per kategori
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">klicka på en huvudkategori för underkategorierna</p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedControl label="Ordning" appearance="v2" size="sm" options={ORDERS} value={order} onChange={setOrder} />
          <CsvButton
            filename="snitt-per-kategori"
            header={["Kategori", "Underkategori", "Summa", "Snitt per vecka", "Snitt per månad"]}
            rows={() =>
              data.byCategory.map((c) => {
                const parent = c.parentKey ? data.byCategory.find((p) => p.key === c.parentKey)?.name ?? "" : c.name;
                return [parent, c.parentKey ? c.name : "", kronor(c.total), kronor(c.perWeek), kronor(c.perMonth)];
              })
            }
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" aria-label="Per kategori">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className={cn(head, "pl-5 pr-3 text-left sm:pl-6")}>Kategori</th>
              <th className={cn(head, wide, "w-[40%] px-3 text-left")}>{data.months.count ? "Snitt per månad, relativt största" : "Summa, relativt största"}</th>
              <th className={cn(head, "px-3 text-right")}>Summa</th>
              <th className={cn(head, wide, "px-3 text-right")}>Per vecka</th>
              <th className={cn(head, "pl-3 pr-5 text-right sm:pr-6")}>Per månad</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(({ main, children }) => [row(main, false, children.length > 0), ...(open.has(main.key) ? children.map((c) => row(c, true, false)) : [])])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
