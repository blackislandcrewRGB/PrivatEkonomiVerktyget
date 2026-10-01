import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { parseKr, sendJson, shortDate, type SavingsHolding, type SavingsPoint } from "../../../api";
import { notify } from "../../../components/Toast";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../components/ui/dialog";
import { cn } from "../../../lib/cn";
import { BUTTON, FIELD } from "../../settings/ui";
import { isoDate, wholeKr } from "../common";
import { signedKr } from "./ValueCard";

/**
 * A holding's readings (Design v2), '<name> · avläsningar': a value for a
 * date in a grey box at the top (today by default; the same date again
 * replaces the value), then the readings newest first with the return since
 * the one before (green or red) and a bin; the first one is marked 'start'.
 * A click on a reading puts it in the box to be changed. The name is renamed
 * with the pencil, and the holding removed with its bin (asks first).
 * `points`: the portfolio's, with the return, when this is the only holding.
 */
export function ReadingsCard({
  holding: h,
  points,
  reload,
  onRemoveValue,
}: {
  holding: SavingsHolding;
  points: SavingsPoint[] | null;
  reload: () => void;
  onRemoveValue: (h: SavingsHolding, date: string, value: number) => void;
}) {
  const fail = (e: unknown) => notify({ text: (e as Error).message });
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [value, setValue] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const ore = parseKr(value);
  const save = () =>
    sendJson("PUT", `/savings/holdings/${h.id}/values`, { date, value: ore })
      .then(() => {
        setValue("");
        notify({ text: `${h.name}: ${wholeKr(ore!)} den ${shortDate(date)}.` });
        reload();
      })
      .catch(fail);
  const rename = () => {
    const next = renaming?.trim();
    setRenaming(null);
    if (next && next !== h.name) sendJson("PATCH", `/savings/holdings/${h.id}`, { name: next }).then(reload, fail);
  };
  const remove = () =>
    sendJson("DELETE", `/savings/holdings/${h.id}`, {})
      .then(() => {
        setRemoving(false);
        notify({ text: `${h.name} är borttaget.` });
        reload();
      })
      .catch(fail);
  const returnOf = (d: string) => points?.find((p) => p.date === d)?.return ?? null;
  const oldest = h.values[0]?.date;

  return (
    <section className="space-y-3 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-label={`${h.name} · avläsningar`} data-card="readings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {renaming !== null ? (
            <input
              autoFocus
              aria-label="Nytt namn"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  rename();
                } else if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={rename}
              className={cn(FIELD, "h-8 w-48")}
            />
          ) : (
            <h2 className="truncate text-[15px] font-semibold">{h.name} · avläsningar</h2>
          )}
          {renaming === null && (
            <>
              <button type="button" onClick={() => setRenaming(h.name)} aria-label={`Byt namn på ${h.name}`} title="Byt namn" className="rounded p-1 text-ink-3 hover:text-ink">
                <Pencil className="size-3.5" />
              </button>
              <button type="button" onClick={() => setRemoving(true)} aria-label={`Ta bort ${h.name}`} title="Ta bort" className="rounded p-1 text-ink-3 hover:text-alarm">
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
        <span className="text-[11px] text-ink-3">skrivs av från appen</span>
      </div>

      <form
        className="flex flex-wrap items-center gap-2 rounded-inset bg-card-inset p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ore !== null) save();
        }}
      >
        <input type="date" aria-label="Datum" value={date} max={isoDate(new Date())} onChange={(e) => setDate(e.target.value)} className={cn(FIELD, "h-8 w-36 flex-none")} />
        <label className={cn(FIELD, "flex h-8 min-w-24 flex-1 items-center gap-1 focus-within:border-accent")}>
          <input
            inputMode="decimal"
            aria-label={`Värde för ${h.name}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Explicit: implicit submission doesn't fire for every Enter (as in BulkLabelDialog).
              if (e.key === "Enter") {
                e.preventDefault();
                if (ore !== null) save();
              }
            }}
            placeholder="125 000"
            className="min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none"
          />
          <span className="text-ink-3">kr</span>
        </label>
        <button type="submit" className={BUTTON.blue} disabled={ore === null}>
          För in
        </button>
      </form>

      {h.values.length > 0 && (
        <table className="w-full text-[13px]" aria-label={`Värden för ${h.name}`}>
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="py-2 text-left font-normal">Datum</th>
              <th className="px-2 py-2 text-right font-normal">Värde</th>
              <th className="px-2 py-2 text-right font-normal">Avkastning</th>
              <th className="w-7" aria-label="Ta bort" />
            </tr>
          </thead>
          <tbody>
            {[...h.values].reverse().map((v) => {
              const ret = returnOf(v.date);
              return (
                <tr
                  key={v.date}
                  className="cursor-pointer border-b border-hairline last:border-b-0 hover:bg-band"
                  onClick={() => {
                    setDate(v.date);
                    setValue(String(Math.round(v.value / 100)));
                  }}
                  title="Ändra: värdet hamnar i rutan ovan"
                  data-reading={v.date}
                >
                  <td className="whitespace-nowrap py-2 tabular-nums">
                    {shortDate(v.date)}
                    {v.date === oldest && <span className="pl-1.5 text-[11px] text-ink-3">start</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{wholeKr(v.value)}</td>
                  <td className={cn("whitespace-nowrap px-2 py-2 text-right tabular-nums", ret === null || Math.round(ret / 100) === 0 ? "text-ink-3" : ret > 0 ? "text-positive-text" : "text-alarm")} data-return={ret ?? undefined}>
                    {ret === null ? "–" : signedKr(ret)}
                  </td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveValue(h, v.date, v.value);
                      }}
                      aria-label={`Ta bort värdet ${v.date}`}
                      className="rounded p-1 text-ink-3 hover:text-alarm"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent aria-describedby={`remove-holding-${h.id}`}>
          <DialogTitle>Ta bort {h.name}?</DialogTitle>
          <DialogDescription id={`remove-holding-${h.id}`} className="mt-2">
            {h.values.length === 1 ? "Värdet" : `Alla ${h.values.length} värden`} tas bort också. Insättningarna i Sparande påverkas inte.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              Avbryt
            </Button>
            <Button variant="danger" onClick={remove}>
              <Trash2 /> Ta bort
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
