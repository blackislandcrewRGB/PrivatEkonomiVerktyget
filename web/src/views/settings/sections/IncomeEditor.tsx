import { useState } from "react";
import { Trash2 } from "lucide-react";
import { formatSek, parseKr, sendJson, type Account, type RecurringIncome } from "../../../api";
import { Amount } from "../../../components/Amount";
import { Button } from "../../../components/ui/button";
import { notify } from "../../../components/Toast";

import { BUTTON, FIELD as input } from "../ui";

/**
 * One recurring income: what it is and its recent actual amounts ('sätt till
 * lägsta/snitt'); 'Ändra' opens its fields with Spara/Avbryt.
 */
export function IncomeEditor({ income: i, accounts, onChanged }: { income: RecurringIncome; accounts: Account[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", amount: "", day: "", accountId: "", pattern: "" });
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<RecurringIncome>) => {
    setError(null);
    try {
      await sendJson("PATCH", `/recurring-income/${i.id}`, patch);
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const open = () => {
    setDraft({ name: i.name, amount: (i.amount / 100).toLocaleString("sv-SE"), day: String(i.dayOfMonth), accountId: i.accountId === null ? "" : String(i.accountId), pattern: i.matchPattern ?? "" });
    setError(null);
    setEditing(true);
  };
  const submit = async () => {
    const patch: Partial<RecurringIncome> = {};
    const amount = parseKr(draft.amount);
    const day = Number(draft.day);
    if (!draft.name.trim()) return setError("Namn krävs.");
    if (!amount) return setError("Ogiltigt belopp.");
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError("Dagen ska vara 1–31.");
    if (draft.name.trim() !== i.name) patch.name = draft.name.trim();
    if (amount !== i.amount) patch.amount = amount;
    if (day !== i.dayOfMonth) patch.dayOfMonth = day;
    const accountId = draft.accountId ? Number(draft.accountId) : null;
    if (accountId !== i.accountId) patch.accountId = accountId;
    if (draft.pattern.trim() !== (i.matchPattern ?? "")) patch.matchPattern = draft.pattern.trim();
    if (Object.keys(patch).length === 0 || (await save(patch))) setEditing(false);
  };
  const remove = async () => {
    if (!confirm(`Ta bort "${i.name}"? Kopplingarna till importerade rader tas bort, transaktionerna finns kvar.`)) return;
    await sendJson("DELETE", `/recurring-income/${i.id}`, {});
    notify({ text: `${i.name} är borttagen.` });
    onChanged();
  };
  const account = accounts.find((a) => a.id === i.accountId);

  return (
    <div className="rounded-[12px] bg-card p-3.5 text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]" data-income={i.id}>
      {editing ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_5rem]">
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-2">Namn</span>
              <input autoFocus className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-2">Belopp (uppskattning, kr)</span>
              <input className={`${input} text-right tabular-nums`} inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-2">Dag</span>
              <input className={`${input} tabular-nums`} inputMode="numeric" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-2">Konto</span>
              <select className={input} value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}>
                <option value="">Inget konto</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-2">Texten innehåller</span>
              <input className={`${input} font-mono text-xs`} value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={BUTTON.blue} onClick={submit}>
              Spara
            </button>
            <button type="button" className={BUTTON.link} onClick={() => setEditing(false)}>
              Avbryt
            </button>
            <span className="flex-1" />
            <Button size="sm" variant="danger" onClick={remove}>
              <Trash2 /> Ta bort
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-medium">{i.name}</span>
          <Amount ore={i.amount} size="sm" whole />
          <span className="text-ink-2">
            den {i.dayOfMonth}:e{account ? ` på ${account.name}` : ""}
            {i.matchPattern && (
              <>
                {" "}
                · texten innehåller <span className="font-mono text-xs">{i.matchPattern}</span>
              </>
            )}
          </span>
          <span className="flex-1" />
          <button type="button" className={BUTTON.link} onClick={open}>
            Ändra
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-alarm">{error}</p>}

      {i.recent.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-2 text-[11px] text-ink-2">
          <span>Senaste {i.recent.length}:</span>
          {i.recent.map((r) => (
            <span key={r.id} className="tabular-nums">
              {r.bookingDate.slice(0, 7)} {formatSek(r.amount)}
            </span>
          ))}
          <span className="tabular-nums">
            lägsta <span className="font-medium text-ink">{formatSek(i.recentMin!)}</span> · snitt <span className="font-medium text-ink">{formatSek(i.recentAvg!)}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => save({ amount: Math.round(i.recentMin! / 100) * 100 })}>
            Sätt till lägsta
          </Button>
          <Button size="sm" variant="ghost" onClick={() => save({ amount: Math.round(i.recentAvg! / 100) * 100 })}>
            Sätt till snitt
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-2">Inga kopplade inbetalningar ännu.</p>
      )}
      {i.overrides.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-2">Förväntat belopp: {i.overrides.map((o) => `${o.month} ${formatSek(o.amount)}`).join(", ")} (ändras i Översikten)</p>
      )}
    </div>
  );
}
