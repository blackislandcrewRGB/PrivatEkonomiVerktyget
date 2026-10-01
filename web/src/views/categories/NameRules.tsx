import { useEffect, useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { getJson, sendJson, type LabelRule, type LabelRulePreview, type LabelRuleSaved } from "../../api";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";

const rowsText = (n: number) => `${n} ${n === 1 ? "rad" : "rader"}`;

/**
 * Name rules: new imports whose text contains the pattern get the name
 * ('ANTHROPIC* CLAUDE SUB' → 'CLAUDE Abonnemang'). Made here or from 'Namn'
 * on selected rows in Transaktioner. Removing one leaves the rows' names.
 */
export function NameRules({ rules, onChanged }: { rules: LabelRule[]; onChanged: () => void }) {
  const [pattern, setPattern] = useState("");
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<LabelRulePreview | null>(null);
  const [removing, setRemoving] = useState<LabelRule | null>(null);

  useEffect(() => {
    const p = pattern.trim();
    if (!p) return setPreview(null);
    let live = true;
    const t = setTimeout(() => {
      getJson<LabelRulePreview>(`/label-rules/preview?pattern=${encodeURIComponent(p)}`)
        .then((r) => live && setPreview(r))
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pattern]);

  const add = async () => {
    try {
      const r = await sendJson<LabelRuleSaved>("POST", "/label-rules", { pattern, matchType: "contains", label });
      setPattern("");
      setLabel("");
      onChanged();
      notify({
        text: `Namnregel sparad: ${r.rule.pattern} → ${r.rule.label}.${r.applied ? ` ${rowsText(r.applied)} utan namn fick namnet.` : ""}`,
        action: {
          label: "Ångra",
          run: async () => {
            await sendJson("POST", `/label-rules/${r.rule.id}/undo`, { previousLabel: r.previousLabel, before: r.before });
            onChanged();
          },
        },
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  const remove = async (rule: LabelRule) => {
    try {
      await sendJson("DELETE", `/label-rules/${rule.id}`, {});
      onChanged();
      notify({
        text: `Namnregeln ${rule.pattern} → ${rule.label} togs bort. Raderna behåller namnet.`,
        action: {
          label: "Ångra",
          run: async () => {
            await sendJson("POST", "/label-rules/restore", rule);
            onChanged();
          },
        },
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  const field =
    "h-8 w-full rounded-[9px] border border-neutral-bar/70 bg-card px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <section aria-labelledby="name-rules-title" className="min-w-0 space-y-3 rounded-card bg-card px-4 py-4 text-ink shadow-card sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="name-rules-title" className="text-base font-semibold">
          Namnregler <span className="font-normal text-ink-3 tabular-nums">{rules.length}</span>
        </h2>
        <p className="min-w-56 flex-1 text-[11px] text-ink-3">
          nya importer vars text innehåller mönstret får namnet i stället för bankens text · rader med eget namn rörs inte · du kan också markera rader i
          Transaktioner och välja <b className="font-semibold">Namn</b>
        </p>
      </div>

      <form
        className="rounded-inset bg-card-inset p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pattern.trim() && label.trim()) add();
        }}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-center">
          <input aria-label="Mönster" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ANTHROPIC* CLAUDE SUB" className={`${field} font-mono text-[12px]`} />
          <ArrowRight className="hidden size-4 text-ink-3 sm:block" aria-hidden />
          <input aria-label="Namn" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="CLAUDE Abonnemang" className={field} />
          <Button
            type="submit"
            size="sm"
            disabled={!pattern.trim() || !label.trim()}
            className="h-8 rounded-[9px] border-0 bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-hover"
          >
            Lägg till
          </Button>
        </div>
        {preview && (
          <p className="mt-2 text-[11px] text-ink-2" aria-live="polite">
            {preview.matches > 0
              ? `Döper också om ${rowsText(preview.matches)} utan namn: ${preview.examples.slice(0, 3).join(", ")}${preview.examples.length > 3 ? " …" : ""}`
              : "Inga rader utan namn träffas nu. Gäller kommande importer."}
          </p>
        )}
      </form>

      <ul aria-label="Namnregler" className="-mx-4 sm:-mx-5">
        {rules.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-t border-hairline px-4 py-2.5 text-[13px] first:border-t-0 sm:px-5">
            <p className="min-w-0 flex-1 truncate">
              <span className="font-mono text-[12px] text-ink-2">{r.pattern}</span>
              <span className="text-ink-3"> → </span>
              <b className="font-semibold text-ink">{r.label}</b>
            </p>
            <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{rowsText(r.rows)}</span>
            <button
              type="button"
              onClick={() => setRemoving(r)}
              aria-label={`Ta bort namnregeln ${r.pattern}`}
              className="rounded-md p-1.5 text-ink-3 hover:bg-card-inset hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {rules.length === 0 && <li className="px-5 py-4 text-center text-[13px] text-ink-3">Inga namnregler än.</li>}
      </ul>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent aria-describedby="remove-name-rule-desc">
          <DialogTitle>Ta bort namnregeln?</DialogTitle>
          {removing && (
            <DialogDescription id="remove-name-rule-desc" className="mt-1">
              <span className="font-mono">{removing.pattern}</span> → <b className="text-ink">{removing.label}</b>. Raderna som redan fått namnet behåller det; nya importer
              får bankens text.
            </DialogDescription>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Avbryt
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const r = removing;
                setRemoving(null);
                if (r) void remove(r);
              }}
            >
              Ta bort
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
