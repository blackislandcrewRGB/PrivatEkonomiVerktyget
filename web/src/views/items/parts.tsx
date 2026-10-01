import { useState } from "react";
import { Package } from "lucide-react";
import { shortDate, type Item } from "../../api";
import { MerchantIcon } from "../../components/MerchantIcon";
import { cn } from "../../lib/cn";
import { daysUntil, STATUS_LABELS } from "./ItemPanel";

/** '19/9', with the year when it isn't this year's ('20/11 2025'). */
export const itemDate = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4) ? shortDate(iso) : `${shortDate(iso)} ${iso.slice(0, 4)}`);

/** The category as a grey pill; none is an orange 'utan kategori'. */
export function CategoryPill({ category, className }: { category: string | null; className?: string }) {
  return (
    <span
      data-category-pill={category ? "set" : "missing"}
      className={cn(
        "inline-block max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        category ? "bg-card-inset text-ink-2" : "bg-caution-soft text-caution-text",
        className,
      )}
    >
      {category ?? "utan kategori"}
    </span>
  );
}

/** The warranty or the right to return, when either is close enough to matter; null otherwise. */
export function deadline(item: Item, today: string): string | null {
  const returnLeft = item.returnDeadline ? daysUntil(item.returnDeadline, today) : null;
  if (returnLeft !== null && returnLeft >= 0 && returnLeft <= 14) return `Ångerrätt ${returnLeft === 0 ? "sista dagen" : `${returnLeft} d kvar`}`;
  const warrantyLeft = item.warrantyEndsOn ? daysUntil(item.warrantyEndsOn, today) : null;
  if (warrantyLeft !== null && warrantyLeft >= 0 && warrantyLeft <= 30) return `Garanti ${warrantyLeft} d kvar`;
  return null;
}

/** The status when it isn't 'owned', and a deadline that is close, in one short line; null when neither. */
export function ItemNote({ item, today, className }: { item: Item; today: string; className?: string }) {
  const due = deadline(item, today);
  if (item.status === "owned" && !due) return null;
  return (
    <span className={cn("flex flex-wrap gap-x-2 text-[11px]", className)}>
      {item.status !== "owned" && <span className="text-ink-2">{STATUS_LABELS[item.status]}</span>}
      {due && <span className="text-alarm">{due}</span>}
    </span>
  );
}

/**
 * The pryl's picture, else the merchant's icon, else a box. The card shows the
 * whole picture (a wide product shot would lose its top and bottom to a crop);
 * the little one in the list fills its square. A picture that doesn't load
 * falls back to the icon rather than a broken image.
 */
export function Thumb({ item, size }: { item: Item; size: "card" | "row" }) {
  const [failed, setFailed] = useState(false);
  if (item.cover && !failed) {
    return <img src={item.cover} alt="" onError={() => setFailed(true)} className={cn(size === "card" ? "size-full object-contain p-5" : "size-full object-cover")} />;
  }
  if (item.icon) return <MerchantIcon decorative text={item.merchant ?? item.name} icon={item.icon} size={size === "card" ? 40 : 26} />;
  return <Package className={cn("text-ink-3", size === "card" ? "size-10" : "size-5")} aria-hidden />;
}
