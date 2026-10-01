import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { parseKr, sendJson, type MonthStartTerm, type Overview } from "../../api";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { Card } from "../../components/Card";
import { shortAccountName } from "../../components/AccountBadge";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";
import { navigate, openSettings, type ViewId } from "../../shell/routes";
import { dm, kr, plusDays } from "./format";
import { ISK_COLOUR, walletColour } from "./wallet";

const round = (ore: number) => Math.round(ore / 100) * 100;
const longMonth = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
/** '114' (whole kronor, no unit). */
const bare = (ore: number) => kr(ore).replace(/\s*kr$/, "");
const hoursText = (h: number) => h.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
/** '25/9' or '25/9–30/9'. */
const days = (from: string, to: string) => (from === to ? dm(from) : `${dm(from)}–${dm(to)}`);

/**
 * Pengar nu: the money there is now, split by where it is; the way to the
 * 1st as an equation (the money now, plus and minus the cash flow's own
 * terms, is what is left when this month's bills are paid); the bills up
 * to the next salary behind the pill in the corner; and the salary under
 * it all.
 */
export function MoneyCard({ data, onChanged, onNavigate, className }: { data: Overview; onChanged: () => void; onNavigate: (v: ViewId) => void; className?: string }) {
  const m = data.money;
  const [billsOpen, setBillsOpen] = useState(false);
  return (
    <Card aria-labelledby="money-title" className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 id="money-title" className="pt-1 text-[13px] font-medium text-ink-2">
            Pengar nu
          </h2>
          <BillsPill data={data} open={billsOpen} onToggle={() => setBillsOpen((o) => !o)} />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-7">
          <AnimatedAmount
            ore={round(m.totalOre)}
            whole
            kind="neutral"
            className={cn("shrink-0 text-[40px] font-bold leading-none tracking-[-0.03em] sm:text-[52px]", m.totalOre < 0 ? "text-alarm" : "text-ink")}
          />
          <Split money={m} />
        </div>
      </div>

      <Equation data={data} />

      {billsOpen && <Bills data={data} />}

      <Footer data={data} onChanged={onChanged} onNavigate={onNavigate} />
    </Card>
  );
}

/**
 * Where the money is: a thin bar with a segment per account and the cash on
 * ISK, in the Wallet colours, and a legend with the amounts. A small account
 * still gets a sliver.
 */
function Split({ money }: { money: Overview["money"] }) {
  const parts = [
    ...money.accounts.map((a) => ({ key: `a${a.id}`, name: shortAccountName(a.name), ore: a.balance, colour: walletColour({ name: a.name, kind: "bank" }) })),
    ...(money.iskOre ? [{ key: "isk", name: "ISK-likvider", ore: money.iskOre, colour: ISK_COLOUR }] : []),
  ];
  const sum = parts.reduce((s, p) => s + Math.max(0, p.ore), 0);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 pb-1">
      <div
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]"
        role="img"
        aria-label={`Var pengarna finns: ${parts.map((p) => `${p.name} ${kr(p.ore)}`).join(", ")}.`}
        data-testid="money-bar"
      >
        {parts.map((p) => (
          <div key={p.key} data-part={p.key} className={cn("min-w-1", p.colour)} style={{ flexGrow: sum > 0 ? Math.max(0, p.ore) / sum : 1, flexBasis: 0 }} />
        ))}
      </div>
      <ul className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-ink-2" data-testid="money-split">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className={cn("size-2 rounded-full", p.colour)} />
            {p.name} <b className="font-semibold text-ink tabular-nums">{bare(p.ore)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The way to the 1st: the money now, then the cash flow's terms with their
 * signs, equal to Kvar vid månadsskiftet — nothing is added up here, the
 * server's terms and balance are shown as they are. A box shows what is in
 * it on hover or tap. On a phone it is a column with the signs to the left.
 */
function Equation({ data }: { data: Overview }) {
  const m = data.monthStart;
  if (!m) return null;
  const [year, month] = m.date.split("-").map(Number);
  const first = `${Number(m.date.slice(8, 10))} ${new Date(year, month - 1, 1).toLocaleDateString("sv-SE", { month: "long" })}`;
  const terms = m.start === undefined ? [] : (m.terms ?? []);
  return (
    <section className="flex flex-col gap-4 rounded-[14px] bg-card-inset p-4 sm:p-5" data-testid="month-start" aria-labelledby="month-start-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h3 id="month-start-title" className="text-[13px] font-semibold text-ink-2">
          Så här blir det den {first}
        </h3>
        <span className="text-xs text-ink-3">när {longMonth(m.month)}s räkningar är betalda</span>
      </div>
      <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" aria-label="Uträkningen">
        {terms.length > 0 && <Term label="Pengar nu" value={kr(m.start!)} details={<span>Bankkontona och likviderna på ISK i dag.</span>} />}
        {terms.map((t) => (
          <Term
            key={t.key}
            sign={t.amount < 0 ? "−" : "+"}
            termKey={t.key}
            label={`${t.label} ${days(t.from, t.to)}`}
            value={formatKr(round(t.amount), { sign: "always", whole: true })}
            positive={t.amount > 0}
            note={t.key === "partner" && t.estimate ? "uppskattat" : undefined}
            details={<Items term={t} />}
          />
        ))}
        <Term
          sign={terms.length > 0 ? "=" : undefined}
          termKey="result"
          label={`Kvar ${dm(m.date)}`}
          value={kr(m.balance)}
          result
          negative={m.balance < 0}
          note={m.cashOre > 0 ? `varav ${bare(m.cashOre)} på ISK` : undefined}
          details={<span>Det kassaflödet säger är kvar när {longMonth(m.month)}s lön, räkningar och kortfakturor är betalda och nästa månads inte är det än.</span>}
        />
      </ol>
    </section>
  );
}

function Term({
  sign,
  termKey,
  label,
  value,
  positive,
  negative,
  result,
  note,
  details,
}: {
  sign?: string;
  termKey?: string;
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
  result?: boolean;
  note?: string;
  details: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const spoken = sign === "−" ? "minus " : sign === "+" ? "plus " : sign === "=" ? "blir " : "";
  return (
    <li className="flex items-center gap-2" data-term={termKey ?? "start"}>
      {/* The first box has no sign; on a phone it keeps the column so the boxes line up. */}
      <span aria-hidden className={cn("w-4 shrink-0 text-center text-lg text-ink-3 sm:w-auto", !sign && "sm:hidden")}>
        {sign}
      </span>
      <Tooltip open={open} onOpenChange={setOpen} className="max-w-sm flex-col items-stretch gap-1 py-1.5" content={details}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
          aria-label={`${spoken}${label}: ${value}${note ? `, ${note}` : ""}`}
          className={cn("flex min-w-0 flex-1 flex-col rounded-[10px] px-3.5 py-2 text-left sm:flex-none", result ? "bg-accent-soft py-2.5" : "bg-card")}
        >
          <span className={cn("whitespace-nowrap text-xs", result ? "text-accent" : "text-ink-2")}>{label}</span>
          <span
            className={cn(
              "whitespace-nowrap font-bold tabular-nums",
              result ? "text-[22px] leading-tight" : "text-[17px]",
              positive && "text-positive-text",
              negative && "text-alarm",
            )}
          >
            {value}
          </span>
          {note && <span className="whitespace-nowrap text-[11px] text-ink-2">{note}</span>}
        </button>
      </Tooltip>
    </li>
  );
}

/** What a term is made of, for its tooltip. */
function Items({ term }: { term: MonthStartTerm }) {
  return (
    <>
      {term.items.map((i, n) => (
        <span key={n} className="flex justify-between gap-4">
          <span className="truncate">
            {dm(i.date)} {i.name}
            {i.estimate ? " (uppskattat)" : ""}
          </span>
          <span className="tabular-nums">{formatKr(round(i.amount), { sign: "always", whole: true })}</span>
        </span>
      ))}
    </>
  );
}

/** The day the bills run to: the next salary when the rows reach it, else their last day. */
function billsUntil(data: Overview): string | null {
  const t = data.timeline;
  if (!t.accountsTo) return null;
  return t.payday && plusDays(t.accountsTo, 1) === t.payday ? t.payday : t.accountsTo;
}

/** 'Räkningar till 23/10 −15 104 kr ›': opens the list under the card's content. */
function BillsPill({ data, open, onToggle }: { data: Overview; open: boolean; onToggle: () => void }) {
  const t = data.timeline;
  const until = billsUntil(data);
  if (!t.accounts.length || until === null) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="money-bills"
      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-card-inset px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-segment"
    >
      Räkningar till {dm(until)}
      <b className="font-semibold text-ink tabular-nums">{kr(-(t.accountsTotal ?? 0))}</b>
      <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
    </button>
  );
}

/** '25/9' or '25/9–30/9': the days a list of draws falls on. */
function span(items: { dueDate: string }[]): string {
  if (!items.length) return "";
  return days(items[0].dueDate, items[items.length - 1].dueDate);
}

/** 'med fakturan 30/10' when the card's next invoice covers the draws, else 'via fakturan'. */
function invoiceDue(data: Overview, accountId: number, items: { dueDate: string }[]): string {
  const next = data.balances.find((b) => b.id === accountId)?.nextInvoice;
  return next && items.every((i) => i.dueDate <= next.periodTo) ? `med fakturan ${dm(next.dueDate)}` : "via fakturan";
}

/**
 * The bills up to the next salary, per account: from a bank account before
 * payday or from the salary when it comes first, on a card with its invoice.
 * A row opens its list.
 */
function Bills({ data }: { data: Overview }) {
  const [open, setOpen] = useState<number | null>(null);
  const t = data.timeline;
  const all = t.accounts.flatMap((a) => a.items.map((i) => i.dueDate)).sort();
  return (
    <section id="money-bills" aria-labelledby="money-bills-title" className="flex flex-col border-t border-hairline pt-3">
      <h3 id="money-bills-title" className="text-[13px] font-semibold text-ink-2">
        Räkningar {all.length ? days(all[0], all[all.length - 1]) : ""}
      </h3>
      <ul className="pt-1">
        {t.accounts.map((r, n) => {
          const early = r.items.filter((i) => i.beforePayday);
          const late = r.items.filter((i) => !i.beforePayday);
          const text =
            r.kind === "credit_card"
              ? `på kortet ${span(r.items)}, betalas ${invoiceDue(data, r.accountId, r.items)}`
              : !r.beforePayday
                ? `dras ${span(r.items)}`
                : late.length === 0
                  ? `dras ${span(r.items)}, före lönen ${dm(r.before)}`
                  : early.length === 0
                    ? `dras ${span(r.items)}, från lönen ${dm(r.before)}`
                    : `dras ${span(r.items)} · ${kr(r.total)} före lönen ${dm(r.before)}`;
          const name = shortAccountName(r.accountName);
          return (
            <li key={r.accountId} className={cn(n > 0 && "border-t border-hairline")}>
              <button
                type="button"
                aria-expanded={open === r.accountId}
                aria-label={`${name}: ${kr(-r.windowTotal)} ${text}, ${r.windowCount} st`}
                onClick={() => setOpen((o) => (o === r.accountId ? null : r.accountId))}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2.5 text-left text-[13px] sm:grid-cols-[110px_minmax(0,1fr)_96px_60px]"
              >
                <span className="flex min-w-0 flex-col sm:contents">
                  <span className="truncate font-semibold">{name}</span>
                  <span className="text-xs text-ink-2 sm:text-[13px]">{text}</span>
                </span>
                <span className="text-right font-semibold tabular-nums">{kr(-r.windowTotal)}</span>
                <span className="inline-flex items-center justify-end gap-0.5 text-xs text-ink-3">
                  {r.windowCount} st
                  <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open === r.accountId ? "rotate-180" : "-rotate-90")} />
                </span>
              </button>
              {open === r.accountId && (
                <ul className="space-y-1 pb-3 text-[13px] sm:pl-[122px]">
                  {r.items.map((i, k) => (
                    <li key={`${i.expenseId}-${i.period}`}>
                      {r.kind === "bank" && r.beforePayday && !i.beforePayday && (k === 0 || r.items[k - 1].beforePayday) && (
                        <p className="mb-1 mt-1.5 text-[11px] text-ink-3">Efter lönen {dm(r.before)}</p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="w-10 text-ink-3 tabular-nums">{dm(i.dueDate)}</span>
                        <span className="min-w-0 flex-1 truncate">{i.name}</span>
                        <span className="tabular-nums">{kr(-i.amount)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The salary under it all: this month's as it came (or is booked), the next
 * one with its forecast and a way to change it, and the cash flow.
 */
function Footer({ data, onChanged, onNavigate }: { data: Overview; onChanged: () => void; onNavigate: (v: ViewId) => void }) {
  const p = data.payday;
  const [editing, setEditing] = useState(false);
  const cashflow = (
    <button type="button" className="shrink-0 font-medium text-accent hover:text-accent-hover" onClick={() => navigate("overview", { search: "?flik=kassaflode" })}>
      Kassaflöde →
    </button>
  );
  if (!p) {
    return (
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span className="flex flex-wrap items-center gap-2">
          Lägg in lönen som återkommande inkomst så visas nästa lön.
          <Button size="sm" onClick={() => openSettings("inkomster")}>
            Till Inställningar
          </Button>
        </span>
        {cashflow}
      </div>
    );
  }
  const green = (text: string) => <b className="font-semibold text-positive-text">{text}</b>;
  const against = (amount: number, forecast: number | null) =>
    forecast === null ? null : (
      <span className={cn(Math.abs(amount - forecast) > 50000 && "font-medium text-caution-text")}>
        ,{" "}
        {amount === forecast ? "precis som beräknat" : `${kr(Math.abs(amount - forecast))} ${amount < forecast ? "lägre" : "högre"} än prognosen ${kr(forecast)}`}
      </span>
    );
  const parts: ReactNode[] = [];
  if (p.pending) {
    // Booked, not yet in the balance: it is the next salary, nothing more to say about the one after.
    parts.push(
      <span key="pending">
        Lön för {longMonth(p.month)} bokförd {dm(p.pending.bookingDate)}, i saldot {dm(p.pending.availableDate)} {green(formatKr(p.pending.amount, { sign: "always" }))}
        {against(p.pending.amount, p.forecast?.net ?? null)}
      </span>,
    );
  } else {
    if (p.received) {
      parts.push(
        <span key="received">
          Lön för {longMonth(p.received.month)} {green(formatKr(p.received.amount, { sign: "always" }))}
          {against(p.received.amount, p.received.forecast)}
        </span>,
      );
    }
    parts.push(
      <span key="next">
        {parts.length ? "nästa lön" : "Nästa lön"} <b className="font-semibold text-ink">{dm(p.date)}</b>{" "}
        {p.late ? <span className="font-medium text-caution-text">försenad</span> : `om ${p.daysUntil} ${p.daysUntil === 1 ? "dag" : "dagar"}`},{" "}
        <SalaryAmount p={p} editing={editing} setEditing={setEditing} onNavigate={onNavigate} green={green} />
      </span>,
    );
  }
  return (
    <div className="mt-auto flex flex-col gap-2">
      <div className="flex items-end justify-between gap-4 text-xs text-ink-2" data-testid="salary-line">
        <p className="min-w-0">{parts.flatMap((x, i) => (i ? [" · ", x] : [x]))}</p>
        {cashflow}
      </div>
      {editing && <SalaryForm p={p} onDone={() => setEditing(false)} onChanged={onChanged} />}
    </div>
  );
}

/** 'prognos +23 499 kr (145 tim · timmar)' or 'ca +24 676 kr (uppskattning · ändra)'. */
function SalaryAmount({
  p,
  editing,
  setEditing,
  onNavigate,
  green,
}: {
  p: NonNullable<Overview["payday"]>;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onNavigate: (v: ViewId) => void;
  green: (text: string) => ReactNode;
}) {
  const monthName = longMonth(p.month);
  const amount = green(formatKr(round(p.expected), { sign: "always", whole: true }));
  const link = "text-accent hover:text-accent-hover";
  if (p.forecast) {
    return (
      <>
        prognos {amount} ({p.forecast.assumed ? "vanlig månad" : `${hoursText(p.forecast.hours)} tim`}
        {p.forecast.vacationHours ? ` varav ${hoursText(p.forecast.vacationHours)} semester` : ""}
        {p.forecast.vacationPayout ? " + outtagen semester" : ""} ·{" "}
        <button type="button" onClick={() => onNavigate("salary")} className={link} title="Ändra timmarna under Lön">
          timmar
        </button>
        )
      </>
    );
  }
  return (
    <>
      {p.expectedSource === "override" ? "" : "ca "}
      {amount} ({p.expectedSource === "override" ? `förväntat för ${monthName}, uppskattning ${kr(p.estimate)}` : "uppskattning"} ·{" "}
      <button type="button" onClick={() => setEditing(!editing)} className={link} title={`Ange förväntat belopp för ${monthName}`} aria-expanded={editing}>
        ändra
      </button>
      )
    </>
  );
}

/** The month's expected salary, typed from the payslip. */
function SalaryForm({ p, onDone, onChanged }: { p: NonNullable<Overview["payday"]>; onDone: () => void; onChanged: () => void }) {
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(p.override ? String(p.override / 100).replace(".", ",") : ""), [p.override]);
  const monthName = longMonth(p.month);
  const save = async (amount: number | null) => {
    await sendJson("PUT", `/recurring-income/${p.incomeId}/overrides/${p.month}`, { amount });
    onDone();
    onChanged();
  };
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        const ore = parseKr(draft);
        if (ore) save(ore);
      }}
    >
      <label htmlFor="salary-override" className="text-ink-2">
        Förväntat för {monthName}
      </label>
      <input
        id="salary-override"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        placeholder="från lönespecen"
        className="h-7 w-28 rounded-md border border-border bg-surface px-2 text-right tabular-nums outline-none focus:border-ring"
      />
      <span>kr</span>
      <Button type="submit" size="sm" variant="primary">
        Spara
      </Button>
      {p.override !== null && (
        <Button size="sm" variant="ghost" onClick={() => save(null)}>
          Använd uppskattningen
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onDone}>
        Avbryt
      </Button>
    </form>
  );
}
