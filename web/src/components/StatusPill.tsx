import type { ExpenseStatus } from "../api";
import { cn } from "../lib/cn";

export type Status = ExpenseStatus | "betald" | "delvis" | "obetald";

// Design v2's colours (Fasta utgifter is where the pills are).
const STYLE: Record<Status, { label: string; className: string }> = {
  kommande: { label: "kommande", className: "bg-card-inset text-ink-2" },
  dragen: { label: "dragen", className: "bg-positive-soft text-positive-text" },
  forfallen: { label: "förfallen", className: "bg-alarm-soft text-alarm" },
  markerad_betald: { label: "betald", className: "bg-positive-soft text-positive-text" },
  betald: { label: "betald", className: "bg-positive-soft text-positive-text" },
  delvis: { label: "delvis betald", className: "bg-caution-soft text-caution-text" },
  obetald: { label: "obetald", className: "bg-card-inset text-ink-2" },
  passerad: { label: "passerad", className: "bg-caution-soft text-caution-text" },
};

/** kommande / dragen / förfallen / betald … as a small pill; suffix after the word ('dragen i år'). */
export function StatusPill({ status, label, suffix, title, className }: { status: Status; label?: string; suffix?: string; title?: string; className?: string }) {
  const s = STYLE[status];
  return (
    // The colour crossfades when the status changes (kommande → dragen); the
    // text changes with it. A CSS transition, so reduced motion switches it off.
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-[180ms] ease-out", s.className, className)}>
      {label ?? s.label}
      {suffix && ` ${suffix}`}
    </span>
  );
}
