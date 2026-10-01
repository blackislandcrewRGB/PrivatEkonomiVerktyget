import { useRef } from "react";
import { cn } from "../../../lib/cn";
import { FILTERS, type StatusFilter as Filter } from "./status";

/** The dot's colour per status (and the filter's choices). */
export const DOT: Record<Exclude<Filter, "all">, string> = { ok: "bg-positive", soon: "bg-caution", late: "bg-alarm", info: "bg-neutral-bar" };

/**
 * The status filter: Alla and the four statuses with their dots and counts,
 * Design v2's segmented look; on a phone a row of chips that scrolls
 * sideways. ←/→ move between the choices.
 */
export function StatusFilter({ value, counts, onChange }: { value: Filter; counts: Record<Filter, number>; onChange: (f: Filter) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = FILTERS.findIndex((f) => f.value === value);
  return (
    <div
      role="radiogroup"
      aria-label="Visa efter status"
      className="-mx-4 flex max-w-[100vw] shrink-0 gap-0.5 overflow-x-auto px-4 sm:mx-0 sm:w-fit sm:max-w-full sm:rounded-[10px] sm:bg-segment sm:p-[3px]"
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = (index + step + FILTERS.length) % FILTERS.length;
        onChange(FILTERS[next].value);
        refs.current[next]?.focus();
      }}
    >
      {FILTERS.map((f, i) => (
        <button
          key={f.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={f.value === value}
          tabIndex={f.value === value ? 0 : -1}
          onClick={() => onChange(f.value)}
          data-filter={f.value}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-ink transition-colors sm:rounded-lg",
            f.value === value ? "bg-segment-on font-semibold shadow-segment" : "bg-segment hover:bg-segment-on/50 sm:bg-transparent",
          )}
        >
          {f.value !== "all" && <span aria-hidden className={cn("size-1.5 rounded-full", DOT[f.value])} />}
          {f.label} · <span className="tabular-nums">{counts[f.value]}</span>
        </button>
      ))}
    </div>
  );
}
