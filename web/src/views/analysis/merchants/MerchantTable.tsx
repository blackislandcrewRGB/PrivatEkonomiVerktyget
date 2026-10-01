import { ChevronRight } from "lucide-react";
import { MerchantIcon } from "../../../components/MerchantIcon";
import { cn } from "../../../lib/cn";
import { wholeKr } from "../common";
import type { Sort } from "./list";
import { MerchantName } from "./MerchantName";
import type { Merchant, MerchantCategory } from "./types";

export const FIRST = 15;
export const MORE = 25;

/** What the order is by, which the bar shows. A single purchase has no average worth a bar. */
function measure(m: Merchant, sort: Sort): number | null {
  return sort === "summa" ? m.total : sort === "antal" ? m.count : m.count >= 2 ? m.avg : null;
}

const th = "whitespace-nowrap px-2 pb-2 text-left text-[11px] font-normal text-ink-3";
const td = "whitespace-nowrap px-2 py-2 tabular-nums";

/**
 * Topplista's rows (Design v2): the place and a 32 px logo, the name (500)
 * with the category and the bank's texts or towns under, a 6 px bar against
 * number one – black for it, blue for the rest – the purchases, the sum in
 * bold and the average per purchase. A row opens its transactions. On a
 * phone the bar and the average give way.
 */
export function MerchantTable({
  rows,
  first,
  shown,
  sort,
  categories,
  onOpen,
  onMore,
}: {
  rows: { m: Merchant; place: number }[];
  /** Number one in the list, whatever the search leaves. */
  first: Merchant | undefined;
  shown: number;
  sort: Sort;
  categories: MerchantCategory[];
  onOpen: (m: Merchant) => void;
  onMore: () => void;
}) {
  const top = first ? measure(first, sort) : null;
  const left = rows.length - shown;
  return (
    <>
      <div className="-mx-5 overflow-x-auto sm:-mx-6">
        <table className="w-full text-[13px]" aria-label="Topplista handlare">
          <thead className="border-b border-hairline">
            <tr>
              <th className={cn(th, "w-8 pl-5 sm:pl-6 @[40rem]:w-10")}>#</th>
              <th className={cn(th, "w-10 @[40rem]:w-12")}>
                <span className="sr-only">Logotyp</span>
              </th>
              <th className={th}>Handlare</th>
              <th className={cn(th, "hidden @[40rem]:table-cell")}>Andel av 1:an</th>
              <th className={cn(th, "text-right")}>Köp</th>
              <th className={cn(th, "pr-5 text-right sm:pr-6 @[40rem]:pr-2")}>Summa</th>
              <th className={cn(th, "hidden pr-5 text-right sm:pr-6 @[40rem]:table-cell")}>Snitt/köp</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ m, place }) => {
              const value = measure(m, sort);
              const share = top && value !== null ? Math.min(1, value / top) : null;
              return (
                <tr key={m.key} onClick={() => onOpen(m)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-band" data-place={place} data-total={m.total}>
                  <td className={cn(td, "pl-5 text-ink-3 sm:pl-6")}>{place}</td>
                  <td className={td}>
                    <MerchantIcon decorative label={m.label} contact={m.contactName} text={m.texts[0]} icon={m.icon} size={32} shape="square" className="rounded-[9px]" />
                  </td>
                  {/* max-w-0 with w-full: the name takes the room left and shortens itself. */}
                  <td className={cn(td, "w-full max-w-0 whitespace-normal")}>
                    <button type="button" onClick={(e) => (e.stopPropagation(), onOpen(m))} className="block w-full min-w-0 text-left" title="Visa transaktionerna">
                      <MerchantName m={m} categories={categories} />
                    </button>
                  </td>
                  <td className={cn(td, "hidden @[40rem]:table-cell")}>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-track @[52rem]:w-40 @[64rem]:w-52" data-bar={share ?? "none"}>
                      {share !== null && <div className={cn("h-full rounded-full", place === 1 ? "bg-ink" : "bg-accent")} style={{ width: `${share * 100}%` }} />}
                    </div>
                  </td>
                  <td className={cn(td, "text-right text-ink-2")}>{m.count}</td>
                  <td className={cn(td, "pr-5 text-right font-bold sm:pr-6 @[40rem]:pr-2")}>{wholeKr(m.total)}</td>
                  <td className={cn(td, "hidden pr-5 text-right text-ink-2 sm:pr-6 @[40rem]:table-cell")}>{wholeKr(m.avg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {left > 0 && (
        <div className="-mx-5 -mb-1 border-t border-hairline pt-3 text-center sm:-mx-6">
          <button type="button" onClick={onMore} className="inline-flex items-center gap-0.5 text-[13px] font-medium text-accent hover:underline">
            Visa fler · {left} kvar <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </>
  );
}
