import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { Category, SplitPart } from "../api";
import { useCategories } from "../categories";
import { cn } from "../lib/cn";
import { formatKr } from "../lib/format";
import { categoryColor, NEUTRAL_COLOR } from "../lib/palette";

/**
 * Colour dot + category name ('Mat › Livsmedel'). With onClick it is a
 * button (opens the picker); without, plain text. No category shows
 * 'Saknar kategori' in warning colour. `fallbackName` is shown (in normal
 * colour) for a category the list doesn't have, e.g. while it is loading.
 */
export const CategoryChip = forwardRef<
  HTMLButtonElement,
  { categoryId: number | null; short?: boolean; fallbackName?: string; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">
>(function CategoryChip({ categoryId, short, fallbackName, className, onClick, ...rest }, ref) {
  const all = useCategories();
  const c: Category | undefined = categoryId != null ? all.find((x) => x.id === categoryId) : undefined;
  const parent = c?.parentId != null ? all.find((x) => x.id === c.parentId) : undefined;
  const known = c !== undefined || (categoryId != null && fallbackName !== undefined);
  const name = c ? (parent && !short ? `${parent.name} › ${c.name}` : c.name) : known ? fallbackName : "Saknar kategori";
  const color = c ? categoryColor(c, all) : NEUTRAL_COLOR;
  const body = (
    <>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </>
  );
  const base = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-[13px] leading-5",
    known ? "text-foreground" : "text-warning",
    className,
  );
  if (!onClick) return <span className={base}>{body}</span>;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(base, "hover:border-border hover:bg-surface-hover")}
      {...rest}
    >
      {body}
    </button>
  );
});

/**
 * '+1' after the category of a purchase split across categories: the chip
 * shows the largest part, this says how many more there are and lists them
 * with their amounts in the tooltip.
 */
export function SplitBadge({ splits, className }: { splits: SplitPart[]; className?: string }) {
  const all = useCategories();
  if (splits.length < 2) return null;
  const name = (id: number) => {
    const c = all.find((x) => x.id === id);
    const p = c?.parentId != null ? all.find((x) => x.id === c.parentId) : undefined;
    return c ? (p ? `${p.name} › ${c.name}` : c.name) : "Okänd kategori";
  };
  return (
    <span
      title={`Uppdelat köp:\n${splits.map((s) => `${name(s.categoryId)} ${formatKr(s.amount)}`).join("\n")}`}
      aria-label={`Uppdelat på ${splits.length} kategorier`}
      className={cn("shrink-0 rounded-full bg-surface-muted px-1.5 text-[11px] leading-5 text-muted", className)}
    >
      +{splits.length - 1}
    </span>
  );
}
