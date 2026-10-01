import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/** A Design v2 number field with its unit ('tim') inside, on the right. */
export function UnitInput({ unit = "tim", className, placeholder = "–", ...props }: { unit?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cn("relative block", className)}>
      <input
        inputMode="decimal"
        placeholder={placeholder}
        {...props}
        className={cn(
          "h-9 w-full rounded-[9px] border border-neutral-bar/70 bg-card pl-3 pr-9 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-3 focus:border-accent disabled:bg-card-inset",
          // An empty field's dash sits on the left, as in the sketch; a number on the right, by the unit.
          placeholder === "–" && "placeholder:text-left",
        )}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-ink-3" aria-hidden>
        {unit}
      </span>
    </span>
  );
}
