import type { ReactNode } from "react";
import type { Digest } from "../../api";
import { Card, InsetBox } from "../../components/Card";
import { cn } from "../../lib/cn";
import { dm, kr } from "./format";

/** The digest compares the week with this many weeks before it. */
const WEEKS_BACK = 8;

function Box({ label, children, className, labelClass }: { label: string; children: ReactNode; className?: string; labelClass?: string }) {
  return (
    <InsetBox className={cn("flex min-w-0 flex-col gap-1", className)}>
      <h3 className={cn("text-[11px] font-normal text-ink-2", labelClass)}>{label}</h3>
      {children}
    </InsetBox>
  );
}

const big = "text-xl font-bold tabular-nums";
const small = "text-[11px] leading-normal text-ink-2";

/**
 * Veckan som gick: what the Sunday notification says, for the latest whole
 * week, as five boxes — variable spending (my part) against 8 weeks, the
 * largest purchases, next week's draws, what is left to review and safe to
 * spend.
 */
export function WeekDigest({ data: d }: { data: Digest | null }) {
  if (!d) return null;
  const [, head, span] = /^(.*?)\s*\((.*)\)$/.exec(d.title) ?? [null, d.title, null];
  const diff = d.average ? Math.round(((d.spent - d.average) / d.average) * 100) : null;
  const coming = d.coming ?? [];

  return (
    <Card aria-labelledby="digest-title" className="@container flex flex-col gap-3 sm:py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="digest-title" className="text-base font-semibold">
          {head}
          {span && (
            <>
              {" "}
              <span className="font-normal text-ink-2">{span}</span>
            </>
          )}
        </h2>
        <span className="text-xs text-ink-3">söndagsdigest</span>
      </div>
      <div className="grid grid-cols-1 gap-3 @[28rem]:grid-cols-2 @[52rem]:grid-cols-5">
        <Box label="Rörligt, min del">
          <p className={big}>{kr(d.spent)}</p>
          <p className={cn(small, "font-medium", diff !== null && diff < 0 && "text-positive-text", diff !== null && diff > 0 && "text-caution-text")}>
            {diff === null ? "" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff).toLocaleString("sv-SE")} % mot `}
            {WEEKS_BACK}-veckorssnittet {kr(d.average)}
          </p>
        </Box>
        <Box label="Största köp">
          {d.largest.length ? (
            <ul className="text-xs leading-relaxed">
              {d.largest.map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate" title={`${l.name} ${dm(l.date)}`}>
                    {l.name}
                  </span>
                  <b className="shrink-0 font-semibold tabular-nums">{kr(l.amount)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className={small}>inga</p>
          )}
        </Box>
        <Box label="Nästa vecka">
          <p className={big}>{kr(d.comingTotal)}</p>
          <p className={small}>
            {coming.length
              ? `${coming.length} ${coming.length === 1 ? "dragning" : "dragningar"}: ${coming
                  .slice(0, 4)
                  .map((c) => `${c.name} ${kr(c.amount)} ${dm(c.date)}`)
                  .join(", ")}${coming.length > 4 ? ` och ${coming.length - 4} till` : ""}`
              : "inga dragningar"}
          </p>
        </Box>
        <Box label="Att granska">
          <p className={big}>{d.review}</p>
          <p className={small}>{d.review === 0 ? "inga okategoriserade rader" : d.review === 1 ? "rad att kategorisera" : "rader att kategorisera"}</p>
        </Box>
        <Box label="Safe to spend" className="bg-accent-soft" labelClass="text-accent">
          <p className={big}>{kr(d.safeToSpend)}</p>
          <p className={small}>
            lägst {kr(d.lowest.balance)} den {dm(d.lowest.date)}
          </p>
        </Box>
      </div>
    </Card>
  );
}
