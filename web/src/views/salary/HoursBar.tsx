import { cn } from "../../lib/cn";
import { h } from "./format";
import { hoursBar } from "./hours";

/**
 * The month's hours against full time: the fill in blue (light blue for a
 * forecast in the table), a black marker at the working time. In the hero,
 * 12 px with the marker's and full time's figures under it; in the table's
 * rows, 8 px without.
 */
export function HoursBar({
  hours,
  measure,
  full,
  size = "hero",
  forecast = false,
  className,
}: {
  hours: number;
  measure: number;
  full: number;
  size?: "hero" | "row";
  forecast?: boolean;
  className?: string;
}) {
  const b = hoursBar(hours, measure, full);
  const hero = size === "hero";
  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="img"
        aria-label={`${h(hours)} tim av heltid ${h(full)}, mått ${h(measure)}${b.over ? `, ${h(b.over)} tim över heltid` : ""}`}
        data-hours-bar={b.state}
        data-fill={Math.round(b.fill * 1000) / 1000}
        className={cn("relative w-full bg-segment", hero ? "h-3 rounded-[6px]" : "h-2 rounded-[4px]")}
      >
        <span
          className={cn("absolute inset-y-0 left-0 transition-[width] duration-300", hero ? "rounded-[6px]" : "rounded-[4px]", forecast ? "bg-accent-bar" : "bg-accent")}
          style={{ width: `${b.fill * 100}%` }}
        />
        <span data-marker className={cn("absolute w-0.5 -translate-x-1/2 rounded-full bg-ink", hero ? "-inset-y-1" : "-inset-y-0.5")} style={{ left: `${b.marker * 100}%` }} />
      </div>
      {hero && (
        <div className="relative mt-1 h-3.5 text-[10px] text-ink-3 tabular-nums" aria-hidden>
          <span className="absolute -translate-x-1/2" style={{ left: `${b.marker * 100}%` }}>
            {h(measure)}
          </span>
          <span className="absolute right-0">{h(full)}</span>
        </div>
      )}
    </div>
  );
}
