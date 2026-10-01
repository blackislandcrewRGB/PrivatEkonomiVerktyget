import type { TransactionList } from "../../../api";
import { Card } from "../../../components/Card";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { formatKr } from "../../../lib/format";
import { dayBars } from "./dayBars";

/** Whole kronor, as the day headers show them: '+27 795 kr', '−11 685 kr'. */
const wholeKr = (ore: number, sign: "auto" | "always" = "auto") => formatKr(Math.round(ore / 100) * 100, { whole: true, sign });

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** '2026-09-25' -> '25 september'. */
const dayMonth = (iso: string) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * The two cards over the list: In / Ut / Netto for what is shown (the same
 * sums as before, in whole kronor, the exact ones on hover), and for a month
 * Ut per day as bars — a click jumps to that day in the list.
 */
export function SummaryCards({
  totals,
  title,
  month,
  today,
  onPickDay,
}: {
  totals: TransactionList["totals"];
  /** 'September', 'Alla datum', '1/8 – 30/9 2026'. */
  title: string;
  /** 'YYYY-MM' when a month is shown: then the bars. */
  month: string | null;
  today: string;
  onPickDay: (date: string) => void;
}) {
  const net = totals.in + totals.out;
  return (
    <div className="@container">
      <div className={cn("grid gap-4", month && "@[56rem]:grid-cols-12")}>
        <Card aria-labelledby="tx-summary-title" className="flex flex-col gap-3 sm:px-6 @[56rem]:col-span-5">
          <h2 id="tx-summary-title" className="text-[13px] font-medium text-ink-2">
            {title} · {totals.count} {totals.count === 1 ? "transaktion" : "transaktioner"}
          </h2>
          {/* The figures shrink with the tiles (down to 15 px) rather than being cut. */}
          <div className="@container grid grid-cols-3 gap-1.5">
            <Tile label="In" ore={totals.in} text={wholeKr(totals.in, totals.in ? "always" : "auto")} className="bg-positive-soft" labelClass="text-positive-text" />
            <Tile label="Ut" ore={totals.out} text={wholeKr(totals.out)} className="bg-card-inset" labelClass="text-ink-2" />
            <Tile label="Netto" ore={net} text={wholeKr(net, "always")} className="bg-accent-soft" labelClass="text-accent" />
          </div>
          <p className="mt-auto text-[11px] text-ink-3">
            Överföringar, avstämning och returnerade köp räknas inte.
            {!!totals.partial &&
              ` ${totals.partial === 1 ? "Ett uppdelat köp räknas" : `${totals.partial} uppdelade köp räknas`} bara med sin del i kategorin.`}
          </p>
        </Card>
        {month && <DayBarsCard month={month} outByDay={totals.outByDay ?? {}} today={today} onPickDay={onPickDay} />}
      </div>
    </div>
  );
}

function Tile({ label, ore, text, className, labelClass }: { label: string; ore: number; text: string; className: string; labelClass: string }) {
  return (
    <div className={cn("min-w-0 rounded-inset px-2.5 py-2.5", className)} data-tile={label}>
      <p className={cn("text-[11px] font-medium", labelClass)}>{label}</p>
      <p className="truncate text-[clamp(15px,4.4cqw,18px)] font-bold leading-snug tabular-nums tracking-[-0.01em]" title={formatKr(ore, { sign: label === "Ut" ? "auto" : "always" })}>
        {text}
      </p>
    </div>
  );
}

function DayBarsCard({ month, outByDay, today, onPickDay }: { month: string; outByDay: Record<string, number>; today: string; onPickDay: (date: string) => void }) {
  const bars = dayBars(month, outByDay, today);
  return (
    <Card aria-labelledby="tx-days-title" className="flex flex-col gap-3 sm:px-6 @[56rem]:col-span-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 id="tx-days-title" className="text-[13px] font-medium text-ink-2">
          Utgifter per dag
        </h2>
        <p className="text-[11px] text-ink-3">klicka på en dag för att hoppa dit i listan</p>
      </div>
      <div className="mt-auto">
        <div className="flex h-12 items-end gap-[3px]" role="group" aria-label="Utgifter per dag">
          {bars.map((b) =>
            b.ore > 0 ? (
              <Tooltip key={b.date} content={`${dayMonth(b.date)} · ${wholeKr(-b.ore)}`}>
                <button
                  type="button"
                  onClick={() => onPickDay(b.date)}
                  aria-label={`${dayMonth(b.date)}: ${wholeKr(-b.ore)}`}
                  data-day={b.date}
                  data-ore={b.ore}
                  data-today={b.today || undefined}
                  className={cn("min-h-1 min-w-0 flex-1 rounded-[3px] transition-opacity hover:opacity-80", b.today ? "bg-accent" : "bg-accent-bar")}
                  style={{ height: `${Math.max(8, b.share * 100)}%` }}
                />
              </Tooltip>
            ) : (
              <span key={b.date} aria-hidden data-day={b.date} className={cn("h-[3px] min-w-0 flex-1 rounded-full", b.today ? "bg-accent" : "bg-segment")} />
            ),
          )}
        </div>
        <div aria-hidden className="mt-1 flex gap-[3px] text-[10px] leading-3 text-ink-3 tabular-nums">
          {bars.map((b) => (
            <span key={b.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
              {b.label ? b.day : ""}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
