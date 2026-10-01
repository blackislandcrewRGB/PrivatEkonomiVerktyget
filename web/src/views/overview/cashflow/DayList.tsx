import { useState } from "react";
import { TaxRefundPopover } from "../../tax/TaxRefundBreakdown";
import type { CashEvent, Cashflow as Data } from "../../../api";
import { amountText } from "../../../components/Amount";
import { Card } from "../../../components/Card";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { cn } from "../../../lib/cn";
import { kr, weekday } from "../format";
import { dayRows, type ListRange } from "./dayRows";

const KIND_LABEL: Record<CashEvent["kind"], string> = { income: "inkomst", fixed: "fast", invoice: "kortfaktura", planned: "planerad", partner: "delad ekonomi" };
const KIND_DOT: Record<CashEvent["kind"], string> = { income: "bg-positive", fixed: "bg-ink", invoice: "bg-alarm", planned: "bg-caution", partner: "bg-job" };

const RANGES: { value: ListRange; label: string }[] = [
  { value: "salary", label: "Till nästa lön" },
  { value: "30", label: "30 dagar" },
  { value: "90", label: "90 dagar" },
];

const MONTHS = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

/** The day as a small badge: 'FRE', '25', 'sep'. Today blue, the lowest day orange. */
function DateBadge({ date, today, lowest }: { date: string; today: boolean; lowest: boolean }) {
  return (
    <span
      className={cn(
        "flex w-12 flex-col items-center self-start rounded-xl py-1.5 leading-none",
        today && "bg-accent text-white",
        !today && lowest && "bg-caution-soft text-caution-text",
        !today && !lowest && "text-ink",
      )}
    >
      <span className={cn("text-[10px] font-semibold uppercase", !today && !lowest && "text-ink-2")}>{weekday(date)}</span>
      <span className="mt-1 text-xl font-bold tabular-nums">{Number(date.slice(8, 10))}</span>
      <span className={cn("mt-1 text-[10px]", today ? "text-white/80" : !lowest && "text-ink-3")}>{MONTHS[Number(date.slice(5, 7)) - 1]}</span>
    </span>
  );
}

function Line({ dot, name, tag, amount, refundYear }: { dot: string; name: string; tag?: string; amount?: number; refundYear?: number }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", dot)} aria-hidden />
      <span className="min-w-0 flex-1">
        {name}
        {tag && <span className="ml-1.5 text-[11px] text-ink-3">{tag}</span>}
        {refundYear && (
          <TaxRefundPopover year={refundYear} className="ml-1.5 text-[11px]">
            Visa uträkning
          </TaxRefundPopover>
        )}
      </span>
      {amount !== undefined && <span className={cn("shrink-0 whitespace-nowrap tabular-nums", amount > 0 && "text-positive-text")}>{amountText(amount, amount > 0 ? "income" : "expense", true)}</span>}
    </li>
  );
}

/**
 * Dag för dag: the days with incomes, fixed charges and invoices (up to the
 * next salary and its bills, 30 or 90 days), each with its events, the
 * balance after the day and a bar for how high that is in the period. The
 * lowest day has a row of its own even when nothing happens on it.
 */
export function DayList({ data }: { data: Data }) {
  const [range, setRange] = useState<ListRange>("salary");
  const rows = dayRows(data, range);
  const all = dayRows(data, "90");
  const top = Math.max(1, ...rows.map((r) => r.balance));

  return (
    <Card aria-labelledby="cash-events-title" className="@container px-0 sm:px-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 sm:px-7">
        <h2 id="cash-events-title" className="text-base font-semibold">
          Dag för dag <span className="text-[13px] font-normal text-ink-2">· dagar med inkomster, fasta utgifter och fakturor, saldot efter dagen till höger</span>
        </h2>
        <SegmentedControl label="Hur många dagar" appearance="v2" size="sm" options={RANGES} value={range} onChange={setRange} />
      </div>
      <ul className="mt-3 text-[13px]" data-testid="day-list">
        {rows.map((d) => (
          <li
            key={d.date}
            className={cn(
              "grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-hairline px-5 py-3.5 sm:px-7 @[36rem]:grid-cols-[3rem_minmax(0,1fr)_7.5rem]",
            )}
            data-day={d.date}
            data-lowest={d.lowest || undefined}
          >
            <DateBadge date={d.date} today={d.today} lowest={d.lowest} />
            <ul className="space-y-1 pt-1.5">
              {d.events.map((e, i) => (
                <Line
                  key={i}
                  dot={KIND_DOT[e.kind]}
                  name={e.name}
                  tag={`${KIND_LABEL[e.kind]}${e.estimate ? ", uppskattad" : ""}${e.paced ? `, varav ca ${kr(e.paced)} kommande köp` : ""}`}
                  amount={e.amount}
                  refundYear={e.taxRefundYear}
                />
              ))}
              {d.lowest && <Line dot="bg-alarm" name="Lägsta punkt" tag={`rörliga utgifter ${kr(data.variable.perDay)}/dag har dragits`} />}
            </ul>
            <div className="col-start-2 @[36rem]:col-start-3 @[36rem]:pt-1">
              <p className={cn("text-right text-[15px] font-bold tabular-nums", d.lowest && "text-caution-text", d.balance < 0 && "text-alarm")}>{kr(d.balance)}</p>
              <div className="mt-1.5 h-1 rounded-full bg-track" aria-hidden>
                <div className={cn("ml-auto h-1 rounded-full", d.lowest ? "bg-caution" : "bg-accent")} style={{ width: `${(Math.max(0, d.balance) / top) * 100}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length < all.length && (
        <button type="button" className="mx-5 mt-2 text-xs text-accent hover:underline sm:mx-7" onClick={() => setRange("90")}>
          Visa alla 90 dagar →
        </button>
      )}
    </Card>
  );
}
