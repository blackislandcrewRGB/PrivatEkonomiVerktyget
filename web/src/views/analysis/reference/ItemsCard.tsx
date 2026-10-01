import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ReferenceComparison, ReferenceDiff, ReferenceItem } from "../../../api";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { cn } from "../../../lib/cn";
import { useLocalStorage } from "../../../lib/useLocalStorage";
import { CsvButton, kr, monthLabel } from "../common";
import { baseText, money, signedKr, signedPct } from "./format";
import { TONE, refTone } from "./tone";

export type ItemOrder = "deviation" | "reference";
type Row = Pick<ReferenceItem, "reference12Ore" | "reference3Ore" | "actual12Ore" | "actual3Ore" | "diff12" | "diff3">;

/** The rows by the largest difference in kronor either way first, or as Konsumentverket lists them. */
export function orderItems(items: ReferenceItem[], order: ItemOrder): ReferenceItem[] {
  if (order === "reference") return items;
  return [...items].sort((a, b) => Math.abs(b.diff12.ore ?? 0) - Math.abs(a.diff12.ore ?? 0));
}

/**
 * Where an item's money comes from, compactly: subcategories under their
 * main category ("Nöje › Film, Musik, Spel, Streaming"); a main category on
 * its own when only it counts. Other sources (a fixed expense) as they are.
 */
export function sourceText(sources: string[]): string {
  const groups = new Map<string, string[]>();
  for (const s of sources) {
    const [parent, child] = s.split(" › ");
    const list = groups.get(parent) ?? [];
    if (child) list.push(child);
    groups.set(parent, list);
  }
  return [...groups].map(([parent, children]) => (children.length ? `${parent} › ${children.join(", ")}` : parent)).join(", ");
}

/** The bar's scale for a row: the larger of the reference and the average, with a little room. */
export const barScale = (r: Pick<Row, "reference12Ore" | "actual12Ore">) => Math.max(r.reference12Ore, r.actual12Ore ?? 0) * 1.15;

/**
 * A row against its reference: an 8 px bar for the 12-month average (green
 * under, orange over, grey on it) and a black 2 px mark at the reference, on
 * the row's own scale.
 */
function RefBar({ row }: { row: Row }) {
  const scale = barScale(row);
  if (scale <= 0) return <span className="block h-2 rounded-full bg-track" />;
  const tone = refTone(row.diff12);
  const fill = Math.max(0, row.actual12Ore ?? 0) / scale;
  const mark = row.reference12Ore / scale;
  return (
    <span className="relative block h-2 rounded-full bg-track" aria-hidden>
      <span className={cn("block h-full rounded-full", TONE[tone].bar)} style={{ width: `${fill * 100}%` }} data-fill={fill} data-tone={tone} />
      <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `calc(${mark * 100}% - 1px)` }} data-mark={mark} />
    </span>
  );
}

function Pill({ d }: { d: ReferenceDiff }) {
  if (d.ore === null) return <span className="text-ink-3">–</span>;
  const tone = refTone(d);
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums", TONE[tone].pill)} data-tone={tone}>
      {d.pct === null ? signedKr(d.ore) : signedPct(d.pct)}
    </span>
  );
}

/** The total's difference as coloured text: '+1 831 kr · +27,8 %'. */
function TotalDiff({ d }: { d: ReferenceDiff }) {
  if (d.ore === null) return <span className="text-ink-3">–</span>;
  return (
    <span className={cn("tabular-nums", TONE[refTone(d)].text)} data-tone={refTone(d)}>
      {/* On a narrow card only the per cent fits. */}
      <span className={cn(d.pct !== null && "hidden @[56rem]:inline")}>{signedKr(d.ore)}</span>
      {d.pct !== null && (
        <>
          <span className="hidden @[56rem]:inline"> · </span>
          {signedPct(d.pct)}
        </>
      )}
    </span>
  );
}

const cell = "whitespace-nowrap px-3 py-2.5 text-right tabular-nums";
/** The three months are left out under 44 rem; a row folds them out there. The reference too on a phone. */
const wide = "hidden @[44rem]:table-cell";
const mid = "hidden @[36rem]:table-cell";

/**
 * Per post (Design v2): each item with where its money comes from and how
 * its reference is set, a bar against the reference, the reference, the 12-
 * and 3-month averages and their differences as pills. Largest difference
 * first, or Konsumentverket's order (remembered in this browser). An item
 * with no category counted to it says so, with 'Koppla kategori ›' to the
 * mapping. Mat, förbrukningsvaror och hygien together in a grey row before
 * the total.
 */
export function ItemsCard({ c, onMap }: { c: ReferenceComparison; onMap: (item: ReferenceItem) => void }) {
  const [order, setOrder] = useLocalStorage<ItemOrder>("reference.order", "deviation", (v) => (v === "deviation" || v === "reference" ? v : null));
  // Under 44 rem a row folds out its reference and three months.
  const [open, setOpen] = useState<string | null>(null);
  const detail = (key: string, r: Row) =>
    open === key && (
      <tr className="border-b border-hairline bg-band @[44rem]:hidden" data-detail={key}>
        <td colSpan={7} className="px-5 py-2 text-[12px] text-ink-2 sm:px-6">
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
            <span className="@[36rem]:hidden">Referens {kr(r.reference12Ore)}</span>
            <span>
              Snitt 3 mån <b className="font-semibold text-ink">{money(r.actual3Ore)}</b>
              {r.reference3Ore !== r.reference12Ore && ` mot ${kr(r.reference3Ore)}`}
            </span>
            <Pill d={r.diff3} />
          </span>
        </td>
      </tr>
    );
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));
  const shown = orderItems(
    c.items.filter((i) => !i.excluded),
    order,
  );

  const figures = (r: Row, strong = false, total = false): ReactNode => (
    <>
      <td className={cn(cell, mid, "text-ink-2")}>{kr(r.reference12Ore)}</td>
      <td className={cn(cell, "font-semibold", strong && "text-ink")}>{money(r.actual12Ore)}</td>
      <td className={cn(cell, "pr-5 sm:pr-6 @[44rem]:pr-3")}>{total ? <TotalDiff d={r.diff12} /> : <Pill d={r.diff12} />}</td>
      <td className={cn(cell, wide, "text-ink-2")}>
        {money(r.actual3Ore)}
        {/* With KPI the three months have a reference of their own: the one their difference is against. */}
        {r.reference3Ore !== r.reference12Ore && <span className="block text-[11px] text-ink-3">mot {kr(r.reference3Ore)}</span>}
      </td>
      <td className={cn(cell, wide, "pr-5 sm:pr-6")}>{total ? <TotalDiff d={r.diff3} /> : <Pill d={r.diff3} />}</td>
    </>
  );

  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="reference-items-title" data-card="items">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-5 pb-2 pt-4 sm:px-6">
        <div className="min-w-0">
          <h2 id="reference-items-title" className="text-[15px] font-semibold">
            Per post
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">kronor per månad · stapeln är ditt 12-månaderssnitt, strecket referensen · grönt under, orange över</p>
        </div>
        <div className="flex items-center gap-3">
          <SegmentedControl<ItemOrder>
            label="Ordning"
            appearance="v2"
            size="sm"
            options={[
              { value: "deviation", label: "Avvikelse" },
              { value: "reference", label: "Konsumentverkets ordning" },
            ]}
            value={order}
            onChange={setOrder}
          />
          <CsvButton
            filename={`konsumentverket-${c.months12.to}-${c.share === "mine" ? "min-del" : "hushallet"}.csv`}
            header={["Post", c.kpi.on ? "Referens KPI-justerad 12 mån" : "Referens", "Snitt 12 mån", "Skillnad 12 mån", "Snitt 3 mån", "Skillnad 3 mån"]}
            rows={() =>
              [...c.items.filter((i) => !i.excluded), { ...c.groceries, name: "Mat, förbrukningsvaror och hygien" }, { ...c.total, name: "Totalt" }].map((i) => [
                i.name,
                i.reference12Ore / 100,
                i.actual12Ore === null ? null : i.actual12Ore / 100,
                i.diff12.ore === null ? null : i.diff12.ore / 100,
                i.actual3Ore === null ? null : i.actual3Ore / 100,
                i.diff3.ore === null ? null : i.diff3.ore / 100,
              ])
            }
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" aria-label="Per post">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="py-2 pl-5 pr-3 text-left font-normal sm:pl-6">Post</th>
              <th className="hidden w-[24%] px-3 py-2 text-left font-normal @[36rem]:table-cell">Mot referensen</th>
              <th className={cn(mid, "px-3 py-2 text-right font-normal")}>{c.kpi.on ? "Referens, KPI" : "Referens"}</th>
              <th className="px-3 py-2 text-right font-normal">Snitt 12 mån</th>
              <th className="py-2 pl-3 pr-5 text-right font-normal sm:pr-6 @[44rem]:pr-3">Skillnad</th>
              <th className={cn(wide, "px-3 py-2 text-right font-normal")}>Snitt 3 mån</th>
              <th className={cn(wide, "py-2 pl-3 pr-5 text-right font-normal sm:pr-6")}>Skillnad</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <Fragment key={i.target}>
                <tr className="border-b border-hairline align-middle" data-item={i.target}>
                  <td className="min-w-36 max-w-80 py-2.5 pl-5 pr-3 sm:pl-6 @[36rem]:min-w-44 @[56rem]:min-w-64">
                    <button
                      type="button"
                      onClick={() => toggle(i.target)}
                      aria-expanded={open === i.target}
                      className="flex items-center gap-1 text-left font-semibold @[44rem]:pointer-events-none"
                    >
                      {i.name}
                      <ChevronDown className={cn("size-3.5 shrink-0 text-ink-3 transition-transform @[44rem]:hidden", open === i.target && "rotate-180")} aria-hidden />
                    </button>
                    <span className="block text-[11px] leading-snug text-ink-3">
                      {i.sources.length ? sourceText(i.sources) : "ingen kategori kopplad, faktiskt = 0"} · referens: {i.basis}
                    </span>
                    {i.kpiAdjustment && (
                      <span className="block text-[11px] text-ink-3">
                        KPI {i.kpiAdjustment.name.toLowerCase()} {signedPct(i.kpiAdjustment.changePct)} mot {baseText(i.kpiAdjustment.base)}
                        {i.kpiAdjustment.month !== c.months12.to && ` (senast ${monthLabel(i.kpiAdjustment.month, true)})`}
                      </span>
                    )}
                    {i.sources.length === 0 && (
                      <button type="button" onClick={() => onMap(i)} className="mt-0.5 text-[11px] font-medium text-accent hover:underline" data-map={i.target}>
                        Koppla kategori ›
                      </button>
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 @[36rem]:table-cell">
                    <RefBar row={i} />
                  </td>
                  {figures(i)}
                </tr>
                {detail(i.target, i)}
              </Fragment>
            ))}
            <tr className="border-b border-hairline bg-band align-middle" data-item="groceries">
              <td className="py-2.5 pl-5 pr-3 sm:pl-6">
                <span className="block font-semibold">Mat, förbrukningsvaror och hygien</span>
                <span className="block text-[11px] leading-snug text-ink-3">
                  tillsammans, eftersom toalettpapper, diskmedel och tandkräm från matbutiken ligger under Livsmedel
                </span>
              </td>
              <td className="hidden px-3 py-2.5 @[36rem]:table-cell">
                <RefBar row={c.groceries} />
              </td>
              {figures(c.groceries)}
            </tr>
            <tr className="border-t border-ink font-semibold" data-item="total">
              <td className="py-2.5 pl-5 pr-3 sm:pl-6">Totalt, de poster som gäller er</td>
              <td className="hidden @[36rem]:table-cell" />
              {figures(c.total, true, true)}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
