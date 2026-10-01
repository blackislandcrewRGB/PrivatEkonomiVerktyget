import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Design v2's card (UI-SPEC.md, "Design v2"): white on the grey page, 18 px
 * corners, no border, a soft shadow. Inside it, boxes are grey (InsetBox)
 * and dividers are hairlines (border-hairline).
 */
export function Card({ className, ...props }: ComponentProps<"section">) {
  // min-w-0: in a grid or flex row a card shrinks with the page instead of pushing it wider.
  return <section className={cn("min-w-0 rounded-card bg-card p-5 text-ink shadow-card sm:px-7 sm:py-6", className)} {...props} />;
}

/** A card's heading row: the title on the left, a note or a figure on the right. */
export function CardHeader({ title, id, aside, className }: { title: ReactNode; id?: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}>
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {aside && <div className="text-xs text-ink-2">{aside}</div>}
    </div>
  );
}

/** A grey box inside a card, 12 px corners. */
export function InsetBox({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("rounded-inset bg-card-inset p-3.5", className)} {...props} />;
}
