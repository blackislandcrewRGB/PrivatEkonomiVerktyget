import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, Lightbulb, Plus, Trash2, TrendingUp } from "lucide-react";
import {
  PAYMENT_METHOD_LABEL,
  getJson,
  parseKr,
  sendJson,
  type Account,
  type BankDayRule,
  type DateBasis,
  type ExpenseHistory,
  type ExpenseMonth,
  type ForeignPrice,
  type PaymentMethod,
  type RecurringExpense,
  type RentNotice,
  uploadIcon,
} from "../../api";
import { Amount } from "../../components/Amount";
import { CategoryChip } from "../../components/CategoryChip";
import { CategoryPicker } from "../../components/CategoryPicker";
import { IconUpload } from "../../components/IconUpload";
import { Kbd } from "../../components/KeyHint";
import { MerchantIcon } from "../../components/MerchantIcon";
import { notify } from "../../components/Toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SidePanel } from "../../components/SidePanel";
import { StatusPill } from "../../components/StatusPill";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { openTransactions } from "../../shell/openTransactions";
import { todayIso } from "../../lib/today";
import { dm, kr } from "../overview/format";

const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** The fields a panel edits (what PATCH /recurring-expenses/:id takes). */
export type ExpensePatch = Partial<
  Pick<
    RecurringExpense,
    | "name"
    | "amount"
    | "scheduleType"
    | "anchorDay"
    | "anchorMonth"
    | "remindDays"
    | "bankDayRule"
    | "dateBasis"
    | "paymentMethod"
    | "accountId"
    | "previousAccountId"
    | "accountFrom"
    | "categoryId"
    | "shared"
    | "matchPattern"
    | "billingCycle"
    | "yearlyAvailable"
    | "boundUntil"
    | "link"
    | "note"
    | "paused"
    | "lastPeriod"
    | "remindBeforeCharge"
    | "partOfId"
    | "currency"
    | "foreignAmount"
    | "vatPercent"
    | "nextFrom"
    | "nextAmount"
    | "nextForeignAmount"
  >
>;

export const NEW_EXPENSE: ExpensePatch = {
  name: "",
  amount: 0,
  scheduleType: "day_of_month",
  anchorDay: null,
  anchorMonth: null,
  bankDayRule: "none",
  dateBasis: "booking",
  paymentMethod: "autogiro",
  accountId: null,
  categoryId: null,
  shared: false,
  matchPattern: null,
  billingCycle: "monthly",
  yearlyAvailable: false,
  boundUntil: null,
  link: null,
  note: null,
  paused: false,
  remindBeforeCharge: false,
  partOfId: null,
};

const input = "h-8 w-full rounded-md border border-border bg-surface px-2 outline-none focus:border-ring";
/** 'september 2026'. */
const monthText = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
const addMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * Every field of a fixed expense in the side panel, with this month's status
 * ('markera betald'), 'Beloppet har ändrats' and a suggested schedule as rows
 * with their button, the last 12 months as small bars, the linked charges and
 * the amount per month. Empty for a new expense: 'Skapa' saves it.
 */
export function ExpensePanel({
  expense,
  isNew,
  accounts,
  expenses = [],
  onClose,
  onSave,
  onCreate,
  onAcceptAmount,
  onMark,
  onRemove,
  onChanged,
}: {
  expense: RecurringExpense | null;
  isNew: boolean;
  accounts: Account[];
  /** All of them, for 'Dras tillsammans med'. */
  expenses?: RecurringExpense[];
  onClose: () => void;
  onSave: (id: number, patch: ExpensePatch) => void;
  onCreate: (values: ExpensePatch) => Promise<boolean>;
  onAcceptAmount: (id: number) => void;
  onMark: (e: RecurringExpense, paid: boolean) => void;
  onRemove: (e: RecurringExpense) => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<ExpensePatch>(NEW_EXPENSE);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isNew) {
      setDraft(NEW_EXPENSE);
      setError(null);
    }
  }, [isNew]);
  const open = isNew || !!expense;
  const v: ExpensePatch = isNew ? draft : (expense ?? NEW_EXPENSE);
  const commit = (patch: ExpensePatch) => (isNew ? setDraft((d) => ({ ...d, ...patch })) : expense && onSave(expense.id, patch));

  const create = async () => {
    if (!draft.name?.trim()) return setError("Ge utgiften ett namn.");
    if (!draft.amount) return setError("Fyll i beloppet.");
    setError(null);
    if (await onCreate({ ...draft, name: draft.name.trim() })) setDraft(NEW_EXPENSE);
  };

  return (
    <SidePanel
      modal={false}
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? "Ny fast utgift" : (expense?.name ?? "")}
      description={isNew ? "Fyll i det du vet; resten går att ändra sedan." : expense?.scheduleText}
      footer={
        isNew ? (
          <>
            <Button variant="primary" size="sm" onClick={create}>
              <Plus /> Skapa
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Avbryt
            </Button>
            {error && <span className="text-xs text-danger">{error}</span>}
          </>
        ) : (
          expense && (
            <>
              <Button variant="danger" size="sm" onClick={() => onRemove(expense)}>
                <Trash2 /> Ta bort
              </Button>
              <span className="flex-1" />
              <span className="flex items-center gap-1 text-xs text-muted">
                <Kbd keys={["↑"]} />
                <Kbd keys={["↓"]} /> nästa
              </span>
            </>
          )
        )
      }
    >
      <div className="space-y-6 text-sm">
        {expense && !isNew && <StatusBlock e={expense} onMark={onMark} onAcceptAmount={onAcceptAmount} onSave={onSave} />}
        <Fields key={isNew ? "new" : expense?.id} v={v} self={isNew ? null : expense} expenses={expenses} accounts={accounts} commit={commit} onChanged={onChanged} autoFocus={isNew} />
        {expense && !isNew && (
          <>
            <ExpenseIcon e={expense} onChanged={onChanged} />
            <Plans e={expense} onChanged={onChanged} />
            <History e={expense} />
            <RentNotices e={expense} />
            {expense.billingCycle === "monthly" && <SkippedMonths expense={expense} onChanged={onChanged} />}
            {expense.billingCycle === "monthly" && <MonthAmounts expense={expense} onChanged={onChanged} />}
          </>
        )}
      </div>
    </SidePanel>
  );
}

function StatusBlock({
  e,
  onMark,
  onAcceptAmount,
  onSave,
}: {
  e: RecurringExpense;
  onMark: (e: RecurringExpense, paid: boolean) => void;
  onAcceptAmount: (id: number) => void;
  onSave: (id: number, patch: ExpensePatch) => void;
}) {
  const m = e.thisMonth ?? e.thisYear ?? null;
  const month = !m ? "" : e.billingCycle === "yearly" ? `I år (${m.period.slice(0, 4)})` : new Date(`${m.period}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Amount ore={e.variesByMonth ? e.thisMonthAmount : e.amount} size="lg" kind="neutral" whole />
        <span className="text-muted">{e.billingCycle === "yearly" ? "per år" : "per månad"}</span>
        {e.foreignPrice && <span className="text-muted tabular-nums">· {money(e.foreignPrice.withVat, e.foreignPrice.currency)} med moms</span>}
      </div>
      {m && (
        <div className="rounded-lg border border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-medium capitalize">{month}</span>
            <StatusPill status={m.status} />
            <span className="flex-1" />
            {m.status === "markerad_betald" ? (
              <Button size="sm" variant="ghost" onClick={() => onMark(e, false)}>
                Ångra
              </Button>
            ) : m.status !== "dragen" ? (
              <Button size="sm" onClick={() => onMark(e, true)}>
                Markera betald
              </Button>
            ) : null}
          </div>
          <p className="mt-0.5 text-muted">
            {m.transaction
              ? `Dragen ${dm(m.transaction.bookingDate)}, ${kr(Math.abs(m.transaction.amount))}.`
              : `${m.status === "kommande" ? "Väntas" : "Skulle dragits"} ${dm(m.dueDate)}, ${kr(m.amount)}.`}
            {e.nextDate && !e.paused && e.nextDate !== m.dueDate && ` Nästa ${dm(e.nextDate)}.`}
          </p>
        </div>
      )}
      {!m && e.nextDate && !e.paused && <p className="text-xs text-muted">Nästa dragning {dm(e.nextDate)}.</p>}
      {e.amountChanged && e.latestCharge && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-warning">
          <TrendingUp className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {e.latestForeign
              ? `Priset har ändrats ${money(e.latestForeign.expected, e.latestForeign.currency)} → ${money(e.latestForeign.charged, e.latestForeign.currency)} (med moms)`
              : `Beloppet har ändrats ${kr(e.latestExpected)} → ${kr(Math.abs(e.latestCharge.amount))}`}
            <span className="block text-xs opacity-80">senast dragen {dm(e.latestCharge.bookingDate)}</span>
          </span>
          <Button size="sm" onClick={() => onAcceptAmount(e.id)}>
            Uppdatera
          </Button>
        </div>
      )}
      {e.suggestion && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-transfer-soft px-3 py-2 text-transfer">
          <Lightbulb className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            Föreslaget schema: {e.suggestion.text}
            <span className="block text-xs opacity-80">
              stämmer med {e.suggestion.matches} av {e.suggestion.total} dragningar
              {e.suggestion.currentMatches > 0 && ` (nuvarande: ${e.suggestion.currentMatches})`}
            </span>
          </span>
          <Button
            size="sm"
            onClick={() =>
              onSave(e.id, {
                scheduleType: e.suggestion!.scheduleType,
                anchorDay: e.suggestion!.scheduleType === "last_day" ? e.anchorDay : e.suggestion!.anchorDay,
                bankDayRule: e.suggestion!.bankDayRule,
              })
            }
          >
            Använd
          </Button>
        </div>
      )}
      {e.offSchedule > 0 && (
        <p className="text-xs text-warning">
          {e.offSchedule} {e.offSchedule === 1 ? "dragning" : "dragningar"} avvek mer än 2 dagar från schemat (kopplade ändå, inom 5 dagar).
        </p>
      )}
    </div>
  );
}

const CURRENCY_OPTIONS: { value: "SEK" | "EUR" | "USD"; label: string }[] = [
  { value: "SEK", label: "kr" },
  { value: "EUR", label: "EUR" },
  { value: "USD", label: "USD" },
];
/** Swedish VAT on a service bought from abroad (Claude: 90 € + 25 % = 112,50 €). */
const DEFAULT_VAT = 25;
const SYMBOL: Record<string, string> = { EUR: "€", USD: "$" };
const money = (hundredths: number, currency: string) =>
  `${(hundredths / 100).toLocaleString("sv-SE", { minimumFractionDigits: hundredths % 100 ? 2 : 0, maximumFractionDigits: 2 })} ${SYMBOL[currency] ?? currency}`;

/**
 * Priced in a currency: the price before VAT and the VAT, and what that comes
 * to in kronor at Riksbanken's rate and the bank's markup (worked out by the
 * server; a new one's when it is saved).
 */
function ForeignFields({ v, price, commit }: { v: ExpensePatch; price: ForeignPrice | null; commit: (p: ExpensePatch) => void }) {
  const currency = v.currency!;
  const gross = v.foreignAmount ? Math.round(v.foreignAmount * (1 + (v.vatPercent ?? 0) / 100)) : null;
  return (
    <>
      <Field label="Pris">
        <div className="flex flex-wrap items-center gap-2">
          <TextField
            aria-label={`Pris i ${currency} utan moms`}
            value={v.foreignAmount ? (v.foreignAmount / 100).toLocaleString("sv-SE") : ""}
            placeholder="0"
            onCommit={(t) => {
              const hundredths = parseKr(t);
              if (hundredths && hundredths > 0 && hundredths !== v.foreignAmount) commit({ foreignAmount: hundredths });
            }}
            className={cn(input, "w-24 text-right tabular-nums")}
            inputMode="decimal"
          />
          <span className="text-muted">{SYMBOL[currency]} utan moms, +</span>
          <TextField
            aria-label="Moms i procent"
            value={v.vatPercent === null || v.vatPercent === undefined ? "" : String(v.vatPercent)}
            placeholder="0"
            onCommit={(t) => {
              const pct = t.trim() === "" ? 0 : Number(t.replace(",", "."));
              if (Number.isInteger(pct) && pct >= 0 && pct <= 50 && pct !== v.vatPercent) commit({ vatPercent: pct });
            }}
            className={cn(input, "w-14 text-right tabular-nums")}
            inputMode="decimal"
          />
          <span className="text-muted">% moms</span>
        </div>
      </Field>
      <Field label="I kronor">
        <p className="text-muted tabular-nums" data-testid="foreign-price">
          {price ? (
            <>
              <span className="font-medium text-foreground">{kr(price.amount)}</span> {v.billingCycle === "yearly" ? "per år" : "per månad"}
              <span className="block text-xs">
                {money(price.withVat, currency)} med moms × {price.rate.toLocaleString("sv-SE", { maximumFractionDigits: 4 })} (Riksbanken {dm(price.rateDate)})
                {price.markup > 0 && ` + bankens påslag ${(price.markup * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`}. Följer kursen varje dag.
              </span>
            </>
          ) : gross ? (
            `${money(gross, currency)} med moms. Kronorna räknas fram med dagens kurs när den sparas.`
          ) : (
            "Fyll i priset."
          )}
        </p>
      </Field>
    </>
  );
}

/**
 * 'Byt plan…': the subscription is on another plan from a month (upgraded or
 * downgraded): a new price, a name and, once the plan has begun, often a new
 * draw day. The plan it was on keeps the months before. A month still to
 * come only waits: the periods before keep the price, and once the first
 * charge at the new one has come, it is the plan.
 */
function PlanChange({ e, onChanged }: { e: RecurringExpense; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const thisMonth = todayIso().slice(0, 7);
  const start = e.nextPeriod ?? thisMonth;
  const [from, setFrom] = useState(start);
  const [price, setPrice] = useState("");
  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const currency = e.currency ?? null;
  // A few months back from the next draw (the plan may have begun already) to a year ahead, after the one it is on began.
  const began = e.plans?.length ? e.plans[e.plans.length - 1].from : null;
  const months = Array.from({ length: 16 }, (_, i) => addMonth(start, i - 3)).filter((m) => !began || m > began);
  const started = from <= thisMonth;
  const open = () => {
    setFrom(months.find((m) => m >= start) ?? months[0] ?? start);
    setPrice("");
    setName("");
    setDay(e.anchorDay ? String(e.anchorDay) : "");
    setEditing(true);
  };
  if (e.nextFrom) {
    const gross = currency && e.nextForeignAmount ? Math.round(e.nextForeignAmount * (1 + (e.vatPercent ?? 0) / 100)) : null;
    return (
      <Field label="Nytt pris">
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-transfer-soft px-2 py-1 text-transfer" data-testid="price-change">
          <span className="min-w-0 flex-1">
            Från {monthText(e.nextFrom)}: {e.nextPlanName && <span className="font-medium">{e.nextPlanName} · </span>}
            <span className="font-medium tabular-nums">{e.nextAmount ? kr(e.nextAmount) : "–"}</span>
            {gross !== null && currency && ` (${money(gross, currency)} med moms)`}
            <span className="block text-xs opacity-80">Blir planen när den första dragningen till det nya priset har kommit.</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => void sendJson("PATCH", `/recurring-expenses/${e.id}`, { nextFrom: null }).then(onChanged)}>
            Ta bort
          </Button>
        </div>
      </Field>
    );
  }
  if (!editing) {
    return (
      <Field label="">
        <button type="button" className="text-left text-sm text-link hover:underline" onClick={open}>
          Byt plan…
        </button>
      </Field>
    );
  }
  const save = async () => {
    const amount = parseKr(price);
    if (!amount || amount <= 0) return notify({ text: currency ? `Skriv det nya priset i ${currency}, utan moms.` : "Skriv det nya beloppet i kronor." });
    const anchorDay = started && day.trim() ? Number(day) : undefined;
    if (anchorDay !== undefined && !(Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31)) return notify({ text: "Dagen ska vara 1–31." });
    try {
      await sendJson("POST", `/recurring-expenses/${e.id}/change-plan`, {
        from,
        ...(currency ? { foreignAmount: amount } : { amount }),
        ...(anchorDay !== undefined && anchorDay !== e.anchorDay ? { anchorDay } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      notify({ text: (err as Error).message });
    }
  };
  return (
    <Field label="Byt plan" top>
      <form
        aria-label="Byt plan"
        className="space-y-2 rounded-md border border-border p-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">från</span>
          <select aria-label="Från månad" className={cn(input, "w-auto")} value={from} onChange={(ev) => setFrom(ev.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthText(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={currency ? `Nytt pris i ${currency} utan moms` : "Nytt belopp"}
            autoFocus
            inputMode="decimal"
            placeholder="0"
            className={cn(input, "w-24 text-right tabular-nums")}
            value={price}
            onChange={(ev) => setPrice(ev.target.value)}
          />
          <span className="text-muted">{currency ? `${SYMBOL[currency]} utan moms (+${e.vatPercent ?? 0} %)` : "kr"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Namn på planen" placeholder="Planens namn (valfritt)" className={cn(input, "w-52 max-w-full")} value={name} onChange={(ev) => setName(ev.target.value)} />
          {started && (
            <>
              <span className="text-muted">dras den</span>
              <input aria-label="Ny dragdag" inputMode="numeric" className={cn(input, "w-14 text-right tabular-nums")} value={day} onChange={(ev) => setDay(ev.target.value)} />
            </>
          )}
        </div>
        <p className="text-xs text-muted">
          {started
            ? "Månaderna före behåller sitt pris och sin dag. En dragning som startade planen kopplas från köpet i Transaktioner."
            : "Månaderna före behåller priset. Planen börjar gälla när den första dragningen till det nya priset har kommit."}
        </p>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="primary">
            Byt plan
          </Button>
          <Button type="button" size="sm" onClick={() => setEditing(false)}>
            Avbryt
          </Button>
        </div>
      </form>
    </Field>
  );
}

/** The plans it has been on, with the months each held, and 'Ångra senaste planbyte'. */
function Plans({ e, onChanged }: { e: RecurringExpense; onChanged: () => void }) {
  const plans = e.plans ?? [];
  if (plans.length === 0) return null;
  const undo = async () => {
    try {
      await sendJson("POST", `/recurring-expenses/${e.id}/undo-plan-change`, {});
      onChanged();
    } catch (err) {
      notify({ text: (err as Error).message });
    }
  };
  return (
    <section data-testid="plans">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Planer</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {[...plans].reverse().map((p, i) => {
          const now = p.until === null;
          const price = e.billingCycle === "yearly" ? "per år" : "per månad";
          return (
            <li key={p.from ?? "first"} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5">
              <span className={cn("font-medium", !now && "text-muted")}>{p.plan.name ?? (now ? "Nuvarande plan" : `Plan ${plans.length - i}`)}</span>
              <span className="tabular-nums">
                {kr(p.plan.amount)} {price}
              </span>
              {p.plan.anchorDay && p.plan.scheduleType === "day_of_month" && <span className="text-muted">dag {p.plan.anchorDay}</span>}
              <span className="flex-1 text-right text-xs text-muted">
                {p.from ? `från ${monthText(p.from)}` : "tidigare"}
                {p.until && ` till och med ${monthText(p.until)}`}
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => void undo()} className="mt-1 text-xs text-muted hover:text-foreground">
        Ångra senaste planbyte
      </button>
    </section>
  );
}

function Fields({
  v,
  self,
  expenses,
  accounts,
  commit,
  onChanged,
  autoFocus,
}: {
  v: ExpensePatch;
  self: RecurringExpense | null;
  expenses: RecurringExpense[];
  accounts: Account[];
  commit: (p: ExpensePatch) => void;
  onChanged: () => void;
  autoFocus: boolean;
}) {
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const owner = v.partOfId != null ? expenses.find((e) => e.id === v.partOfId) : undefined;
  // Only an expense with a charge of its own, and not one with others drawn with it.
  const owners = expenses.filter((e) => e.id !== self?.id && e.partOfId === null && !e.paused);
  const hasParts = (self?.partNames.length ?? 0) > 0;
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
      <Field label="Namn">
        <TextField aria-label="Namn" autoFocus={autoFocus} value={v.name ?? ""} onCommit={(name) => name && commit({ name })} className={input} />
      </Field>
      <Field label="Pris i">
        <SegmentedControl
          label="Pris i"
          size="sm"
          options={CURRENCY_OPTIONS}
          value={v.currency ?? "SEK"}
          onChange={(c) =>
            commit(c === "SEK" ? { currency: null, foreignAmount: null, vatPercent: null } : { currency: c, vatPercent: v.vatPercent ?? DEFAULT_VAT, ...(v.foreignAmount ? { foreignAmount: v.foreignAmount } : {}) })
          }
        />
      </Field>
      {v.currency ? (
        <ForeignFields v={v} price={self?.foreignPrice ?? null} commit={commit} />
      ) : (
        <Field label="Belopp">
          <div className="flex items-center gap-2">
            <TextField
              aria-label="Belopp"
              value={v.amount ? (v.amount / 100).toLocaleString("sv-SE") : ""}
              placeholder="0"
              onCommit={(t) => {
                const ore = parseKr(t);
                if (ore && ore > 0 && ore !== v.amount) commit({ amount: ore });
              }}
              className={cn(input, "w-32 text-right tabular-nums")}
              inputMode="decimal"
            />
            <span className="text-muted">kr {v.billingCycle === "yearly" ? "per år" : "per månad"}</span>
          </div>
        </Field>
      )}
      {self && <PlanChange e={self} onChanged={onChanged} />}
      <Field label="Dragning" top>
        <div className="space-y-1">
          <select
            aria-label="Dras tillsammans med"
            className={input}
            value={v.partOfId ?? ""}
            disabled={hasParts}
            onChange={(e) => commit({ partOfId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Egen dragning</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                Dras tillsammans med {o.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            {hasParts
              ? `${self!.partNames.join(" och ")} dras tillsammans med den här. Dragningen delas: de räknas som sina belopp, resten på den här.`
              : owner
                ? `Ingen egen dragning: följer ${owner.name}s dag och konto. Dragningen delas: den här räknas som sitt belopp, resten på ${owner.name}.`
                : "Välj en annan utgift om banken drar båda i samma dragning, som bredband och mobil hos Tele2."}
          </p>
        </div>
      </Field>
      {!owner && (
        <>
      <Field label={v.billingCycle === "yearly" ? "Datum" : "Dag"}>
        <div className="flex items-center gap-2">
          <TextField
            aria-label="Dag"
            value={v.scheduleType === "last_day" ? "sista" : v.anchorDay == null ? "" : String(v.anchorDay)}
            placeholder="1–31"
            onCommit={(t) => {
              const s = t.trim().toLowerCase();
              if (s === "sista" || s === "s") return commit({ scheduleType: "last_day" });
              const d = s === "" ? null : Number(s);
              if (d === null || (Number.isInteger(d) && d >= 1 && d <= 31)) commit({ scheduleType: "day_of_month", anchorDay: d });
            }}
            className={cn(input, "w-20 tabular-nums")}
          />
          {v.billingCycle === "yearly" ? (
            <select
              aria-label="Månad"
              value={v.anchorMonth ?? ""}
              onChange={(e) => commit({ anchorMonth: e.target.value ? Number(e.target.value) : null })}
              className={cn(input, "w-32")}
            >
              <option value="">Månad…</option>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted">1–31 eller "sista"</span>
          )}
        </div>
        {v.billingCycle === "yearly" && (
          <p className="mt-1 text-xs text-muted">Dagen den förnyas eller ska vara betald. En dragning från 45 dagar före till 10 dagar efter räknas till det året.</p>
        )}
      </Field>
      {v.billingCycle !== "yearly" && (
        <Field label="Påminn">
          <label className="flex flex-wrap items-center gap-2">
            <input type="checkbox" checked={!!v.remindBeforeCharge} onChange={(e) => commit({ remindBeforeCharge: e.target.checked })} />
            <span className="text-muted">Säg till innan den dras</span>
            {v.remindBeforeCharge && (
              <>
                <TextField
                  aria-label="Påminn dagar före"
                  value={String(v.remindDays ?? 3)}
                  placeholder="3"
                  onCommit={(t) => {
                    const d = t.trim() === "" ? null : Number(t);
                    if (d === null || (Number.isInteger(d) && d >= 0 && d <= 90)) commit({ remindDays: d });
                  }}
                  className={cn(input, "w-14 tabular-nums")}
                />
                <span className="text-xs text-muted">dagar före i Att göra</span>
              </>
            )}
          </label>
          {v.remindBeforeCharge && <p className="mt-1 text-xs text-muted">För den som ska sägas upp innan den tar betalt igen. Frågan kommer inför varje dragning tills utgiften pausas.</p>}
        </Field>
      )}
      {v.billingCycle === "yearly" && (
        <Field label="Påminn">
          <div className="flex items-center gap-2">
            <TextField
              aria-label="Påminn dagar före"
              value={String(v.remindDays ?? 14)}
              placeholder="14"
              onCommit={(t) => {
                const d = t.trim() === "" ? null : Number(t);
                if (d === null || (Number.isInteger(d) && d >= 0 && d <= 90)) commit({ remindDays: d });
              }}
              className={cn(input, "w-16 tabular-nums")}
            />
            <span className="text-xs text-muted">dagar före i Att göra (0 = aldrig)</span>
          </div>
        </Field>
      )}
      <Field label="Vid helgdag">
        <SegmentedControl<BankDayRule>
          label="Om dagen är en helg eller helgdag: samma dag, nästa bankdag eller föregående bankdag"
          size="sm"
          options={[
            { value: "none", label: "Samma dag" },
            { value: "next", label: "Nästa" },
            { value: "previous", label: "Föregående" },
          ]}
          value={v.bankDayRule ?? "none"}
          onChange={(bankDayRule) => commit({ bankDayRule })}
        />
      </Field>
      <Field label="Jämför med">
        <SegmentedControl<DateBasis>
          label="Vilket datum dragningen jämförs med"
          size="sm"
          options={[
            { value: "booking", label: "Bokföringsdag" },
            { value: "transaction", label: "Transaktionsdag" },
          ]}
          value={v.dateBasis ?? "booking"}
          onChange={(dateBasis) => commit({ dateBasis })}
        />
      </Field>
      <Field label="Betalsätt">
        <select aria-label="Betalsätt" className={input} value={v.paymentMethod} onChange={(e) => commit({ paymentMethod: e.target.value as PaymentMethod })}>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Konto">
        <select
          aria-label="Konto"
          className={input}
          value={v.accountId ?? ""}
          onChange={(e) => commit({ accountId: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Inget konto</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {self && v.previousAccountId != null && v.accountFrom && (
          <div className="mt-1.5 space-y-1 text-xs text-muted" data-testid="account-move">
            <p>
              {accounts.find((a) => a.id === v.previousAccountId)?.name ?? "Tidigare konto"} till och med {monthText(addMonth(v.accountFrom, -1))}. Dragningar före bytet
              kopplas dit, också när de importeras senare.
            </p>
            <label className="flex items-center gap-2">
              Nytt konto från
              <input
                type="month"
                aria-label="Nytt konto från"
                className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground"
                value={v.accountFrom}
                onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && commit({ accountFrom: e.target.value })}
              />
            </label>
            <button type="button" className="text-link hover:underline" onClick={() => commit({ previousAccountId: null })}>
              Kontot var fel från början
            </button>
          </div>
        )}
      </Field>
        </>
      )}
      <Field label="Kategori">
        <CategoryChip categoryId={v.categoryId ?? null} onClick={(e) => setPicker(e.currentTarget)} className="border-border" aria-label="Kategori" />
        <CategoryPicker
          open={!!picker}
          onOpenChange={(o) => !o && setPicker(null)}
          anchor={picker}
          value={v.categoryId ?? null}
          includeTransfers={false}
          onPick={(c) => commit({ categoryId: c.id })}
        />
      </Field>
      <Field label="Delad">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!v.shared} onChange={(e) => commit({ shared: e.target.checked })} />
          <span className="text-muted">Delas lika i hushållet</span>
        </label>
      </Field>
      {!owner && (
        <Field label="Bankens text">
          <TextField
            aria-label="Bankens text"
            value={v.matchPattern ?? ""}
            placeholder="t.ex. NETFLIX"
            onCommit={(t) => commit({ matchPattern: t || null })}
            className={cn(input, "font-mono text-xs")}
          />
        </Field>
      )}
      <Field label="Betalas">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl<"monthly" | "yearly">
            label="Betalas"
            size="sm"
            options={[
              { value: "monthly", label: "Månadsvis" },
              { value: "yearly", label: "Årsvis" },
            ]}
            value={v.billingCycle ?? "monthly"}
            onChange={(billingCycle) => commit({ billingCycle })}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={!!v.yearlyAvailable} onChange={(e) => commit({ yearlyAvailable: e.target.checked })} />
            finns årsvis
          </label>
        </div>
      </Field>
      <Field label="Bunden t.o.m.">
        <input
          type="date"
          aria-label="Bunden t.o.m."
          className={cn(input, "w-44")}
          value={v.boundUntil ?? ""}
          onChange={(e) => commit({ boundUntil: e.target.value || null })}
        />
      </Field>
      <Field label="Länk">
        <div className="flex items-center gap-1.5">
          <TextField aria-label="Länk" value={v.link ?? ""} placeholder="https://…" onCommit={(t) => commit({ link: t || null })} className={input} />
          {v.link && (
            <a href={v.link} target="_blank" rel="noreferrer" className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Öppna länken">
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      </Field>
      <Field label="Anteckning" top>
        <TextField
          multiline
          aria-label="Anteckning"
          value={v.note ?? ""}
          onCommit={(t) => commit({ note: t || null })}
          className="min-h-16 w-full rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-ring"
        />
      </Field>
      <Field label="Pausad">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!v.paused} onChange={(e) => commit({ paused: e.target.checked })} />
          <span className="text-muted">{v.paused && v.lastPeriod ? "Uppsagd efter sista dragningen" : "Räknas inte och väntas inte"}</span>
        </label>
        {self && v.paused && (
          <div className="mt-1.5 space-y-1 text-xs text-muted" data-testid="last-period">
            <label className="flex items-center gap-2">
              Sista dragning
              <input
                type="month"
                aria-label="Sista dragning"
                className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground"
                value={v.lastPeriod ?? ""}
                onChange={(e) => commit({ lastPeriod: /^\d{4}-\d{2}$/.test(e.target.value) ? e.target.value : null })}
              />
            </label>
            <p>
              {v.lastPeriod
                ? `Räknas, kopplas och delas till och med ${monthText(v.lastPeriod)}, sedan inte.`
                : "Utan sista dragning räknas den inte alls, inte heller dragningar som redan gjorts."}
            </p>
          </div>
        )}
      </Field>
    </dl>
  );
}

function Field({ label, top, children }: { label: string; top?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className={cn("text-muted", top && "self-start pt-1")}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** Edits locally, saves on blur or Enter; Esc goes back. */
function TextField({
  value,
  onCommit,
  multiline,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputMode?: "decimal";
  "aria-label": string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft.trim() !== value && onCommit(draft.trim());
  if (multiline) return <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} {...rest} />;
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      {...rest}
    />
  );
}

/** The last 12 months as bars (charged; the line is what was expected) and the linked charges. */
/**
 * The expense's picture. When its charges match a rule, an upload asks where
 * it applies: only this expense (the default) or every purchase there.
 */
function ExpenseIcon({ e, onChanged }: { e: RecurringExpense; onChanged: () => void }) {
  const [pending, setPending] = useState<File | null>(null);
  const onlyThis = useRef<HTMLButtonElement>(null);
  const rule = e.iconRule ?? null;
  const send = async (file: File, target: "expense" | "rule") => {
    setPending(null);
    try {
      await uploadIcon(target === "rule" && rule ? `/rules/${rule.id}/icon` : `/recurring-expenses/${e.id}/icon`, file);
      notify({ text: target === "rule" && rule ? `Bilden gäller nu alla köp hos ${rule.pattern}.` : `Bilden gäller ${e.name}.` });
      onChanged();
    } catch (err) {
      notify({ text: (err as Error).message });
    }
  };
  const remove = async () => {
    if (e.iconPath) await sendJson("DELETE", `/recurring-expenses/${e.id}/icon`, {});
    else if (rule?.hasImage) await sendJson("DELETE", `/rules/${rule.id}/icon`, {});
    onChanged();
  };
  const where = e.iconPath
    ? `Egen bild för ${e.name}.`
    : rule?.hasImage
      ? `Bilden kommer från regeln ${rule.pattern} (alla köp där).`
      : e.icon?.brand
        ? "Varumärkets ikon."
        : "Monogram tills du lägger in en bild.";
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Ikon</h3>
      <IconUpload
        preview={<MerchantIcon label={e.name} icon={e.icon} size={40} />}
        hasOwn={!!e.iconPath || !!rule?.hasImage}
        onFile={async (file) => (rule ? setPending(file) : send(file, "expense"))}
        onRemove={remove}
        removeLabel={e.iconPath ? "Ta bort ikon" : `Ta bort ikon (alla köp hos ${rule?.pattern})`}
      >
        <span>{where}</span>
      </IconUpload>
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent
          className="max-w-md"
          // The default (only this expense) has focus, so Enter picks it.
          onOpenAutoFocus={(ev) => {
            ev.preventDefault();
            onlyThis.current?.focus();
          }}
        >
          <DialogTitle>Var ska bilden gälla?</DialogTitle>
          <DialogDescription>
            Gäller bilden bara {e.name}, eller alla köp hos {rule?.pattern}?
          </DialogDescription>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button ref={onlyThis} variant="primary" size="sm" onClick={() => pending && send(pending, "expense")}>
              Bara {e.name}
            </Button>
            <Button size="sm" onClick={() => pending && send(pending, "rule")}>
              Alla köp hos {rule?.pattern}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function History({ e }: { e: RecurringExpense }) {
  const [h, setH] = useState<ExpenseHistory | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    getJson<ExpenseHistory>(`/recurring-expenses/${e.id}/history`).then((x) => live && setH(x), () => live && setH(null));
    return () => {
      live = false;
    };
  }, [e.id, e.amount, e.linkedCount, e.matchPattern, e.anchorDay, e.scheduleType, e.plans?.length]);
  if (!h) return null;
  const max = Math.max(1, ...h.months.flatMap((m) => [m.charged ?? 0, e.billingCycle === "monthly" ? m.expected : 0]));
  const shown = all ? h.charges : h.charges.slice(0, 5);
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Dragningar, 12 månader</h3>
      <div className="flex h-20 items-end gap-1" role="img" aria-label="Draget per månad de senaste 12 månaderna">
        {h.months.map((m) => {
          // The month a new plan began often has two charges, the old plan's and the new one's: not a deviation.
          const twoPlans = !!m.planChange && (m.charges ?? 0) > 1;
          const off = m.charged !== null && e.billingCycle === "monthly" && m.charged !== m.expected && !twoPlans;
          return (
            <div
              key={m.month}
              className="relative flex h-full flex-1 flex-col justify-end"
              title={`${m.month}: ${m.charged !== null ? `dragen ${kr(m.charged)}` : "ingen dragning"}${e.billingCycle === "monthly" ? `, väntat ${kr(m.expected)}` : ""}${m.plan ? `, ${m.plan}` : ""}${m.planChange ? `, ny plan${twoPlans ? ` (${m.charges} dragningar)` : ""}` : ""}`}
            >
              {e.billingCycle === "monthly" && (
                <span className="absolute inset-x-0 border-t border-dashed border-muted/60" style={{ bottom: `${(m.expected / max) * 100}%` }} />
              )}
              <span
                className={cn("rounded-sm", m.charged === null ? "h-0.5 bg-border" : off ? "bg-warning" : m.planChange ? "bg-transfer" : "bg-foreground/50")}
                style={m.charged !== null ? { height: `${Math.max(4, (m.charged / max) * 100)}%` } : undefined}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-center text-[10px] text-subtle">
        {h.months.map((m) => (
          <span key={m.month} className="flex-1">
            {new Date(`${m.month}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "narrow" })}
          </span>
        ))}
      </div>
      {h.charges.length === 0 ? (
        <p className="mt-3 text-muted">{e.matchPattern ? "Inga kopplade dragningar än." : "Ingen text att matcha mot, så inga dragningar kopplas."}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openTransactions({ period: c.bookingDate.slice(0, 7), q: c.descriptionClean, transfers: true })}
                className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-hover"
                title="Visa i Transaktioner"
              >
                <span className="w-10 text-muted tabular-nums">{dm(c.bookingDate)}</span>
                <span className="w-10 text-xs text-subtle">{c.bookingDate.slice(0, 4)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{c.descriptionClean}</span>
                <Amount ore={c.amount} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {h.charges.length > 5 && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-1 text-xs text-muted hover:text-foreground">
          {all ? "Visa färre" : `Visa alla ${h.charges.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * Months it wasn't drawn: a subscription paused for a while (a streaming
 * service in July and August). Nothing is expected for them — not 'förfallen', no Vakt task,
 * nothing shared. A charge that comes anyway still counts.
 */
function SkippedMonths({ expense: e, onChanged }: { expense: RecurringExpense; onChanged: () => void }) {
  const [month, setMonth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const set = async (period: string, skipped: boolean) => {
    setError(null);
    try {
      await sendJson("PUT", `/recurring-expenses/${e.id}/marks/${period}`, { skipped });
      setMonth("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <section data-testid="skipped-months">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Månader utan dragning</h3>
      {e.skippedPeriods.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {e.skippedPeriods.map((p) => (
            <li key={p} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
              {monthText(p)}
              <button type="button" aria-label={`Ta bort ${monthText(p)}`} className="text-muted hover:text-foreground" onClick={() => set(p, false)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-muted">Pausad en period? Lägg till månaderna, så väntas ingen dragning och inget delas då.</p>
      )}
      <div className="flex items-center gap-2">
        <input
          type="month"
          aria-label="Månad utan dragning"
          className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground"
          value={month}
          onChange={(ev) => setMonth(ev.target.value)}
        />
        <Button size="sm" disabled={!/^\d{4}-\d{2}$/.test(month) || e.skippedPeriods.includes(month)} onClick={() => set(month, true)}>
          Lägg till
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}

/**
 * Hyresavier: the notices imported for this expense (Importer), newest
 * first — the month the rent is for, what to pay and when, whether the
 * period's charge has come, and the PDF. Nothing when there are none.
 */
function RentNotices({ e }: { e: RecurringExpense }) {
  const [list, setList] = useState<RentNotice[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    getJson<RentNotice[]>(`/rent-notices?expenseId=${e.id}`).then((x) => live && setList(x), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [e.id, e.linkedCount]);
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, 4);
  return (
    <section data-testid="rent-notices">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Hyresavier</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {shown.map((n) => (
          <li key={n.id} className="flex items-center gap-3 px-3 py-1.5" title={n.lines.map((l) => `${l.text}: ${kr(l.amount)}`).join("\n")}>
            <span className="min-w-0 flex-1">
              <span className="block truncate capitalize">{monthText(n.rentMonth)}</span>
              <span className="block text-xs text-muted">
                avi {n.number} · förfaller {dm(n.dueDate)}
                {n.paid ? ` · betald ${dm(n.paid.date)}` : ""}
              </span>
            </span>
            {n.paid ? <Check className="size-4 shrink-0 text-income" aria-label="Betald" /> : <span className="text-xs text-muted">inte betald</span>}
            <span className="w-20 text-right tabular-nums">{kr(n.amount)}</span>
            <a href={`/api/rent-notices/${n.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs text-link hover:underline" aria-label={`Öppna avi ${n.number} (PDF)`}>
              PDF
            </a>
          </li>
        ))}
      </ul>
      {list.length > 4 && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-1 text-xs text-muted hover:text-foreground">
          {all ? "Visa färre" : `Visa alla ${list.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * Amount per month for one year, for charges that vary (e.g. CSN). An empty
 * field means the usual amount. Past months show what was actually charged.
 */
function MonthAmounts({ expense: e, onChanged }: { expense: RecurringExpense; onChanged: () => void }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [months, setMonths] = useState<ExpenseMonth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    getJson<ExpenseMonth[]>(`/recurring-expenses/${e.id}/months?year=${year}`).then(setMonths);
  }, [e.id, year]);
  useEffect(load, [load, e.amount]);

  const save = async (month: string, value: string) => {
    setError(null);
    const trimmed = value.trim();
    const ore = trimmed ? parseKr(trimmed) : null;
    if (trimmed && !ore) return setError(`Ogiltigt belopp för ${month}.`);
    const current = months?.find((m) => m.month === month)?.amount ?? null;
    // Typing the usual amount (the plan's price for the month) clears the month's own amount.
    const amount = ore === (months?.find((m) => m.month === month)?.usual ?? e.amount) ? null : ore;
    if (amount === current) return;
    try {
      await sendJson("PUT", `/recurring-expenses/${e.id}/amounts/${month}`, { amount });
      load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "short" });

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Belopp per månad</h3>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="px-1.5" onClick={() => setYear(year - 1)} aria-label="Föregående år">
          ‹
        </Button>
        <span className="text-xs font-medium tabular-nums">{year}</span>
        <Button size="sm" variant="ghost" className="px-1.5" onClick={() => setYear(year + 1)} aria-label="Nästa år">
          ›
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Tomt fält = {e.plans?.length ? "planens pris för månaden" : `standardbeloppet ${kr(e.amount)}`}. Används i prognosen, avstämningen och kontrollen av ändrat belopp.
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {months?.map((m) => {
          const past = m.month < thisMonth;
          // The month a new plan began often has two charges, the old plan's and the new one's: not a deviation.
          const off = m.charged !== null && m.charged !== m.expected && !(m.planChange && (m.charges ?? 0) > 1);
          return (
            <label
              key={m.month}
              className={cn("block rounded-md border p-1.5", m.month === thisMonth ? "border-ring" : "border-border", past && "bg-surface-muted/60")}
            >
              <span className="block text-[11px] capitalize text-muted">{monthLabel(m.month)}</span>
              <MonthInput
                label={`Belopp ${m.month}`}
                value={m.amount === null ? "" : String(m.amount / 100).replace(".", ",")}
                placeholder={String((m.usual ?? e.amount) / 100).replace(".", ",")}
                onCommit={(t) => save(m.month, t)}
              />
              <span className={cn("block text-[10px] tabular-nums", off ? "text-warning" : "text-subtle")}>{m.charged !== null ? `dragen ${kr(m.charged)}` : " "}</span>
            </label>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}

function MonthInput({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(ev) => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
      className="w-full rounded border border-border bg-surface px-1 py-0.5 text-right text-[13px] tabular-nums outline-none placeholder:text-subtle focus:border-ring"
    />
  );
}
