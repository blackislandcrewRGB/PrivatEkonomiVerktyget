import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Repeat } from "lucide-react";
import { getJson, sendJson, type Account, type ExpenseEstimates, type RecurringExpense } from "../../api";
import { SHARE_OPTIONS, useShare } from "../../lib/share";
import { EmptyState } from "../../components/EmptyState";
import { KeyHint } from "../../components/KeyHint";
import { SegmentedControl } from "../../components/SegmentedControl";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { usePersistentState } from "../../usePersistentState";
import { isTyping } from "../../shell/hotkeys";
import { useIntent } from "../../shell/intents";
import { HeaderActions } from "../../shell/PageHeader";
import { setSearch, useSearch } from "../../shell/routes";
import { ShortcutsDialog, type ShortcutGroups } from "../transactions/ShortcutsDialog";
import { ExpensePanel, type ExpensePatch } from "./ExpensePanel";
import { ExpenseTable } from "./ExpenseTable";
import { MonthCalendar, shiftMonth } from "./MonthCalendar";
import { groupByAccount, todayIso } from "./model";
import { Hero } from "./hero/Hero";
import { Estimates } from "./Estimates";
import { RecurringSkeleton } from "../skeletons";

export const RECURRING_SHORTCUTS: ShortcutGroups = [
  {
    group: "Lista",
    items: [
      { keys: [["↓"], ["j"]], label: "Nästa utgift" },
      { keys: [["↑"], ["k"]], label: "Föregående utgift" },
      { keys: [["enter"]], label: "Öppna panelen med alla fält (följer med när du flyttar)" },
      { keys: [["esc"]], label: "Stäng panelen" },
      { keys: [["n"]], label: "Ny fast utgift" },
    ],
  },
  {
    group: "Vy",
    items: [
      { keys: [["v"]], label: "Lista / kalender" },
      { keys: [["←"], ["→"]], label: "Föregående / nästa månad (kalendern)" },
      { keys: [["t"]], label: "Den här månaden (kalendern)" },
      { keys: [["?"]], label: "Den här rutan" },
    ],
  },
];

/**
 * Fasta utgifter: the hero (the month against the salary, this month's draws, Eget and Årsvis), the expenses as a read-only table per
 * account (or a month calendar), food and fuel as estimates, and a side panel
 * with every field. 'Min del | Hushållet' (app-wide) halves shared expenses. The view
 * and the calendar's month live in the URL (?vy=kalender&manad=2026-10).
 */
export function RecurringView({ focusId = null, onFocused }: { focusId?: number | null; onFocused?: () => void } = {}) {
  const [expenses, setExpenses] = useState<RecurringExpense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<number | "new" | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [folded, setFolded] = useFoldedGroups();
  const [share, setShare] = useShare();
  const [estimates, setEstimates] = useState<ExpenseEstimates | null>(null);

  const params = new URLSearchParams(useSearch());
  const mode = params.get("vy") === "kalender" ? "calendar" : "list";
  const month = /^\d{4}-\d{2}$/.test(params.get("manad") ?? "") ? params.get("manad")! : todayIso().slice(0, 7);
  const setView = (next: { mode?: "list" | "calendar"; month?: string }) => {
    const m = next.mode ?? mode;
    const p = new URLSearchParams();
    if (m === "calendar") {
      p.set("vy", "kalender");
      const mm = next.month ?? month;
      if (mm !== todayIso().slice(0, 7)) p.set("manad", mm);
    }
    const s = p.toString();
    setSearch(s ? `?${s}` : "", { replace: next.month !== undefined });
  };

  const reload = useCallback(async () => {
    const [e, a] = await Promise.all([getJson<RecurringExpense[]>("/recurring-expenses"), getJson<Account[]>("/accounts")]);
    setExpenses(e);
    setAccounts(a);
    setLoaded(true);
    getJson<ExpenseEstimates>("/recurring-expenses/estimates").then(setEstimates, () => setEstimates(null));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const save = (id: number, patch: ExpensePatch) => run(() => sendJson("PATCH", `/recurring-expenses/${id}`, patch));
  const acceptAmount = (id: number) => run(() => sendJson("POST", `/recurring-expenses/${id}/accept-latest-amount`, {}));
  const create = async (values: ExpensePatch) => {
    setError(null);
    try {
      const created = await sendJson<RecurringExpense>("POST", "/recurring-expenses", values);
      await reload();
      setPanel(created.id);
      setActiveId(created.id);
      notify({ text: `${created.name} är tillagd.` });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const mark = async (e: RecurringExpense, paid: boolean) => {
    // A yearly one: this year's draw.
    const current = e.thisMonth ?? e.thisYear;
    if (!current) return;
    const period = current.period;
    if (await run(() => sendJson("PUT", `/recurring-expenses/${e.id}/marks/${period}`, { paid }))) {
      if (paid) notify({ text: `${e.name} är markerad som betald för perioden.`, action: { label: "Ångra", run: () => mark(e, false) } });
    }
  };
  const remove = async (e: RecurringExpense) => {
    if (!confirm(`Ta bort "${e.name}"? Kopplade transaktioner finns kvar men kopplas loss.`)) return;
    if (await run(() => sendJson("DELETE", `/recurring-expenses/${e.id}`, {}))) {
      setPanel(null);
      notify({ text: `${e.name} är borttagen.` });
    }
  };

  useIntent("recurring.new", () => setPanel("new"));

  const groups = useMemo(() => groupByAccount(expenses, accounts), [expenses, accounts]);
  const navigable = useMemo(() => groups.filter((g) => !folded.keys.includes(g.key)).flatMap((g) => g.items), [groups, folded]);
  const toggleGroup = (key: string) =>
    setFolded((f) => ({ keys: f.keys.includes(key) ? f.keys.filter((k) => k !== key) : [...f.keys, key] }));

  const open = useCallback((id: number) => {
    setActiveId(id);
    setPanel(id);
  }, []);

  // Opened from a transaction's '↻' link: open that expense and scroll to it.
  useEffect(() => {
    if (focusId == null || !loaded) return;
    const e = expenses.find((x) => x.id === focusId);
    if (e) {
      const g = groups.find((x) => x.items.includes(e));
      if (g && folded.keys.includes(g.key)) toggleGroup(g.key);
      open(focusId);
      requestAnimationFrame(() => document.getElementById(`expense-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    }
    onFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loaded]);

  // ---------- keyboard ----------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || help) return;
    if (document.querySelector('[role="dialog"][data-state="open"]:not([data-side-panel])')) return;
    const handled = () => e.preventDefault();
    const move = (step: number) => {
      if (!navigable.length) return;
      const i = navigable.findIndex((x) => x.id === activeId);
      const next = navigable[i < 0 ? (step > 0 ? 0 : navigable.length - 1) : Math.max(0, Math.min(navigable.length - 1, i + step))];
      setActiveId(next.id);
      if (panel !== null && panel !== "new") setPanel(next.id);
      document.getElementById(`expense-${next.id}`)?.scrollIntoView({ block: "nearest" });
    };
    switch (e.key) {
      case "ArrowDown":
      case "j":
        if (mode !== "list") return;
        handled();
        return move(1);
      case "ArrowUp":
      case "k":
        if (mode !== "list") return;
        handled();
        return move(-1);
      case "Enter":
        if (mode === "list" && activeId !== null) {
          handled();
          setPanel(activeId);
        }
        return;
      case "Escape":
        if (panel !== null) setPanel(null);
        return;
      case "n":
        handled();
        return setPanel("new");
      case "v":
        handled();
        return setView({ mode: mode === "list" ? "calendar" : "list" });
      case "ArrowLeft":
      case "ArrowRight":
        if (mode !== "calendar") return;
        handled();
        return setView({ month: shiftMonth(month, e.key === "ArrowLeft" ? -1 : 1) });
      case "t":
        if (mode !== "calendar") return;
        handled();
        return setView({ month: todayIso().slice(0, 7) });
      case "?":
        handled();
        return setHelp(true);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!loaded) return <RecurringSkeleton />;
  const panelExpense = typeof panel === "number" ? (expenses.find((e) => e.id === panel) ?? null) : null;

  return (
    <div className="space-y-6">
      <HeaderActions>
        <SegmentedControl label="Vems utgifter" options={SHARE_OPTIONS} value={share} onChange={setShare} size="sm" appearance="v2" />
        <SegmentedControl
          label="Visa som"
          size="sm"
          appearance="v2"
          options={[
            { value: "list", label: "Lista" },
            { value: "calendar", label: "Kalender" },
          ]}
          value={mode}
          onChange={(m) => setView({ mode: m })}
        />
        <KeyHint keys={["n"]} label="Ny fast utgift">
          <Button size="sm" onClick={() => setPanel("new")} className="h-8 rounded-[10px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
            <Plus /> Ny fast utgift
          </Button>
        </KeyHint>
      </HeaderActions>
      {error && <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>}

      {expenses.length === 0 ? (
        <EmptyState icon={Repeat} title="Inga fasta utgifter ännu" action={<Button variant="primary" onClick={() => setPanel("new")}>Ny fast utgift</Button>}>
          Hyra, abonnemang, försäkringar och räkningar som kommer varje månad eller år. Lägg in dem en och en: redan importerade transaktioner kopplas automatiskt bakåt i tiden.
        </EmptyState>
      ) : (
        <>
          <Hero expenses={expenses} share={share} estimates={estimates} />
          {mode === "list" ? (
            <ExpenseTable
              groups={groups}
              share={share}
              accounts={accounts}
              activeId={activeId}
              collapsed={folded.keys}
              onToggleGroup={toggleGroup}
              onOpen={open}
            />
          ) : (
            <MonthCalendar month={month} onMonth={(m) => setView({ month: m })} expenses={expenses} accounts={accounts} share={share} onOpen={open} />
          )}
          {estimates && <Estimates data={estimates} share={share} onChanged={setEstimates} />}
        </>
      )}

      <ExpensePanel
        expense={panelExpense}
        isNew={panel === "new"}
        accounts={accounts}
        expenses={expenses}
        onClose={() => setPanel(null)}
        onSave={save}
        onCreate={create}
        onAcceptAmount={acceptAmount}
        onMark={mark}
        onRemove={remove}
        onChanged={reload}
      />
      <ShortcutsDialog open={help} onOpenChange={setHelp} title="Kortkommandon i Fasta utgifter" groups={RECURRING_SHORTCUTS} />
    </div>
  );
}

const FOLDED_KEY = "recurring.collapsed";

/** The folded groups, remembered on this device (localStorage) group by group; nothing when storage is blocked. */
function useFoldedGroups() {
  const [folded, setFolded] = useState<{ keys: string[] }>(() => {
    try {
      const keys: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]");
      return { keys: Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [] };
    } catch {
      return { keys: [] };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(folded.keys));
    } catch {
      // Not remembered; fine.
    }
  }, [folded]);
  return [folded, setFolded] as const;
}

