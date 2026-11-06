import { useState } from "react";
import { Trash2 } from "lucide-react";
import { sendJson, type SalaryOverview } from "../../api";
import { notify } from "../../components/Toast";
import { dm } from "../overview/format";
import { h, monthOnly, num } from "./format";
import { UnitInput } from "./UnitInput";

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "numeric" }).replace(".", "");

/**
 * 'Sjuk': the days (and hours) of the work month off sick. Saved at once, one
 * by one: the sick pay and the karensavdrag follow in the forecast. The hours
 * are part of 'Timmar totalt', as the vacation's are.
 */
export function Sick({ info, month, onChanged }: { info: SalaryOverview; month: string; onChanged: () => void }) {
  const [date, setDate] = useState("");
  const [hours, setHours] = useState("");
  // Bumped when a change is refused: the fields show what is saved again.
  const [reset, setReset] = useState(0);
  const days = info.sickDays.filter((d) => d.date.startsWith(month));
  const periods = info.sickPeriods.filter((p) => p.days.some((d) => d.date.startsWith(month)));
  const shift = h(info.settings.shiftHours);

  const run = async (method: "PUT" | "DELETE", on: string, body?: { hours: number }) => {
    try {
      await sendJson(method, `/salary/sick/${on}`, body ?? {});
      onChanged();
      return true;
    } catch (e) {
      notify({ text: (e as Error).message });
      setReset((n) => n + 1);
      return false;
    }
  };
  /** Quarters of an hour, up to 24, as the server takes them. */
  const valid = (v: number) => v > 0 && v <= 24 && Math.round(v * 4) === v * 4;
  const add = async () => {
    const hrs = hours.trim() ? num(hours) : info.settings.shiftHours;
    if (!date.startsWith(month)) return notify({ text: `Välj ett datum i ${monthOnly(month)}.` });
    if (!valid(hrs)) return notify({ text: "Sjuktimmarna ska vara mellan 0,25 och 24, i kvartar." });
    if (await run("PUT", date, { hours: hrs })) {
      setDate("");
      setHours("");
    }
  };

  return (
    <div className="space-y-2.5 rounded-inset bg-card-inset p-3" data-testid="sick-fields">
      {days.length === 0 && <p className="text-[12px] text-ink-3">Inga sjukdagar i {monthOnly(month)}.</p>}
      {days.length > 0 && (
        <ul className="grid gap-1.5">
          {days.map((d) => (
            <li key={d.date} className="flex items-center gap-2.5">
              <span className="w-24 text-[13px] capitalize text-ink">{day(d.date)}</span>
              <UnitInput
                aria-label={`Sjuktimmar ${d.date}`}
                className="w-28"
                defaultValue={h(d.hours)}
                key={`${d.date}-${d.hours}-${reset}`}
                onBlur={(e) => {
                  const v = num(e.target.value);
                  if (v === d.hours) return;
                  if (!valid(v)) {
                    notify({ text: "Sjuktimmarna ska vara mellan 0,25 och 24, i kvartar." });
                    setReset((n) => n + 1);
                    return;
                  }
                  void run("PUT", d.date, { hours: v });
                }}
              />
              <button type="button" aria-label={`Ta bort ${d.date}`} onClick={() => void run("DELETE", d.date)} className="text-ink-3 hover:text-negative">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        aria-label="Lägg till sjukdag"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="grid gap-1">
          <span className="text-[11px] text-ink-2">Datum</span>
          <input
            type="date"
            aria-label="Sjukdag"
            value={date}
            min={`${month}-01`}
            max={`${month}-31`}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-[9px] border border-neutral-bar/70 bg-card px-2.5 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] text-ink-2">Timmar</span>
          <UnitInput aria-label="Sjuktimmar" className="w-28" placeholder={shift} value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <button type="submit" disabled={!date} className="h-9 whitespace-nowrap rounded-[9px] bg-accent px-3 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-40">
          Lägg till
        </button>
      </form>
      {periods.map((p) => {
        const starts = p.from.startsWith(month);
        return (
          <p key={p.from} className="text-[12px] text-ink-2" data-sick-period>
            Sjukperiod {dm(p.from)}–{dm(p.to)} · {h(p.hours)} tim ·{" "}
            {starts ? `karensavdrag i ${monthOnly(month)}` : `fortsätter från ${monthOnly(p.from.slice(0, 7))}, karensavdraget räknas från ${monthOnly(p.from.slice(0, 7))}`}
          </p>
        );
      })}
      <p className="text-[11px] text-ink-3">
        Sjuktimmarna ingår i Timmar totalt; en hel sjukdag är inget pass i Pendling (avmarkera den där), en deldag ligger i passet. De dras med timlönen och betalas som sjuklön, 80 %, och en gång per sjukperiod dras karensavdrag (20 % av en veckas sjuklön). En ny sjukdag inom fem dagar fortsätter perioden. Reglerna är antagna tills en spec med sjuklön är inläst.
      </p>
    </div>
  );
}
