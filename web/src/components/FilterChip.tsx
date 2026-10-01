import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Design v2's filter chip (Transaktioner, Prylar): white with a light shadow,
 * black with white text when on, a ▾ when it opens a menu. A trigger passes
 * its props (and ref) through.
 */
export function FilterChip({ active, caret = false, className, children, ...props }: ComponentProps<"button"> & { active: boolean; caret?: boolean }) {
  return (
    <button
      type="button"
      data-active={active || undefined}
      className={cn(
        "inline-flex h-8 max-w-72 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors",
        active ? "bg-ink text-card hover:bg-ink/85" : "bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-card-inset",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {caret && <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />}
    </button>
  );
}
