import { useEffect, useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { RECEIPT_STORE_NAMES, sendJson, shortDate, type ParsedReceipt, type Receipt, type ReceiptLine, type ReceiptLineKind } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { formatKr } from "../../lib/format";
import { cn } from "../../lib/cn";

/**
 * The rows a receipt was read as, to look over before they are stored.
 *
 * The amounts are editable, because the point of showing them is that a
 * misreading can be corrected — but the sum has to land on the total the
 * receipt itself states, and until it does, Spara is off. That is the same
 * rule the server keeps, shown as it is being broken rather than as a refusal
 * afterwards.
 */

const field = "h-7 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

const KIND_LABELS: Record<ReceiptLineKind, string> = { item: "Vara", discount: "Rabatt", deposit: "Pant", bag: "Kasse" };

interface Draft {
  key: number;
  kind: ReceiptLineKind;
  name: string;
  /** Kronor as written, so a half-typed '−4,' doesn't jump around. */
  amount: string;
  quantityMilli: number | null;
  unit: "st" | "kg" | null;
  unitPriceOre: number | null;
}

const kronor = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 });

/** Like parseKr, but a receipt row may be a discount and then it is negative. */
export function parseSignedKr(input: string): number | null {
  const s = input.replace(/[\s  ]|kr/gi, "").replace("−", "-").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const negative = s.startsWith("-");
  const [kr, ore = ""] = s.replace("-", "").split(".");
  const value = Number(kr) * 100 + Number(ore.padEnd(2, "0"));
  return negative ? -value : value;
}

const draftsFrom = (lines: ReceiptLine[]): Draft[] =>
  lines.map((l, i) => ({ key: i, kind: l.kind, name: l.name, amount: kronor(l.totalOre), quantityMilli: l.quantityMilli, unit: l.unit, unitPriceOre: l.unitPriceOre }));

/** '2 st à 15,61' / '0,124 kg à 10,90', or nothing when the receipt didn't say. */
export function quantityText(line: Pick<Draft, "quantityMilli" | "unit" | "unitPriceOre">): string | null {
  if (line.quantityMilli === null || line.unit === null) return null;
  const count = (line.quantityMilli / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 3 });
  const each = line.unitPriceOre === null ? "" : ` à ${kronor(line.unitPriceOre)}`;
  return `${count} ${line.unit}${each}`;
}

export function ReceiptDialog({
  open,
  parsed,
  transactionId,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  parsed: ParsedReceipt | null;
  transactionId: number | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (receipt: Receipt) => void;
}) {
  const [lines, setLines] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    if (open && parsed) {
      setLines(draftsFrom(parsed.lines));
      setError(null);
    }
  }, [open, parsed]);

  const sum = useMemo(() => {
    let total = 0;
    for (const l of lines) {
      const ore = parseSignedKr(l.amount);
      if (ore === null) return null;
      total += ore;
    }
    return total;
  }, [lines]);

  if (!parsed) return null;
  const totalOre = parsed.totalOre ?? parsed.sumOre;
  const balances = sum !== null && sum === totalOre;
  const tx = parsed.transaction;

  const set = (key: number, patch: Partial<Draft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (busy || !balances) return;
    setBusy(true);
    try {
      const receipt = await sendJson<Receipt>("POST", "/receipts", {
        ...parsed,
        transactionId,
        totalOre,
        lines: lines.map((l) => ({
          kind: l.kind,
          name: l.name,
          quantityMilli: l.quantityMilli,
          unit: l.unit,
          unitPriceOre: l.unitPriceOre,
          totalOre: parseSignedKr(l.amount),
        })),
      });
      notify({ text: `Kvittot från ${RECEIPT_STORE_NAMES[parsed.store]} är inlagt.` });
      onOpenChange(false);
      onSaved(receipt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={`${id}-desc`} className="max-h-[85vh] w-[36rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
        <DialogTitle>Kvitto från {RECEIPT_STORE_NAMES[parsed.store]}</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="mt-1">
          Så här läste jag kvittot. Rätta det som blivit fel — raderna måste bli {formatKr(totalOre, { sign: "auto" })}, det kvittot självt säger.
        </DialogDescription>

        <p className="mt-2 text-xs text-muted">
          {[parsed.storeArea, parsed.purchaseDate && shortDate(parsed.purchaseDate), parsed.purchaseTime].filter(Boolean).join(" · ")}
          {parsed.receiptDate === null && parsed.purchaseDate && " · datum från köpet, kvittot saknar det"}
        </p>

        <ul className="mt-3 space-y-1">
          {lines.map((l, i) => {
            const quantity = quantityText(l);
            return (
              <li key={l.key} className="flex items-center gap-1.5">
                <select
                  aria-label={`Sorts rad ${i + 1}`}
                  value={l.kind}
                  onChange={(e) => set(l.key, { kind: e.target.value as ReceiptLineKind })}
                  className={cn(field, "w-20 shrink-0")}
                >
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="min-w-0 flex-1">
                  <input aria-label={`Namn rad ${i + 1}`} value={l.name} onChange={(e) => set(l.key, { name: e.target.value })} className={field} />
                  {quantity && <span className="pl-2 text-xs text-subtle">{quantity}</span>}
                </div>
                <input
                  aria-label={`Belopp rad ${i + 1}`}
                  value={l.amount}
                  inputMode="decimal"
                  onChange={(e) => set(l.key, { amount: e.target.value })}
                  className={cn(field, "w-24 shrink-0 text-right tabular-nums", parseSignedKr(l.amount) === null && "border-danger")}
                />
                <button
                  type="button"
                  aria-label={`Ta bort rad ${i + 1}`}
                  title="Ta bort raden"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  className="rounded p-1 text-muted hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 border-t border-border pt-2 text-sm">
          <p className={cn("flex justify-between tabular-nums", balances ? "text-foreground" : "text-danger")}>
            <span>{balances ? "Raderna stämmer med kvittot" : "Raderna stämmer inte med kvittot"}</span>
            <span>
              {sum === null ? "–" : formatKr(sum)} av {formatKr(totalOre)}
            </span>
          </p>
          {tx && (
            <p className="mt-1 flex justify-between text-xs text-muted tabular-nums">
              <span>
                Köpet: {tx.descriptionClean} {shortDate(tx.bookingDate)}
              </span>
              <span className={cn(!tx.matchesTotal && "text-danger")}>
                {formatKr(tx.amountOre)}
                {tx.matchesTotal ? "" : " – annat belopp än kvittot"}
              </span>
            </p>
          )}
          {tx?.hasReceipt && <p className="mt-1 text-xs text-danger">Köpet har redan ett kvitto. Ta bort det först.</p>}
          {parsed.statedItemCount !== null && <p className="mt-1 text-xs text-subtle">Kvittot säger {parsed.statedItemCount} varor.</p>}
        </div>

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" disabled={!balances || busy} onClick={() => void save()}>
            Spara kvitto
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
