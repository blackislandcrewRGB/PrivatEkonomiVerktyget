import type { PensionOverview } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { dm, kr } from "../format";
import { pensionSplit } from "./split";

const COLOUR = { placeable: "bg-accent", fixed: "bg-neutral-bar" } as const;

/**
 * Låst till 65+: the pension in total, never counted in the net worth or
 * the endurance, split in what is placeable and what is not, and how old
 * the figures written down are.
 */
export function LockedCard({ data, className }: { data: PensionOverview; className?: string }) {
  const parts = pensionSplit(data);
  const sum = parts.reduce((s, p) => s + Math.max(0, p.ore), 0);
  return (
    <Card aria-labelledby="locked-title" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="locked-title" className="text-[13px] font-medium text-ink-2">
          Låst till 65+
        </h2>
        <span className="rounded-full bg-card-inset px-2.5 py-0.5 text-[11px] text-ink-2">räknas aldrig in i nettoförmögenheten eller uthålligheten</span>
      </div>
      <p className="text-[52px] font-bold leading-none tracking-[-0.03em] tabular-nums" data-testid="pension-total">
        {kr(data.totalOre)}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]" role="img" aria-label={`Pensionen: ${parts.map((p) => `${p.label.toLocaleLowerCase("sv")} ${kr(p.ore)}`).join(", ")}.`} data-testid="pension-split">
          {parts.map((p) => (
            <div key={p.key} data-part={p.key} className={cn("min-w-1", COLOUR[p.key])} style={{ flexGrow: sum > 0 ? Math.max(0, p.ore) / sum : 1, flexBasis: 0 }} />
          ))}
        </div>
        <ul className="grid gap-x-6 gap-y-1 text-xs text-ink-2 sm:grid-cols-2">
          {parts.map((p) => (
            <li key={p.key}>
              <span aria-hidden className={cn("mr-1.5 inline-block size-2 rounded-full", COLOUR[p.key])} />
              {p.label} <b className="font-semibold text-ink tabular-nums">{kr(p.ore)}</b>
              {p.names && ` · ${p.names}${p.key === "placeable" ? ", du väljer fonder" : ""}`}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-ink-3">
        Pensionen går inte att använda på decennier.
        {data.oldestValueDate && (
          <>
            {" "}
            Äldsta värdet är från {dm(data.oldestValueDate)}
            {data.oldestMonths !== null && ` — ${data.oldestMonths} månader gammalt`}. Skrivs av för hand från minpension.se, ungefär en gång om året, med pennan på raden; ingenting hämtas.
            {data.stale.length > 0 && ` ${data.stale.length} värde${data.stale.length === 1 ? "" : "n"} är över ett år gammalt.`}
          </>
        )}
      </p>
    </Card>
  );
}
