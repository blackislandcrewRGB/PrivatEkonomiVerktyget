import { useEffect, useId, useState } from "react";
import { parseKr, sendJson, shortDate, type Item, type ItemOwner, type ItemSuggestion } from "../../api";
import { MerchantIcon } from "../../components/MerchantIcon";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";

/**
 * A new pryl. Opened from a transaction it comes filled in — name, price,
 * date, merchant and the merchant's own icon — so the usual case is to type
 * what the thing actually is and press Spara.
 *
 * The category is free text with the subcategories under 'Prylar & hem' as
 * suggestions: it describes the thing, not where the money went.
 */

const field = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

export interface ItemDraft {
  name: string;
  category: string;
  price: string;
  purchaseDate: string;
  merchant: string;
  purchaseUrl: string;
  warrantyMonths: string;
  returnDeadline: string;
  owner: ItemOwner;
  note: string;
}

const kronor = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 });

/** An empty pryl, bought today: what 'Ny pryl' starts from. */
export const emptyDraft = (today: string): ItemDraft => ({
  name: "",
  category: "",
  price: "",
  purchaseDate: today,
  merchant: "",
  purchaseUrl: "",
  warrantyMonths: "",
  returnDeadline: "",
  owner: "me",
  note: "",
});

export const draftFrom = (s: ItemSuggestion): ItemDraft => ({
  name: s.name,
  category: s.category ?? "",
  price: kronor(s.priceOre),
  purchaseDate: s.purchaseDate,
  merchant: s.merchant,
  purchaseUrl: "",
  warrantyMonths: "",
  returnDeadline: "",
  owner: "me",
  note: "",
});

export function ItemDialog({
  open,
  draft,
  categoryOptions,
  icon,
  bookedDate,
  transactionIds,
  partnerName = "Partnern",
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** What the fields start at; from a transaction via draftFrom. */
  draft: ItemDraft;
  categoryOptions: string[];
  icon?: ItemSuggestion["icon"];
  /** The day the bank booked the purchase, when that is not the day it was bought. */
  bookedDate?: string | null;
  /** The transactions the new pryl is linked to at once. */
  transactionIds?: number[];
  partnerName?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: Item) => void;
}) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  // A fresh dialog starts from what it was opened with, every time.
  useEffect(() => {
    if (open) {
      setForm(draft);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  const set = (patch: Partial<ItemDraft>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (busy) return;
    const priceOre = parseKr(form.price);
    if (!form.name.trim()) return setError("Prylen behöver ett namn.");
    if (priceOre === null) return setError("Skriv priset som ett tal, till exempel 4 490.");
    setBusy(true);
    try {
      const item = await sendJson<Item>("POST", "/items", {
        name: form.name,
        category: form.category || null,
        purchaseDate: form.purchaseDate,
        priceOre,
        merchant: form.merchant || null,
        purchaseUrl: form.purchaseUrl || null,
        warrantyMonths: form.warrantyMonths.trim() === "" ? null : Number(form.warrantyMonths),
        returnDeadline: form.returnDeadline || null,
        owner: form.owner,
        note: form.note || null,
        transactionIds: transactionIds ?? [],
      });
      notify({ text: `${item.name} är inlagd.` });
      onOpenChange(false);
      onSaved(item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={`${listId}-desc`} className="max-h-[80vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2">
          <MerchantIcon decorative text={form.merchant || form.name} icon={icon ?? undefined} size={24} />
          Ny pryl
        </DialogTitle>
        <DialogDescription id={`${listId}-desc`} className="mt-1">
          En sak du köpt. Den påverkar inga summor och ingen kategori — den ligger vid sidan av pengarna.
        </DialogDescription>
        <form
          className="mt-4 grid gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1">
            <span className="text-xs text-muted">Vad är det?</span>
            <input autoFocus className={field} placeholder="t.ex. Ovalring Gen 4" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted">Pris (kr)</span>
              <input className={`${field} text-right tabular-nums`} inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} />
            </label>
            {/* The hint sits outside the label, so the field is still called
                just 'Inköpsdatum' to a screen reader. */}
            <div className="grid content-start gap-1">
              <label className="grid gap-1">
                <span className="text-xs text-muted">Inköpsdatum</span>
                <input type="date" className={field} value={form.purchaseDate} onChange={(e) => set({ purchaseDate: e.target.value })} />
              </label>
              {/* The lists show the booking day; this is the day the thing was
                  bought, which is what a warranty is counted from. */}
              {bookedDate && bookedDate !== form.purchaseDate && <span className="text-xs text-subtle">Bokfördes {shortDate(bookedDate)}</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted">Kategori</span>
              <input className={field} list={listId} placeholder="Fritt, eller välj" value={form.category} onChange={(e) => set({ category: e.target.value })} />
              <datalist id={listId}>
                {categoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Handlare</span>
              <input className={field} value={form.merchant} onChange={(e) => set({ merchant: e.target.value })} />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Köplänk</span>
            <input className={field} type="url" inputMode="url" placeholder="https://…" value={form.purchaseUrl} onChange={(e) => set({ purchaseUrl: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted">Garanti (månader)</span>
              <input className={field} inputMode="numeric" placeholder="t.ex. 24" value={form.warrantyMonths} onChange={(e) => set({ warrantyMonths: e.target.value.replace(/\D/g, "") })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Ångerrätt t.o.m.</span>
              <input type="date" className={field} value={form.returnDeadline} onChange={(e) => set({ returnDeadline: e.target.value })} />
            </label>
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted">Vems</span>
            <SegmentedControl<ItemOwner>
              size="sm"
              label="Vems"
              value={form.owner}
              onChange={(owner) => set({ owner })}
              options={[
                { value: "me", label: "Min" },
                { value: "shared", label: "Delad" },
                { value: "partner", label: `${partnerName}s` },
              ]}
              className="justify-self-start"
            />
          </div>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Anteckning</span>
            <input className={field} value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </label>
          {error && <p className="text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Spara
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
