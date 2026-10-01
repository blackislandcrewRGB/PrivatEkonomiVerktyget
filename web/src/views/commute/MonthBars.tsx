import { cn } from "../../lib/cn";
import { kr } from "../overview/format";
import type { MonthPoint } from "./months";

const short = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");
const long = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short", year: "numeric" }).replace(".", "");

/**
 * Two bars a month, reckoned (light blue) and bought (green), the same
 * months as the table below, this month's label in blue. 90 px high, both
 * on one scale; on a narrow screen they scroll sideways. Hovering a month
 * gives its amounts.
 */
export function MonthBars({ points }: { points: MonthPoint[] }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.estimate ?? 0, p.spent]));
  const h = (v: number) => `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`;
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul aria-label="Beräknat och tankat per månad" className="flex min-w-[36rem] gap-1.5">
        {points.map((p) => {
          const text = `${long(p.month)}: beräknat ${p.estimate === null ? "–" : kr(p.estimate)} · tankat ${kr(p.spent)}`;
          return (
            <li key={p.month} data-bar-month={p.month} data-estimate={p.estimate ?? ""} data-spent={p.spent} title={text} aria-label={text} className="flex min-w-0 flex-1 flex-col items-stretch gap-1">
              <div className="flex h-[90px] items-end gap-[3px]">
                <span className="flex-1 rounded-t-[4px] bg-accent-bar" style={{ height: h(p.estimate ?? 0) }} />
                <span className={cn("flex-1 rounded-t-[4px] bg-positive", !p.current && "opacity-60")} style={{ height: h(p.spent) }} />
              </div>
              <span className={cn("text-center text-[10px]", p.current ? "font-semibold text-accent" : "text-ink-3")}>{short(p.month)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
