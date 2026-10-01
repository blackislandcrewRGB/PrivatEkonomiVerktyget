import { useEffect, useState } from "react";
import { getJson, parseKr, sendJson, formatSek } from "../../../api";
import { cn } from "../../../lib/cn";
import { CompactRow, Editable, Field } from "../compact";
import { cashflowSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/**
 * Kassaflöde: the buffer kept aside from the lowest point ('safe to spend'),
 * and Har jag råd?'s red limit: how few months the savings may last after a
 * purchase before it is red.
 */
export function CashflowSection({ open, onToggle, match }: SectionProps) {
  const [buffer, setBuffer] = useState<number | null>(null);
  const [red, setRed] = useState<number | null>(null);
  const [draft, setDraft] = useState({ buffer: "", red: "" });
  useEffect(() => {
    getJson<{ buffer: number }>("/cashflow/settings").then((r) => setBuffer(r.buffer), () => setBuffer(null));
    getJson<{ redBelowMonths: number }>("/afford/settings").then((r) => setRed(r.redBelowMonths), () => setRed(null));
  }, []);
  if (buffer === null) return null;
  const s = cashflowSummary(buffer, red);
  if (!match("Kassaflöde", "Har jag råd?", "buffert", s.summary, s.hint)) return null;
  return (
    <CompactRow id="kassaflode" name="Kassaflöde" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <Editable
        description="Safe to spend är den lägsta punkten de kommande 90 dagarna minus bufferten. I Har jag råd? blir ett köp rött om pengarna räcker färre månader än gränsen med sparandet efter köpet."
        onEdit={() => setDraft({ buffer: String(buffer / 100), red: String(red ?? 3).replace(".", ",") })}
        onSave={async () => {
          const ore = parseKr(draft.buffer);
          if (ore === null) throw new Error("Skriv bufferten i kronor.");
          const months = Number(draft.red.replace(",", "."));
          if (draft.red.trim() === "" || !Number.isFinite(months)) throw new Error("Skriv gränsen i månader.");
          const r = await sendJson<{ buffer: number }>("PUT", "/cashflow/settings", { buffer: ore });
          setBuffer(r.buffer);
          const a = await sendJson<{ redBelowMonths: number }>("PUT", "/afford/settings", { redBelowMonths: months });
          setRed(a.redBelowMonths);
        }}
        edit={
          <div className="flex flex-wrap gap-4">
            <Field label="Buffert (kr)" className="w-40">
              <input aria-label="Buffert" inputMode="decimal" className={cn(FIELD, "text-right tabular-nums")} value={draft.buffer} onChange={(e) => setDraft({ ...draft, buffer: e.target.value })} />
            </Field>
            <Field label="Rött under, med sparandet efter köpet (månader)" className="w-72">
              <input aria-label="Röd gräns" inputMode="decimal" className={cn(FIELD, "w-24 text-right tabular-nums")} value={draft.red} onChange={(e) => setDraft({ ...draft, red: e.target.value })} />
            </Field>
          </div>
        }
      >
        <p className="text-[13px]">
          Buffert <span className="font-semibold tabular-nums">{formatSek(buffer)}</span>
          {red !== null && (
            <>
              {" · "}rött under <span className="font-semibold tabular-nums">{red.toLocaleString("sv-SE")} månader</span> med sparandet
            </>
          )}
        </p>
      </Editable>
    </CompactRow>
  );
}
