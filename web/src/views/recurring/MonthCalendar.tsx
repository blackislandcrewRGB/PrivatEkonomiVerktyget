import { useEffect, useState } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { getJson, sendJson, type Account, type RecurringExpense, type RecurringIncome, type ScheduleDeadline } from "../../api";
import { MerchantIcon } from "../../components/MerchantIcon";
import { StatusPill } from "../../components/StatusPill";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { longDate } from "../../lib/format";
import { kr } from "../overview/format";
import type { Share } from "../../lib/share";
import { accountTone, partOf, tint, todayIso } from "./model";

interface Draw {
  expenseId: number;
  period: string;
  date: string;
}

const WEEKDAYS = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"];

export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * A month as a calendar (Monday first): a chip per predicted draw in the
 * account's colour (bank days included), payday marked, today ringed, and
 * the work schedule's deadline (Jobb) with 'Mottaget' under the day.
 * Click a day for its draws; a draw opens the panel. ←/→ and T move.
 */
export function MonthCalendar({
  month,
  onMonth,
  expenses,
  accounts,
  share = "household",
  onOpen,
}: {
  month: string;
  onMonth: (m: string) => void;
  expenses: RecurringExpense[];
  accounts: Account[];
  share?: Share;
  onOpen: (id: number) => void;
}) {
  const [draws, setDraws] = useState<Draw[]>([]);
  const [salaryDay, setSalaryDay] = useState<number | null>(null);
  const [deadlines, setDeadlines] = useState<ScheduleDeadline[]>([]);
  const today = todayIso();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    getJson<Draw[]>(`/recurring-expenses/calendar?month=${month}`).then(setDraws, () => setDraws([]));
  }, [month, expenses]);
  const loadDeadlines = () => {
    const [yy, mm] = month.split("-").map(Number);
    getJson<ScheduleDeadline[]>(`/salary/schedule?from=${month}-01&to=${month}-${new Date(yy, mm, 0).getDate()}`).then(setDeadlines, () => setDeadlines([]));
  };
  useEffect(loadDeadlines, [month]);
  const setReceived = (s: ScheduleDeadline, received: boolean) => sendJson("PUT", `/salary/schedule/${s.month}`, { received }).then(loadDeadlines, () => {});
  // A new month starts on today, or on nothing.
  useEffect(() => setSelected(today.startsWith(month) ? today : null), [month, today]);
  useEffect(() => {
    // Payday: the largest active recurring income's day (as Översikten picks it).
    getJson<RecurringIncome[]>("/recurring-income").then(
      (list) => setSalaryDay([...list].filter((i) => i.active).sort((a, b) => b.amount - a.amount)[0]?.dayOfMonth ?? null),
      () => setSalaryDay(null),
    );
  }, []);

  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const date = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const payday = salaryDay === null ? null : date(Math.min(salaryDay, days));
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const onDay = (d: string) =>
    draws
      .filter((x) => x.date === d)
      .map((x) => ({ draw: x, e: byId.get(x.expenseId)! }))
      .filter((x) => x.e);
  const amountOf = (e: RecurringExpense, period: string) => partOf(e, e.thisMonth?.period === period ? e.thisMonth.amount : e.thisMonthAmount, share);
  const statusOf = (e: RecurringExpense, period: string) => (e.thisMonth?.period === period ? e.thisMonth.status : null);
  const monthTotal = draws.reduce((s, x) => s + (byId.get(x.expenseId) ? amountOf(byId.get(x.expenseId)!, x.period) : 0), 0);
  const title = new Date(y, m - 1, 1).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
  const usedAccounts = accounts.filter((a) => expenses.some((e) => e.accountId === a.id && !e.paused));
  const undated = expenses.filter(
    (e) => !e.paused && ((e.scheduleType === "day_of_month" && e.anchorDay === null) || (e.billingCycle === "yearly" && !e.anchorMonth)),
  );
  const selectedDraws = selected ? onDay(selected) : [];
  const selectedWork = deadlines.filter((s) => s.date === selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Föregående månad">
          <ChevronLeft />
        </Button>
        <h2 className="min-w-36 text-center text-[15px] font-semibold capitalize text-ink">{title}</h2>
        <Button size="icon" variant="ghost" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Nästa månad">
          <ChevronRight />
        </Button>
        {!today.startsWith(month) && (
          <Button size="sm" onClick={() => onMonth(today.slice(0, 7))} className="h-8 rounded-[10px] border-0 bg-segment px-3 text-[13px] font-medium text-ink hover:bg-card-inset">
            I dag
          </Button>
        )}
        <span className="text-sm font-semibold text-ink-2 tabular-nums">· {kr(monthTotal)}</span>
        <span className="flex-1" />
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-label="Konton">
          {usedAccounts.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: accountTone(accounts, a.id) }} />
              {a.name}
            </li>
          ))}
          {payday && (
            <li className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-positive-soft ring-1 ring-positive" /> lön
            </li>
          )}
          {deadlines.length > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-work-soft ring-1 ring-work" /> jobb
            </li>
          )}
        </ul>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-card bg-hairline shadow-card [gap:1px]" role="grid" aria-label={`Dragningar i ${title}`}>
          {WEEKDAYS.map((d, i) => (
            <div key={d} role="columnheader" className={cn("bg-band px-2 py-1.5 text-xs font-semibold", i > 4 ? "text-ink-3" : "text-ink-2")}>
              {d}
            </div>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <div key={`pad${i}`} className="bg-band" />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const d = date(i + 1);
            const items = onDay(d);
            const sum = items.reduce((s, x) => s + amountOf(x.e, x.draw.period), 0);
            const weekend = (offset + i) % 7 > 4;
            return (
              <div
                key={d}
                role="gridcell"
                data-date={d}
                aria-selected={selected === d}
                tabIndex={-1}
                onClick={() => setSelected(d)}
                className={cn(
                  "min-h-28 cursor-pointer bg-card p-1.5 text-ink outline-none",
                  weekend && "bg-band",
                  d < today && "opacity-70",
                  d === payday && "bg-positive-soft/60",
                  selected === d && "ring-2 ring-inset ring-accent",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      d === today ? "bg-accent font-semibold text-white" : weekend ? "text-ink-3" : "text-ink-2",
                    )}
                  >
                    {i + 1}
                  </span>
                  {d === payday && <span className="text-[10px] font-semibold text-positive-text">lön</span>}
                  {sum > 0 && <span className="text-[11px] font-medium text-ink-2 tabular-nums">{kr(sum)}</span>}
                </div>
                <ul className="space-y-0.5">
                  {deadlines
                    .filter((s) => s.date === d)
                    .map((s) => (
                      <li key={`w${s.month}`} data-work={s.month} title={`${s.name}${s.received ? " · mottaget" : ""}`}>
                        <span
                          className={cn(
                            "flex w-full items-center gap-1 truncate rounded-sm border-l-[3px] border-work bg-work-soft px-1 py-px text-[11px] text-work",
                            s.received && "text-ink-3",
                          )}
                        >
                          {s.received ? <Check className="size-3.5 shrink-0" aria-hidden /> : <CalendarClock className="size-3.5 shrink-0" aria-hidden />}
                          <span className="truncate">Schema {new Date(`${s.month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" })}</span>
                        </span>
                      </li>
                    ))}
                  {items.map(({ e, draw }) => {
                    const status = statusOf(e, draw.period);
                    const color = accountTone(accounts, e.accountId);
                    return (
                      <li key={`${e.id}-${draw.period}`}>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelected(d);
                            onOpen(e.id);
                          }}
                          title={`${e.name} ${kr(amountOf(e, draw.period))}${status ? ` · ${status === "markerad_betald" ? "betald" : status}` : ""}${draw.period !== month ? ` (${draw.period})` : ""}`}
                          className={cn("flex w-full items-center gap-1 truncate rounded-[4px] border-l-[3px] px-1 py-px text-left text-[11px] text-ink hover:brightness-95", (status === "dragen" || status === "markerad_betald") && "text-ink-3")}
                          style={{ borderColor: color, background: tint(color) }}
                        >
                          {status === "dragen" || status === "markerad_betald" ? <Check className="size-3.5 shrink-0" aria-hidden /> : <MerchantIcon decorative label={e.name} icon={e.icon} size={14} />}
                          <span className="truncate">{e.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {Array.from({ length: (7 - ((offset + days) % 7)) % 7 }, (_, i) => (
            <div key={`end${i}`} className="bg-surface-muted/40" />
          ))}
        </div>
      </div>

      {selected && (
        <section className="overflow-hidden rounded-card bg-card text-ink shadow-card" aria-label={`Dragningar ${selected}`}>
          <div className="flex items-baseline justify-between gap-2 bg-band px-5 py-3">
            <h3 className="text-sm font-semibold">{longDate(selected)}</h3>
            <span className="text-xs text-ink-2">
              {selectedDraws.length === 0 ? "Inga dragningar" : `${selectedDraws.length} st · ${kr(selectedDraws.reduce((s, x) => s + amountOf(x.e, x.draw.period), 0))}`}
              {selected === payday && " · lönedag"}
            </span>
          </div>
          {selectedWork.length > 0 && (
            <ul className="divide-y divide-hairline border-t border-hairline text-sm">
              {selectedWork.map((s) => (
                <li key={s.month} data-testid="schedule-deadline" className="flex items-center gap-3 px-5 py-2.5">
                  <span className="size-2.5 shrink-0 rounded-sm bg-work" />
                  <CalendarClock className="size-5 shrink-0 text-work" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {s.name}
                    <span className="block text-[11px] text-ink-3">Jobb · senast den dag du angett för schemat under Inställningar › Lön › Avtalet</span>
                  </span>
                  {s.received ? (
                    <span className="inline-flex items-center gap-2 text-xs text-ink-2">
                      <Check className="size-4 text-positive" aria-hidden /> Mottaget
                      <Button size="sm" variant="ghost" onClick={() => setReceived(s, false)}>
                        Ångra
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => setReceived(s, true)}>
                      Mottaget
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {selectedDraws.length > 0 && (
            <ul className="divide-y divide-hairline border-t border-hairline text-sm">
              {selectedDraws.map(({ e, draw }) => {
                const status = statusOf(e, draw.period);
                return (
                  <li key={`${e.id}-${draw.period}`}>
                    <button type="button" onClick={() => onOpen(e.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-band">
                      <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: accountTone(accounts, e.accountId) }} />
                      <MerchantIcon decorative label={e.name} icon={e.icon} size={28} shape="square" />
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      {status && <StatusPill status={status} />}
                      <span className="w-24 text-right text-[13px] font-bold tabular-nums">{kr(amountOf(e, draw.period))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {undated.length > 0 && <p className="text-xs text-ink-3">Utan dag: {undated.map((e) => e.name).join(", ")}</p>}
    </div>
  );
}
