import { useState } from "react";
import { CalendarClock, Check, ChevronDown } from "lucide-react";
import { sendJson, type Overview, type TimelineEvent } from "../../api";
import { shortAccountName } from "../../components/AccountBadge";
import { Card } from "../../components/Card";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";
import { kr, monthShort, plusDays, weekday } from "./format";

/** 'november'. */
const monthLong = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });

type Row = { kind: "day"; date: string; events: TimelineEvent[] } | { kind: "empty"; from: string; to: string };

/**
 * The 14 days as rows: a row for today and for each day with something on
 * it; the days between with nothing planned folded into one quiet row.
 */
export function agendaRows(from: string, to: string, today: string, events: TimelineEvent[]): Row[] {
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const rows: Row[] = [];
  for (let d = from; d <= to; d = plusDays(d, 1)) {
    const on = byDay.get(d) ?? [];
    const last = rows.at(-1);
    if (on.length || d === today) rows.push({ kind: "day", date: d, events: on });
    else if (last?.kind === "empty") last.to = d;
    else rows.push({ kind: "empty", from: d, to: d });
  }
  return rows;
}

/**
 * Kommande 14 dagar as a calendar list: a row per day with something on it
 * — incomes, fixed expenses by their names (filled dot: from a bank account,
 * ring: on a card, blue once drawn), card invoices (red) and the work
 * schedule's deadline (Jobb, ticked off as received with a click) — with
 * the day's money to the right. Today is the blue badge. A row opens to
 * the day's events one by one. What each account draws before payday is in
 * Pengar nu (MoneyCard).
 */
export function Timeline({ data, act, className }: { data: Overview; act: (fn: () => Promise<unknown>) => Promise<void>; className?: string }) {
  const t = data.timeline;
  const [open, setOpen] = useState<string | null>(null);
  const accountName = (id: number | null) => data.balances.find((b) => b.id === id)?.name ?? null;
  const setReceived = (month: string, received: boolean) => act(() => sendJson("PUT", `/salary/schedule/${month}`, { received }));
  const rows = agendaRows(t.from, t.to, data.today, t.events);

  return (
    <Card aria-labelledby="timeline-title" className={cn("flex flex-col sm:py-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-2.5">
        <h2 id="timeline-title" className="text-base font-semibold">
          Kommande 14 dagar
        </h2>
        <Legend />
      </div>
      <ol>
        {rows.map((r) =>
          r.kind === "empty" ? (
            <Empty key={r.from} from={r.from} to={r.to} />
          ) : (
            <Day
              key={r.date}
              date={r.date}
              events={r.events}
              isToday={r.date === data.today}
              isPayday={r.date === t.payday}
              accountName={accountName}
              open={open === r.date}
              onToggle={() => setOpen((o) => (o === r.date ? null : r.date))}
              onReceived={setReceived}
            />
          ),
        )}
      </ol>
    </Card>
  );
}

/** The weekday, the day and the month in the left column; a range for folded days. */
function DateBadge({ from, to, today, muted }: { from: string; to?: string; today?: boolean; muted?: boolean }) {
  const range = !!to && to !== from;
  return (
    <div className={cn("flex w-16 shrink-0 flex-col items-center rounded-[10px] py-1 leading-tight", today && "bg-accent")}>
      <span className={cn("text-[10px] font-semibold", today ? "text-white/80" : "text-ink-3")}>{range ? `${weekday(from)}–${weekday(to)}` : weekday(from)}</span>
      <span className={cn("text-xl font-semibold tabular-nums", today ? "text-white" : muted ? "text-ink-3" : "text-ink")}>
        {range ? `${Number(from.slice(8, 10))}–${Number(to.slice(8, 10))}` : Number(from.slice(8, 10))}
      </span>
      <span className={cn("text-[10px]", today ? "text-white/80" : "text-ink-3")}>{monthShort(range ? to : from)}</span>
    </div>
  );
}

function Empty({ from, to }: { from: string; to: string }) {
  return (
    <li className="flex items-center gap-3.5 border-t border-hairline py-1.5" data-days={`${from}/${to}`}>
      <DateBadge from={from} to={to} muted />
      <span className="text-xs text-ink-3">inget planerat</span>
    </li>
  );
}

/** The dot for an event, in the legend's colours. */
function eventDot(e: TimelineEvent): string {
  if (e.kind === "income") return "bg-positive";
  if (e.kind === "invoice") return e.status === "estimate" ? "border-[1.5px] border-alarm" : "bg-alarm";
  if (e.kind === "work") return "bg-job";
  if (e.status === "dragen" || e.status === "markerad_betald") return "bg-accent";
  if (e.status === "forfallen") return "bg-caution";
  return e.onCard ? "border-[1.5px] border-ink" : "bg-ink";
}

const invoiceName = (e: TimelineEvent) => `Faktura ${shortAccountName(e.name)}`;

function Day({
  date,
  events,
  isToday,
  isPayday,
  accountName,
  open,
  onToggle,
  onReceived,
}: {
  date: string;
  events: TimelineEvent[];
  isToday: boolean;
  isPayday: boolean;
  accountName: (id: number | null) => string | null;
  open: boolean;
  onToggle: () => void;
  onReceived: (month: string, received: boolean) => void;
}) {
  const incomes = events.filter((e) => e.kind === "income");
  const invoices = events.filter((e) => e.kind === "invoice");
  const expenses = events.filter((e) => e.kind === "expense");
  const work = events.filter((e) => e.kind === "work");
  const onCard = expenses.filter((e) => e.onCard).length;
  const drawn = expenses.filter((e) => e.status === "dragen" || e.status === "markerad_betald").length;
  const incoming = incomes.reduce((s, e) => s + e.amount, 0);
  const outgoing = [...expenses, ...invoices].reduce((s, e) => s + e.amount, 0);
  const estimate = invoices.some((e) => e.status === "estimate");
  const money = [...incomes, ...invoices, ...expenses];

  const names = [...incomes.map((e) => e.name), ...invoices.map(invoiceName), ...expenses.map((e) => e.name)];
  const title = names.length ? names.join(" · ") : isToday ? "I dag" : "Jobb";
  const sub = [
    isToday && names.length ? "i dag" : null,
    isPayday ? "lön" : null,
    expenses.length ? `${expenses.length} ${expenses.length === 1 ? "fast utgift" : "fasta utgifter"}` : null,
    onCard ? `${onCard} på kortet` : null,
    drawn ? `${drawn} ${drawn === 1 ? "dragen" : "dragna"}` : null,
    ...invoices.map((e) => (e.status === "estimate" ? "kortfaktura, uppskattad" : "kortfaktura")),
    money.length === 0 && work.length === 0 ? "inga dragningar" : null,
  ].filter(Boolean);
  const label = `${weekday(date)} ${Number(date.slice(8, 10))} ${monthShort(date)}`;
  const spoken = events.length
    ? events.map((e) => (e.kind === "work" ? `${e.name}${e.status === "received" ? " (mottaget)" : ""}` : `${e.kind === "invoice" ? invoiceName(e) : e.name} ${kr(e.amount)}`)).join(", ")
    : "inga dragningar";

  return (
    <li className="border-t border-hairline" data-day={date}>
      <div className="flex items-center gap-3.5 py-2.5">
        <DateBadge from={date} today={isToday} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <button
            type="button"
            disabled={!money.length}
            aria-expanded={money.length ? open : undefined}
            aria-label={`${label}: ${spoken}`}
            onClick={onToggle}
            className="flex w-full min-w-0 flex-col items-start gap-1 text-left disabled:cursor-default"
          >
            <span className="flex w-full min-w-0 items-center gap-1 text-[13px] text-ink">
              <span className="min-w-0 truncate">{title}</span>
              {money.length > 0 && <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />}
            </span>
            {sub.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-[11px] text-ink-2">
                {money.slice(0, 8).map((e, i) => (
                  <span key={i} aria-hidden className={cn("size-[7px] rounded-full", eventDot(e))} />
                ))}
                <span className={cn(money.length > 0 && "ml-1")}>{sub.join(" · ")}</span>
              </span>
            )}
          </button>
          {work.map((e) => {
            const received = e.status === "received";
            const month = monthLong(e.month!);
            return (
              <button
                key={`w${e.month}`}
                type="button"
                data-work={e.month}
                onClick={() => onReceived(e.month!, !received)}
                aria-label={received ? `Schemat för ${month} är mottaget. Ångra` : `Markera schemat för ${month} som mottaget`}
                title={e.name}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  received ? "text-ink-2" : "bg-job/15 text-ink ring-1 ring-job/60",
                )}
              >
                {received ? <Check className="size-3 shrink-0 text-job" aria-hidden /> : <CalendarClock className="size-3 shrink-0 text-job" aria-hidden />}
                schema för {month}
                {received ? " mottaget" : ""}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 flex-col items-end text-[15px] font-semibold tabular-nums">
          {incoming > 0 && <span className="text-positive-text">{formatKr(Math.round(incoming / 100) * 100, { sign: "always", whole: true })}</span>}
          {outgoing > 0 && (
            <span className="text-ink">
              {estimate && <span className="text-xs font-normal text-ink-2">ca </span>}
              {kr(-outgoing)}
            </span>
          )}
        </div>
      </div>
      {open && money.length > 0 && (
        <ul className="mb-2.5 space-y-1 rounded-inset bg-card-inset px-3.5 py-2.5 text-[13px] sm:ml-[4.875rem]">
          {money.map((e, i) => (
            <li key={i} className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", eventDot(e))} />
                <span className="truncate">
                  {e.kind === "invoice" ? `${invoiceName(e)}${e.status === "estimate" ? " (uppskattad)" : ""}` : e.name}
                  {e.kind === "expense" && (
                    <span className="text-ink-2">
                      {" "}
                      · {e.onCard ? "på kortet" : shortAccountName(accountName(e.accountId) ?? "utan konto")}
                      {e.status === "dragen" ? " · dragen" : e.status === "markerad_betald" ? " · betald" : e.status === "forfallen" ? " · förfallen" : ""}
                    </span>
                  )}
                </span>
              </span>
              <span className={cn("tabular-nums", e.kind === "income" && "text-positive-text")}>{e.kind === "income" ? `+${kr(e.amount)}` : kr(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Legend() {
  const item = "inline-flex items-center gap-1";
  const dot = "size-[7px] rounded-full";
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2" aria-label="Förklaring">
      <li className={item}>
        <span className={cn(dot, "bg-positive")} /> inkomst
      </li>
      <li className={item}>
        <span className={cn(dot, "bg-ink")} /> fast utgift
      </li>
      <li className={item}>
        <span className={cn(dot, "border-[1.5px] border-ink")} /> på kort
      </li>
      <li className={item}>
        <span className={cn(dot, "bg-accent")} /> dragen
      </li>
      <li className={item}>
        <span className={cn(dot, "bg-alarm")} /> kortfaktura
      </li>
      <li className={item}>
        <span className={cn(dot, "bg-job")} /> jobb
      </li>
    </ul>
  );
}
