import { useCallback, useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RECEIPT_STORE_NAMES, getJson, sendJson, shortDate, type Product, type ProductGroup, type ProductHistory } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { quantityText } from "../receipts/ReceiptDialog";
import { ChartTooltip, Money, Section, chart, kTick, kr, query } from "./common";
import { GroceryOverview } from "./groceries/GroceryOverview";
import { ProductList } from "./groceries/ProductList";
import type { ViewProps } from "./AnalysisView";

/**
 * Matvaror: the groceries the receipts have seen.
 *
 * This is where the names are answered for. A receipt row is what one shop
 * called something once, and the tool's first guess at what it is — which
 * shelf, and whether two names mean the same thing — is only a guess. Here it
 * is corrected, once, and every receipt pasted afterwards follows the answer.
 *
 * Nothing on this page is money. Renaming a grocery, moving it or putting two
 * together changes no sum anywhere: the receipts keep their rows exactly as
 * they were read, and the transactions their amounts.
 */

const field = "h-8 rounded-md border border-hairline bg-card px-2 text-sm outline-none focus:border-accent";

/** A shelf as a dot in the colour it was given. */
function Dot({ color }: { color: string | null }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color ?? "var(--color-border-strong)" }} />;
}

export function Products({ from, to }: ViewProps) {
  const [rows, setRows] = useState<Product[] | null>(null);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getJson<Product[]>(`/products?${query({ from, to })}`).then(setRows, (e: Error) => setError(String(e)));
    getJson<ProductGroup[]>("/products/groups").then(setGroups, () => setGroups([]));
  }, [from, to]);
  useEffect(load, [load]);

  const act = async (run: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      load();
      if (done) notify({ text: done });
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const picked = (rows ?? []).filter((p) => selected.includes(p.id));
  // The open grocery is read out of the list, so a rename or a name that
  // leaves shows in the dialog at once instead of going stale behind it.
  const open = (rows ?? []).find((p) => p.id === openId) ?? null;
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (error) return <p className="text-alarm">{error}</p>;
  if (!rows) return null;
  if (rows.length === 0) {
    return (
      <Section title="Matvaror" subtitle="Vad pengarna blev, enligt kvittona.">
        <p className="text-sm text-ink-2">
          Inga varor ännu. Klistra in ett kvitto i ett matköp — öppna köpet i Transaktioner och tryck ⌘V — så står varorna här.
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      <GroceryOverview from={from} to={to} />

      <ProductList
        rows={rows}
        groups={groups}
        busy={busy}
        selected={selected}
        onToggle={toggle}
        onOpen={setOpenId}
        onShelf={(p, groupId) => void act(() => sendJson("PUT", `/products/${p.id}`, { groupId }))}
        onSuggest={() =>
          void act(async () => {
            const { placed } = await sendJson<{ placed: number }>("POST", "/products/suggest", {});
            notify({ text: placed === 0 ? "Reglerna känner inte igen någon av dem." : placed === 1 ? "En vara fick en hylla." : `${placed} varor fick en hylla.` });
          })
        }
        footer={
          selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-3 text-sm sm:px-6">
              <span className="min-w-0 flex-1 truncate text-ink-2">{picked.map((p) => p.name).join(", ")}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Avmarkera
              </Button>
              <Button size="sm" variant="primary" disabled={selected.length < 2} onClick={() => setMerging(true)}>
                Slå ihop {selected.length === 1 ? "1 vara" : `${selected.length} varor`}
              </Button>
            </div>
          )
        }
      />

      <MergeDialog
        open={merging}
        products={picked}
        onOpenChange={setMerging}
        onMerged={() => {
          setSelected([]);
          setMerging(false);
          load();
        }}
      />
      <ProductDialog product={open} groups={groups} from={from} to={to} onOpenChange={(o) => !o && setOpenId(null)} onChanged={load} />
    </div>
  );
}

/**
 * Which of the chosen names to keep. The others' names move over, so the rows
 * already stored and the ones pasted next month read as one grocery.
 */
function MergeDialog({
  open,
  products,
  onOpenChange,
  onMerged,
}: {
  open: boolean;
  products: Product[];
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}) {
  const [keep, setKeep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setKeep(products[0]?.id ?? null);
  }, [open, products]);

  const save = async () => {
    if (keep === null || busy) return;
    setBusy(true);
    try {
      await sendJson("POST", "/products/merge", { keepId: keep, mergeIds: products.filter((p) => p.id !== keep).map((p) => p.id) });
      notify({ text: "Varorna är en nu." });
      onMerged();
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[26rem] max-w-[calc(100vw-2rem)]">
        <DialogTitle>Slå ihop varor</DialogTitle>
        <DialogDescription className="mt-1">Vilket namn ska varan heta? De andras namn flyttas hit, och nästa kvitto med något av dem hamnar rätt.</DialogDescription>
        <ul className="mt-3 space-y-1">
          {products.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-band">
                <input type="radio" name="keep" checked={keep === p.id} onChange={() => setKeep(p.id)} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-ink-2 tabular-nums">
                  {p.times} ggr · <Money ore={p.totalOre} />
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" disabled={keep === null || busy} onClick={() => void save()}>
            Slå ihop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One grocery: its name, its shelf, and every name the shops have printed for it. */
function ProductDialog({
  product,
  groups,
  from,
  to,
  onOpenChange,
  onChanged,
}: {
  product: Product | null;
  groups: ProductGroup[];
  from: string;
  to: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const id = product?.id ?? null;
  useEffect(() => {
    if (product) setName(product.name);
  }, [product]);
  useEffect(() => {
    setHistory(null);
    if (id === null) return;
    let alive = true;
    getJson<ProductHistory>(`/products/${id}/history?${query({ from, to })}`).then(
      (h) => alive && setHistory(h),
      () => alive && setHistory(null),
    );
    return () => {
      alive = false;
    };
  }, [id, from, to]);
  if (!product) return null;

  const run = async (call: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await call();
      onChanged();
      if (done) notify({ text: done });
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (name.trim() === product.name) return;
    await run(() => sendJson("PUT", `/products/${product.id}`, { name }), "Varan är omdöpt.");
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[30rem] max-w-[calc(100vw-2rem)]">
        <DialogTitle>{product.name}</DialogTitle>
        <DialogDescription className="mt-1">
          {product.times} {product.times === 1 ? "gång" : "gånger"} i perioden, <Money ore={product.totalOre} />
          {product.lastPurchase && ` · senast ${shortDate(product.lastPurchase)}`}
        </DialogDescription>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input aria-label="Varans namn" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} className={cn(field, "min-w-0 flex-1")} />
          <select
            aria-label="Hylla"
            value={product.groupId === null ? "" : String(product.groupId)}
            disabled={busy}
            onChange={(e) => void run(() => sendJson("PUT", `/products/${product.id}`, { groupId: e.target.value === "" ? null : Number(e.target.value) }))}
            className={field}
          >
            <option value="">Utan hylla</option>
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {history && history.rows.length > 0 && (
          <>
            <p className="mt-3 text-sm text-ink-2">
              {history.everyDays !== null && <>Köps ungefär var {history.everyDays}:e dag · </>}
              {history.perMonthOre !== null && <>{kr(history.perMonthOre)} i månaden</>}
              {history.cheapestStore && <> · billigast på {RECEIPT_STORE_NAMES[history.cheapestStore]}</>}
            </p>
            {history.rows.length > 1 && (
              <div className="mt-2 h-28 w-full">
                <ResponsiveContainer>
                  {/* What one of them cost: the receipt's à-pris when it gives one ('2 st à
                      15,61'), otherwise the row itself, which is then the price of one.
                      Buying two shouldn't look like the price doubling. */}
                  <LineChart
                    data={history.rows.map((r) => ({ ...r, label: shortDate(r.date), priceOre: r.unitPriceOre ?? r.totalOre }))}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                    <XAxis dataKey="label" tick={chart.tick} stroke={chart.grid} />
                    <YAxis tickFormatter={kTick} tick={chart.tick} width={40} stroke={chart.grid} domain={[0, "auto"]} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const r = payload[0].payload as ProductHistory["rows"][number] & { label: string; priceOre: number };
                        const quantity = quantityText(r);
                        return (
                          <ChartTooltip
                            title={`${RECEIPT_STORE_NAMES[r.store]} ${r.label}`}
                            lines={[{ name: r.unit ? `per ${r.unit}` : "styckpris", value: kr(r.priceOre) }]}
                            footer={
                              quantity && (
                                <p className="flex justify-between">
                                  <span>{quantity}</span>
                                  <span className="tabular-nums">{kr(r.totalOre)}</span>
                                </p>
                              )
                            }
                          />
                        );
                      }}
                    />
                    <Line type="monotone" dataKey="priceOre" stroke={chart.line} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <ul className="mt-2 max-h-40 divide-y divide-hairline overflow-y-auto rounded-md border border-hairline text-sm">
              {[...history.rows].reverse().map((r, i) => (
                <li key={`${r.receiptId}-${i}`} className="flex items-baseline gap-2 px-2 py-1">
                  <span className="w-12 shrink-0 text-ink-2 tabular-nums">{shortDate(r.date)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {RECEIPT_STORE_NAMES[r.store]}
                    <span className="pl-1.5 text-xs text-ink-3">{quantityText(r) ?? r.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <Money ore={r.totalOre} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-2">Namn på kvittona</h3>
        <ul className="mt-1 divide-y divide-hairline rounded-md border border-hairline text-sm">
          {product.aliases.map((a) => (
            <li key={a} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">{a}</span>
              {product.aliases.length > 1 && (
                <button
                  type="button"
                  aria-label={`Lossa ${a}`}
                  title="Lossa namnet till en egen vara"
                  disabled={busy}
                  onClick={() => void run(() => sendJson("POST", "/products/detach", { nameKey: a }), "Namnet är en egen vara igen.")}
                  className="rounded p-1 text-ink-2 hover:text-ink"
                >
                  <Scissors className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {product.aliases.length === 1 && <p className="mt-1 text-xs text-ink-2">Markera två varor i listan för att slå ihop dem.</p>}

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Stäng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
