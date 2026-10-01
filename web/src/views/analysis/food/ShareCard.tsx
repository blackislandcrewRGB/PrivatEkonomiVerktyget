import { wholeKr, pct } from "../common";
import { cn } from "../../../lib/cn";
import { wholeMonths } from "../categories/figures";
import { CHANGE_CLASS, changeTone, signed } from "./tones";
import { FOOD_KINDS, foodTotal, perWholeMonth, type FoodData } from "./types";

const SIZE = 104;
const STROKE = 16;

/**
 * The food as a ring: livsmedel, restaurang & café and hämtmat in turn, from
 * the top clockwise, each as long as its share of all the food; the share
 * eaten out in the middle. An empty track without food.
 */
export function FoodRing({ total, share }: { total: FoodData["total"]; share: number | null }) {
  const r = (SIZE - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const all = foodTotal(total);
  let start = 0;
  return (
    <div className="relative size-[104px] shrink-0" role="img" aria-label={`${pct(share)} ute och hämtmat av maten`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full -rotate-90" aria-hidden>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke="var(--color-track)" strokeWidth={STROKE} />
        {all > 0 &&
          FOOD_KINDS.map((k) => {
            const part = Math.max(0, total[k.key]) / all;
            const len = part * c;
            const el = (
              <circle
                key={k.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                fill="none"
                stroke={k.colour}
                strokeWidth={STROKE}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-start}
                data-segment={k.key}
                data-part={part}
              />
            );
            start += len;
            return part > 0 ? el : null;
          })}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[18px] font-bold leading-none tabular-nums">{pct(share)}</span>
        <span className="mt-0.5 max-w-12 text-[9px] leading-tight text-ink-3">ute + hämtmat</span>
      </span>
    </div>
  );
}

/**
 * Mat's hero, the left card (Design v2): the ring, the change in the share
 * against the same period last year in percentage points (orange up, green
 * down, grey within ±0,5; none without food last year), the food in the
 * period and per month (over the whole months, as Snitt), and what the share
 * is.
 */
export function ShareCard({ data, before, to }: { data: FoodData; before: FoodData | null; to: string }) {
  const now = data.total.outShare;
  const then = before?.total.outShare ?? null;
  const delta = now !== null && then !== null ? (now - then) * 100 : null;
  const tone = delta === null ? null : changeTone(delta, 0.5);
  const whole = wholeMonths(data.months.map((m) => m.month), to);
  const perMonth = perWholeMonth(data.months, whole, foodTotal);

  return (
    <section className="min-w-0 rounded-card bg-card p-5 text-ink shadow-card sm:px-6" aria-labelledby="food-share-title" data-card="share">
      <h2 id="food-share-title" className="text-[13px] font-semibold text-ink-2">
        Ute och hämtmat, andel av maten
      </h2>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-4">
        <FoodRing total={data.total} share={now} />
        <div className="min-w-0 flex-1 basis-[14rem] space-y-2">
          {tone && delta !== null && (
            <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums", CHANGE_CLASS[tone])} data-change={tone}>
              {tone === "up" ? "↗" : tone === "down" ? "↘" : "→"} {signed(delta)} p.e. mot förra året ({pct(then)})
            </span>
          )}
          <p className="text-[13px] text-ink-2 tabular-nums">
            {wholeKr(foodTotal(data.total))} på mat i perioden
            {perMonth !== null && (
              <span title={`snitt över ${whole.length} hela ${whole.length === 1 ? "månad" : "månader"}`}> · {wholeKr(perMonth)}/mån</span>
            )}
          </p>
          <p className="text-[11px] leading-snug text-ink-3">Andelen = restaurang, café och hämtmat delat med all mat.</p>
        </div>
      </div>
    </section>
  );
}
