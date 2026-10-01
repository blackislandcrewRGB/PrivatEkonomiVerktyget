import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { getJson, sendJson, type FuelFill, type FuelFillMissing } from "../../api";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";

/**
 * Kvitton: liter och literpris per tankning.
 *
 * The bank only says what a tank cost. The litres are on the receipt, and so
 * is the discount — and until they are entered here, the consumption is the
 * amount divided by a price typed in by hand, which is an estimate that has
 * been running about three percent low.
 *
 * The form checks the receipt against itself while it is being filled in:
 * price times litres less the discount has to be the amount the bank charged.
 * A mistyped litre count is then a red line in the form, not a consumption
 * figure nobody can explain later.
 */

const kr = (ore: number) => `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
const perLitre = (ore: number) => `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/l`;
const litres = (e2: number) => `${(e2 / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} l`;
/** The latest receipts shown before 'Visa alla'. */
const SHOWN = 8;
const whole = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
const dm = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(".", "");

/** A Swedish-typed number: spaces ignored, comma or full stop. NaN when it isn't one. */
const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

const input = "h-8 rounded-[9px] border border-neutral-bar/70 bg-card px-2 text-sm text-ink tabular-nums outline-none focus:border-accent";

interface Data {
  fills: FuelFill[];
  missing: FuelFillMissing[];
}

export function Receipts({ onChanged, onError }: { onChanged: () => void; onError: (e: unknown) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const load = () => getJson<Data>("/fuel/fills").then(setData, onError);
  useEffect(() => {
    void load();
    // Loaded once with the view; every change reloads it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return null;

  const saved = async () => {
    setOpen(null);
    await load();
    onChanged();
  };

  const remove = async (fill: FuelFill) => {
    try {
      await sendJson("DELETE", `/fuel/fills/${fill.id}`, {});
      await saved();
    } catch (e) {
      onError(e);
    }
  };

  const openMissing = data.missing.find((m) => m.id === open) ?? null;
  const fills = all ? data.fills : data.fills.slice(0, SHOWN);

  return (
    <Card aria-labelledby="receipts-title" className="min-w-0 overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 id="receipts-title" className="text-base font-semibold">
          Tankningar med kvitto
        </h2>
        <p className="text-[11px] text-ink-3" title="Liter och literpris står bara på kvittot. Med dem mäts förbrukningen i stället för att räknas ur beloppet och ett pris.">
          liter och literpris från kvittot · rabatten syns för sig
        </p>
      </div>

      {data.missing.length > 0 && (
        <div className="px-4 pt-3 sm:px-5">
          <ul className="flex flex-wrap gap-1.5" aria-label="Tankningar utan kvitto">
            {data.missing.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-expanded={open === m.id}
                  aria-label={`Kvitto för ${dm(m.date)} ${m.description}, ${whole(m.amountOre)}`}
                  onClick={() => setOpen(open === m.id ? null : m.id)}
                  className={cn(
                    "rounded-full bg-caution-soft px-2.5 py-1 text-left text-[11px] text-caution-text hover:brightness-95",
                    open === m.id && "ring-2 ring-caution/50",
                  )}
                >
                  {i === 0 && "Utan kvitto: "}
                  {dm(m.date)} {m.description} {whole(m.amountOre)} · <b className="font-semibold">lägg till</b>
                </button>
              </li>
            ))}
          </ul>
          {openMissing && (
            <div className="mt-3 rounded-inset bg-card-inset px-3 py-2.5">
              <p className="text-[12px] font-semibold">
                {dm(openMissing.date)} {openMissing.description} · {kr(openMissing.amountOre)}
              </p>
              <FillForm key={openMissing.id} purchase={openMissing} onSaved={saved} onError={onError} />
            </div>
          )}
        </div>
      )}

      <ul className="mt-3" aria-label="Kvitton">
        {fills.map((f) => (
          <li key={f.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 border-t border-hairline px-4 py-2 text-[13px] sm:grid-cols-[3.5rem_minmax(0,1fr)_4.5rem_5.5rem_4.5rem_1.75rem] sm:px-5">
            <span className="text-ink-3 tabular-nums">{dm(f.date)}</span>
            <span className="min-w-0 truncate" title={f.station ?? undefined}>
              {f.station ?? "Tankning"}
            </span>
            <span className="text-right text-ink-2 tabular-nums max-sm:hidden">{litres(f.litresE2)}</span>
            <span className="text-right font-semibold tabular-nums" title="Betalt per liter: beloppet delat med litern">
              {perLitre(Math.round((f.amountOre * 100) / f.litresE2))}
            </span>
            <span className="text-right text-[12px] text-positive-text tabular-nums max-sm:hidden" title={f.discountOre > 0 ? `Rabatt ${kr(f.discountOre)} på tankningen` : undefined}>
              {f.discountOre > 0 ? `−${Math.round((f.discountOre * 100) / f.litresE2)} öre/l` : ""}
            </span>
            <button type="button" onClick={() => remove(f)} aria-label={`Ta bort kvittot ${f.date}`} className="grid size-7 place-items-center justify-self-end rounded-md text-ink-3 hover:bg-card-inset hover:text-danger">
              <Trash2 className="size-3.5" />
            </button>
            {/* Phones: litres and discount under the station. */}
            <span className="col-span-2 col-start-2 text-[11px] text-ink-3 tabular-nums sm:hidden">
              {litres(f.litresE2)}
              {f.discountOre > 0 && <span className="text-positive-text"> · −{Math.round((f.discountOre * 100) / f.litresE2)} öre/l</span>}
            </span>
          </li>
        ))}
        {data.fills.length === 0 && <li className="border-t border-hairline px-5 py-4 text-[13px] text-ink-3">Inga kvitton inlagda än.</li>}
      </ul>
      {data.fills.length > SHOWN && (
        <button type="button" onClick={() => setAll((x) => !x)} className="block w-full border-t border-hairline px-4 py-3 text-left text-[13px] font-semibold text-accent hover:bg-band sm:px-5">
          {all ? "Visa färre" : `Visa alla ${data.fills.length} ›`}
        </button>
      )}
    </Card>
  );
}

function FillForm({ purchase, onSaved, onError }: { purchase: FuelFillMissing; onSaved: () => void; onError: (e: unknown) => void }) {
  const [date, setDate] = useState(purchase.date);
  const [litre, setLitre] = useState("");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);

  const litresE2 = Math.round(num(litre) * 100);
  const listPriceOre = Math.round(num(price) * 100);
  const discountOre = discount.trim() === "" ? 0 : Math.round(num(discount) * 100);
  const filled = litre.trim() !== "" && price.trim() !== "";
  const numbers = filled && Number.isFinite(litresE2) && Number.isFinite(listPriceOre) && Number.isFinite(discountOre) && litresE2 > 0 && listPriceOre > 0;

  // The receipt's own arithmetic, shown while it is typed: a mistyped litre
  // count is a line that does not add up, here, rather than a consumption
  // figure to wonder about in a month's time.
  const gross = numbers ? Math.round((listPriceOre * litresE2) / 100) : null;
  const total = gross === null ? null : gross - discountOre;
  const off = total === null ? null : total - purchase.amountOre;
  const fits = off !== null && Math.abs(off) <= 2;
  const paid = numbers ? Math.round((purchase.amountOre * 100) / litresE2) : null;

  const save = async () => {
    setBusy(true);
    try {
      await sendJson("POST", "/fuel/fills", {
        date,
        litresE2,
        listPriceOre,
        discountOre,
        amountOre: purchase.amountOre,
        transactionId: purchase.id,
        station: purchase.description,
      });
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (fits && !busy) void save();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-ink-2">
          Kvittots datum
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Kvittots datum" className={cn(input, "mt-0.5 block")} />
        </label>
        <label className="text-[11px] text-ink-2">
          Liter
          <input inputMode="decimal" value={litre} onChange={(e) => setLitre(e.target.value)} placeholder="50,00" aria-label="Liter" className={cn(input, "mt-0.5 block w-24 text-right")} />
        </label>
        <label className="text-[11px] text-ink-2">
          Literpris
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="20,00" aria-label="Literpris" className={cn(input, "mt-0.5 block w-24 text-right")} />
        </label>
        <label className="text-[11px] text-ink-2">
          Rabatt
          <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="10,00" aria-label="Rabatt" className={cn(input, "mt-0.5 block w-24 text-right")} />
        </label>
        <Button size="sm" type="submit" disabled={!fits || busy} className="h-8 rounded-[9px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
          Spara
        </Button>
      </div>
      <p className={cn("text-[11px] tabular-nums", !numbers || fits ? "text-ink-2" : "text-caution-text")}>
        {!numbers ? (
          <>Literpriset och litern står överst på kvittot; rabatten en bit ned. Beloppet är {kr(purchase.amountOre)}.</>
        ) : fits ? (
          <>
            {litres(litresE2)} × {perLitre(listPriceOre)}
            {discountOre > 0 ? ` − ${kr(discountOre)}` : ""} = {kr(total!)} — stämmer med banken. Betalt {perLitre(paid!)}
            {discountOre > 0 ? `, ${Math.round((discountOre * 100) / litresE2)} öre/l under pumppriset` : ""}.
          </>
        ) : (
          <>
            {litres(litresE2)} × {perLitre(listPriceOre)}
            {discountOre > 0 ? ` − ${kr(discountOre)}` : ""} = {kr(total!)}, men banken drog {kr(purchase.amountOre)} ({off! > 0 ? "+" : "−"}
            {kr(Math.abs(off!))}).
          </>
        )}
      </p>
    </form>
  );
}
