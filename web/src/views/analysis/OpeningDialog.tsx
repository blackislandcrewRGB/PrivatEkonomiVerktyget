import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ACCOUNT_NAMES, ZONE_NAMES, parseKr, parseScaled, sendJson, type InstrumentCurrency, type InstrumentZone, type TradeAccount } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { kr } from "./common";
import { todayIso } from "../../lib/today";

/**
 * Startinnehav: the portfolio as it already is.
 *
 * A portfolio exists before the tool does, and the trades that built it are
 * at the broker, not here. So this asks for what the broker's own page shows
 * — how many, and the average price paid (GAV) — and writes one `opening`
 * trade per holding. It is deliberately a table with several rows, because
 * that is how the page it is copied from looks.
 *
 * The cash is asked for in the same breath: the broker's value for the
 * account includes it, and without it the reconciliation would call it an
 * error.
 */

const field = "h-8 w-full rounded-md border border-hairline bg-card px-2 text-sm outline-none focus:border-accent";

interface Row {
  key: number;
  name: string;
  ticker: string;
  isin: string;
  currency: InstrumentCurrency;
  zone: InstrumentZone;
  quantity: string;
  gav: string;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, name: "", ticker: "", isin: "", currency: "USD", zone: "bet", quantity: "", gav: "" });

export function OpeningDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [account, setAccount] = useState<TradeAccount>("isk");
  const [cash, setCash] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([emptyRow()]);
    setCash("");
    setError(null);
  }, [open]);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.name.trim() || r.quantity.trim() || r.gav.trim());
  const parsed = filled.map((r) => ({ row: r, quantityE4: parseScaled(r.quantity, 4), priceE4: parseScaled(r.gav, 4) }));
  const cashOre = cash.trim() === "" ? null : parseKr(cash);
  const ready = parsed.length > 0 && parsed.every((p) => p.row.name.trim() && p.quantityE4 !== null && p.quantityE4 > 0 && p.priceE4 !== null) && (cash.trim() === "" || cashOre !== null);

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson("POST", "/savings/opening", {
        date,
        account,
        cashOre,
        rows: parsed.map(({ row, quantityE4, priceE4 }) => ({
          name: row.name.trim(),
          isin: row.isin.trim() || null,
          currency: row.currency,
          kind: row.zone === "base" ? "etf" : "stock",
          zone: row.zone,
          tickerYahoo: row.ticker.trim() || null,
          quantityE4,
          priceE4,
        })),
      });
      notify({ text: `${parsed.length} innehav är inlagda. Tryck Hämta kurser för kurserna.` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[46rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
        <DialogTitle>Startinnehav</DialogTitle>
        <DialogDescription className="mt-1">
          Innehaven som de står hos Avanza i dag. Priset är genomsnittligt anskaffningsvärde (GAV), inte ett enskilt köp — de köpen finns inte här, och att låtsas
          om dem vore sämre än att säga som det är.
        </DialogDescription>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-ink-2">Per datum</span>
            <input aria-label="Datum" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(field, "mt-0.5 w-40")} />
          </label>
          <label className="block">
            <span className="text-xs text-ink-2">Konto</span>
            <select aria-label="Konto" value={account} onChange={(e) => setAccount(e.target.value as TradeAccount)} className={cn(field, "mt-0.5 w-28")}>
              {(["isk", "depot"] as const).map((a) => (
                <option key={a} value={a}>
                  {ACCOUNT_NAMES[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-ink-2">Likvider (kr)</span>
            <input aria-label="Likvider" inputMode="decimal" placeholder="12 480,25" value={cash} onChange={(e) => setCash(e.target.value)} className={cn(field, "mt-0.5 w-36 tabular-nums")} />
          </label>
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-2">
              <th className="pb-1 font-medium">Instrument</th>
              <th className="pb-1 font-medium">Ticker</th>
              <th className="pb-1 font-medium">Valuta</th>
              <th className="pb-1 font-medium">Zon</th>
              <th className="pb-1 text-right font-medium">Antal</th>
              <th className="pb-1 text-right font-medium">Snittinköp</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="py-0.5 pr-1">
                  <input aria-label={`Namn rad ${i + 1}`} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} className={field} />
                </td>
                <td className="py-0.5 pr-1">
                  <input aria-label={`Ticker rad ${i + 1}`} placeholder="EXA" value={r.ticker} onChange={(e) => set(r.key, { ticker: e.target.value })} className={cn(field, "w-24")} />
                </td>
                <td className="py-0.5 pr-1">
                  <select aria-label={`Valuta rad ${i + 1}`} value={r.currency} onChange={(e) => set(r.key, { currency: e.target.value as InstrumentCurrency })} className={cn(field, "w-20")}>
                    {(["SEK", "USD", "EUR"] as const).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-0.5 pr-1">
                  <select aria-label={`Zon rad ${i + 1}`} value={r.zone} onChange={(e) => set(r.key, { zone: e.target.value as InstrumentZone })} className={cn(field, "w-28")}>
                    {(["base", "bet"] as const).map((z) => (
                      <option key={z} value={z}>
                        {ZONE_NAMES[z]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-0.5 pr-1">
                  <input
                    aria-label={`Antal rad ${i + 1}`}
                    inputMode="decimal"
                    value={r.quantity}
                    onChange={(e) => set(r.key, { quantity: e.target.value })}
                    className={cn(field, "w-20 text-right tabular-nums")}
                  />
                </td>
                <td className="py-0.5 pr-1">
                  <input
                    aria-label={`Snittinköp rad ${i + 1}`}
                    inputMode="decimal"
                    value={r.gav}
                    onChange={(e) => set(r.key, { gav: e.target.value })}
                    className={cn(field, "w-24 text-right tabular-nums")}
                  />
                </td>
                <td className="py-0.5">
                  <button
                    type="button"
                    aria-label={`Ta bort rad ${i + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="rounded p-1 text-ink-2 hover:text-alarm disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          <Plus /> Rad till
        </Button>

        <p className="mt-3 text-xs text-ink-2">
          Kurserna hämtas efteråt, så värdet blir dagens. Snittinköpet räknas om till kronor med Riksbankens kurs för datumet ovan — köptes de när dollarn stod
          lägre blir insatt netto något för högt, och då kan kursen rättas per affär i efterhand.
        </p>
        {cashOre !== null && <p className="mt-1 text-xs text-ink-2">Likvider: {kr(cashOre)}</p>}
        {error && <p className="mt-2 text-sm text-alarm">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            Lägg in {parsed.length > 0 ? `${parsed.length} innehav` : "innehav"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
