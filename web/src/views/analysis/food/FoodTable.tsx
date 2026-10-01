import { kronor, percent } from "../../../csv";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { CsvButton, Money, monthLabel, pct } from "../common";
import { SHARE_TONE, shareText, shareTone } from "./tones";
import { FOOD_KINDS, foodTotal, type FoodData } from "./types";

/** On a phone the headings wrap and the columns sit closer. */
const head = "py-2 font-normal @[36rem]:whitespace-nowrap";
const cell = "whitespace-nowrap py-2 tabular-nums";
const pad = "px-2 @[36rem]:px-3";
/** Fördelning is left out on a narrow card (a phone). */
const wide = "hidden @[36rem]:table-cell";

/** The share eaten out as a pill in its tone; a dash without food. */
export function SharePill({ share }: { share: number | null }) {
  if (share === null) return <span className="text-ink-3">–</span>;
  const tone = shareTone(share);
  return (
    <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums @[36rem]:px-2 @[36rem]:text-[12px]", SHARE_TONE[tone].className)} data-tone={tone}>
      {shareText(share)}
    </span>
  );
}

/**
 * Mat's table (Design v2): per month a three-part bar as wide as the month's
 * food against the largest month's, the three amounts and the share eaten
 * out as a toned pill; the current month light blue and bold; Totalt under a
 * black line. The CSV is the same as before.
 */
export function FoodTable({ data }: { data: FoodData }) {
  const current = todayIso().slice(0, 7);
  const largest = Math.max(0, ...data.months.map(foodTotal));
  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="food-table-title" data-card="table">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4 sm:px-6">
        <h2 id="food-table-title" className="text-[15px] font-semibold">
          Tabell
        </h2>
        <CsvButton
          filename="mat-per-manad"
          header={["Månad", "Livsmedel", "Restaurang & café", "Hämtmat", "Andel ute & hämtmat %"]}
          rows={() => [
            ...data.months.map((m) => [m.month, kronor(m.groceries), kronor(m.restaurants), kronor(m.takeaway), percent(m.outShare)]),
            ["Totalt", kronor(data.total.groceries), kronor(data.total.restaurants), kronor(data.total.takeaway), percent(data.total.outShare)],
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] @[36rem]:text-[13px]" aria-label="Mat per månad">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className={cn(head, "pl-4 pr-2 text-left @[36rem]:pl-6 @[36rem]:pr-3")}>Månad</th>
              <th className={cn(head, wide, "w-[36%] px-3 text-left")}>Fördelning</th>
              <th className={cn(head, pad, "text-right")}>Livsmedel</th>
              <th className={cn(head, pad, "text-right")}>Restaurang & café</th>
              <th className={cn(head, pad, "text-right")}>Hämtmat</th>
              <th className={cn(head, "pl-2 pr-4 text-right @[36rem]:pl-3 @[36rem]:pr-6")}>Ute & hämtmat</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => {
              const total = foodTotal(m);
              const now = m.month === current;
              return (
                <tr key={m.month} className={cn("border-b border-hairline", now && "bg-row-current font-semibold")} data-month={m.month} aria-current={now ? "date" : undefined}>
                  <td className="whitespace-nowrap py-2 pl-4 pr-2 @[36rem]:pl-6 @[36rem]:pr-3">
                    <span className="hidden first-letter:uppercase @[36rem]:inline-block">{monthLabel(m.month, true)}</span>
                    <span className="@[36rem]:hidden">{monthLabel(m.month).replace(".", "")}</span>
                  </td>
                  <td className={cn(wide, "px-3 py-2")}>
                    <span className="flex h-1.5 overflow-hidden rounded-full" style={{ width: `${largest > 0 ? (Math.max(0, total) / largest) * 100 : 0}%` }} data-spread={largest > 0 ? Math.max(0, total) / largest : 0}>
                      {FOOD_KINDS.map((k) =>
                        m[k.key] > 0 && total > 0 ? <span key={k.key} className={cn("h-full", k.dot)} style={{ width: `${(m[k.key] / total) * 100}%` }} data-part={k.key} /> : null,
                      )}
                    </span>
                  </td>
                  {FOOD_KINDS.map((k) => (
                    <td key={k.key} className={cn(cell, pad, "text-right")}>
                      <Money ore={m[k.key]} />
                    </td>
                  ))}
                  <td className="whitespace-nowrap py-1.5 pl-2 pr-4 text-right @[36rem]:pl-3 @[36rem]:pr-6">
                    <SharePill share={m.outShare} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-ink font-semibold">
              <td className="py-2.5 pl-4 pr-2 @[36rem]:pl-6 @[36rem]:pr-3">Totalt</td>
              <td className={wide} />
              {FOOD_KINDS.map((k) => (
                <td key={k.key} className={cn(cell, pad, "text-right")}>
                  <Money ore={data.total[k.key]} />
                </td>
              ))}
              <td className="whitespace-nowrap py-2.5 pl-2 pr-4 text-right tabular-nums @[36rem]:pl-3 @[36rem]:pr-6">{pct(data.total.outShare)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-hairline px-5 py-3 text-[11px] text-ink-3 sm:px-6">
        Andelen tonas: grön under 20 %, grå 20–30 %, orange 30–40 %, röd över 40 %.
      </p>
    </section>
  );
}
