import type { RealSavings } from "../../../api";
import { cn } from "../../../lib/cn";
import { wholeKr } from "../common";
import { kpiName, signedPct } from "./RealCard";

/** Whole kronor with a sign, lost as '−', won as '+': what prices took beyond the interest. */
const power = (lostOre: number) => {
  const v = Math.round(lostOre / 100);
  return v === 0 ? "0 kr" : `${v > 0 ? "−" : "+"}${wholeKr(Math.abs(v) * 100)}`;
};

/**
 * Bufferten mot inflationen (Design v2): the e-savings account today, the
 * newest twelve months' inflation as the interest it would take to keep its
 * purchasing power, and per whole year its average balance, the interest it
 * got, prices December to December and what that cost or gave in kronor.
 */
export function BufferCard({ buffer: b, kpiMonth }: { buffer: NonNullable<RealSavings["buffer"]>; kpiMonth: string | null }) {
  return (
    <section className="@container space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="buffer-title" data-card="buffer">
      <div>
        <h2 id="buffer-title" className="text-[15px] font-semibold">
          Bufferten mot inflationen
        </h2>
        <p className="mt-0.5 text-[12px] text-ink-3">{b.name} · räntan mot KPI</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 rounded-inset bg-card-inset px-3.5 py-3" data-box="balance">
          <p className="text-[11px] text-ink-2">Saldo i dag</p>
          <p className="mt-0.5 text-[20px] font-bold leading-tight tabular-nums">{wholeKr(b.balanceOre)}</p>
        </div>
        <div className="min-w-0 rounded-inset bg-card-inset px-3.5 py-3" data-box="needed">
          <p className="text-[11px] text-ink-2">Räntan som håller köpkraften</p>
          <p className="mt-0.5 text-[20px] font-bold leading-tight tabular-nums">{b.inflation12 ? signedPct(b.inflation12.change).replace(/^\+/, "") : "–"}</p>
          {b.inflation12 && <p className="mt-0.5 text-[11px] text-ink-3">inflationen senaste 12 mån, t.o.m. {kpiName(b.inflation12.to)}</p>}
        </div>
      </div>
      {b.years.length > 0 ? (
        <table className="w-full text-[12px] @[30rem]:text-[13px]" aria-label="Bufferten per år">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="py-1.5 pr-2 text-left font-normal">År</th>
              <th className="hidden px-2 py-1.5 text-right font-normal @[30rem]:table-cell">Snittsaldo</th>
              <th className="px-2 py-1.5 text-right font-normal">Ränta</th>
              <th className="px-2 py-1.5 text-right font-normal">Inflation</th>
              <th className="py-1.5 pl-2 text-right font-normal">Köpkraft</th>
            </tr>
          </thead>
          <tbody>
            {[...b.years].reverse().map((y) => {
              const beat = y.lostOre !== null && Math.round(y.lostOre / 100) <= 0;
              return (
                <tr key={y.year} className="border-b border-hairline last:border-0" data-year={y.year}>
                  <td className="py-2 pr-2 font-medium">{y.year}</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums text-ink-2 @[30rem]:table-cell">{wholeKr(y.averageOre)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                    {wholeKr(y.interestOre)} <span className="text-ink-3">· {signedPct(y.rate).replace(/^\+/, "")}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-2">{signedPct(y.inflation)}</td>
                  <td className="py-2 pl-2 text-right">
                    {y.lostOre === null ? (
                      "–"
                    ) : (
                      <span
                        className={cn("inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums", beat ? "bg-positive-soft text-positive-text" : "bg-caution-soft text-caution-text")}
                        data-tone={beat ? "kept" : "lost"}
                      >
                        {power(y.lostOre)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-[12px] text-ink-3">Inget helt år med rader på kontot än.</p>
      )}
      <p className="text-[11px] text-ink-3">
        Köpkraft: snittsaldot gånger inflationen minus räntan – grön när räntan räckte, orange när priserna tog mer. Bara hela år med rader på kontot; räntan är raderna som heter något med
        ränta. {kpiMonth ? `KPI t.o.m. ${kpiName(kpiMonth)}.` : ""}
      </p>
    </section>
  );
}
