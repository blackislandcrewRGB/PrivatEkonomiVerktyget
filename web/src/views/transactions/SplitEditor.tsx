import { useState } from "react";
import { Plus, X } from "lucide-react";
import { parseKr, sendJson, type Transaction } from "../../api";
import { useCategories } from "../../categories";
import { CategorySelect } from "../../components/CategorySelect";
import { Button } from "../../components/ui/button";
import { notify } from "../../components/Toast";
import { formatKr } from "../../lib/format";

/** The server refuses more than this. */
export const MAX_PARTS = 10;

interface Draft {
  categoryId: number | null;
  /** Kronor as typed; empty means 'the rest'. */
  text: string;
}

/** The amount as it is typed: kronor without a sign and without the unit (the field has it). */
const kronor = (ore: number) => formatKr(Math.abs(ore), { whole: true }).replace(/\s*kr$/, "");

/**
 * Editing a split starts from its parts; a new one from the row's category
 * and an empty line. The first line's amount is left empty on purpose: it
 * takes whatever the other lines don't, so only one amount has to be typed.
 */
const draftsFor = (row: Transaction): Draft[] =>
  row.splits?.length
    ? row.splits.map((p) => ({ categoryId: p.categoryId, text: kronor(p.amount) }))
    : [
        { categoryId: row.categoryId, text: "" },
        { categoryId: null, text: "" },
      ];

/**
 * What the drafts add up to. A line without an amount takes what is left, so
 * you only type the part you know; more than one empty line has nothing to
 * divide between them.
 */
export function checkDrafts(drafts: Draft[], amount: number): { parts?: { categoryId: number; amount: number }[]; error: string | null; rest: number } {
  const sign = Math.sign(amount);
  const values = drafts.map((d) => (d.text.trim() === "" ? null : parseKr(d.text)));
  const filled = values.reduce((s: number, v) => s + (v ?? 0) * sign, 0);
  const rest = amount - filled;
  const empty = values.filter((v) => v === null).length;
  const bad = values.some((v, i) => v === null && drafts[i].text.trim() !== "");
  const missing = drafts.some((d) => d.categoryId === null);
  const ids = drafts.map((d) => d.categoryId).filter((id): id is number => id !== null);

  if (drafts.length < 2) return { error: "En uppdelning behöver minst två delar.", rest };
  if (bad) return { error: "Skriv beloppen som tal, till exempel 1 200,50.", rest };
  if (new Set(ids).size !== ids.length) return { error: "Samma kategori står två gånger. Slå ihop delarna.", rest };
  if (missing) return { error: "Välj en kategori för varje del.", rest };
  if (empty > 1) return { error: "Fyll i beloppen. Bara en del kan ta resten.", rest };
  if (empty === 1 && (rest === 0 || Math.sign(rest) !== sign)) return { error: "Det finns inget kvar till den sista delen.", rest };
  if (empty === 0 && rest !== 0) {
    return { error: Math.sign(rest) === sign ? `${formatKr(Math.abs(rest))} är inte fördelade än.` : `${formatKr(Math.abs(rest))} för mycket.`, rest };
  }
  const parts = drafts.map((d, i) => ({ categoryId: d.categoryId!, amount: values[i] === null ? rest : values[i]! * sign }));
  return { parts, error: null, rest };
}

/**
 * Splits one purchase across categories: a category and an amount per part.
 * The amounts are kronor without a sign (the row's sign is used), and the one
 * line you leave empty takes the rest, so an Amazon order is two lines and one
 * amount. Saving replaces the whole split.
 */
export function SplitEditor({ row, onSaved, onCancel }: { row: Transaction; onSaved: () => void; onCancel: () => void }) {
  const categories = useCategories();
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsFor(row));
  const [busy, setBusy] = useState(false);
  const { parts, error, rest } = checkDrafts(drafts, row.amount);

  const set = (i: number, patch: Partial<Draft>) => setDrafts((list) => list.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  const save = async () => {
    if (!parts || busy) return;
    setBusy(true);
    try {
      await sendJson("PUT", `/transactions/${row.id}/splits`, { parts });
      notify({ text: `Uppdelat på ${parts.length} kategorier.` });
      onSaved();
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-muted/40 p-2">
      <ul className="space-y-1.5">
        {drafts.map((d, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <CategorySelect
              categories={categories}
              value={d.categoryId}
              onChange={(id) => set(i, { categoryId: id })}
              includeTransfers={false}
              emptyLabel="– välj kategori –"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[13px]"
            />
            <input
              inputMode="decimal"
              value={d.text}
              aria-label={`Belopp för del ${i + 1}`}
              placeholder={Math.sign(rest) === Math.sign(row.amount) ? kronor(rest) : "0"}
              onChange={(e) => set(i, { text: e.target.value })}
              className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right tabular-nums"
            />
            <span className="text-xs text-muted">kr</span>
            <button
              type="button"
              aria-label={`Ta bort del ${i + 1}`}
              disabled={drafts.length <= 2}
              onClick={() => setDrafts((list) => list.filter((_, n) => n !== i))}
              className="rounded-md p-1 text-muted hover:bg-surface-hover disabled:opacity-30"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={drafts.length >= MAX_PARTS}
          onClick={() => setDrafts((list) => [...list, { categoryId: null, text: "" }])}
        >
          <Plus className="size-3.5" /> Lägg till del
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Avbryt
        </Button>
        <Button size="sm" disabled={!parts || busy} onClick={() => void save()}>
          Spara
        </Button>
      </div>
      <p className={`text-xs ${error ? "text-warning" : "text-muted"}`}>
        {error ?? `Delarna blir ${formatKr(Math.abs(row.amount))}, som köpet. Den tomma raden tar resten.`}
      </p>
    </div>
  );
}
