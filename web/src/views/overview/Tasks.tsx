import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Banknote, BellRing, CalendarClock, CalendarX2, Check, ChevronDown, CirclePause, Coins, Copy, FileDown, Fuel, Inbox, DatabaseBackup, Landmark, Package, PiggyBank, RefreshCw, Scale, Receipt, ShieldCheck, Store, TrendingUp, TriangleAlert, Undo2, Wallet, X, type LucideIcon, FileText } from "lucide-react";
import { sendJson, type Overview, type OverviewTask, type WatchFinding, type WatchKind } from "../../api";
import { Amount } from "../../components/Amount";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { DURATION } from "../../lib/motion";
import { requestIntent } from "../../shell/intents";
import { openItemFor } from "../items/ItemDialogHost";
import { openTransactions } from "../../shell/openTransactions";
import { navigate, openSettings, type ViewId } from "../../shell/routes";
import { defaultFilters } from "../transactions/filters";
import { dm, kr } from "./format";
import { todayIso } from "../../lib/today";

// Dismissed tasks, for today only, per browser.
const DISMISSED_KEY = "privatekonomi.overviewDismissed";
const today = todayIso;

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "{}");
    return v.date === today() && Array.isArray(v.ids) ? v.ids : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify({ date: today(), ids }));
  } catch {
    // Dismissed until the page reloads.
  }
}

const ICON: Record<Exclude<OverviewTask["kind"], "watch">, LucideIcon> = {
  invoice_due: Receipt,
  salary_late: Banknote,
  stale_balance: Wallet,
  invoice_missing: FileDown,
  review: Inbox,
  amount_changed: TrendingUp,
  fuel_shifts: Fuel,
  bank: Landmark,
  salary: Banknote,
  reference_budget: Scale,
  backup: DatabaseBackup,
};

const WATCH_ICON: Record<WatchKind, LucideIcon> = {
  price_drift: TrendingUp,
  double_charge: Copy,
  unusual_amount: TriangleAlert,
  new_merchant: Store,
  missed_charge: CalendarX2,
  subscription_stopped: CirclePause,
  yearly_renewal: CalendarClock,
  charge_coming: BellRing,
  bet_zone_over: Scale,
  prices_stale: RefreshCw,
  fx_missing: Coins,
  buffer_low: PiggyBank,
  pension_stale: CalendarClock,
  pension_forecast_stale: CalendarClock,
  warranty_ending: ShieldCheck,
  return_deadline: Undo2,
  maybe_item: Package,
  isk_allowance: Landmark,
  tax_return_missing: FileText,
};

/**
 * A task that is done ticks itself off: a check is drawn where the buttons
 * were, and then the row collapses and the ones below slide up. It runs
 * however the task left — dismissed for the day, dismissed for good, or done
 * and gone after a reload.
 */
const CHECK_S = 0.25;
const TASK: Variants = {
  here: { opacity: 1, height: "auto" },
  gone: { opacity: 0, height: 0, transition: { duration: DURATION.layout, ease: "easeOut", delay: CHECK_S } },
};
const CHECK: Variants = {
  here: { opacity: 0, pathLength: 0 },
  gone: { opacity: 1, pathLength: 1, transition: { duration: CHECK_S, ease: "easeOut" } },
};

const iconOf = (t: OverviewTask) => (t.finding ? WATCH_ICON[t.finding.kind] : ICON[t.kind as Exclude<OverviewTask["kind"], "watch">]);

/** The rows a finding is about: its days, account and amount. */
function showRows(f: WatchFinding) {
  const plus = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const days = f.kind === "double_charge" ? 2 : 0;
  const amount = f.amount ?? f.newAmount;
  const k = amount !== undefined ? String(amount / 100).replace(".", ",") : "";
  openTransactions({
    ...defaultFilters(),
    period: "range",
    from: plus(f.date, -days),
    to: f.date,
    account: f.accountId ? String(f.accountId) : "",
    min: k,
    max: k,
  });
}

/**
 * Att göra: what needs action, each with its button (open, update, mark
 * paid …) and dismissable for the day. Shown only when there is something.
 */
export function Tasks({
  data,
  act,
  onNavigate,
}: {
  data: Overview;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onNavigate: (v: ViewId) => void;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = data.tasks.filter((t) => !dismissed.includes(t.id));
  const hidden = data.tasks.length - visible.length;

  const dismiss = (id: string) => {
    const ids = [...dismissed.filter((d) => data.tasks.some((t) => t.id === d)), id];
    setDismissed(ids);
    writeDismissed(ids);
  };
  const restore = () => {
    setDismissed([]);
    writeDismissed([]);
  };

  const markInvoice = (t: OverviewTask, paid: boolean) =>
    act(() => sendJson("PUT", `/statements/${t.statementId}/paid`, { paid })).then(() => {
      if (paid) notify({ text: "Fakturan är markerad som betald.", action: { label: "Ångra", run: () => markInvoice(t, false) } });
    });
  const markExpense = (expenseId: number, period: string, paid: boolean) =>
    act(() => sendJson("PUT", `/recurring-expenses/${expenseId}/marks/${period}`, { paid })).then(() => {
      if (paid) notify({ text: "Markerad som betald för perioden.", action: { label: "Ångra", run: () => markExpense(expenseId, period, false) } });
    });
  const markSkipped = (expenseId: number, period: string, skipped: boolean) =>
    act(() => sendJson("PUT", `/recurring-expenses/${expenseId}/marks/${period}`, { skipped })).then(() => {
      if (skipped) notify({ text: "Ingen dragning väntas den månaden.", action: { label: "Ångra", run: () => markSkipped(expenseId, period, false) } });
    });
  const acceptAmount = (expenseId: number) => act(() => sendJson("POST", `/recurring-expenses/${expenseId}/accept-latest-amount`, {}));

  // Vakt: dismissed for good (with a way back right after), accepted, paused.
  const restoreFinding = (key: string) => act(() => sendJson("POST", "/watch/restore", { key }));
  const dismissFinding = (f: WatchFinding, text: string) =>
    act(() => sendJson("POST", "/watch/dismiss", { key: f.key })).then(() => notify({ text, action: { label: "Ångra", run: () => restoreFinding(f.key) } }));
  const acceptFinding = (f: WatchFinding) =>
    act(() => sendJson("POST", "/watch/accept", { key: f.key })).then(() => notify({ text: `${kr(f.newAmount!)} är det nya beloppet.` }));
  const muteSeries = (f: WatchFinding) =>
    act(() => sendJson("POST", "/watch/mute", { key: f.key })).then(() =>
      notify({ text: "Priset bevakas inte längre.", action: { label: "Ångra", run: () => act(() => sendJson("POST", "/watch/unmute", { series: f.series })) } }),
    );
  const pauseExpense = (expenseId: number, paused: boolean) =>
    act(() => sendJson("PATCH", `/recurring-expenses/${expenseId}`, { paused })).then(() => {
      if (paused) notify({ text: "Utgiften är pausad.", action: { label: "Ångra", run: () => pauseExpense(expenseId, false) } });
    });

  /** Analys › Sparande, where the holdings are. */
  const showHoldings = () => navigate("analysis", { search: "?flik=sparande" });
  // Both of the balance-sheet findings are answered in the same place.
  const showSituation = () => navigate("overview", { search: "?flik=situation" });
  const showPension = () => navigate("overview", { search: "?flik=pension" });

  const watchActions = (f: WatchFinding): { label: string; run: () => void }[] => {
    const show = { label: "Visa", run: () => showRows(f) };
    switch (f.kind) {
      case "price_drift":
        return [
          { label: "Acceptera nytt belopp", run: () => acceptFinding(f) },
          { label: "Varierar – fråga inte", run: () => muteSeries(f) },
        ];
      case "double_charge":
        return [{ label: "Behåll båda", run: () => dismissFinding(f, "Båda raderna står kvar.") }, show];
      case "unusual_amount":
      case "new_merchant":
        return [show];
      case "missed_charge":
        return [
          { label: "Markera betald", run: () => markExpense(f.expenseId!, f.period!, true) },
          // A yearly one not renewed may have been cancelled; a monthly one paused for a while.
          f.yearly ? { label: "Pausa", run: () => pauseExpense(f.expenseId!, true) } : { label: "Drogs inte (pausad)", run: () => markSkipped(f.expenseId!, f.period!, true) },
        ];
      case "subscription_stopped":
        return [{ label: "Pausa", run: () => pauseExpense(f.expenseId!, true) }];
      // A watched subscription drawing again: cancelling it is done at the
      // shop, so what the tool can do is stop counting on it.
      // Sparandet: the answer is in Analys › Sparande, so that is where the
      // button goes. Fetching again is worth a button of its own.
      case "bet_zone_over":
      case "fx_missing":
        return [{ label: "Visa innehaven", run: showHoldings }];
      case "prices_stale":
        return [{ label: "Hämta nu", run: () => act(() => sendJson("POST", "/savings/prices/sync", {})) }, { label: "Visa innehaven", run: showHoldings }];
      // Ekonomisk situation and Pension: the answer is the tab that holds them.
      case "buffer_low":
        return [{ label: "Visa situationen", run: showSituation }];
      case "pension_stale":
      case "pension_forecast_stale":
        return [{ label: "Visa pensionen", run: showPension }];
      // Deklaration: the balance sheet holds the ISK tax; the receipt is read in Importer.
      case "isk_allowance":
        return [{ label: "Visa situationen", run: showSituation }];
      case "tax_return_missing":
        return [{ label: "Läs in kvittensen", run: () => onNavigate("imports") }];
      case "charge_coming":
        return [
          { label: "Pausa", run: () => pauseExpense(f.expenseId!, true) },
          { label: "Behåll", run: () => dismissFinding(f, "Frågan kommer igen inför nästa dragning.") },
        ];
      // Prylar: the thing itself, or the purchase that might be one.
      case "warranty_ending":
      case "return_deadline":
        return [
          {
            label: "Visa prylen",
            run: () => {
              onNavigate("items");
              requestIntent({ kind: "items.open", itemId: f.itemId! });
            },
          },
        ];
      case "maybe_item":
        return [
          { label: "Skapa pryl", run: () => openItemFor(f.transactionId!) },
          { label: "Nej", run: () => dismissFinding(f, "Frågan kommer inte tillbaka för det köpet.") },
        ];
      case "yearly_renewal":
        return f.invoice
          ? [
              { label: "Markera betald", run: () => markExpense(f.expenseId!, f.period!, true) },
              { label: "Påminn inte i år", run: () => dismissFinding(f, "Påminnelsen är borta för i år.") },
            ]
          : [
              { label: "Behåll", run: () => dismissFinding(f, "Den får förnyas. Påminnelsen är borta för i år.") },
              { label: "Avsluta", run: () => pauseExpense(f.expenseId!, true) },
            ];
    }
  };

  const action = (t: OverviewTask): { label: string; run: () => void } => {
    const toggle = () => setExpanded((e) => (e === t.id ? null : t.id));
    switch (t.kind) {
      case "invoice_due":
        return { label: "Markera betald", run: () => markInvoice(t, true) };
      case "amount_changed":
        return { label: expanded === t.id ? "Dölj" : "Visa", run: toggle };
      case "stale_balance":
        return { label: "Uppdatera", run: () => requestIntent({ kind: "overview.editBalance", accountId: t.accountId! }) };
      case "review":
        return { label: "Öppna", run: () => openTransactions({}, "review") };
      case "invoice_missing":
      case "salary_late":
        return { label: "Importera", run: () => onNavigate("imports") };
      case "fuel_shifts":
        return { label: "Fyll i", run: () => onNavigate("commute") };
      case "bank":
        return { label: "Öppna", run: () => openSettings("konton") };
      // The backups are listed under Inställningar › Data, with 'Säkerhetskopiera nu'.
      case "backup":
        return {
          label: "Visa",
          run: () => {
            openSettings("data");
          },
        };
      // Added as a file, not in a form: the tab says how.
      case "reference_budget":
        return { label: "Så gör du", run: () => navigate("analysis", { search: "?flik=konsumentverket" }) };
      case "watch":
        return watchActions(t.finding!)[0];
      case "salary":
        return t.salary?.action === "ack"
          ? { label: "Visa", run: () => act(() => sendJson("POST", "/salary/changes/ack", { month: t.salary!.month })).then(() => openSettings("lon")) }
          : { label: "Öppna Lön", run: () => onNavigate("salary") };
    }
  };

  const restoreButton = hidden > 0 && (
    <button type="button" onClick={restore} className="text-accent hover:text-accent-hover">
      {hidden} {hidden === 1 ? "avfärdad" : "avfärdade"} i dag · visa igen
    </button>
  );

  // Nothing to do: one quiet row with a tick.
  if (visible.length === 0) {
    return (
      <section aria-labelledby="tasks-title" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-wallet bg-card px-[18px] py-3 text-[13px] text-ink shadow-card" data-testid="tasks-empty">
        <span aria-hidden className="flex size-[22px] items-center justify-center rounded-full bg-positive-soft">
          <Check className="size-3 text-positive-text" strokeWidth={3} />
        </span>
        <h2 id="tasks-title" className="font-semibold">
          Att göra
        </h2>
        <span className="text-ink-2">
          Inget just nu
          {restoreButton && <> · {restoreButton}</>}
        </span>
      </section>
    );
  }

  return (
    <section aria-labelledby="tasks-title" className="rounded-card bg-card py-2 text-ink shadow-card">
      <div className="flex items-baseline gap-3 px-5 pb-1 pt-3 sm:px-7">
        <h2 id="tasks-title" className="text-base font-semibold">
          Att göra
          <span className="ml-1.5 font-normal text-ink-2">{visible.length}</span>
        </h2>
        {restoreButton && <span className="text-xs">{restoreButton}</span>}
      </div>
      {(
        <ul className="divide-y divide-hairline">
          <AnimatePresence initial={false}>
          {visible.map((t) => {
            const Icon = iconOf(t);
            const f = t.finding;
            const [a, ...more] = f ? watchActions(f) : [action(t)];
            const urgent = t.kind === "invoice_due" || t.kind === "salary_late" || f?.kind === "missed_charge" || f?.kind === "double_charge" || f?.kind === "return_deadline";
            return (
              <motion.li
                key={t.id}
                data-task={t.kind}
                data-finding={f?.kind}
                layout
                variants={TASK}
                initial={false}
                animate="here"
                exit="gone"
                className="relative overflow-hidden"
              >
                {/* Drawn as the task leaves, over the row it belongs to. */}
                <motion.svg
                  data-check=""
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="pointer-events-none absolute right-6 top-2.5 size-5 text-positive-text"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <motion.path d="M4 12.5 L9.5 18 L20 6.5" variants={CHECK} />
                </motion.svg>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 sm:px-7">
                  <Icon className={cn("size-4 shrink-0", urgent ? "text-caution-text" : "text-ink-2")} aria-hidden />
                  {/* Phones: the text gets the row, the buttons go under it. */}
                  <span className="min-w-0 flex-1 text-sm max-sm:basis-[calc(100%-2.5rem)]">{t.text}</span>
                  <Button size="sm" className="max-sm:ml-7" onClick={a.run} aria-expanded={t.items ? expanded === t.id : undefined}>
                    {a.label}
                    {t.items && <ChevronDown className={cn("transition-transform", expanded === t.id && "rotate-180")} />}
                  </Button>
                  {more.map((m) => (
                    <Button key={m.label} size="sm" variant="ghost" onClick={m.run}>
                      {m.label}
                    </Button>
                  ))}
                  {f ? (
                    <Tooltip content="Avfärda – kommer inte tillbaka">
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Avfärda: ${t.text}`} onClick={() => dismissFinding(f, "Avfärdad.")}>
                        <X />
                      </Button>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Avfärda för i dag">
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Avfärda för i dag: ${t.text}`} onClick={() => dismiss(t.id)}>
                        <X />
                      </Button>
                    </Tooltip>
                  )}
                </div>
                {expanded === t.id && t.items && (
                  <div className="mx-5 mb-2 rounded-inset bg-card-inset px-4 py-2 sm:mx-7">
                    <ul className="space-y-1 text-sm">
                      {t.items.map((i) => (
                        <li key={i.expenseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7">
                          <span className="min-w-0 flex-1">
                            {i.name}
                            {i.latest !== undefined && (
                              <span className="ml-2 text-xs text-ink-2">
                                drogs {kr(i.latest)}, utgiften säger {kr(i.amount)}
                              </span>
                            )}
                          </span>
                          {i.latest === undefined && <Amount ore={-i.amount} size="sm" whole />}
                          {t.kind === "amount_changed" && i.latest !== undefined && (
                            <Button size="sm" onClick={() => acceptAmount(i.expenseId)}>
                              Använd {kr(i.latest)}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => onNavigate("recurring")} className="mt-2 pl-7 text-xs text-accent hover:text-accent-hover">
                      Öppna Fasta utgifter
                    </button>
                  </div>
                )}
              </motion.li>
            );
          })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
