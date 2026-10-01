import { cn } from "../lib/cn";
import { formatKr, longDate } from "../lib/format";

/**
 * A day in Design v2's list card: a light grey band with the weekday and
 * date on the left and the day's sum on the right (green when positive).
 * flash: lit up for a moment (a day picked elsewhere).
 */
export function DateGroupHeader({ date, total, flash = false, className }: { date: string; total?: number; flash?: boolean; className?: string }) {
  return (
    <div
      data-day-header={date}
      data-flash={flash || undefined}
      className={cn(
        "flex items-baseline justify-between gap-3 border-t border-hairline bg-band px-4 py-2 text-xs font-semibold text-ink-2 transition-colors duration-500 sm:px-6",
        className,
        flash && "bg-accent-soft",
      )}
    >
      <span>{longDate(date)}</span>
      {total !== undefined && total !== 0 && (
        <span className={cn("tabular-nums", total > 0 && "text-positive-text")}>{formatKr(Math.round(total / 100) * 100, { whole: true, sign: total > 0 ? "always" : "auto" })}</span>
      )}
    </div>
  );
}
