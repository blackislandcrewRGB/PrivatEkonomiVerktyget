import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import type { Item } from "../../api";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { useTransition } from "../../lib/motion";
import { formatKr } from "../../lib/format";

/**
 * A year of buying (Design v2): a bar per month with its sum over it and a
 * white dot per pryl inside it (six at most, then '+N'); a click on a bar
 * shows that month's prylar, a click on a dot opens the pryl. Beside it the
 * same year by category, each bar against the biggest.
 *
 * A sibling of the shift calendar in Pendling & bränsle rather than the same
 * component: that one is a grid of the days in one month, each a toggle for
 * 'did I work'. This is twelve months of a year with a dot per thing and a
 * bar per month. Sharing an abstraction between them would leave something
 * that is neither.
 */

const MONTHS = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];
const SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export interface MonthOfItems {
  /** 0–11. */
  month: number;
  items: Item[];
  sum: number;
}

/** The year's twelve months, each with the things bought in it, oldest first. */
export function monthsOfYear(items: Item[], year: string): MonthOfItems[] {
  return MONTHS.map((_, month) => {
    const inMonth = items
      .filter((i) => i.purchaseDate.slice(0, 4) === year && Number(i.purchaseDate.slice(5, 7)) === month + 1)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id - b.id);
    return { month, items: inMonth, sum: inMonth.reduce((s, i) => s + i.priceOre, 0) };
  });
}

export interface CategorySum {
  category: string;
  count: number;
  sum: number;
}

/** The year by category, biggest first. Things without one are gathered under 'Utan kategori'. */
export function sumsByCategory(items: Item[], year: string): CategorySum[] {
  const out = new Map<string, CategorySum>();
  for (const i of items) {
    if (i.purchaseDate.slice(0, 4) !== year) continue;
    const category = i.category ?? "Utan kategori";
    const at = out.get(category) ?? { category, count: 0, sum: 0 };
    at.count += 1;
    at.sum += i.priceOre;
    out.set(category, at);
  }
  return [...out.values()].sort((a, b) => b.sum - a.sum || a.category.localeCompare(b.category, "sv"));
}

/** A bar's sum as short as it reads: '330', '3,5k', '12k'. */
export function shortSum(ore: number): string {
  const kr = Math.round(ore / 100);
  if (kr < 1000) return String(kr);
  const k = Math.round(kr / 100) / 10;
  return `${k.toLocaleString("sv-SE", { maximumFractionDigits: k >= 10 ? 0 : 1 })}k`;
}

/** How many months the year's average is over: all twelve, or up to this month in this year. */
export const monthsSoFar = (year: string, today: string) => (year === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12);

/** At most this many dots in a bar; the rest as '+N'. */
const MAX_DOTS = 6;
/** The tallest bar, px. */
const BAR_PX = 96;

export function ItemsCalendar({
  items,
  year,
  years,
  today,
  month,
  onYear,
  onMonth,
  onOpen,
}: {
  /** Everything the filters let through; the calendar picks its year out of it. */
  items: Item[];
  year: string;
  /** The years there is anything in, newest first. */
  years: string[];
  today: string;
  /** The month filtered on ('2026-08'), if any: its bar is marked. */
  month: string;
  onYear: (year: string) => void;
  /** A bar was clicked: show that month's prylar. */
  onMonth: (month: string) => void;
  onOpen: (id: number) => void;
}) {
  const fill = useTransition("number");
  const months = monthsOfYear(items, year);
  const categories = sumsByCategory(items, year);
  const total = categories.reduce((s, c) => s + c.sum, 0);
  const count = categories.reduce((s, c) => s + c.count, 0);
  const max = Math.max(1, ...months.map((m) => m.sum));
  const categoryMax = Math.max(1, ...categories.map((c) => c.sum));
  const perMonth = Math.round(total / monthsSoFar(year, today) / 100) * 100;
  // Stepping past the years there is anything in would only show twelve empty months.
  const step = (by: number) => {
    const next = String(Number(year) + by);
    if (years.includes(next) || next === today.slice(0, 4)) onYear(next);
  };
  const stepper = "grid h-full w-7 place-items-center rounded-lg text-ink-2 hover:bg-segment-on/50 hover:text-ink";

  return (
    <div className="@container">
      <div className="grid items-start gap-4 @[56rem]:grid-cols-12">
        <Card aria-label={`Prylar per månad ${year}`} className="space-y-4 @[56rem]:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex h-9 items-center gap-0.5 rounded-[10px] bg-segment p-[3px]">
              <button type="button" aria-label="Föregående år" onClick={() => step(-1)} className={stepper}>
                <ChevronLeft className="size-4" />
              </button>
              <h2 className="flex h-full items-center rounded-lg bg-segment-on px-3.5 text-[14px] font-semibold tabular-nums shadow-segment">{year}</h2>
              <button type="button" aria-label="Nästa år" onClick={() => step(1)} className={stepper}>
                <ChevronRight className="size-4" />
              </button>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-ink-2" data-testid="calendar-summary">
              <span>
                {count} {count === 1 ? "pryl" : "prylar"}
              </span>
              <span>·</span>
              <AnimatedAmount ore={total} kind="neutral" whole size="sm" className="font-semibold text-ink" />
              <span>·</span>
              <span title={`Årets summa delad på ${monthsSoFar(year, today)} månader`}>snitt {formatKr(perMonth, { whole: true })}/mån</span>
            </p>
          </div>

          <ul className="grid grid-cols-12 items-end gap-1 @[30rem]:gap-2" aria-label={`Månaderna ${year}`}>
            {months.map((m) => {
              const key = `${year}-${String(m.month + 1).padStart(2, "0")}`;
              const n = m.items.length;
              const dots = m.items.slice(0, n > MAX_DOTS ? MAX_DOTS - 1 : MAX_DOTS);
              const more = n - dots.length;
              // Tall enough for its dots, however small the sum.
              const height = n ? Math.max((m.sum / max) * BAR_PX, 10 + (dots.length + (more ? 1 : 0)) * 9) : 4;
              return (
                <li key={m.month} data-bar-month={key} data-sum={m.sum} className="flex min-w-0 flex-col items-center gap-1">
                  <span className="h-4 text-[10px] text-ink-2 tabular-nums">{n ? shortSum(m.sum) : ""}</span>
                  <div className="relative flex w-full justify-center" style={{ height }}>
                    {n > 0 ? (
                      <>
                        <motion.button
                          type="button"
                          onClick={() => onMonth(key)}
                          aria-label={`${MONTHS[m.month]} ${year}: ${n} ${n === 1 ? "pryl" : "prylar"}, ${formatKr(m.sum, { whole: true })}. Visa dem`}
                          className={cn("absolute inset-0 origin-bottom rounded-[6px] bg-accent hover:bg-accent-hover", month === key && "ring-2 ring-accent ring-offset-2 ring-offset-card")}
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={fill}
                        />
                        <span className="pointer-events-none relative flex flex-col items-center gap-[3px] pt-[5px]">
                          {dots.map((item) => (
                            <Tooltip key={item.id} content={`${item.name} · ${formatKr(item.priceOre, { whole: true })} · ${item.purchaseDate}`}>
                              <button
                                type="button"
                                onClick={() => onOpen(item.id)}
                                aria-label={`${item.name}, ${MONTHS[m.month].toLowerCase()} ${year}`}
                                className="pointer-events-auto size-1.5 rounded-full bg-white transition-transform duration-[180ms] ease-out hover:scale-150"
                              />
                            </Tooltip>
                          ))}
                          {more > 0 && <span className="text-[9px] font-semibold leading-none text-white">+{more}</span>}
                        </span>
                      </>
                    ) : (
                      <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-segment" />
                    )}
                  </div>
                  <span className={cn("text-[10px]", n ? "font-medium text-ink" : "text-ink-3", month === key && "text-accent")}>{SHORT[m.month]}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-ink-3">Varje prick är en pryl · klicka på en månad för att se dem.</p>
        </Card>

        <Card aria-labelledby="items-per-category" className="space-y-3 @[56rem]:col-span-5">
          <h2 id="items-per-category" className="text-base font-semibold">
            Per kategori {year}
          </h2>
          {categories.length === 0 ? (
            <p className="text-[13px] text-ink-3">Ingenting inlagt det här året.</p>
          ) : (
            <ul>
              {categories.map((c) => {
                const none = c.category === "Utan kategori";
                return (
                  <li key={c.category} data-category={c.category} className="space-y-1.5 border-t border-hairline py-2.5 first:border-t-0 first:pt-0">
                    <span className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className={cn("truncate", none && "text-caution-text")}>{c.category}</span>
                      <span className="shrink-0 text-ink-2 tabular-nums">
                        <b className="font-semibold text-ink">{formatKr(c.sum, { whole: true })}</b> · {c.count} {c.count === 1 ? "pryl" : "prylar"}
                      </span>
                    </span>
                    <span className="relative block h-1.5 rounded-full bg-track">
                      <motion.span
                        className={cn("absolute inset-y-0 left-0 rounded-full", none ? "bg-caution" : "bg-accent")}
                        initial={{ width: 0 }}
                        animate={{ width: `${(c.sum / categoryMax) * 100}%` }}
                        transition={fill}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
