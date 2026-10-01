import { Pencil, Plus } from "lucide-react";
import type { PensionEntry } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { dm, kr } from "../format";
import { initials } from "./initials";
import { regionColour } from "./regions";

/**
 * Värden från minpension.se: one row per entry with the provider's badge
 * (blue when the funds are chosen), what it is, its funds in their region's
 * colour, the amount and the pencil that writes a new value down.
 */
export function EntriesCard({ entries, onEdit, onAdd }: { entries: PensionEntry[]; onEdit: (e: PensionEntry) => void; onAdd: () => void }) {
  return (
    <Card aria-labelledby="entries-title" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="entries-title" className="text-base font-semibold">
          Värden från minpension.se
        </h2>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-accent hover:underline">
          <Plus className="size-3.5" aria-hidden /> Lägg till pensionspost
        </button>
      </div>
      <ul className="divide-y divide-hairline">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start gap-3 py-3.5" data-entry={e.id}>
            <span
              aria-hidden
              className={cn("grid size-9 shrink-0 place-items-center rounded-[10px] text-[11px] font-bold", e.placeable ? "bg-accent-soft text-accent" : "bg-card-inset text-ink-2")}
              data-testid="provider-badge"
            >
              {initials(e.provider)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {e.provider} – {e.name}
                {e.status === "closed" && <span className="ml-1.5 rounded-full bg-card-inset px-2 py-0.5 text-[10px] font-normal text-ink-2">avslutad</span>}
              </p>
              <p className="text-[11px] text-ink-2">
                {e.placeable ? "placerbar" : "ej placerbar"} · värde från {dm(e.valueDate)}
                {e.payoutFromAge !== null && ` · uttag från ${e.payoutFromAge} år`}
                {e.note && ` · ${e.note}`}
              </p>
              {e.funds.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[11px] text-ink-2">
                  {e.funds.map((f) => (
                    <li key={f.id}>
                      <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: regionColour(f.region) }} />
                      {f.fundName} · {kr(f.amountOre)} · {(f.unitsE4 / 10000).toLocaleString("sv-SE", { maximumFractionDigits: 4 })} andelar à{" "}
                      {(f.navOre / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                      {f.feePctE4 !== null && ` · avgift ${(f.feePctE4 / 10000).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} %`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <span className="whitespace-nowrap pt-0.5 text-[13px] font-semibold tabular-nums">{kr(e.amountOre)}</span>
            <button
              type="button"
              aria-label={`Uppdatera ${e.provider} – ${e.name}`}
              onClick={() => onEdit(e)}
              className="grid size-7 shrink-0 place-items-center rounded-full bg-card-inset text-accent hover:bg-accent-soft"
            >
              <Pencil className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
