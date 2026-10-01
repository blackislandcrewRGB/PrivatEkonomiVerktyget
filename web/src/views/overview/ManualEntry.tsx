import { useEffect, useState, useSyncExternalStore } from "react";
import { getJson, parseKr, sendJson, type Account } from "../../api";
import { useCategories } from "../../categories";
import { CategorySelect } from "../../components/CategorySelect";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { todayIso } from "../../lib/today";

// One dialog for the whole app: the command palette and the '+' in
// Översikten's header open it; views that show balances reload on save.
let open = false;
const listeners = new Set<() => void>();
const savedListeners = new Set<() => void>();
const set = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};

export const openManualEntry = () => set(true);

/** Runs `fn` after a one-off income or expense has been saved. */
export function onManualSaved(fn: () => void): () => void {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}

const today = todayIso;
const empty = () => ({ label: "", amount: "", date: today(), accountId: "", categoryId: null as number | null, updateBalance: true, isIncome: true });
const field = "h-8 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

/** One-off income or expense entered by hand (a gift, cash). 'Uppdatera saldo' adds it to the account at once. */
export function ManualEntryHost() {
  const isOpen = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const categories = useCategories();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    getJson<Account[]>("/accounts").then(setAccounts, () => setAccounts([]));
  }, [isOpen]);

  const save = async () => {
    const ore = parseKr(form.amount);
    if (!form.label.trim() || !ore) return setError("Fyll i beskrivning och belopp.");
    try {
      await sendJson("POST", "/transactions", {
        label: form.label,
        amount: form.isIncome ? ore : -ore,
        bookingDate: form.date,
        accountId: form.accountId ? Number(form.accountId) : null,
        categoryId: form.categoryId,
        updateBalance: form.updateBalance && !!form.accountId,
      });
      notify({ text: `${form.isIncome ? "Inkomsten" : "Utgiften"} ${form.label.trim()} är registrerad.` });
      setForm(empty());
      set(false);
      savedListeners.forEach((l) => l());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={set}>
      <DialogContent aria-describedby="manual-entry-desc">
        <DialogTitle>Registrera inkomst eller utgift</DialogTitle>
        <DialogDescription id="manual-entry-desc" className="mt-1">
          En engångsrad som inte kommer från någon import, till exempel en gåva eller kontanter.
        </DialogDescription>
        <form
          className="mt-4 grid gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <SegmentedControl
            label="Inkomst eller utgift"
            options={[
              { value: "in", label: "Inkomst" },
              { value: "out", label: "Utgift" },
            ]}
            value={form.isIncome ? "in" : "out"}
            onChange={(v) => setForm({ ...form, isIncome: v === "in" })}
            className="justify-self-start"
          />
          <label className="grid gap-1">
            <span className="text-xs text-muted">Beskrivning</span>
            <input autoFocus className={field} placeholder="t.ex. Gåva från mormor" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted">Belopp (kr)</span>
              <input className={`${field} text-right tabular-nums`} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Datum</span>
              <input type="date" className={field} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted">Konto</span>
              <select className={field} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                <option value="">Inget konto</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Kategori</span>
              <CategorySelect categories={categories} value={form.categoryId} className={field} emptyLabel="Ingen" onChange={(id) => setForm({ ...form, categoryId: id })} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" checked={form.updateBalance} disabled={!form.accountId} onChange={(e) => setForm({ ...form, updateBalance: e.target.checked })} />
            Lägg till på kontots saldo direkt
          </label>
          {error && <p className="text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => set(false)}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary">
              Spara
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
