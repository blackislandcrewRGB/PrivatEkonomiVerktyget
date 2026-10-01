import { useEffect, useState } from "react";
import { Link2, Package, Plus, X } from "lucide-react";
import { sendJson, type Item, type Transaction } from "../../api";
import { Button } from "../../components/ui/button";
import { notify } from "../../components/Toast";
import { AttachmentDrop } from "../items/AttachmentDrop";
import { onItemSaved, openItemFor } from "../items/ItemDialogHost";
import { ItemLinkDialog } from "../items/ItemLinkDialog";

/**
 * The prylar a transaction paid for, in its panel: what it bought, a place to
 * drop the receipt, and the two ways in — 'Skapa pryl' from this row, or
 * 'Koppla till pryl' for something already written down (a refund, an
 * instalment).
 *
 * Nothing here changes the transaction. The row keeps its category, its
 * amount and its place in every sum; a pryl is only a note about what the
 * money turned into.
 */
export function TxItems({ row, onChanged }: { row: Transaction; onChanged: () => void }) {
  const [linking, setLinking] = useState(false);
  const items = row.items ?? [];
  // The dialog is the app's own (Att göra opens the same one); the row reloads
  // when it has saved something.
  useEffect(() => onItemSaved(() => onChanged()), [onChanged]);

  const link = async (item: Item) => {
    try {
      await sendJson("POST", `/items/${item.id}/transactions`, { transactionId: row.id });
      setLinking(false);
      notify({ text: `Kopplad till ${item.name}.` });
      onChanged();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  const unlink = async (item: { id: number; name: string }) => {
    try {
      await sendJson("DELETE", `/items/${item.id}/transactions/${row.id}`, {});
      notify({ text: `Kopplingen till ${item.name} är borta.` });
      onChanged();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Prylar</h3>
      {items.length > 0 && (
        <ul className="mb-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <Package className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                <button
                  type="button"
                  aria-label={`Koppla bort ${item.name}`}
                  title="Koppla bort"
                  onClick={() => void unlink(item)}
                  className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <AttachmentDrop itemId={item.id} onDone={onChanged} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => openItemFor(row.id)}>
          <Plus /> Skapa pryl
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setLinking(true)}>
          <Link2 /> Koppla till pryl
        </Button>
      </div>
      {items.length === 0 && <p className="mt-1.5 text-xs text-muted">En pryl är en anteckning om vad pengarna blev. Den ändrar ingen summa och ingen kategori.</p>}

      <ItemLinkDialog open={linking} excludeIds={items.map((i) => i.id)} onOpenChange={setLinking} onPick={(item) => void link(item)} />
    </section>
  );
}
