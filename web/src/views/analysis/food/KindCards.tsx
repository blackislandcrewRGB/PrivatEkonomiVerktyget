import { cn } from "../../../lib/cn";
import { wholeKr } from "../common";
import { wholeMonths } from "../categories/figures";
import { CHANGE_CLASS, changeTone } from "./tones";
import { FOOD_KINDS, perWholeMonth, type FoodData } from "./types";

/** '+152 %' / '−20 %', whole percent. */
const percentChange = (n: number) => {
  const r = Math.round(n);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} %`;
};

/**
 * Mat's hero, the right side (Design v2): a card each for livsmedel,
 * restaurang & café and hämtmat with its colour dot, the sum in the period
 * and per whole month, and under a divider the change against the same
 * period last year in percent (orange up, green down, grey within ±0,5 %)
 * with last year's sum; 'ingen jämförelse' when last year had none.
 */
export function KindCards({ data, before, to }: { data: FoodData; before: FoodData | null; to: string }) {
  const whole = wholeMonths(data.months.map((m) => m.month), to);
  return (
    <div className="grid h-full grid-cols-1 gap-4 @[40rem]:grid-cols-3">
      {FOOD_KINDS.map((k) => {
        const now = data.total[k.key];
        const then = before?.total[k.key] ?? 0;
        const change = then > 0 ? ((now - then) / then) * 100 : null;
        const tone = change === null ? null : changeTone(change, 0.5);
        const perMonth = perWholeMonth(data.months, whole, (m) => m[k.key]);
        return (
          <section key={k.key} className="flex min-w-0 flex-col rounded-card bg-card px-5 py-4 text-ink shadow-card" data-card={k.key} aria-label={k.name}>
            <p className="flex items-center gap-2 text-[12px] text-ink-2">
              <span className={cn("size-2 shrink-0 rounded-full", k.dot)} aria-hidden />
              {k.name}
            </p>
            <p className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.01em] tabular-nums">{wholeKr(now)}</p>
            <p className="mb-3 text-[11px] text-ink-3 tabular-nums" title={`snitt över ${whole.length} hela ${whole.length === 1 ? "månad" : "månader"}`}>
              {perMonth === null ? "ingen hel månad" : `${wholeKr(perMonth)}/mån`}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline pt-3 text-[11px] text-ink-3">
              {tone && change !== null ? (
                <>
                  <span className={cn("rounded-full px-2 py-0.5 font-semibold tabular-nums", CHANGE_CLASS[tone])} data-change={tone}>
                    {percentChange(change)}
                  </span>
                  <span className="tabular-nums">förra året {wholeKr(then)}</span>
                </>
              ) : (
                <span>ingen jämförelse</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
