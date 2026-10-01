import { useEffect, useState } from "react";
import { formatSek, getJson, parseKr, sendJson, type NetworthSettings } from "../../../api";
import { cn } from "../../../lib/cn";
import { CompactRow, Editable, Field } from "../compact";
import { pensionSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/**
 * Pension: inkomstbasbeloppet, per år. The ceiling on the pensionable income
 * is 7,5 of them, and the government sets a new one every November. Adding
 * next year's is a line here, not a change in the code; the year it applies
 * to and where it comes from are kept with it.
 */
export function PensionSection({ open, onToggle, match }: SectionProps) {
  const [data, setData] = useState<NetworthSettings | null>(null);
  const [draft, setDraft] = useState({ year: "", amount: "", source: "" });
  useEffect(() => {
    getJson<NetworthSettings>("/networth/settings").then(setData, () => setData(null));
  }, []);
  if (!data) return null;
  const s = pensionSummary(data);
  if (!match("Pension", "inkomstbasbelopp", s.summary, s.hint)) return null;
  return (
    <CompactRow id="pension" name="Pension" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <Editable
        description="Inkomstbasbeloppet sätter taket för pensionsgrundande inkomst (7,5 per år). Regeringen fastställer ett nytt varje november."
        onEdit={() => setDraft({ year: String(new Date().getFullYear()), amount: "", source: "" })}
        onSave={async () => {
          const year = Number(draft.year);
          const amountOre = parseKr(draft.amount);
          if (!Number.isInteger(year)) throw new Error("Skriv året beloppet gäller.");
          if (amountOre === null) throw new Error("Skriv inkomstbasbeloppet i kronor.");
          setData(await sendJson<NetworthSettings>("PUT", "/networth/settings", { incomeBaseAmount: { year, amountOre, source: draft.source } }));
        }}
        edit={
          <div className="grid gap-3 @[40rem]:grid-cols-[6rem_10rem_minmax(0,1fr)]">
            <Field label="År">
              <input aria-label="År" inputMode="numeric" className={cn(FIELD, "tabular-nums")} value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
            </Field>
            <Field label="Inkomstbasbelopp (kr)">
              <input aria-label="Inkomstbasbelopp" inputMode="decimal" className={cn(FIELD, "tabular-nums")} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </Field>
            <Field label="Källa">
              <input aria-label="Källa" className={FIELD} placeholder="regeringsbeslut 6/11 2025" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
            </Field>
          </div>
        }
      >
        <ul className="space-y-0.5 text-[13px]">
          {data.pension.incomeBaseAmounts.map((a) => (
            <li key={a.year}>
              {a.year}: <span className="font-semibold tabular-nums">{formatSek(a.amountOre)}</span> <span className="text-ink-3">· {a.source}</span>
            </li>
          ))}
        </ul>
      </Editable>
    </CompactRow>
  );
}
