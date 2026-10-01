import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useCategories } from "../../../categories";
import { kronor, percent } from "../../../csv";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { cn } from "../../../lib/cn";
import { categoryColor } from "../../../lib/palette";
import { useResolvedTheme } from "../../../lib/theme";
import { useLocalStorage } from "../../../lib/useLocalStorage";
import { CsvButton, Money } from "../common";
import { chartColor } from "../categories/colors";
import { DELTA, compareGroups, deltaTone, signedKr, signedPct, type CompareData, type CompareOrder, type Line } from "./delta";

/** Δ as a pill: kronor and per cent (none when B is 0), orange more in A, green less, grey the same. */
function DeltaPill({ l }: { l: Line }) {
  const tone = deltaTone(l.diff);
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums @[40rem]:px-2 @[40rem]:text-[12px]", DELTA[tone].pill)} data-tone={tone} data-diff={l.diff}>
      {signedKr(l.diff)}
      {/* On a phone the per cent is left out; the kronor say it. */}
      {tone !== "even" && l.pct !== null && <span className="hidden @[40rem]:inline"> · {signedPct(l.pct)}</span>}
    </span>
  );
}

/** A over B as two 6 px bars against the largest value in the table. */
function Bars({ l, max }: { l: Line; max: number }) {
  const w = (v: number) => `${max > 0 ? (Math.max(0, v) / max) * 100 : 0}%`;
  return (
    <span className="block space-y-0.5" aria-hidden>
      <span className="block h-1.5 rounded-full bg-track">
        <span className="block h-full rounded-full bg-accent" style={{ width: w(l.a) }} data-bar-a={Math.max(0, l.a) / (max || 1)} />
      </span>
      <span className="block h-1.5 rounded-full bg-track">
        <span className="block h-full rounded-full bg-ink-2" style={{ width: w(l.b) }} data-bar-b={Math.max(0, l.b) / (max || 1)} />
      </span>
    </span>
  );
}

const cell = "whitespace-nowrap px-1.5 py-2 text-right tabular-nums @[40rem]:px-3";
/** The bars are left out on a narrow card (a phone). */
const wide = "hidden @[40rem]:table-cell";

/**
 * Jämför perioder › Per kategori (Design v2): a row per main category with
 * its colour, A over B as bars, A, B and Δ as a pill; largest difference
 * first or the categories' order (remembered in this browser). A main
 * category folds out its subcategories in the same form. Rows where both are
 * 0 are left out. Totalt in a grey row with Δ in colour. The CSV is as before.
 */
export function CompareTable({ data, aLabel, bLabel, aShort, bShort }: { data: CompareData; aLabel: string; bLabel: string; aShort: string; bShort: string }) {
  const [order, setOrder] = useLocalStorage<CompareOrder>("analysis.compare.order", "diff", (v) => (v === "diff" || v === "category" ? v : null));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const categories = useCategories();
  const theme = useResolvedTheme();
  const groups = compareGroups(data.rows, order);
  const max = Math.max(0, data.total.a, data.total.b, ...data.rows.flatMap((l) => [l.a, l.b]));
  const colourOf = (l: Line) => {
    if (l.key === "unknown") return chartColor("#71717a", theme);
    if (l.categoryId === null) return chartColor("#d4d4d8", theme);
    return chartColor(categoryColor(categories.find((c) => c.id === l.categoryId), categories), theme);
  };
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const row = (l: Line, child: boolean, hasChildren: boolean) => (
    <tr key={l.key} className={cn("border-b border-hairline", child && "text-ink-2")} data-row={l.key}>
      <td className={cn("py-2 pr-1.5 @[40rem]:pr-3", child ? "pl-9 @[40rem]:pl-[3.25rem]" : "pl-4 @[40rem]:pl-6")}>
        <span className="flex min-w-0 items-center gap-1.5 @[40rem]:gap-2">
          {hasChildren ? (
            <button type="button" onClick={() => toggle(l.key)} aria-expanded={open.has(l.key)} aria-label={`${l.name}, underkategorier`} className="-ml-1 grid size-4 shrink-0 place-items-center">
              <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform", open.has(l.key) && "rotate-90")} aria-hidden />
            </button>
          ) : (
            !child && <span className="w-3 shrink-0" />
          )}
          <span className="size-2 shrink-0 rounded-full" style={{ background: colourOf(l) }} aria-hidden />
          <span className={cn("min-w-0 max-w-[4.5rem] truncate @[40rem]:max-w-none", !child && "font-medium")} title={l.name}>
            {l.name}
          </span>
        </span>
      </td>
      <td className={cn(wide, "w-[38%] px-3 py-2")}>
        <Bars l={l} max={max} />
      </td>
      <td className={cell}>
        <Money ore={l.a} />
      </td>
      <td className={cell}>
        <Money ore={l.b} />
      </td>
      <td className="whitespace-nowrap py-1.5 pl-1.5 pr-4 text-right @[40rem]:pl-3 @[40rem]:pr-6">
        <DeltaPill l={l} />
      </td>
    </tr>
  );

  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="compare-table-title" data-card="table">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-5 pb-2 pt-4 sm:px-6">
        <div className="min-w-0">
          <h2 id="compare-table-title" className="text-[15px] font-semibold">
            Per kategori
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">A = blå, B = grå · Δ = A − B · klicka på en huvudkategori för underkategorierna</p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedControl<CompareOrder>
            label="Ordning"
            appearance="v2"
            size="sm"
            options={[
              { value: "diff", label: "Störst skillnad" },
              { value: "category", label: "Kategoriordning" },
            ]}
            value={order}
            onChange={setOrder}
          />
          <CsvButton
            filename={`jamfor-${aLabel}-mot-${bLabel}`.replace(/\s+/g, "-")}
            header={["Kategori", "Underkategori", `A ${aLabel}`, `B ${bLabel}`, "Differens", "Differens %"]}
            rows={() => [
              ...data.rows.map((l) => {
                const parent = l.parentKey ? (data.rows.find((p) => p.key === l.parentKey)?.name ?? "") : l.name;
                return [parent, l.parentKey ? l.name : "", kronor(l.a), kronor(l.b), kronor(l.diff), percent(l.pct)];
              }),
              ["Totalt", "", kronor(data.total.a), kronor(data.total.b), kronor(data.total.diff), percent(data.total.pct)],
            ]}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] @[40rem]:text-[13px]" aria-label="Per kategori">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="py-2 pl-4 pr-1.5 text-left font-normal @[40rem]:pl-6 @[40rem]:pr-3">Kategori</th>
              <th className={cn(wide, "px-3 py-2 text-left font-normal")}>A mot B</th>
              <th className="px-1.5 py-2 text-right font-normal @[40rem]:px-3">A · {aShort}</th>
              <th className="px-1.5 py-2 text-right font-normal @[40rem]:px-3">B · {bShort}</th>
              <th className="py-2 pl-1.5 pr-4 text-right font-normal @[40rem]:pl-3 @[40rem]:pr-6">Δ</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ main, children }) => (
              <Fragment key={main.key}>
                {row(main, false, children.length > 0)}
                {open.has(main.key) && children.map((c) => row(c, true, false))}
              </Fragment>
            ))}
            <tr className="border-t border-hairline bg-band font-semibold" data-row="total">
              <td className="py-2.5 pl-4 pr-1.5 @[40rem]:pl-6 @[40rem]:pr-3">
                <span className="flex items-center gap-2">
                  <span className="w-3 shrink-0" />
                  <span className="size-2 shrink-0 rounded-full bg-ink" aria-hidden />
                  Totalt
                </span>
              </td>
              <td className={cn(wide, "px-3 py-2")}>
                <Bars l={data.total} max={max} />
              </td>
              <td className={cell}>
                <Money ore={data.total.a} />
              </td>
              <td className={cell}>
                <Money ore={data.total.b} />
              </td>
              <td className="whitespace-nowrap py-1.5 pl-1.5 pr-4 text-right @[40rem]:pl-3 @[40rem]:pr-6">
                <DeltaPill l={data.total} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
