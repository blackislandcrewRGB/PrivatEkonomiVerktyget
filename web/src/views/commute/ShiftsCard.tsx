import { useEffect, useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { getJson, sendJson, type FuelMonth, type FuelOverview } from "../../api";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";
import { useWidth } from "../../lib/useWidth";
import { dm, kr } from "../overview/format";
import { MonthBars } from "./MonthBars";
import { consumptionOf, monthEstimate, shownMonths } from "./months";

const monthLabel = (m: string, year = true) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", year ? { month: "short", year: "numeric" } : { month: "short" }).replace(".", "");
/** 'sep 25': the month on a phone, where the columns are tight. */
const shortLabel = (m: string) => `${monthLabel(m, false)} ${m.slice(2, 4)}`;
const l100 = (v: number) => v.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * 'Pass per månad': reckoned and bought as bars over the same 13 months as
 * the table (a year back to this month, oldest first), then the table with
 * the shifts to fill in (or days to mark in a calendar). The months ahead,
 * where shifts can be entered in advance, fold out under this month.
 */
export function ShiftsCard({ data, onChanged, onError }: { data: FuelOverview; onChanged: () => void; onError: (e: unknown) => void }) {
  const [ahead, setAhead] = useState(false);
  const [measure, width] = useWidth(1000);
  // Narrow: Km and Pris fold out under the month instead of taking columns.
  const compact = width < 560;
  const cols = compact ? 5 : 7;
  const s = data.settings;
  const consumption = consumptionOf(data);
  const shown = shownMonths(data);
  const now = data.today.slice(0, 7);
  const row = (m: FuelMonth) => <MonthRow key={m.month} m={m} current={m.month === now} estimate={monthEstimate(m, data)} compact={compact} onChanged={onChanged} onError={onError} />;
  const th = cn("whitespace-nowrap py-2 text-right font-normal", compact ? "px-1" : "px-2");
  return (
    <Card aria-labelledby="shifts-title" className="@container space-y-3 overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 id="shifts-title" className="text-base font-semibold">
          Pass per månad
        </h2>
        <p className="flex items-center gap-3 text-[11px] text-ink-2" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-accent-bar" /> beräknat
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-positive" /> tankat
          </span>
        </p>
      </div>
      <div className="px-4 sm:px-5">
        <MonthBars points={shown.points} />
      </div>
      <div ref={measure} className="overflow-x-auto">
        <table className="w-full text-[13px]" aria-label="Pass per månad">
          <thead className="text-[11px] text-ink-3">
            <tr>
              <th className={cn("py-2 text-left font-normal", compact ? "pl-4 pr-1" : "px-4 sm:px-5")}>Månad</th>
              <th className={cn("py-2 text-left font-normal", compact ? "px-1" : "px-2")}>Pass</th>
              {!compact && (
                <>
                  <th className={th}>Km</th>
                  <th className={th} title="Snittpriset för månadens tankningar, var och en till priset som gällde den dagen">
                    Pris
                  </th>
                </>
              )}
              <th className={th}>Beräknat</th>
              <th className={th}>Tankat</th>
              <th className={cn(th, compact ? "pr-4" : "px-4 sm:pr-5")} title="Från det som tankades och körsträckan enligt passen">
                l/100 km
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.past.map(row)}
            {shown.ahead.length > 0 && (
              <tr className="border-t border-hairline bg-band">
                <td colSpan={cols} className="p-0">
                  <button type="button" aria-expanded={ahead} onClick={() => setAhead((a) => !a)} className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-[12px] text-ink-2 sm:px-5">
                    <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform", ahead && "rotate-90")} aria-hidden />
                    <span className="font-semibold text-ink">Kommande månader ({shown.ahead.length})</span>
                    <span className="text-ink-3">· fyll i pass i förväg</span>
                  </button>
                </td>
              </tr>
            )}
            {ahead && shown.ahead.map(row)}
          </tbody>
        </table>
      </div>
      <p className="border-t border-hairline px-4 py-3 text-[11px] text-ink-3 sm:px-5">
        Beräknat: km × {l100(consumption)} l/100 km × månadens pris{s.congestionPerShift ? ` + trängselskatt ${kr(s.congestionPerShift)} per pass` : ""}. Tankat: kategorin Bil ›
        Drivmedel, per köpdag. Tankningar med "resa" i namnet eller anteckningen räknas inte. Pris i orange: bara ett senare pris finns, så l/100 km är osäkert. Klicka på
        kalenderikonen för att välja passdagar i en kalender.
      </p>
    </Card>
  );
}

export function MonthRow({
  m,
  current,
  estimate,
  compact = false,
  onChanged,
  onError,
}: {
  m: FuelMonth;
  current: boolean;
  estimate: number | null;
  compact?: boolean;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [details, setDetails] = useState(false);
  const [value, setValue] = useState(m.shifts === null ? "" : String(m.shifts));
  const [days, setDays] = useState<string[] | null>(null);
  useEffect(() => setValue(m.shifts === null ? "" : String(m.shifts)), [m.shifts]);

  const save = async () => {
    const v = value.trim();
    const shifts = v === "" ? null : Number(v);
    if (shifts === m.shifts) return;
    try {
      await sendJson("PUT", `/fuel/shifts/${m.month}`, { shifts });
      onChanged();
    } catch (e) {
      setValue(m.shifts === null ? "" : String(m.shifts));
      onError(e);
    }
  };
  const toggleCalendar = async () => {
    if (days) return setDays(null);
    try {
      setDays((await getJson<{ days: string[] }>(`/fuel/shift-days/${m.month}`)).days);
    } catch (e) {
      onError(e);
    }
  };
  const toggleDay = async (date: string) => {
    try {
      const r = await sendJson<{ days: string[]; shifts: number }>("PUT", `/fuel/shift-days/${date}`, { on: !days?.includes(date) });
      setDays(r.days);
      onChanged();
    } catch (e) {
      onError(e);
    }
  };

  const showPrice = !!m.price && (m.spent > 0 || m.shifts !== null);
  const kmText = m.km === null ? "" : m.km.toLocaleString("sv-SE");
  const priceText = showPrice ? (m.price!.price / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const priceNote = m.priceLater && showPrice ? `(från ${dm(m.price!.date)})` : null;
  const priceTitle = m.priceLater && m.price ? `Inget pris angivet före tankningen: räknat med priset från ${m.price.date}. Lägg in ett äldre pris under Inställningar › Bil.` : undefined;
  return (
    <>
      <tr data-month={m.month} className={cn("h-11 border-t border-hairline", current && "bg-row-current")}>
        <td className={cn("whitespace-nowrap py-1.5", compact ? "pl-4 pr-1" : "px-4 sm:px-5", current && "font-semibold")}>
          {compact ? (
            <button type="button" aria-expanded={details} onClick={() => setDetails((d) => !d)} className="inline-flex items-center gap-1 text-left" title="Km och pris">
              {shortLabel(m.month)}
              <ChevronRight className={cn("size-3 text-ink-3 transition-transform", details && "rotate-90")} aria-hidden />
            </button>
          ) : (
            monthLabel(m.month)
          )}
          {current && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-semibold text-accent">nu</span>}
        </td>
        <td className={cn("py-1.5", compact ? "px-1" : "px-2")}>
          <span className="inline-flex h-7 items-center gap-0.5 rounded-full bg-card-inset pl-1 pr-1">
            <input
              aria-label={`Pass ${monthLabel(m.month)}`}
              inputMode="numeric"
              value={value}
              placeholder="–"
              onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={save}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="h-6 w-8 rounded-full bg-transparent text-center font-semibold tabular-nums text-ink outline-none focus:bg-card focus:ring-2 focus:ring-accent/30"
            />
            <button
              type="button"
              onClick={toggleCalendar}
              aria-expanded={days !== null}
              aria-label={`Välj datum för ${monthLabel(m.month)}`}
              title="Markera dagarna i stället: antalet följer"
              className={cn("grid size-6 place-items-center rounded-full hover:bg-card hover:text-ink", days ? "text-accent" : "text-ink-3")}
            >
              <CalendarDays className="size-3.5" />
            </button>
          </span>
        </td>
        {!compact && (
          <>
            <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{kmText}</td>
            <td className={cn("px-2 py-1.5 text-right tabular-nums", m.priceLater ? "text-caution-text" : "text-ink-2")} title={priceTitle}>
              {priceText}
              {priceNote && <span className="ml-1 text-[11px]">{priceNote}</span>}
            </td>
          </>
        )}
        <td className={cn("whitespace-nowrap py-1.5 text-right tabular-nums", compact ? "px-1" : "px-2")}>{estimate === null ? "" : kr(estimate)}</td>
        <td className={cn("whitespace-nowrap py-1.5 text-right tabular-nums", compact ? "px-1" : "px-2")} title={m.trips ? `Resor, räknas inte: ${kr(m.trips)}` : undefined}>
          {m.spent ? kr(m.spent) : m.shifts !== null && !current ? "–" : ""}
          {m.trips > 0 && !compact && <span className="ml-1 text-[11px] text-ink-3">+ resa</span>}
        </td>
        {/* A month whose litres come off receipts is read, not reckoned: the
            dot says so. A month reckoned on a later price is uncertain: orange. */}
        <td
          className={cn("py-1.5 text-right tabular-nums", compact ? "pl-1 pr-4" : "px-4 sm:pr-5", m.priceLater && "text-caution-text")}
          data-l100
          title={
            m.priceLater
              ? "Osäkert: räknat med ett senare pris, och ingår inte i kalibreringen"
              : m.litresExact
                ? "Liter från kvitto, inte uträknade ur beloppet"
                : m.receipts > 0
                  ? `${m.receipts} av tankningarna har kvitto med liter; resten är uträknade ur beloppet`
                  : undefined
          }
        >
          {m.l100 === null || current ? "" : l100(m.l100)}
          {m.l100 !== null && !current && !m.priceLater && m.receipts > 0 && <span className={cn("ml-1 text-[11px]", m.litresExact ? "text-positive-text" : "text-ink-3")}>•</span>}
        </td>
      </tr>
      {compact && details && (
        <tr className={cn("text-[12px] text-ink-2", current && "bg-row-current")} data-month-details={m.month}>
          <td colSpan={5} className="px-4 pb-2 pt-0 tabular-nums sm:px-5">
            {monthLabel(m.month)} · {kmText ? `${kmText} km` : "inga km"} · {priceText ? <span className={cn(m.priceLater && "text-caution-text")}>{priceText} kr/l {priceNote}</span> : "inget pris"}
            {m.trips > 0 && ` · + resa ${kr(m.trips)} (räknas inte)`}
          </td>
        </tr>
      )}
      {days && (
        <tr className="border-t border-hairline">
          <td colSpan={compact ? 5 : 7} className="px-4 py-3 sm:px-5">
            <DayPicker month={m.month} days={days} onToggle={toggleDay} />
          </td>
        </tr>
      )}
    </>
  );
}

function DayPicker({ month, days, onToggle }: { month: string; days: string[]; onToggle: (date: string) => void }) {
  const [y, mo] = month.split("-").map(Number);
  const count = new Date(y, mo, 0).getDate();
  const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7; // Monday first
  return (
    <div>
      <div className="grid w-fit grid-cols-7 gap-1 text-center text-xs" role="group" aria-label={`Arbetsdagar ${monthLabel(month)}`}>
        {["må", "ti", "on", "to", "fr", "lö", "sö"].map((d) => (
          <span key={d} className="text-ink-3">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          const on = days.includes(date);
          return (
            <button
              key={date}
              type="button"
              aria-pressed={on}
              aria-label={date}
              onClick={() => onToggle(date)}
              className={cn("size-8 rounded-[8px] tabular-nums", on ? "bg-accent font-semibold text-white" : "hover:bg-card-inset")}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-ink-3">{days.length} markerade. Antalet pass blir antalet markerade dagar.</p>
    </div>
  );
}

