import type { Item } from "../../api";
import { formatKr } from "../../lib/format";
import { CategoryPill, ItemNote, itemDate, Thumb } from "./parts";

/**
 * A pryl in the list (Design v2): a 44 px picture, the name with its category
 * and the bank's merchant text under it (and the status or a close deadline),
 * the category as a pill in a column of its own, the date and the price in
 * bold. Narrow: the pill goes (the category is in the line under the name,
 * a missing one in orange), then the date moves first in that line.
 */
export function ItemRow({ item, today, onOpen }: { item: Item; today: string; onOpen: () => void }) {
  const date = itemDate(item.purchaseDate, today);
  return (
    <button type="button" onClick={onOpen} data-item={item.id} className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left text-[13px] text-ink hover:bg-band sm:px-5">
      <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-card-inset">
        <Thumb item={item} size="row" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.name}</span>
        <span className="block truncate text-[12px] text-ink-3">
          <span className="@[28rem]:hidden">{date} · </span>
          {!item.category && <span className="text-caution-text @[36rem]:hidden">utan kategori · </span>}
          {[item.category, item.merchant].filter(Boolean).join(" · ") || "—"}
        </span>
        <ItemNote item={item} today={today} />
      </span>
      <span className="hidden w-32 shrink-0 @[36rem]:block">
        <CategoryPill category={item.category} />
      </span>
      <span className="hidden w-20 shrink-0 text-[12px] text-ink-2 tabular-nums @[28rem]:block">{date}</span>
      <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{formatKr(item.priceOre, { whole: true })}</span>
    </button>
  );
}
