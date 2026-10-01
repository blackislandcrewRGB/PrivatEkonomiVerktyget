import { cn } from "../../../lib/cn";
import { wholeKr } from "../common";
import { DELTA, deltaTone, largestDiffs, signedKr, signedPct, type CompareData } from "./delta";

/**
 * Jämför perioder's hero (Design v2): "A mot B", the total's difference in
 * kronor in large type (orange when A is more, green when less) with "mer/
 * mindre i A · ±N %", A and B as two boxes, and the four categories with the
 * largest difference as pills.
 */
export function CompareHero({ data, aName, bName, aShort, bShort }: { data: CompareData; aName: string; bName: string; aShort: string; bShort: string }) {
  const t = data.total;
  const tone = deltaTone(t.diff);
  const largest = largestDiffs(data.rows);
  return (
    <section className="@container space-y-3 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="compare-hero-title" data-card="hero">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id="compare-hero-title" className="text-[13px] font-semibold text-ink-2">
            {aName} mot {bName}
          </h2>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className={cn("text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums", DELTA[tone].text)} data-testid="compare-delta" data-tone={tone}>
              {signedKr(t.diff)}
            </span>
            <span className="text-[15px] text-ink-2">
              {tone === "even" ? "lika mycket" : tone === "more" ? `mer i ${aShort}` : `mindre i ${aShort}`}
              {t.pct !== null && tone !== "even" && ` · ${signedPct(t.pct, 1)}`}
            </span>
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 @[40rem]:w-auto @[40rem]:min-w-[22rem]">
          <div className="min-w-0 rounded-inset bg-accent-soft px-3.5 py-3" data-box="a">
            <p className="truncate text-[11px] text-accent">A · {aShort}</p>
            <p className="mt-0.5 text-[20px] font-bold leading-tight tabular-nums">{wholeKr(t.a)}</p>
          </div>
          <div className="min-w-0 rounded-inset bg-card-inset px-3.5 py-3" data-box="b">
            <p className="truncate text-[11px] text-ink-2">B · {bShort}</p>
            <p className="mt-0.5 text-[20px] font-bold leading-tight tabular-nums">{wholeKr(t.b)}</p>
          </div>
        </div>
      </div>
      {largest.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="mr-1 text-ink-2">Störst skillnad:</span>
          {largest.map((l) => (
            <span key={l.key} className={cn("rounded-full px-2.5 py-0.5 font-semibold tabular-nums", DELTA[deltaTone(l.diff)].pill)} data-largest={l.key}>
              {l.name} {signedKr(l.diff)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
