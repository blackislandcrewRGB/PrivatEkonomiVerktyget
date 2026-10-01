import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { getJson, sendJson, type FuelOverview, type FuelSettings } from "../../../api";
import { useCategories } from "../../../categories";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { CompactRow, Editable } from "../compact";
import { carSummary } from "../summaries";
import { BUTTON, FIELD } from "../ui";
import type { SectionProps } from "./types";

const kronor = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseKronor = (s: string) => Math.round(Number(s.replace(/\s/g, "").replace(",", ".")) * 100);
const decimal = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/**
 * Bil: what Pendling & bränsle needs. The distances, other driving, the
 * table consumption, congestion tax per shift and which category is fuel
 * (edited together), and the diesel price, entered with its date whenever
 * it changes.
 */
export function CarSection({ open, onToggle, match }: SectionProps) {
  const [data, setData] = useState<FuelOverview | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Local date (sv-SE formats as YYYY-MM-DD).
  const [priceDate, setPriceDate] = useState(todayIso);
  const [price, setPrice] = useState("");
  const categories = useCategories();
  const load = useCallback(() => getJson<FuelOverview>("/fuel").then(setData, () => setData(null)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!data) return null;
  const summary = carSummary(data, categories);
  if (!match("Bil", "diesel", "bränsle", "trängselskatt", summary.summary, summary.hint)) return null;
  const s = data.settings;
  const pathOf = (id: number | null) => {
    const c = categories.find((x) => x.id === id);
    const p = c?.parentId != null ? categories.find((x) => x.id === c.parentId) : undefined;
    return c ? (p ? `${p.name} › ${c.name}` : c.name) : "–";
  };
  const leaves = categories.filter((c) => c.parentId !== null && !c.isTransfer && !c.isSettlement);

  const addPrice = async () => {
    try {
      await sendJson("POST", "/fuel/prices", { date: priceDate, price: parseKronor(price) });
      setPrice("");
      notify({ text: `Diesel ${price} kr/l från ${priceDate}.` });
      load();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const removePrice = async (id: number) => {
    await sendJson("DELETE", `/fuel/prices/${id}`, {});
    load();
  };
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-ink-2 max-sm:mt-2 max-sm:text-xs">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
  const field = (key: string, label: string, suffix: string) => (
    <label className="grid gap-1 text-[13px]">
      <span className="text-[11px] text-ink-2">{label}</span>
      <span className="flex items-center gap-2">
        <input aria-label={label} inputMode="decimal" className={cn(FIELD, "w-28 text-right tabular-nums")} value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
        <span className="text-[11px] text-ink-2">{suffix}</span>
      </span>
    </label>
  );

  return (
    <CompactRow id="bil" name="Bil" summary={summary.summary} hint={summary.hint} open={open} onToggle={onToggle}>
      <Editable
      description="För Pendling & bränsle: månadens bränsle räknas ut från antalet arbetspass och dras av i Översiktens prognos."
      onEdit={() =>
        setDraft({
          kmPerShift: String(s.kmPerShift),
          otherKmPerMonth: String(s.otherKmPerMonth),
          baseConsumption: String(s.baseConsumption).replace(".", ","),
          congestion: kronor(s.congestionPerShift),
          categoryId: s.categoryId === null ? "" : String(s.categoryId),
          useCalibrated: s.useCalibrated ? "1" : "",
        })
      }
      onSave={async () => {
        const patch: Partial<FuelSettings> = {
          kmPerShift: decimal(draft.kmPerShift),
          otherKmPerMonth: decimal(draft.otherKmPerMonth),
          baseConsumption: decimal(draft.baseConsumption),
          congestionPerShift: parseKronor(draft.congestion || "0"),
          categoryId: draft.categoryId ? Number(draft.categoryId) : null,
          useCalibrated: draft.useCalibrated === "1",
        };
        await sendJson("PUT", "/fuel/settings", patch);
        load();
      }}
      edit={
        <div className="grid gap-3 @[40rem]:grid-cols-2">
          {field("kmPerShift", "Sträcka per pass (tur och retur)", "km")}
          {field("otherKmPerMonth", "Övrig körning per månad", "km")}
          {field("baseConsumption", "Förbrukning, tabellvärde", "l/100 km")}
          {field("congestion", "Trängselskatt per pass", "kr")}
          <label className="grid gap-1 text-[13px]">
            <span className="text-[11px] text-ink-2">Tankning är kategorin</span>
            <select className={FIELD} value={draft.categoryId ?? ""} onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}>
              <option value="">Bil › Drivmedel (standard)</option>
              {leaves.map((c) => (
                <option key={c.id} value={c.id}>
                  {pathOf(c.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-[13px]">
            <input type="checkbox" checked={draft.useCalibrated === "1"} onChange={(e) => setDraft((d) => ({ ...d, useCalibrated: e.target.checked ? "1" : "" }))} />
            Använd kalibrerad förbrukning när den finns
          </label>
        </div>
      }
    >
      <div className="space-y-4 text-[13px]">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 @[40rem]:grid-cols-[12rem_minmax(0,1fr)]">
          {row("Sträcka per pass", `${s.kmPerShift} km (${s.kmPerShift / 2} km enkel väg)`)}
          {row("Övrig körning", `${s.otherKmPerMonth} km per månad`)}
          {row(
            "Förbrukning",
            data.calibration && s.useCalibrated
              ? `${data.calibration.l100.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} l/100 km kalibrerat (tabellvärde ${String(s.baseConsumption).replace(".", ",")})`
              : `${String(s.baseConsumption).replace(".", ",")} l/100 km (tabellvärde${s.useCalibrated ? ", inget kalibrerat än" : ""})`,
          )}
          {row("Trängselskatt", s.congestionPerShift ? `${kronor(s.congestionPerShift)} kr per pass` : "ingen")}
          {row("Tankning", pathOf(s.fuelCategoryId))}
        </dl>

        <div>
          <h3 className="text-xs font-medium text-ink-2">Literpris diesel</h3>
          <p className="mt-1">
            {data.latestPrice ? (
              <>
                <span className="font-medium tabular-nums">{kronor(data.latestPrice.price)} kr/l</span>, angivet {data.latestPrice.date}{" "}
                <span className={cn("text-xs", data.latestPrice.ageDays > 30 ? "text-caution-text" : "text-ink-2")}>
                  ({data.latestPrice.ageDays === 0 ? "i dag" : `för ${data.latestPrice.ageDays} dagar sedan`})
                </span>
              </>
            ) : (
              <span className="text-caution-text">Inget pris angivet än.</span>
            )}
          </p>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (price.trim()) addPrice();
            }}
          >
            <label className="grid gap-1 text-[11px] text-ink-2">
              Datum
              <input type="date" value={priceDate} onChange={(e) => setPriceDate(e.target.value)} className={cn(FIELD, "w-40 text-ink")} />
            </label>
            <label className="grid gap-1 text-[11px] text-ink-2">
              Pris (kr/l)
              <input aria-label="Literpris" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="19,49" className={cn(FIELD, "w-24 text-right text-ink")} />
            </label>
            <button type="submit" className={BUTTON.blue} disabled={!price.trim()}>
              <Plus className="size-3.5" aria-hidden /> Lägg till pris
            </button>
          </form>
          {data.prices.length > 0 && (
            <ul className="mt-2 max-w-sm divide-y divide-border text-[11px] text-ink-2" aria-label="Literpriser">
              {data.prices.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-1">
                  <span className="tabular-nums">{p.date}</span>
                  <span className="flex-1 text-right tabular-nums text-ink">{kronor(p.price)} kr/l</span>
                  <button type="button" onClick={() => removePrice(p.id)} aria-label={`Ta bort priset ${p.date}`} className="rounded p-0.5 hover:text-alarm">
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Editable>
    </CompactRow>
  );
}
