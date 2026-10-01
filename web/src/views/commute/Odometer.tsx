import { useState } from "react";
import { Trash2 } from "lucide-react";
import { sendJson, type FuelOverview } from "../../api";
import { Card } from "../../components/Card";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short", year: "numeric" }).replace(".", "");
const km = (v: number) => `${Math.round(v).toLocaleString("sv-SE")} km`;
/** '10/8 2026'. */
const dmy = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))} ${iso.slice(0, 4)}`;

/**
 * Mätarställning: readings of the odometer checked against the shifts and
 * other driving between the first and the last, with a suggestion for the
 * other driving when they differ; the readings with a bin, and a new one
 * entered in a grey box.
 */
export function Odometer({ data, onChanged, onError }: { data: FuelOverview; onChanged: () => void; onError: (e: unknown) => void }) {
  const [date, setDate] = useState(data.today);
  const [reading, setReading] = useState("");
  const check = data.odometer;
  const add = async () => {
    try {
      await sendJson("POST", "/fuel/odometer", { date, km: Number(reading.replace(/\s/g, "")) });
      setReading("");
      onChanged();
    } catch (e) {
      onError(e);
    }
  };
  const remove = async (id: number) => {
    try {
      await sendJson("DELETE", `/fuel/odometer/${id}`, {});
      onChanged();
    } catch (e) {
      onError(e);
    }
  };
  const useSuggestion = async (otherKmPerMonth: number) => {
    try {
      await sendJson("PUT", "/fuel/settings", { otherKmPerMonth });
      notify({ text: `Övrig körning är nu ${otherKmPerMonth} km per månad.` });
      onChanged();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <Card aria-labelledby="odometer-title" className="min-w-0 space-y-3 text-[13px]">
      <h2 id="odometer-title" className="text-base font-semibold">
        Mätarställning
      </h2>
      {check && (
        <div className="text-[12px] text-ink-2">
          {check.modelKm === null ? (
            <p>
              Mellan {dmy(check.from.date)} och {dmy(check.to.date)} visar mätaren {km(check.actualKm)}. För att jämföra behövs pass för {check.missing.length}{" "}
              {check.missing.length === 1 ? "månad" : "månader"} till: {check.missing.map((m) => monthLabel(m)).join(", ")}.
            </p>
          ) : (
            <p>
              Mellan {dmy(check.from.date)} och {dmy(check.to.date)}: {km(check.actualKm)} enligt mätaren, {km(check.modelKm)} enligt passen och övrig körning
              {check.deviation !== null && (
                <span className={cn(Math.abs(check.deviation) > 0.1 ? "text-caution-text" : "text-ink-3")}>
                  {" "}
                  ({check.deviation > 0 ? "+" : ""}
                  {Math.round(check.deviation * 100)} %)
                </span>
              )}
              .
              {check.suggestedOtherKm !== null && (
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  Förslag: övrig körning {check.suggestedOtherKm} km per månad i stället för {data.settings.otherKmPerMonth}.
                  <Button size="sm" onClick={() => useSuggestion(check.suggestedOtherKm!)} className="h-7 rounded-[9px] border-0 bg-card-inset px-3 text-[12px] font-semibold text-ink hover:bg-segment">
                    Använd
                  </Button>
                </span>
              )}
            </p>
          )}
        </div>
      )}
      <ul className="-mx-5 sm:-mx-7" aria-label="Mätarställningar">
        {data.readings.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-2.5 sm:px-7">
            <span className="text-ink-2 tabular-nums">{dmy(r.date)}</span>
            <span className="flex-1 text-right font-semibold tabular-nums">{km(r.km)}</span>
            <button type="button" onClick={() => remove(r.id)} aria-label={`Ta bort mätarställningen ${r.date}`} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-card-inset hover:text-danger">
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
        {data.readings.length === 0 && <li className="border-t border-hairline px-5 py-3 text-ink-3 sm:px-7">Inga avläsningar än. Två behövs för att jämföra.</li>}
      </ul>
      <form
        className="flex items-center gap-2 rounded-inset bg-card-inset p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reading.trim()) add();
        }}
      >
        <input
          type="date"
          aria-label="Datum"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 min-w-0 flex-[1.3] basis-0 rounded-[9px] border border-neutral-bar/70 bg-card px-2 text-[13px] text-ink outline-none focus:border-accent"
        />
        <input
          inputMode="numeric"
          aria-label="Mätarställning"
          value={reading}
          onChange={(e) => setReading(e.target.value.replace(/[^\d\s]/g, ""))}
          placeholder="123 456 km"
          className="h-8 min-w-0 flex-1 basis-0 rounded-[9px] border border-neutral-bar/70 bg-card px-2 text-right text-[13px] tabular-nums text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <Button type="submit" size="sm" disabled={!reading.trim()} className="h-8 rounded-[9px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
          Lägg till
        </Button>
      </form>
    </Card>
  );
}
