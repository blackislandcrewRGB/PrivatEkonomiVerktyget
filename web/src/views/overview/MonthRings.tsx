import type { Overview, UsualSpending } from "../../api";
import { AnimatedNumber } from "../../components/AnimatedAmount";
import { Card, CardHeader } from "../../components/Card";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { dm, kr } from "./format";
import { arc, ring, type Ring } from "./rings";

const longMonth = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
const monthShort = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

interface RingRow {
  key: "buy" | "groceries" | "eating-out";
  name: string;
  spent: number;
  usual: UsualSpending | undefined;
  ring: Ring;
  /** The ring's colour, its track and the text colour of its percent. */
  stroke: string;
  track: string;
  text: string;
  dot: string;
  /** Before the usual on the legend's second line ('7 gånger'). */
  lead?: string;
  testId: string;
}

/**
 * The month so far as three activity rings — Köp (what the days without a
 * purchase count), Livsmedel, Restaurang & hämtmat — each full at the usual
 * for the same days of the last three months, with a red second lap past it.
 * The figures stand beside the rings; under them the grocery shop week by
 * week and a dot per day for the days nothing was bought and the days the
 * household ate out.
 */
export function MonthRings({ data, className }: { data: Overview; className?: string }) {
  const { noSpend, eatingOut, groceryWeeks: g } = data;
  const month = noSpend.month;
  const rows: RingRow[] = [
    {
      key: "buy",
      name: "Köp",
      spent: noSpend.amount ?? 0,
      usual: noSpend.usual,
      ring: ring(noSpend.amount ?? 0, noSpend.usual?.toDate),
      stroke: "stroke-accent",
      track: "stroke-accent-soft",
      text: "text-accent",
      dot: "bg-accent",
      testId: "no-spend-usual",
    },
    {
      key: "groceries",
      name: "Livsmedel",
      spent: g.total,
      usual: g.usual,
      ring: ring(g.total, g.usual?.toDate),
      stroke: "stroke-positive",
      track: "stroke-positive-soft",
      text: "text-positive-text",
      dot: "bg-positive",
      testId: "grocery-usual",
    },
    {
      key: "eating-out",
      name: "Restaurang & hämtmat",
      spent: eatingOut.amount,
      usual: eatingOut.usual,
      ring: ring(eatingOut.amount, eatingOut.usual?.toDate),
      stroke: "stroke-caution",
      track: "stroke-caution-soft",
      text: "text-caution-text",
      dot: "bg-caution",
      lead: `${eatingOut.count} ${eatingOut.count === 1 ? "gång" : "gånger"}`,
      testId: "eating-out-usual",
    },
  ];
  const day = Number(data.today.slice(8, 10));
  const days = noSpend.days.length;

  return (
    <Card aria-labelledby="rings-title" className={cn("@container flex flex-col gap-4", className)}>
      <CardHeader id="rings-title" title={`${capital(longMonth(month))} så här långt`} aside="full ring = snittet för samma dagar" />
      <div className="flex flex-col items-center gap-5 @[26rem]:flex-row @[26rem]:items-center">
        <Rings rows={rows} day={day} days={days} />
        <ul className="flex w-full min-w-0 flex-1 flex-col gap-2.5 text-xs" aria-label="Förklaring till ringarna">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-px" data-ring={r.key}>
              <div className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-[9px] shrink-0 rounded-full", r.dot)} />
                <b className="font-semibold">{r.name}</b>
                <span className="text-ink-2 tabular-nums">{kr(r.spent)}</span>
                <b className={cn("ml-auto whitespace-nowrap pl-2 font-semibold tabular-nums", r.text)}>{r.ring.percent === null ? "–" : `${r.ring.percent} %`}</b>
              </div>
              <Usual row={r} />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 border-t border-hairline pt-4">
        <GroceryWeeks weeks={g} />
        <NoSpendDots noSpend={noSpend} />
        <EatingOutDots eatingOut={eatingOut} />
        <p className="text-[11px] text-ink-3">Livsmedel och bilen (bränsle, parkering, trängselskatt med mera) räknas inte som köp.</p>
      </div>
    </Card>
  );
}

/** Three concentric rings, 14 px wide, the outermost first; the day of the month in the middle. */
function Rings({ rows, day, days }: { rows: RingRow[]; day: number; days: number }) {
  const radii = [68, 50, 32];
  const label = `Tre ringar, andel av snittet så här långt: ${rows
    .map((r) => `${r.name} ${r.ring.percent === null ? "inget snitt" : `${r.ring.percent} %`}`)
    .join(", ")}. Dag ${day} av ${days}.`;
  return (
    <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label={label} className="shrink-0">
      <g transform="rotate(-90 80 80)" fill="none" strokeWidth="14" strokeLinecap="round">
        {rows.map((r, i) => (
          <g key={r.key} data-ring-arc={r.key}>
            <circle cx="80" cy="80" r={radii[i]} className={r.track} strokeLinecap="butt" />
            {r.ring.lap > 0 && <circle cx="80" cy="80" r={radii[i]} className={r.stroke} strokeDasharray={arc(radii[i], r.ring.lap)} data-lap={r.ring.lap.toFixed(3)} />}
            {r.ring.over > 0 && <circle cx="80" cy="80" r={radii[i]} className="stroke-alarm" strokeDasharray={arc(radii[i], r.ring.over)} data-over={r.ring.over.toFixed(3)} />}
          </g>
        ))}
      </g>
      <text x="80" y="76" textAnchor="middle" fontSize="11" className="fill-ink-2">
        dag
      </text>
      <text x="80" y="92" textAnchor="middle" fontSize="14" fontWeight="700" className="fill-ink">
        {day}/{days}
      </text>
    </svg>
  );
}

/**
 * Against the usual: what the last three months came to by the same day of
 * the month, and a whole month; over or under it (in words, and in green or
 * orange).
 */
function Usual({ row }: { row: RingRow }) {
  const u = row.usual;
  if (!u || u.perMonth <= 0) {
    return row.lead ? <p className="pl-4 text-ink-2">{row.lead}</p> : null;
  }
  const diff = Math.round(row.spent / 100) * 100 - Math.round(u.toDate / 100) * 100;
  return (
    <p
      className="pl-4 text-ink-2 tabular-nums"
      data-testid={row.testId}
      title={`Snittet för ${monthShort(u.from)}–${monthShort(u.to)}: ${kr(u.toDate)} till och med den ${u.day}:e, ${kr(u.perMonth)} för en hel månad.`}
    >
      {row.lead && `${row.lead} · `}snitt {kr(u.toDate)} så här långt · {kr(u.perMonth)}/mån
      {diff !== 0 && (
        <>
          {" · "}
          <b className={cn("whitespace-nowrap font-semibold", diff > 0 ? "text-caution-text" : "text-positive-text")}>{diff > 0 ? `${kr(diff)} över` : `${kr(-diff)} under`}</b>
        </>
      )}
    </p>
  );
}

/**
 * Livsmedel this month, a bar per week with what was bought, against a
 * dashed line at the usual week (the last three months). This week is so
 * far and paler; the weeks to come are a sliver.
 */
function GroceryWeeks({ weeks: g }: { weeks: Overview["groceryWeeks"] }) {
  const max = Math.max(1, g.averagePerWeek, ...g.weeks.map((w) => w.amount));
  const span = (w: Overview["groceryWeeks"]["weeks"][number]) => (w.from === w.to ? dm(w.from) : `${Number(w.from.slice(8, 10))}–${dm(w.to)}`);
  return (
    <div aria-label={`Livsmedel i ${longMonth(g.month)} per vecka`} className="flex flex-col gap-2.5">
      <div className="flex justify-between gap-4 text-xs text-ink-2">
        <span>Livsmedel per vecka</span>
        {g.averagePerWeek > 0 && (
          <span title="Snittet per vecka de tre senaste hela månaderna">
            <span aria-hidden className="mr-1.5 inline-block w-3 border-t border-dashed border-ink-3 align-middle" />
            vanlig vecka <b className="font-semibold text-ink">{kr(g.averagePerWeek)}</b>
          </span>
        )}
      </div>
      {/* Room above for the amounts; the bars and the line share one scale. */}
      <div className="relative mt-4 grid h-12 gap-2" style={{ gridTemplateColumns: `repeat(${g.weeks.length}, minmax(0, 1fr))` }}>
        {g.averagePerWeek > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-ink-3/60"
            style={{ bottom: `${(g.averagePerWeek / max) * 100}%` }}
          />
        )}
        {g.weeks.map((w) => {
          const height = w.status === "future" ? 0 : (w.amount / max) * 100;
          return (
            <div
              key={w.from}
              className="relative h-full"
              title={`Vecka ${w.week} (${span(w)}): ${w.status === "future" ? "inte än" : `${kr(w.amount)}${w.status === "current" ? " hittills" : ""}`}`}
              data-week={w.week}
            >
              {w.status !== "future" && w.amount > 0 && (
                <span className="absolute inset-x-0 z-20 mb-0.5 text-center text-[10px] leading-none text-ink-2 tabular-nums" style={{ bottom: `${height}%` }}>
                  {/* Over the dashed line, not through it. */}
                  <span className="bg-card px-0.5">{kr(w.amount).replace(/\s*kr$/, "")}</span>
                </span>
              )}
              <span
                className={cn("absolute inset-x-0 bottom-0 min-h-0.5 rounded-[5px] bg-positive", w.status === "current" ? "opacity-50" : w.amount === 0 && "opacity-15")}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 text-center text-[10px] text-ink-3" style={{ gridTemplateColumns: `repeat(${g.weeks.length}, minmax(0, 1fr))` }}>
        {g.weeks.map((w) => (
          <span key={w.from} title={span(w)}>
            v.{w.week}
          </span>
        ))}
      </div>
    </div>
  );
}

const dotGrid = "grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1.5";
const dot = "block size-3.5 rounded-full border-2";

/**
 * Dagar utan köp: a dot per day of the month, green when nothing was bought
 * — the food shop and the car don't count, they have to be paid. A day with
 * purchases is grey, not red: this is a pat on the back for the free days,
 * not a scolding. Today is a ring until something is bought.
 */
function NoSpendDots({ noSpend }: { noSpend: Overview["noSpend"] }) {
  const { days, free, past } = noSpend;
  return (
    <div className="flex flex-col gap-2" data-testid="no-spend">
      <p className="text-xs text-ink-2">
        Dagar utan köp ·{" "}
        <b className="font-semibold text-ink tabular-nums">
          <AnimatedNumber value={free} format={(v) => String(Math.round(v))} /> av {past}
        </b>
      </p>
      <ul className={dotGrid} aria-label="Dagar i månaden">
        {days.map((d) => {
          const label = `${dm(d.date)}: ${
            d.status === "free" ? "inget köpt" : d.status === "today" ? "i dag, inget köpt än" : d.status === "future" ? "kommer" : d.items.map((i) => `${i.name} ${kr(i.amount)}`).join(", ")
          }`;
          const el = (
            <span
              className={cn(
                dot,
                d.status === "free" && "border-positive bg-positive",
                d.status === "spent" && "border-segment bg-segment",
                d.status === "today" && "border-ink bg-card",
                d.status === "future" && "border-track bg-card",
              )}
            />
          );
          return (
            <li key={d.date} data-date={d.date} data-status={d.status} aria-label={label} className="flex justify-center">
              {d.status === "spent" || d.status === "free" ? <Tooltip content={label}>{el}</Tooltip> : el}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Restaurang och hämtmat: a dot per day of the month, coloured the days the
 * household ate out or took food home. No judgement in the colours: the
 * days at home are just grey.
 */
function EatingOutDots({ eatingOut }: { eatingOut: Overview["eatingOut"] }) {
  const { days, count } = eatingOut;
  return (
    <div className="flex flex-col gap-2" data-testid="eating-out">
      <p className="text-xs text-ink-2">
        Restaurang & hämtmat · <b className="font-semibold text-ink tabular-nums">{count} {count === 1 ? "gång" : "gånger"}</b>
      </p>
      <ul className={dotGrid} aria-label="Dagar med restaurang eller hämtmat">
        {days.map((d) => {
          const label = `${dm(d.date)}: ${d.status === "out" ? d.items.map((i) => `${i.name} ${kr(i.amount)}`).join(", ") : d.status === "future" ? "kommer" : "hemma"}`;
          const el = (
            <span
              className={cn(
                dot,
                d.status === "out" && "border-eating-out bg-eating-out",
                (d.status === "home" || d.status === "today") && "border-segment bg-segment",
                d.status === "future" && "border-track bg-card",
              )}
            />
          );
          return (
            <li key={d.date} data-date={d.date} data-status={d.status} aria-label={label} className="flex justify-center">
              {d.status === "out" ? <Tooltip content={label}>{el}</Tooltip> : el}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
