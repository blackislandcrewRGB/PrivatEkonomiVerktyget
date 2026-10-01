import type { Item } from "../../api";
import { formatKr } from "../../lib/format";
import { CategoryPill, ItemNote, itemDate, Thumb } from "./parts";

/**
 * A pryl in the gallery (Design v2): the picture on a light 200 px plate
 * (dark grey in the dark theme), name and price in bold on one line, date
 * and merchant under it with the category as a pill, and the status or a
 * deadline that is close when there is one. The card lifts a little on hover.
 */
export function ItemCard({ item, today, onOpen }: { item: Item; today: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-item={item.id}
      className="flex w-full flex-col overflow-hidden rounded-card bg-card text-left text-ink shadow-card transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.05),0_10px_28px_rgba(0,0,0,0.09)] focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="flex h-[200px] w-full items-center justify-center overflow-hidden bg-card-inset">
        <Thumb item={item} size="card" />
      </span>
      <span className="flex min-w-0 flex-col gap-1.5 px-4 pb-3.5 pt-3">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[14px] font-semibold">{item.name}</span>
          <span className="shrink-0 text-[14px] font-semibold tabular-nums">{formatKr(item.priceOre, { whole: true })}</span>
        </span>
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-[12px] text-ink-3">{[itemDate(item.purchaseDate, today), item.merchantName].filter(Boolean).join(" · ")}</span>
          <CategoryPill category={item.category} className="shrink-0" />
        </span>
        <ItemNote item={item} today={today} />
      </span>
    </button>
  );
}
