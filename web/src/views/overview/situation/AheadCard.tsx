import { useState } from "react";
import type { BalanceSheet } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { dm, kr } from "../format";
import { aheadDays, aheadTerms, itemsLine, keyDays } from "./ahead";
import { TaxRefundPopover } from "../../tax/TaxRefundBreakdown";

type Ahead = NonNullable<BalanceSheet["ahead"]>;

/** Whole kronor with the sign: '+39 821 kr', '−42 897 kr'. */
const signed = (ore: number) => `${ore > 0 ? "+" : ""}${kr(ore)}`;

function Box({ label, value, positive, result, testId }: { label: string; value: string; positive?: boolean; result?: boolean; testId?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col justify-between rounded-inset px-3.5 py-2.5", result ? "bg-accent-soft" : "bg-card-inset")}>
      <span className={cn("text-[11px] leading-snug", result ? "text-accent" : "text-ink-2")}>{label}</span>
      <span className={cn("font-bold tabular-nums", result ? "text-[22px] leading-tight" : "text-[15px]", positive && "text-positive-text")} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

const Sign = ({ children }: { children: string }) => (
  <span aria-hidden className="w-4 shrink-0 self-center text-center text-lg text-ink-3">
    {children}
  </span>
);

/**
 * Framåt: Pengar totalt over the coming salary cycle as an equation — today,
 * what comes in, what goes out, what is left after the salary and the bills —
 * with the three days worth seeing under it, and every day behind 'Visa
 * alla' (folded by default).
 */
export function AheadCard({ ahead, start }: { ahead: Ahead; start: number }) {
  const [open, setOpen] = useState(false);
  const terms = aheadTerms(ahead);
  const end = start + terms.reduce((s, t) => s + t.amount, 0);
  const days = aheadDays(ahead, start);
  const key = keyDays(ahead, start);
  const next = ahead.salaries[1];

  return (
    <Card aria-labelledby="ahead-title" className="@container flex flex-col gap-4" data-testid="networth-ahead">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="ahead-title" className="text-base font-semibold">
          Framåt till {dm(ahead.to)}
          {next && <span className="text-[13px] font-normal text-ink-2"> · lönen efter kommer {dm(next)}</span>}
        </h2>
        <button type="button" className="text-xs text-accent hover:underline" aria-expanded={open} aria-controls="ahead-days" onClick={() => setOpen((o) => !o)}>
          {open ? "Dölj dagarna ‹" : `Visa alla ${days.length} dagar med händelser ›`}
        </button>
      </div>

      <ol className="flex flex-col gap-2 @[44rem]:flex-row @[44rem]:items-stretch" aria-label="Uträkningen" data-testid="ahead-equation">
        <li className="flex min-w-0 flex-1 items-stretch gap-2" data-term="start">
          <span aria-hidden className="w-4 shrink-0 @[44rem]:hidden" />
          <Box label="I dag" value={kr(start)} />
        </li>
        {terms.map((t) => (
          <li key={t.key} className="flex min-w-0 flex-1 items-stretch gap-2" data-term={t.key}>
            <Sign>{t.amount < 0 ? "−" : "+"}</Sign>
            <Box label={t.label} value={signed(t.amount)} positive={t.amount > 0} />
          </li>
        ))}
        <li className="flex min-w-0 flex-1 items-stretch gap-2" data-term="result">
          <Sign>=</Sign>
          <Box label="Efter lön och räkningar" value={kr(end)} result testId="ahead-end" />
        </li>
      </ol>

      {key.length > 0 && (
        <ul className="grid gap-2 @[44rem]:grid-cols-3" aria-label="Viktiga dagar" data-testid="ahead-key-days">
          {key.map((d) => (
            <li key={d.date} className="min-w-0 rounded-inset border border-hairline px-3.5 py-2.5 text-xs" data-key-day={d.date}>
              <p className="flex items-baseline justify-between gap-2">
                <b className="font-semibold">{dm(d.date)}</b>
                <span className="text-ink-2 tabular-nums">{kr(d.balance)}</span>
              </p>
              <p className="mt-0.5 text-ink-2">{itemsLine(d.items)}</p>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ul id="ahead-days" className="-mx-5 border-t border-hairline text-[13px] sm:-mx-7">
          {days.map((d) => (
            <li key={d.date} className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem] gap-x-3 border-b border-hairline px-5 py-2.5 last:border-0 sm:px-7" data-day={d.date}>
              <span className="font-semibold tabular-nums">{dm(d.date)}</span>
              <ul className="space-y-0.5">
                {d.items.map((i, n) => (
                  <li key={n} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {i.name}
                      {i.estimate && <span className="ml-1.5 text-[11px] text-ink-3">{i.paced ? `uppskattad, varav ca ${kr(i.paced)} kommande köp` : "uppskattad"}</span>}
                      {i.taxRefundYear && (
                        <TaxRefundPopover year={i.taxRefundYear} className="ml-1.5 text-[11px]">
                          Visa uträkning
                        </TaxRefundPopover>
                      )}
                    </span>
                    <span className={cn("whitespace-nowrap tabular-nums", i.amount > 0 && "text-positive-text")}>{signed(i.amount)}</span>
                  </li>
                ))}
              </ul>
              <span className="text-right font-bold tabular-nums">{kr(d.balance)}</span>
            </li>
          ))}
        </ul>
      )}

      {(ahead.later ?? []).map((l) => (
        <p key={l.incomeYear} className="flex flex-wrap items-baseline gap-x-2 rounded-inset bg-card-inset px-3.5 py-2.5 text-[12px]" data-testid="ahead-later">
          <span className="min-w-0 flex-1">
            {l.amount >= 0 ? "Skatteåterbäring" : "Kvarskatt"} för {l.incomeYear} (uppskattad):{" "}
            <b className={cn("font-semibold tabular-nums", l.amount > 0 && "text-positive-text")}>{signed(l.amount)}</b> omkring {dm(l.payDate)} {l.payDate.slice(0, 4)} – utanför perioden
          </span>
          <TaxRefundPopover year={l.incomeYear} className="text-[11px]">
            Visa uträkning
          </TaxRefundPopover>
        </p>
      ))}

      <p className="text-[11px] text-ink-3">
        Kortfakturorna räknar med det du troligen handlar på korten resten av perioden. Det du betalar direkt från bankkontot dag för dag är inte med, se Kassaflöde.
      </p>
    </Card>
  );
}

