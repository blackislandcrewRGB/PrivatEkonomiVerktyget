import type { SavingsOverview } from "../../../api";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { monthLabel, pct, wholeKr } from "../common";
import { RATE_PILL } from "./SavedCard";
import { signedKr } from "./ValueCard";

/** The rate's tone by the figure shown (one decimal): above nothing green, below red, nothing grey. */
const rateTone = (rate: number | null) => {
  const r = rate === null ? 0 : Math.round(rate * 1000);
  return r > 0 ? "up" : r < 0 ? "down" : "zero";
};
const netClass = (ore: number) => (Math.round(ore / 100) > 0 ? "text-positive-text" : Math.round(ore / 100) < 0 ? "text-alarm" : "text-ink-3");
/** Uttaget and Inkomst are left out on a narrow card (a phone). */
const wide = "hidden @[36rem]:table-cell";
const cell = "whitespace-nowrap px-2 py-2 text-right tabular-nums @[36rem]:px-3";

/**
 * Sparande's table (Design v2), newest first: put in, taken out, the net in
 * bold green or red, the income in the secondary colour and the savings
 * rate as a toned pill; the current month light blue and bold; Totalt under
 * a black line. A month opens its rows.
 */
export function SavedTable({ data, onOpen }: { data: SavingsOverview; onOpen: (month: string) => void }) {
  const { months, total } = data;
  const current = todayIso().slice(0, 7);
  const Pill = ({ rate }: { rate: number | null }) => {
    const tone = rateTone(rate);
    return (
      <span className={cn("inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums", RATE_PILL[tone].className)} data-tone={tone}>
        {pct(rate)}
      </span>
    );
  };
  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="saved-table-title" data-card="saved-table">
      <h2 id="saved-table-title" className="px-5 pb-2 pt-4 text-[15px] font-semibold sm:px-6">
        Per månad
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] @[36rem]:text-[13px]" aria-label="Sparat per månad">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="py-2 pl-4 pr-2 text-left font-normal @[36rem]:pl-6 @[36rem]:pr-3">Månad</th>
              <th className="px-2 py-2 text-right font-normal @[36rem]:px-3">Insatt</th>
              <th className={cn(wide, "px-3 py-2 text-right font-normal")}>Uttaget</th>
              <th className="px-2 py-2 text-right font-normal @[36rem]:px-3">Netto</th>
              <th className={cn(wide, "px-3 py-2 text-right font-normal")}>Inkomst</th>
              <th className="py-2 pl-2 pr-4 text-right font-normal @[36rem]:pl-3 @[36rem]:pr-6">Sparkvot</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => {
              const now = m.month === current;
              return (
                <tr
                  key={m.month}
                  className={cn("cursor-pointer border-b border-hairline hover:bg-band", now && "bg-row-current font-semibold")}
                  onClick={() => onOpen(m.month)}
                  data-month={m.month}
                  aria-current={now ? "date" : undefined}
                >
                  <td className="whitespace-nowrap py-2 pl-4 pr-2 @[36rem]:pl-6 @[36rem]:pr-3">
                    <span className="hidden @[36rem]:inline">{monthLabel(m.month, true)}</span>
                    <span className="@[36rem]:hidden">{monthLabel(m.month).replace(".", "")}</span>
                  </td>
                  <td className={cell}>{m.deposited ? wholeKr(m.deposited) : <span className="text-ink-3">–</span>}</td>
                  <td className={cn(cell, wide, "px-3")}>{m.withdrawn ? wholeKr(m.withdrawn) : <span className="text-ink-3">–</span>}</td>
                  <td className={cn(cell, "font-semibold", netClass(m.net))} data-net={m.net}>
                    {Math.round(m.net / 100) === 0 ? "0 kr" : signedKr(m.net)}
                  </td>
                  <td className={cn(cell, wide, "px-3 text-ink-2")}>{m.income ? wholeKr(m.income) : "–"}</td>
                  <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right @[36rem]:pl-3 @[36rem]:pr-6">
                    <Pill rate={m.rate} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-ink font-semibold">
              <td className="py-2.5 pl-4 pr-2 @[36rem]:pl-6 @[36rem]:pr-3">Totalt</td>
              <td className={cell}>{wholeKr(total.deposited)}</td>
              <td className={cn(cell, wide, "px-3")}>{wholeKr(total.withdrawn)}</td>
              <td className={cn(cell, netClass(total.net))}>{signedKr(total.net)}</td>
              <td className={cn(cell, wide, "px-3")}>{wholeKr(total.income)}</td>
              <td className="whitespace-nowrap py-2.5 pl-2 pr-4 text-right tabular-nums @[36rem]:pl-3 @[36rem]:pr-6">{pct(total.rate)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
