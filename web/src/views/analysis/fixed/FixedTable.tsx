import { kronor, percent } from "../../../csv";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { CsvButton, Money, monthLabel, pct, wholeKr } from "../common";
import { fixedShareTone, monthSpread, type FixedData, type ShareTone } from "./figures";

const TONE: Record<ShareTone, string> = {
  low: "bg-positive-soft text-positive-text",
  normal: "bg-segment text-ink-2",
  high: "bg-caution-soft text-caution-text",
};
/** '31,7 %', one decimal as the tone reads it. */
const shareText = (share: number) => `${(Math.round(share * 1000) / 10).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
/** Fördelning and Inkomster are left out on a narrow card (a phone). */
const wide = "hidden @[36rem]:table-cell";
const cell = "whitespace-nowrap px-1.5 py-2 text-right tabular-nums @[36rem]:px-3";

function SharePill({ share }: { share: number | null }) {
  if (share === null) return <span className="text-ink-3">–</span>;
  const tone = fixedShareTone(share);
  return (
    <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums @[36rem]:px-2 @[36rem]:text-[12px]", TONE[tone])} data-tone={tone}>
      {shareText(share)}
    </span>
  );
}

/**
 * Fasta mot rörliga's table (Design v2): per month the income's spread as a
 * three-part bar (fixed, variable, and the net light green, or red when the
 * month went back), the amounts, the net in bold green or red and the fixed
 * share as a toned pill. The current month light blue and bold; Totalt
 * under a black line. The CSV is the same as before.
 */
export function FixedTable({ data }: { data: FixedData }) {
  const t = data.total;
  const current = todayIso().slice(0, 7);
  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="fixed-table-title" data-card="table">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4 sm:px-6">
        <h2 id="fixed-table-title" className="text-[15px] font-semibold">
          Tabell
        </h2>
        <CsvButton
          filename="fasta-mot-rorliga"
          header={["Månad", "Fasta", "Rörliga", "Inkomster", "Netto", "Fast andel av inkomst %"]}
          rows={() => [
            ...data.months.map((m) => [m.month, kronor(m.fixed), kronor(m.variable), kronor(m.income), kronor(m.net), percent(m.fixedShareOfIncome)]),
            ["Totalt", kronor(t.fixed), kronor(t.variable), kronor(t.income), kronor(t.net), percent(t.fixedShareOfIncome)],
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] @[36rem]:text-[13px]" aria-label="Fasta mot rörliga per månad">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3 [&>th]:align-bottom">
              <th className="py-2 pl-4 pr-2 text-left font-normal @[36rem]:pl-6 @[36rem]:pr-3">Månad</th>
              <th className={cn(wide, "w-[30%] px-3 py-2 text-left font-normal")}>Fördelning av inkomsten</th>
              <th className="px-1.5 py-2 text-right font-normal @[36rem]:px-3">Fasta</th>
              <th className="px-1.5 py-2 text-right font-normal @[36rem]:px-3">Rörliga</th>
              <th className={cn(wide, "px-3 py-2 text-right font-normal")}>Inkomster</th>
              <th className="px-1.5 py-2 text-right font-normal @[36rem]:px-3">Netto</th>
              <th className="py-2 pl-1.5 pr-4 text-right font-normal @[36rem]:pl-3 @[36rem]:pr-6">Fast andel</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => {
              const s = monthSpread(m);
              const now = m.month === current;
              return (
                <tr key={m.month} className={cn("border-b border-hairline", now && "bg-row-current font-semibold")} data-month={m.month} aria-current={now ? "date" : undefined}>
                  <td className="whitespace-nowrap py-2 pl-4 pr-2 @[36rem]:pl-6 @[36rem]:pr-3">
                    <span className="hidden first-letter:uppercase @[36rem]:inline-block">{monthLabel(m.month, true)}</span>
                    <span className="@[36rem]:hidden">{monthLabel(m.month).replace(".", "")}</span>
                  </td>
                  <td className={cn(wide, "px-3 py-2")}>
                    <span className="flex h-1.5 gap-px overflow-hidden rounded-full" data-spread={m.month} data-back={s.back || undefined}>
                      {s.fixed > 0 && <span className="h-full bg-ink" style={{ width: `${s.fixed * 100}%` }} data-part="fixed" />}
                      {s.variable > 0 && <span className="h-full bg-caution" style={{ width: `${s.variable * 100}%` }} data-part="variable" />}
                      {s.net > 0 && <span className={cn("h-full", s.back ? "bg-alarm" : "bg-positive/40")} style={{ width: `${s.net * 100}%` }} data-part="net" />}
                    </span>
                  </td>
                  <td className={cell}>
                    <Money ore={m.fixed} />
                  </td>
                  <td className={cell}>
                    <Money ore={m.variable} />
                  </td>
                  <td className={cn(cell, wide, "px-3 text-ink-2")}>{wholeKr(m.income)}</td>
                  <td className={cn(cell, "font-semibold", m.net < 0 ? "text-alarm" : "text-positive-text")} data-net={m.net}>
                    {wholeKr(m.net)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pl-1.5 pr-4 text-right @[36rem]:pl-3 @[36rem]:pr-6">
                    <SharePill share={m.fixedShareOfIncome} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-ink font-semibold">
              <td className="py-2.5 pl-4 pr-2 @[36rem]:pl-6 @[36rem]:pr-3">Totalt</td>
              <td className={wide} />
              <td className={cell}>
                <Money ore={t.fixed} />
              </td>
              <td className={cell}>
                <Money ore={t.variable} />
              </td>
              <td className={cn(cell, wide, "px-3")}>{wholeKr(t.income)}</td>
              <td className={cn(cell, t.net < 0 ? "text-alarm" : "text-positive-text")}>{wholeKr(t.net)}</td>
              <td className="whitespace-nowrap py-2.5 pl-1.5 pr-4 text-right tabular-nums @[36rem]:pl-3 @[36rem]:pr-6">{pct(t.fixedShareOfIncome)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-hairline px-5 py-3 text-[11px] text-ink-3 sm:px-6">
        Fast andel tonas: grön under 25 %, grå 25–40 %, orange över 40 %. Röd stapel i fördelningen = månaden gick back.
      </p>
    </section>
  );
}
