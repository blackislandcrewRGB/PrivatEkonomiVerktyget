import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, ReceiptText, Trash2 } from "lucide-react";
import {
  RECEIPT_STORE_NAMES,
  getJson,
  parseReceiptPdf,
  parseReceiptText,
  sendJson,
  shortDate,
  type ParsedReceipt,
  type Receipt,
  type Transaction,
} from "../../api";
import { typingInField } from "../../components/IconUpload";
import { notify } from "../../components/Toast";
import { formatKr } from "../../lib/format";
import { cn } from "../../lib/cn";
import { ReceiptDialog, quantityText } from "../receipts/ReceiptDialog";

/**
 * The receipt of a purchase, in its panel: what the money actually bought.
 *
 * Getting it in is a paste. The shops' own pages and Kivra are where the
 * receipt already is, so ⌘V with the text, or the PDF dropped on the box, and
 * the rows are read and shown before anything is stored. Pasting a *picture*
 * still goes to the merchant's icon — the clipboard says which is which.
 *
 * Nothing here changes the transaction: a receipt is a note about what the
 * money turned into, like a pryl.
 */
export function TxReceipt({ row, onChanged }: { row: Transaction; onChanged?: () => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    getJson<Receipt | null>(`/receipts/transaction/${row.id}`).then(setReceipt, () => setReceipt(null));
  }, [row.id]);
  useEffect(load, [load]);

  const read = useCallback(
    async (get: () => Promise<ParsedReceipt>) => {
      if (busy) return;
      setBusy(true);
      try {
        setParsed(await get());
      } catch (e) {
        notify({ text: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  // ⌘V anywhere in the panel, as long as the caret isn't in a field and the
  // clipboard holds text rather than a picture (that one is the icon's).
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (receipt) return;
    const onPaste = (e: ClipboardEvent) => {
      if (typingInField()) return;
      if ([...(e.clipboardData?.files ?? [])].some((f) => f.type.startsWith("image/"))) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim().length < 20) return;
      e.preventDefault();
      void readRef.current(() => parseReceiptText(text, row.id));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [receipt, row.id]);

  const remove = async () => {
    if (!receipt) return;
    try {
      await sendJson("DELETE", `/receipts/${receipt.id}`, {});
      setReceipt(null);
      onChanged?.();
      notify({
        text: "Kvittot är borttaget.",
        action: {
          label: "Ångra",
          run: async () => {
            await sendJson("POST", `/receipts/${receipt.id}/restore`, {});
            load();
            onChanged?.();
          },
        },
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Kvitto</h3>

      {receipt ? (
        <div className="rounded-md border border-border">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-sm">
            <ReceiptText className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">
              {RECEIPT_STORE_NAMES[receipt.store]} · {shortDate(receipt.purchaseDate)}
            </span>
            <span className="tabular-nums">{formatKr(receipt.totalOre)}</span>
            <button
              type="button"
              aria-label="Ta bort kvittot"
              title="Ta bort kvittot"
              onClick={() => void remove()}
              className="rounded p-1 text-muted hover:text-danger"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <ul className="divide-y divide-border text-sm">
            {receipt.lines.map((l) => {
              const quantity = quantityText(l);
              return (
                <li key={l.id} className="flex items-baseline gap-2 px-2 py-1">
                  <span className={cn("min-w-0 flex-1 truncate", l.kind !== "item" && "text-muted")}>
                    {l.name}
                    {quantity && <span className="pl-1.5 text-xs text-subtle">{quantity}</span>}
                  </span>
                  <span className={cn("shrink-0 tabular-nums", l.totalOre < 0 && "text-muted")}>{formatKr(l.totalOre)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void read(() => parseReceiptPdf(file, row.id));
          }}
          className={cn(
            "flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted",
            over && "border-ring bg-surface-hover",
            busy && "opacity-60",
          )}
        >
          <ReceiptText className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{busy ? "Läser kvittot…" : "Klistra in kvittotexten (⌘V) eller dra hit PDF:en"}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 hover:bg-surface-hover"
          >
            <FileUp className="size-3.5" /> Välj PDF
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Välj kvitto som PDF"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void read(() => parseReceiptPdf(file, row.id));
              e.target.value = "";
            }}
          />
        </div>
      )}
      {!receipt && <p className="mt-1.5 text-xs text-muted">Lidl, ICA, Willys och Rusta. Kvittot ändrar ingen summa och ingen kategori.</p>}

      <ReceiptDialog
        open={parsed !== null}
        parsed={parsed}
        transactionId={row.id}
        onOpenChange={(o) => !o && setParsed(null)}
        onSaved={(saved) => {
          setReceipt(saved);
          onChanged?.();
        }}
      />
    </section>
  );
}
