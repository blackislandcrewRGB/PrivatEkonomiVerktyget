import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "../../../lib/cn";
import { monthLabel } from "../common";
import { CHANGE_TONE, changeTone, indexLabel, pctE2, type Subgroup } from "./types";

/**
 * Varugrupper hos SCB (Design v2): a grey box per group with its name, the
 * change as a pill (green down, orange up, grey within ±0,2 %) and a
 * sparkline in the same colour over a dotted line at 100. No line of mine:
 * the transactions are purchases in a shop, not goods on a receipt.
 */
export function SubgroupsCard({ subgroups, base }: { subgroups: Subgroup[]; base: string }) {
  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="subgroups-title" data-card="subgroups">
      <div>
        <h2 id="subgroups-title" className="text-[15px] font-semibold">
          Varugrupper hos SCB
        </h2>
        <p className="mt-0.5 text-[12px] text-ink-3">
          index, 100 i {base} · utan din egen linje: dina transaktioner är köp i en affär, inte varor på ett kvitto, så det finns inget att jämföra grupp för grupp med
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 @[48rem]:grid-cols-4">
        {subgroups.map((s) => {
          const tone = changeTone(s.changePctE2);
          return (
            <div key={s.key} className="min-w-0 rounded-inset bg-card-inset px-3.5 py-3" data-group={s.key}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[12px] font-semibold leading-snug" title={s.name}>
                  {s.name}
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", CHANGE_TONE[tone].className)} data-tone={tone}>
                  {pctE2(s.changePctE2)}
                </span>
              </div>
              <div className="mt-2 h-12 w-full">
                <ResponsiveContainer>
                  <LineChart data={s.months} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
                    <ReferenceLine y={10000} stroke="var(--color-ink-3)" strokeDasharray="1 3" />
                    <YAxis hide domain={["auto", "auto"]} />
                    <XAxis dataKey="month" hide />
                    <Tooltip
                      cursor={{ stroke: "var(--color-hairline)" }}
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="rounded-[10px] bg-card/95 px-2.5 py-1.5 text-[11px] text-ink shadow-[0_4px_24px_rgba(0,0,0,0.14)] ring-1 ring-black/5 dark:ring-white/10">
                            <span className="first-letter:uppercase">{monthLabel(String(label), true)}</span> · {indexLabel((payload[0].payload as { index: number | null }).index)}
                          </div>
                        ) : null
                      }
                    />
                    <Line type="linear" dataKey="index" stroke={CHANGE_TONE[tone].line} strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
