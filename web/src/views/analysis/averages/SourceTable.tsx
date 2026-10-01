import { kronor } from "../../../csv";
import { cn } from "../../../lib/cn";
import { walletColour } from "../../overview/wallet";
import { CsvButton, Money, monthLabel } from "../common";
import { shareOf, type Avg, type AveragesData, type AverageSource } from "./types";

const val = (n: number | null) => (n === null ? <span className="text-ink-3">–</span> : <Money ore={n} />);
/**
 * The account's wallet colour; the manual rows without an account grey. The
 * everyday account's near-black would vanish on the dark card, so there it
 * is the secondary grey.
 */
const colour = (s: AverageSource) => {
  const c = s.kind ? walletColour({ name: s.name, kind: s.kind }) : "bg-ink-3";
  return c === "bg-wallet-private" ? "bg-wallet-private dark:bg-ink-2" : c;
};
const pct = (share: number) => `${(share * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;

const head = "whitespace-nowrap py-2 font-normal";
/** Per vecka and the bar's column are left out on a narrow card (a phone); the bar goes under the name there. */
const wide = "hidden @[36rem]:table-cell";
const cell = "whitespace-nowrap py-2.5 tabular-nums";

/**
 * Snitt › Per källa (Design v2): each account with its wallet colour, its
 * share of the sum as a bar in that colour, the sum and the week in the
 * secondary colour and the month in bold. The CSV is the same as before.
 */
export function SourceTable({ data }: { data: AveragesData }) {
  const csvRow = (name: string, a: Avg) => [name, kronor(a.total), kronor(a.perWeek), kronor(a.perMonth)];
  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="average-sources-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4 sm:px-6">
        <h2 id="average-sources-title" className="text-[15px] font-semibold">
          Per källa
        </h2>
        <CsvButton
          filename="snitt-per-kalla"
          header={["Källa", "Summa", "Snitt per vecka", "Snitt per månad", "Ofullständig import"]}
          rows={() => [...data.bySource.map((s) => [...csvRow(s.name, s), s.incompleteMonths.join(", ")]), [...csvRow("Totalt", data.total), ""]]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" aria-label="Per källa">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className={cn(head, "pl-5 pr-3 text-left sm:pl-6")}>Källa</th>
              <th className={cn(head, wide, "w-[40%] px-3 text-left")}>Andel av summan</th>
              <th className={cn(head, "px-3 text-right")}>Summa</th>
              <th className={cn(head, wide, "px-3 text-right")}>Per vecka</th>
              <th className={cn(head, "pl-3 pr-5 text-right sm:pr-6")}>Per månad</th>
            </tr>
          </thead>
          <tbody>
            {data.bySource.map((s) => {
              const share = shareOf(s.total, data.total.total);
              return (
                <tr key={s.accountId} className="border-b border-hairline" data-source={s.accountId}>
                  <td className="py-2.5 pl-5 pr-3 sm:pl-6">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("size-2.5 shrink-0 rounded-[3px]", colour(s))} aria-hidden data-colour />
                        {/* A non-breaking hyphen: "e-sparkonto" stays whole on a phone. */}
                        <span className="min-w-0">{s.name.replace(/-/g, "\u2011")}</span>
                      </span>
                      {s.incompleteMonths.length > 0 && (
                        <span
                          className="ml-[1.125rem] shrink-0 rounded-full bg-caution-soft px-2 py-0.5 text-[11px] text-caution-text @[36rem]:ml-0"
                          title={`Ofullständig import: ${s.incompleteMonths.map((m) => monthLabel(m, true)).join(", ")}`}
                        >
                          ofullständig
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 ml-[1.125rem] block h-2 rounded-full bg-track @[36rem]:hidden" aria-hidden>
                      <span className={cn("block h-full rounded-full", colour(s))} style={{ width: `${share * 100}%` }} />
                    </span>
                  </td>
                  <td className={cn(wide, "px-3 py-2.5")}>
                    <span className="block h-2 rounded-full bg-track" role="img" aria-label={`${pct(share)} av summan`}>
                      <span className={cn("block h-full rounded-full", colour(s))} style={{ width: `${share * 100}%` }} data-share={share} />
                    </span>
                  </td>
                  <td className={cn(cell, "px-3 text-right text-ink-2")}>
                    <Money ore={s.total} />
                  </td>
                  <td className={cn(cell, wide, "px-3 text-right text-ink-2")}>{val(s.perWeek)}</td>
                  <td className={cn(cell, "pl-3 pr-5 text-right font-semibold sm:pr-6")}>{val(s.perMonth)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-ink font-semibold">
              <td className="py-2.5 pl-5 pr-3 sm:pl-6">Totalt</td>
              <td className={wide} />
              <td className={cn(cell, "px-3 text-right")}>
                <Money ore={data.total.total} />
              </td>
              <td className={cn(cell, wide, "px-3 text-right")}>{val(data.total.perWeek)}</td>
              <td className={cn(cell, "pl-3 pr-5 text-right sm:pr-6")}>{val(data.total.perMonth)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
