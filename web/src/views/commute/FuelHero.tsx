import { Info } from "lucide-react";
import type { FuelOverview } from "../../api";
import { AnimatedNumber } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/cn";
import { dm, kr } from "../overview/format";
import { fuelGauge } from "./gauge";
import { yearAverage } from "./months";

const longMonth = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
const shortMonth = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("sv") + s.slice(1);
const l100 = (v: number) => v.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const km = (v: number) => `${Math.round(v).toLocaleString("sv-SE")} km`;
const perLitre = (ore: number) => `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/l`;
/** '1 287 kr' without ' kr': inside the gauge. */
const bare = (ore: number) => kr(ore).replace(/\s*kr$/, "");
const span = (months: string[]) => (months.length > 1 ? `${shortMonth(months[0])}–${shortMonth(months.at(-1)!)}` : shortMonth(months[0]));

/**
 * Pendling & bränsle's hero: what is left to buy this month in large type,
 * the shifts and kr per shift as pills, a fuel gauge (bought of reckoned,
 * the month's fill-ups a click away), the price it stands on, and three grey
 * boxes: the calibrated consumption, the 12 months' average and the odometer.
 */
export function FuelHero({ data, onPrice }: { data: FuelOverview; onPrice: () => void }) {
  const f = data.current;
  const month = data.today.slice(0, 7);
  const p = data.latestPrice;
  return (
    <Card aria-labelledby="fuel-now-title" className="@container flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="fuel-now-title" className="text-[13px] font-medium text-ink-2">
            {cap(longMonth(month))} · kvar att tanka
          </h2>
          {f ? (
            <p className="mt-1 text-[52px] font-bold leading-none tracking-[-0.03em] tabular-nums" data-figure="remaining">
              ca <AnimatedNumber value={f.remaining} format={kr} />
            </p>
          ) : (
            <p className="mt-2 text-[15px] font-medium text-caution-text">
              {data.missing === "shifts"
                ? `Fyll i antal pass för ${longMonth(month)} nedan, så räknas bränslet ut.`
                : data.missing === "price"
                  ? "Ange literpriset för diesel under Inställningar › Bil."
                  : "Välj vilken kategori som är tankning under Inställningar › Bil."}
            </p>
          )}
        </div>
        {f && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            <span className="rounded-full bg-card-inset px-2.5 py-1 text-[12px] text-ink-2 tabular-nums">
              {f.shifts} pass · {km(f.km)}
            </span>
            <span className="rounded-full bg-card-inset px-2.5 py-1 text-[12px] text-ink-2 tabular-nums">{kr(f.perShift)} per pass</span>
          </div>
        )}
      </div>

      {f && <Gauge data={data} />}

      <div className="grid gap-x-6 gap-y-1 text-[11px] text-ink-3 @[30rem]:grid-cols-2">
        {f ? (
          <p>
            beräknat för månaden <b className="font-semibold text-ink-2">{kr(f.expectedFuel)}</b>
            {f.expectedCongestion ? ` + trängselskatt ${kr(f.expectedCongestion)}` : ""} · räknas in i Översiktens "kvar att leva på"
            {data.next && ` · ${longMonth(data.next.month)}: ${data.next.shifts} pass, ca ${kr(data.next.expectedFuel)}`}
          </p>
        ) : (
          <span />
        )}
        {/* Which price the forecast stands on, and why that one. An amount without that is a number one cannot check. */}
        <p data-price>
          {f?.price.source === "national" ? (
            <>
              Diesel <b className="font-semibold text-ink-2">{perLitre(f.price.price)}</b> · {f.price.why} ·{" "}
            </>
          ) : p ? (
            <>
              Diesel <b className="font-semibold text-ink-2">{perLitre(p.price)}</b>, angivet {dm(p.date)} ({p.ageDays === 0 ? "i dag" : `för ${p.ageDays} ${p.ageDays === 1 ? "dag" : "dagar"} sedan`})
              {p.ageDays > 30 && <span className="text-caution-text"> · dags att uppdatera</span>} ·{" "}
            </>
          ) : null}
          <button type="button" className="font-medium text-accent hover:underline" onClick={onPrice}>
            {p ? "nytt pris" : "ange literpris"}
          </button>
        </p>
      </div>

      <div className="grid gap-2.5 border-t border-hairline pt-4 @[28rem]:grid-cols-3">
        <Consumption data={data} />
        <Inset label="Snitt 12 mån" testId="average">
          <Average data={data} />
        </Inset>
        <Inset label="Mätarställning" testId="odometer">
          <Reading data={data} />
        </Inset>
      </div>
    </Card>
  );
}

/**
 * Bought of reckoned as a 22 px bar: green for what was bought with the
 * latest fill-up written in it, grey for what is left. More than reckoned:
 * a full bar and the excess in orange. The month's fill-ups (trips struck
 * through) are a click away.
 */
function Gauge({ data }: { data: FuelOverview }) {
  const f = data.current!;
  const g = fuelGauge(f.spent, f.expectedFuel);
  const counted = data.purchases.filter((t) => !t.trip);
  const latest = [...counted].sort((a, b) => b.date.localeCompare(a.date))[0];
  const more = data.purchases.length - (latest ? 1 : 0);
  const label = f.spent > 0 ? `Tankat ${kr(f.spent)}${latest ? ` · ${dm(latest.date)} ${latest.description}` : ""}` : "Inget tankat än";
  const inside = g.share >= 0.4;
  return (
    <div className="space-y-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-gauge={g.state}
            aria-label={`${label}. ${g.state === "over" ? `${kr(g.over)} över beräknat` : g.state === "exact" ? "Precis det beräknade" : `Kvar ${kr(g.left)}`}. Visa månadens tankningar`}
            className="relative block h-[22px] w-full overflow-hidden rounded-[11px] bg-track text-left outline-offset-2"
          >
            <span className="absolute inset-y-0 left-0 rounded-[11px] bg-positive transition-[width] duration-300" style={{ width: `${g.share * 100}%` }} />
            <span className={cn("absolute inset-y-0 flex min-w-0 items-center gap-1 px-2.5 text-[11px] font-semibold", inside ? "left-0 text-[#0d3a1a]" : "text-ink-2")} style={inside ? { maxWidth: `${g.share * 100}%` } : { left: `${g.share * 100}%` }}>
              <span className="truncate">{label}</span>
              {more > 0 && <span className="shrink-0 rounded-full bg-black/10 px-1.5 text-[10px]">+{more}</span>}
            </span>
            {g.state === "under" && <span className="absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-2 tabular-nums">kvar {bare(g.left)}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 text-[13px]">
          <p className="mb-1.5 font-semibold">Tankningar i {longMonth(data.today.slice(0, 7))}</p>
          {data.purchases.length === 0 ? (
            <p className="text-ink-3">Inga än.</p>
          ) : (
            <ul aria-label="Tankningar i månaden" className="space-y-1">
              {data.purchases.map((t) => (
                <li key={t.id} className={cn("flex justify-between gap-3", t.trip && "text-ink-3 line-through")} title={t.trip ? "Resa: räknas inte" : undefined}>
                  <span className="truncate">
                    {dm(t.date)} {t.description}
                    {t.trip && " (resa)"}
                  </span>
                  <span className="tabular-nums">{kr(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {g.state !== "under" && (
        <p className={cn("text-right text-[11px] font-semibold tabular-nums", g.state === "over" ? "text-caution-text" : "text-positive-text")} data-gauge-note>
          {g.state === "over" ? `${kr(g.over)} över beräknat` : "precis det beräknade"}
        </p>
      )}
    </div>
  );
}

function Inset({ label, testId, children, className }: { label: string; testId: string; children: React.ReactNode; className?: string }) {
  return (
    <div data-inset={testId} className={cn("min-w-0 rounded-[10px] bg-card-inset px-3.5 py-3", className)}>
      <p className="flex items-center gap-1 text-[11px] text-ink-2">{label}</p>
      {children}
    </div>
  );
}

/** The consumption the forecast uses, with its spread; how it is worked out in a popover. */
function Consumption({ data }: { data: FuelOverview }) {
  const c = data.calibration;
  const s = data.settings;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-inset="consumption" className="min-w-0 rounded-[10px] bg-card-inset px-3.5 py-3 text-left hover:bg-segment/70" aria-label="Förbrukning: så räknas den">
          <span className="flex items-center gap-1 text-[11px] text-ink-2">
            {c ? "Förbrukning, kalibrerad" : "Förbrukning, tabellvärde"} <Info className="size-3 text-ink-3" aria-hidden />
          </span>
          <span className="mt-0.5 block text-[17px] font-bold tabular-nums">
            {l100(c ? c.l100 : s.baseConsumption)} <span className="text-[11px] font-normal text-ink-2">l/100 km</span>
          </span>
          <span className="block truncate text-[10px] text-ink-3">
            {c ? `${span(c.months)} ${l100(c.min)}–${l100(c.max)} · tabellvärde ${l100(s.baseConsumption)}` : "inget kalibrerat värde än"}
            {c && !s.useCalibrated && " · prognosen använder tabellvärdet"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-2 text-[13px]">
        {c ? (
          <p>
            Kalibrerat: <b>{l100(c.l100)} l/100 km</b> ({span(c.months)}, {l100(c.min)}–{l100(c.max)}), tabellvärde {l100(s.baseConsumption)}.
            {c.exactMonths > 0 && (
              <>
                {" "}
                Liter från kvitto i {c.exactMonths === c.months.length ? "alla" : `${c.exactMonths} av ${c.months.length}`} {c.months.length === 1 ? "månaden" : "månaderna"}.
              </>
            )}
            {!s.useCalibrated && <span className="text-ink-2"> Prognosen använder tabellvärdet (ändras under Inställningar › Bil).</span>}
          </p>
        ) : (
          <p>
            Tabellvärde {l100(s.baseConsumption)} l/100 km. Det ersätts av ett kalibrerat värde när en avslutad månad har både pass och tankningar, och ett literpris angivet
            senast samma dag som tankningarna (lägg in äldre priser under Inställningar › Bil).
          </p>
        )}
        <p className="text-[12px] text-ink-2">
          Kalibreringen tar de senaste tre avslutade månaderna med pass och tankningar: allt som tankats (i liter, varje tankning till priset den dagen) delat med körsträckan
          enligt passen och övrig körning. Månader där priset bara finns från ett senare datum räknas inte. Spridningen är månadernas egna värden; en full tank hamnar i en
          enda månad.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Average({ data }: { data: FuelOverview }) {
  const a = yearAverage(data);
  if (!a) return <p className="mt-0.5 text-[12px] text-ink-3">Inga avslutade månader med pass än.</p>;
  return (
    <>
      <p className="mt-0.5 text-[17px] font-bold tabular-nums" title={`Snitt över ${a.months} avslutade ${a.months === 1 ? "månad" : "månader"} med pass`}>
        {bare(a.spent)} <span className="text-[11px] font-normal text-ink-2">kr/mån tankat</span>
      </p>
      <p className="truncate text-[10px] text-ink-3">{a.estimate === null ? "inget beräknat" : `beräknat ${kr(a.estimate)}/mån`}</p>
    </>
  );
}

function Reading({ data }: { data: FuelOverview }) {
  const sorted = [...data.readings].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  const first = sorted[0];
  if (!last) return <p className="mt-0.5 text-[12px] text-ink-3">Ingen avläsning än.</p>;
  return (
    <>
      <p className="mt-0.5 text-[17px] font-bold tabular-nums">
        {last.km.toLocaleString("sv-SE")} <span className="text-[11px] font-normal text-ink-2">km · {dm(last.date)}</span>
      </p>
      <p className="truncate text-[10px] text-ink-3">
        {sorted.length > 1 ? `${km(last.km - first.km)} sedan ${dm(first.date)} ${first.date.slice(0, 4)}` : "en avläsning till behövs för att jämföra"}
      </p>
    </>
  );
}
