import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { getJson, shortDate, type Item, type ItemList } from "../../api";
import { MerchantIcon } from "../../components/MerchantIcon";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { formatKr } from "../../lib/format";

/**
 * 'Koppla till pryl': the prylar there are, newest first, narrowed by name or
 * merchant. Used when a purchase and its refund, or an instalment, belong to
 * something that is already written down.
 */
export function ItemLinkDialog({
  open,
  excludeIds = [],
  onOpenChange,
  onPick,
}: {
  open: boolean;
  /** Already linked to this transaction: shown as such, not pickable. */
  excludeIds?: number[];
  onOpenChange: (open: boolean) => void;
  onPick: (item: Item) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ("");
    setItems(null);
    let live = true;
    getJson<ItemList>("/items").then(
      (d) => live && setItems(d.items),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [open]);

  const needle = q.trim().toLocaleLowerCase("sv");
  const shown = (items ?? []).filter((i) => !needle || `${i.name} ${i.merchant ?? ""}`.toLocaleLowerCase("sv").includes(needle));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="link-item-desc">
        <DialogTitle>Koppla till pryl</DialogTitle>
        <DialogDescription id="link-item-desc" className="mt-1">
          Transaktionen läggs till på prylen. Ingenting i transaktionen ändras.
        </DialogDescription>
        <input
          autoFocus
          aria-label="Sök pryl"
          placeholder="Sök på namn eller handlare"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mt-4 h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring"
        />
        <ul className="mt-2 max-h-[44vh] min-h-24 overflow-y-auto">
          {items === null && <li className="px-1 py-3 text-sm text-muted">Hämtar…</li>}
          {items !== null && shown.length === 0 && (
            <li className="px-1 py-3 text-sm text-muted">{items.length === 0 ? "Det finns inga prylar än." : "Ingen pryl matchar."}</li>
          )}
          {shown.map((item) => {
            const linked = excludeIds.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={linked}
                  onClick={() => onPick(item)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-surface-hover disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  {item.cover ? (
                    <img src={item.cover} alt="" className="size-7 shrink-0 rounded object-cover" />
                  ) : item.icon ? (
                    <MerchantIcon decorative text={item.merchant ?? item.name} icon={item.icon} size={24} />
                  ) : (
                    <Package className="size-4 shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  <span className="shrink-0 text-xs text-muted">{shortDate(item.purchaseDate)}</span>
                  <span className="shrink-0 tabular-nums">{formatKr(item.priceOre, { whole: true })}</span>
                  {linked && <span className="shrink-0 text-xs text-muted">kopplad</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Stäng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
