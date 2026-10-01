import { PAYMENT_METHOD_LABEL, type ExpenseEstimates, type PaymentMethod, type RecurringExpense } from "../../../api";
import { AnimatedNumber } from "../../../components/AnimatedAmount";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import type { Share } from "../../../lib/share";
import { todayIso } from "../../../lib/today";
import { useWidth } from "../../../lib/useWidth";
import { kr } from "../../overview/format";
import { monthly, partOf } from "../model";
import { salaryBar, segmentLabel, whole, type SegmentKey } from "./salaryBar";
import { monthProgress } from "./thisMonth";

const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
const monthShort = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" }).replace(".", "");

/** '4 390' without 'kr': the segments' labels. */
const bare = (ore: number) => kr(ore).replace(/\s*kr$/, "");

const SEGMENT: Record<SegmentKey, { bar: string; text: string; dot: string }> = {
  fixed: { bar: "bg-wallet-private", text: "text-white", dot: "bg-wallet-private" },
  // Dark text on the green and the orange: white on them is too faint for 11 px.
  food: { bar: "bg-positive", text: "text-[#1d1d1f]", dot: "bg-positive" },
  fuel: { bar: "bg-caution", text: "text-[#1d1d1f]", dot: "bg-caution" },
  left: { bar: "bg-accent-soft", text: "text-accent", dot: "bg-accent-soft" },
};

/**
 * Fasta utgifter's hero, replacing the three cards with everything that was
 * in them. On the left the fixed expenses a month (the yearly ones are put
 * aside for, not in it), with food and fuel, against the usual salary as a
 * bar; on the right this month's draws, and Eget and Årsvis. 'Min del'
 * counts shared expenses at half; the household's sum has no salary to set
 * it against.
 */
export function Hero({ expenses, share, estimates }: { expenses: RecurringExpense[]; share: Share; estimates: ExpenseEstimates | null }) {
  const active = expenses.filter((e) => !e.paused);
  const month = (e: RecurringExpense) => partOf(e, monthly(e), share);
  // What is drawn every month: the yearly ones are put aside for, not in the sum.
  const monthlyOnes = active.filter((e) => e.billingCycle !== "yearly");
  const total = monthlyOnes.reduce((s, e) => s + month(e), 0);
  const shared = monthlyOnes.filter((e) => e.shared).reduce((s, e) => s + month(e), 0);
  const byMethod = new Map<PaymentMethod, number>();
  for (const e of monthlyOnes) byMethod.set(e.paymentMethod, (byMethod.get(e.paymentMethod) ?? 0) + month(e));

  const pick = (x: { amount: number | null; mine: number | null } | undefined) => (share === "mine" ? x?.mine : x?.amount) ?? 0;
  const food = pick(estimates?.food);
  const fuel = pick(estimates?.fuel);
  // Kvar av lönen: my part of what is drawn, against the salary I usually get.
  const salary = share === "mine" ? (estimates?.salary ?? null) : null;

  const yearly = active.filter((e) => e.billingCycle === "yearly");
  const yearlyTotal = yearly.reduce((s, e) => s + partOf(e, e.amount, share), 0);
  const progress = monthProgress(expenses, share);

  return (
    <div className="@container">
      <div className="grid gap-4 @[56rem]:grid-cols-12">
        <Card aria-labelledby="fixed-title" className="flex flex-col gap-4 @[56rem]:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <h2 id="fixed-title" className="text-[13px] font-medium text-ink-2">
                Fasta utgifter per månad, {share === "mine" ? "min del" : "hushållet"}
              </h2>
              <p className="text-[52px] font-bold leading-none tracking-[-0.03em] tabular-nums" data-figure="total">
                <AnimatedNumber value={total} format={kr} />
              </p>
            </div>
            <div className="text-[13px] text-ink-2 @[40rem]:text-right" data-figure="with-food">
              <p>
                Med mat och bränsle{" "}
                <b className="font-semibold text-ink">
                  <AnimatedNumber value={total + food + fuel} format={kr} />
                </b>
              </p>
              {salary && (
                <p className="text-xs" title={`Snittet av de ${salary.count} senaste lönerna (${monthShort(salary.from)}–${monthShort(salary.to)}), ${kr(salary.average)}.`}>
                  av snittlönen {kr(salary.average)}
                </p>
              )}
            </div>
          </div>
          <SalaryBarView fixed={total} food={food} fuel={fuel} salary={salary?.average ?? null} />
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-[11px] text-ink-3">
            <p>
              {salary ? (
                whole(salary.average) >= whole(total) ? (
                  <>
                    utan mat och bränsle är <b className="font-semibold text-ink-2">{kr(whole(salary.average) - whole(total))}</b> kvar av lönen
                  </>
                ) : (
                  <>
                    redan utan mat och bränsle <b className="font-semibold text-alarm">{kr(whole(total) - whole(salary.average))}</b> över snittlönen
                  </>
                )
              ) : (
                share === "household" &&
                [...byMethod]
                  .sort((a, b) => b[1] - a[1])
                  .map(([m, v]) => `${PAYMENT_METHOD_LABEL[m].toLowerCase()} ${kr(v)}`)
                  .join(" · ")
              )}
            </p>
            <p>{estimateNote(estimates, share)}</p>
          </div>
        </Card>

        <div className="grid content-start gap-4 @[56rem]:col-span-4">
          <Card aria-labelledby="month-title" className="flex flex-col gap-2 sm:px-5 sm:py-5">
            <h2 id="month-title" className="text-[13px] font-medium text-ink-2">
              Den här månaden
            </h2>
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2">
              <b className="text-xl font-bold tabular-nums text-ink" data-figure="left-to-draw">
                <AnimatedNumber value={progress.leftOre} format={kr} />
              </b>
              kvar att dra · {progress.leftCount} av {progress.total} kommande
            </p>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-track"
              role="progressbar"
              aria-label={`${progress.total - progress.leftCount} av ${progress.total} dragna i ${monthName(todayMonth())}`}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.total - progress.leftCount}
            >
              <div className="h-full rounded-full bg-positive transition-[width] duration-300" style={{ width: `${progress.drawnShare * 100}%` }} />
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-4" aria-label="Eget och årsvis">
            <SmallCard label="Eget" ore={total - shared} title="De månadsvisa utgifterna som bara är dina, inte delade">
              per månad · delat {bare(shared)}
            </SmallCard>
            <SmallCard label="Årsvis" ore={yearlyTotal} title="Årsvisa utgifter, inte med i Per månad. Delade på 12 är de det du behöver lägga undan varje månad.">
              {yearly.length ? `per år · ${kr(yearly.reduce((s, e) => s + month(e), 0))}/mån` : "inga årsvisa"}
            </SmallCard>
          </div>
        </div>
      </div>
    </div>
  );
}

const todayMonth = () => todayIso().slice(0, 7);

/** 'mat = snitt juni–aug, din del · bränsle uppskattat från Pendling & bränsle', or how to get them. */
function estimateNote(estimates: ExpenseEstimates | null, share: Share): string {
  if (!estimates) return "";
  const { food, fuel } = estimates;
  const whose = share === "mine" ? ", din del" : "";
  const foodText =
    food.source === "entered"
      ? `mat = hushållets belopp under Uppskattat${whose}`
      : food.source === "average"
        ? `mat = snitt ${monthShort(food.average.from)}–${monthShort(food.average.to)}${whose}`
        : "Lägg in vad maten kostar under Uppskattat.";
  const fuelText = fuel.source === "forecast" ? "bränsle uppskattat från Pendling & bränsle" : fuel.source === "average" ? "bränsle = snitt" : null;
  return [foodText, fuelText].filter(Boolean).join(" · ");
}

function SalaryBarView({ fixed, food, fuel, salary }: { fixed: number; food: number; fuel: number; salary: number | null }) {
  const [measure, width] = useWidth(600);
  const bar = salaryBar({ fixed, food, fuel, salary });
  // The segments share the width less their 2 px gaps.
  const room = Math.max(0, width - 2 * (bar.segments.length - 1));
  const labels = bar.segments.map((s) => segmentLabel(s.name, bare(s.ore), s.share * room));
  const hidden = bar.segments.filter((_, i) => labels[i] === "none");
  const description = [
    ...bar.segments.map((s) => `${s.name} ${kr(s.ore)}`),
    ...(bar.over !== null ? [`${kr(bar.over)} över snittlönen`] : []),
  ].join(", ");
  return (
    <div className="space-y-1.5">
      <div
        ref={measure}
        role="img"
        aria-label={description}
        data-over={bar.over !== null || undefined}
        className={cn("flex h-[22px] gap-[2px] overflow-hidden rounded-[11px]", bar.over !== null && "outline-2 outline-offset-2 outline-alarm")}
      >
        {bar.segments.map((s, i) => (
          <div
            key={s.key}
            data-segment={s.key}
            data-ore={s.ore}
            className={cn("flex min-w-1 items-center overflow-hidden whitespace-nowrap px-2 text-[11px] font-semibold tabular-nums", SEGMENT[s.key].bar, SEGMENT[s.key].text)}
            style={{ flexGrow: s.share, flexBasis: 0 }}
            title={`${s.name} ${kr(s.ore)}`}
          >
            {labels[i] === "full" ? `${s.name} ${bare(s.ore)}` : labels[i] === "amount" ? bare(s.ore) : ""}
          </div>
        ))}
      </div>
      {(hidden.length > 0 || bar.over !== null) && (
        <p className="flex flex-wrap gap-x-3 text-[11px] text-ink-2">
          {hidden.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span aria-hidden className={cn("size-2 rounded-full", SEGMENT[s.key].dot)} />
              {s.name} {kr(s.ore)}
            </span>
          ))}
          {bar.over !== null && <span className="font-semibold text-alarm">{kr(bar.over)} över snittlönen</span>}
        </p>
      )}
    </div>
  );
}

function SmallCard({ label, ore, title, children }: { label: string; ore: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0 px-4 py-3.5 sm:px-5 sm:py-4" title={title} aria-label={label}>
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">
        <AnimatedNumber value={ore} format={kr} />
      </p>
      <p className="mt-0.5 text-[11px] text-ink-3">{children}</p>
    </Card>
  );
}
