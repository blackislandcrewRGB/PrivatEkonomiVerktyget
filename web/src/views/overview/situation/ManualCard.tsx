import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { getJson, parseKr, sendJson, type ManualBalance } from "../../../api";
import { Card } from "../../../components/Card";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../components/ui/dialog";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import type { ViewId } from "../../../shell/routes";
import { dm, kr } from "../format";

const field = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

/**
 * Hålls för hand: the figures kept by hand (CSN, the car), each with the
 * round pencil that changes it, and the page's note on what is counted.
 */
export function ManualCard({ reload, onSaved, onNavigate }: { reload: unknown; onSaved: () => void; onNavigate: (v: ViewId) => void }) {
  const [rows, setRows] = useState<ManualBalance[] | null>(null);
  const [editing, setEditing] = useState<ManualBalance | null>(null);
  useEffect(() => {
    getJson<ManualBalance[]>("/networth/manual").then(setRows, () => setRows([]));
  }, [reload]);

  return (
    <Card aria-labelledby="manual-title" className="flex flex-col gap-3">
      <h2 id="manual-title" className="text-base font-semibold">
        Hålls för hand
      </h2>
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5" data-manual={r.key}>
              <span className="min-w-0 flex-1 text-[13px]">
                <span className="block font-medium">{r.name}</span>
                <span className="block truncate text-[11px] text-ink-3">
                  {kr(r.amountOre)} den {dm(r.valueDate)}
                  {r.charges > 0 && ` · ${r.charges} dragning${r.charges === 1 ? "" : "ar"} sedan dess`}
                  {r.source && ` · ${r.source}`}
                </span>
              </span>
              <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums">{kr(r.currentOre)}</span>
              <button
                type="button"
                aria-label={`Ändra ${r.name}`}
                onClick={() => setEditing(r)}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-card-inset text-accent hover:bg-accent-soft"
              >
                <Pencil className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-[11px] text-ink-3">
        Allt räknas för din del, aldrig för hela hushållet. Kortskulden är hela fakturan — det du är skyldig banken — och det{" "}
        <button type="button" className="text-accent hover:underline" onClick={() => onNavigate("shared")}>
          Mio är skyldig dig
        </button>{" "}
        står som en egen fordran, så ingen krona räknas två gånger.
      </p>
      <EditDialog row={editing} onOpenChange={(open) => !open && setEditing(null)} onSaved={onSaved} />
    </Card>
  );
}

/**
 * Changing one of them. The amount and the day move together on purpose: an
 * amount without the day it was true would have every charge since subtracted
 * from it a second time.
 */
function EditDialog({ row, onOpenChange, onSaved }: { row: ManualBalance | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setAmount(String(Math.round(row.amountOre / 100)));
    setDate(row.valueDate);
    setSource(row.source ?? "");
    setError(null);
  }, [row]);

  if (!row) return null;
  const ore = parseKr(amount);

  const save = async () => {
    if (ore === null) return;
    try {
      await sendJson("PUT", `/networth/manual/${row.id}`, { amountOre: ore, valueDate: date, source: source.trim() || null });
      notify({ text: `${row.name} är ${kr(ore)} den ${dm(date)}.` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[26rem] max-w-[calc(100vw-2rem)]">
        <DialogTitle>{row.name}</DialogTitle>
        <DialogDescription className="mt-1">
          {row.recurringExpenseId === null
            ? "Beloppet och dagen det gällde."
            : "Beloppet och dagen det gällde. Därefter räknas det ned av dragningarna, så dagen måste följa med beloppet."}
        </DialogDescription>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-muted">Belopp (kr)</span>
            <input aria-label="Belopp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(field, "mt-0.5 tabular-nums")} />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Gällde den</span>
            <input aria-label="Värdedatum" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(field, "mt-0.5")} />
          </label>
          <label className="col-span-2 block">
            <span className="text-xs text-muted">Källa (valfritt)</span>
            <input aria-label="Källa" placeholder="annonser" value={source} onChange={(e) => setSource(e.target.value)} className={cn(field, "mt-0.5")} />
          </label>
        </div>

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" disabled={ore === null} onClick={() => void save()}>
            Spara
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
