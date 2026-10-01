import type { ImportCoverage } from "../../api";
import { cn } from "../../lib/cn";
import { todayIso } from "../../lib/today";
import { dm } from "../overview/format";
import { accountState, feedText, gapText, type Health } from "./coverage";

const DOT: Record<Health, { className: string; label: string }> = {
  ok: { className: "bg-positive", label: "i fas" },
  late: { className: "bg-caution", label: "lite efter" },
  overdue: { className: "bg-alarm", label: "långt efter" },
  none: { className: "bg-neutral-bar", label: "inget importerat" },
};
const GAP: Record<Health, string> = { ok: "text-ink-3", late: "text-caution-text", overdue: "text-alarm", none: "text-ink-3" };

/**
 * A card per account: how far it is imported ('t.o.m. 24/9'), the gap since
 * in colour, a status dot, and how the account gets its data. Four in a row,
 * two by two, then one column, by the width they have.
 */
export function AccountCards({ coverage }: { coverage: ImportCoverage[] }) {
  const today = todayIso();
  return (
    <div className="@container">
      <ul className="grid gap-3 @[34rem]:grid-cols-2 @[60rem]:grid-cols-4" aria-label="Senast importerat per konto">
        {coverage.map((c) => {
          const s = accountState(c, today);
          const dot = DOT[s.health];
          return (
            <li
              key={c.accountId}
              data-health={s.health}
              title={s.nextInvoice ? `Nästa faktura väntas omkring ${dm(s.nextInvoice)}.` : undefined}
              className="min-w-0 rounded-[14px] bg-card px-4 py-3.5 text-ink shadow-card"
            >
              <p className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.name}</span>
                <span role="img" aria-label={dot.label} className={cn("size-2 shrink-0 rounded-full", dot.className)} />
              </p>
              <p className="mt-2 text-[20px] font-semibold leading-tight tabular-nums">{s.to ? `t.o.m. ${dm(s.to)}` : "inget importerat"}</p>
              <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px]">
                <span className={cn("font-medium tabular-nums", s.gap === 0 ? "text-positive-text" : GAP[s.health])} data-gap>
                  {s.gap === null ? "importera en fil" : gapText(s.gap)}
                </span>
                <span className="truncate text-ink-3">{feedText(c)}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
