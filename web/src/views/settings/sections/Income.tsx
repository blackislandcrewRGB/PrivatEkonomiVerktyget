import { Plus } from "lucide-react";
import { formatSek, sendJson, type Account, type IncomeSuggestion, type RecurringIncome } from "../../../api";
import { notify } from "../../../components/Toast";
import { CompactRow } from "../compact";
import { incomeSummary } from "../summaries";
import { BUTTON } from "../ui";
import { IncomeEditor } from "./IncomeEditor";
import type { SectionProps } from "./types";

/**
 * Återkommande inkomster: imported rows are linked to them (same account,
 * the text contains the pattern, ±5 days), so the forecast knows whether the
 * month's income has come. A suggestion from an import with salary waits
 * here, with 'Lägg till'; the page loads them (they badge the nav).
 */
export function IncomeSection({
  open,
  onToggle,
  match,
  incomes,
  suggestions,
  accounts,
  onChanged,
}: SectionProps & { incomes: RecurringIncome[]; suggestions: IncomeSuggestion[]; accounts: Account[]; onChanged: () => void }) {
  const s = incomeSummary(incomes, suggestions, accounts);
  if (!match("Återkommande inkomster", "lön", s.summary, s.hint)) return null;
  const accept = async (x: IncomeSuggestion) => {
    const created = await sendJson<RecurringIncome & { linked: number }>("POST", "/recurring-income", {
      name: x.name,
      amount: x.amount,
      dayOfMonth: x.dayOfMonth,
      accountId: x.accountId,
      matchPattern: x.matchPattern,
    });
    notify({ text: `${created.name} tillagd. ${created.linked} tidigare inbetalningar kopplades.` });
    onChanged();
  };
  return (
    <CompactRow id="inkomster" name="Återkommande inkomster" summary={s.summary} hint={s.hint} badge={suggestions.length} open={open} onToggle={onToggle}>
      <div className="space-y-3">
        <p className="text-[12px] leading-snug text-ink-2">
          Importerade rader kopplas hit (samma konto, texten innehåller mönstret, ±5 dagar), så att prognosen vet om månadens inkomst har kommit.
        </p>
        {suggestions.map((x) => (
          <div key={x.accountId} className="flex flex-wrap items-center gap-3 rounded-[12px] bg-caution-soft px-3.5 py-2.5 text-[13px]" data-suggestion>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Förslag:</span> {x.name} {formatSek(x.amount)} den {x.dayOfMonth}:e på {x.accountName} (texten innehåller{" "}
              <span className="font-mono text-[11px]">{x.matchPattern}</span>)
              <span className="block text-[11px] text-ink-2">Snitt av {x.basedOn.map((b) => `${b.bookingDate}: ${formatSek(b.amount)}`).join(", ")}</span>
            </span>
            <button type="button" className={BUTTON.blue} onClick={() => accept(x)}>
              <Plus className="size-3.5" aria-hidden /> Lägg till
            </button>
          </div>
        ))}
        {incomes.length === 0 && suggestions.length === 0 && <p className="text-[13px] text-ink-2">Inga återkommande inkomster ännu. De föreslås efter en import med lön.</p>}
        {incomes.map((i) => (
          <IncomeEditor key={i.id} income={i} accounts={accounts} onChanged={onChanged} />
        ))}
      </div>
    </CompactRow>
  );
}
