import { useEffect, useState } from "react";
import type { Category, Rule } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { cn } from "../../lib/cn";
import { categoryPath } from "./rulesFilter";

const ORIGIN: Record<Rule["createdFrom"], string> = { seed: "grund", manual: "manuell", llm: "LLM" };

/**
 * 'Rensa oanvända': the rules with no hit in 12 months, none ticked to begin
 * with. Only the ticked ones are removed; the rows keep their categories.
 */
export function PruneDialog({
  open,
  onOpenChange,
  rules,
  categories,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rules: Rule[];
  categories: Category[];
  onConfirm: (ids: number[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPicked(new Set());
  }, [open]);
  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const everything = picked.size === rules.length && rules.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="prune-desc" className="max-w-lg">
        <DialogTitle>Rensa oanvända regler</DialogTitle>
        <DialogDescription id="prune-desc" className="mt-1">
          {rules.length} {rules.length === 1 ? "regel har" : "regler har"} inte avgjort någon rad de senaste 12 månaderna. Kryssa i de du vill ta bort; raderna behåller sina
          kategorier. En regel för något som bara händer vartannat år kan vara värd att spara.
        </DialogDescription>
        <div className="mt-3 flex items-center justify-between text-[13px]">
          <button type="button" onClick={() => setPicked(everything ? new Set() : new Set(rules.map((r) => r.id)))} className="font-semibold text-accent hover:underline">
            {everything ? "Avmarkera alla" : "Markera alla"}
          </button>
          <span className="text-ink-3 tabular-nums">{picked.size} valda</span>
        </div>
        <ul aria-label="Oanvända regler" className="mt-2 max-h-80 overflow-y-auto rounded-inset bg-card-inset">
          {rules.map((r) => (
            <li key={r.id} className="border-t border-hairline first:border-t-0">
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px]">
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="size-4 shrink-0 accent-[var(--color-accent)]" aria-label={r.pattern} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-ink">{r.pattern}</span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {categoryPath(categories, r.categoryId)} · {ORIGIN[r.createdFrom]}
                    {r.hits > 0 && ` · ${r.hits} träffar totalt`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            variant="danger"
            disabled={picked.size === 0 || busy}
            className={cn(picked.size === 0 && "opacity-50")}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm([...picked]);
              } finally {
                setBusy(false);
              }
            }}
          >
            Ta bort {picked.size} {picked.size === 1 ? "regel" : "regler"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
