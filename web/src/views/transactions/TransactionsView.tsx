import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { EyeOff, Inbox, Keyboard, PenLine, StickyNote, Tag, Trash2, User, UserRound, Users, CircleHelp } from "lucide-react";
import { getJson, type LabelRuleSuggestion, type RuleSuggestion, type Transaction, type TransactionList as ListResponse } from "../../api";
import { useShowPrivate } from "../../privacy";
import { BulkActionBar } from "../../components/BulkActionBar";
import { CategoryPicker } from "../../components/CategoryPicker";
import { DateGroupHeader } from "../../components/DateGroupHeader";
import { EmptyState } from "../../components/EmptyState";
import { KeyHint } from "../../components/KeyHint";
import { Button } from "../../components/ui/button";
import { HeaderActions } from "../../shell/PageHeader";
import { isTyping } from "../../shell/hotkeys";
import { rememberTransactionsSearch, setSearch, useSearch } from "../../shell/routes";
import {
  apiQuery,
  activeCount,
  addMonths,
  currentMonth,
  defaultFilters,
  extendOlder,
  monthLabel,
  parseFilters,
  periodLabel,
  serializeFilters,
  stepPeriod,
  type Filters,
} from "./filters";
import { FilterChips, PeriodPicker, SearchBox } from "./TxFilters";
import { TxRow, type InlineField } from "./TxRow";
import { collapsing, useListEntrance } from "../../lib/motion";
import { Entering } from "../../components/Entering";
import { TxPanel } from "./TxPanel";
import { BulkLabelDialog, BulkNoteDialog } from "./editors";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useTxActions } from "./useTxActions";
import type { PageContext } from "./TransactionsPage";
import { TransactionsSkeleton, TransactionsSummarySkeleton } from "../skeletons";
import { SummaryCards } from "./summary/SummaryCards";
import { todayIso } from "../../lib/today";
import { useWidth } from "../../lib/useWidth";

type Item =
  | { kind: "header"; key: string; date: string; total: number }
  | { kind: "row"; key: string; row: Transaction; pair?: Transaction; masked: boolean };

const counted = (r: Transaction) => !r.isTransfer && !r.isSettlement && r.returnGroupId === null;
/** How far below the top the sticky day header reaches (rows scrolled to stay clear of it). */
const HEADER_H = 33;
/** How long a day picked among the bars stays lit. */
const FLASH_MS = 1600;

const MONTH_NAMES = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];
const isMonth = (period: string) => /^\d{4}-\d{2}$/.test(period);

/** The summary's title: 'September' (with the year when it isn't this one), else the period as the picker says it. */
function summaryTitle(f: Filters): string {
  if (!isMonth(f.period)) {
    const label = periodLabel(f);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const name = MONTH_NAMES[Number(f.period.slice(5)) - 1];
  return f.period.slice(0, 4) === currentMonth().slice(0, 4) ? name : `${name} ${f.period.slice(0, 4)}`;
}

/**
 * The transaction list: grouped per day, virtualised, filters in the URL,
 * a detail panel, bulk actions and a keyboard for everything (see '?').
 */
export function TransactionsView({ ctx }: { ctx: PageContext }) {
  const search = useSearch();
  const filters = useMemo(() => parseFilters(search), [search]);
  const showPrivate = useShowPrivate();
  const update = useCallback((patch: Partial<Filters>, opts: { replace?: boolean } = {}) => {
    const next = serializeFilters({ ...parseFilters(window.location.search), ...patch });
    rememberTransactionsSearch(next);
    setSearch(next, opts);
  }, []);
  useEffect(() => rememberTransactionsSearch(search), [search]);

  // ---------- data ----------
  const [data, setData] = useState<ListResponse | null>(null);
  const [local, setLocal] = useState<Map<number, Transaction>>(new Map());
  const query = apiQuery(filters, showPrivate);
  const req = useRef(0);
  const reload = useCallback(() => {
    const n = ++req.current;
    getJson<ListResponse>(`/transactions?${query}`).then((d) => {
      if (n !== req.current) return;
      setData(d);
      setLocal(new Map());
    });
  }, [query]);
  useEffect(reload, [reload]);
  // 'Utan kategori · N': the rows without a category in the period, with the other filters (not the categories). Again after every reload.
  const [uncategorized, setUncategorized] = useState<number | null>(null);
  const uncategorizedQuery = apiQuery({ ...filters, categories: [], uncategorized: true, includeUnknown: false, sort: "newest" }, showPrivate);
  useEffect(() => {
    if (filters.uncategorized || !data) return;
    let live = true;
    getJson<ListResponse>(`/transactions?${uncategorizedQuery}&limit=1`).then(
      (d) => live && setUncategorized(d.totals.count),
      () => live && setUncategorized(null),
    );
    return () => {
      live = false;
    };
  }, [uncategorizedQuery, filters.uncategorized, data]);
  const applyLocal = useCallback((t: Transaction) => setLocal((m) => new Map(m).set(t.id, t)), []);

  const settlementIds = useMemo(() => new Set(ctx.categories.filter((c) => c.isSettlement).map((c) => c.id)), [ctx.categories]);
  const rows = useMemo(
    () =>
      (data?.rows ?? []).map((r) => {
        const t = local.get(r.id) ?? r;
        return { ...t, isSettlement: t.categoryId !== null && settlementIds.has(t.categoryId) };
      }),
    [data, local, settlementIds],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const masked = useCallback((r: Transaction) => r.private && !showPrivate, [showPrivate]);

  // Days with their rows; a transfer whose both legs are listed becomes one row.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const legs = new Map<number, Transaction[]>();
    if (filters.transfers) for (const r of rows) if (r.transferPairId) legs.set(r.transferPairId, [...(legs.get(r.transferPairId) ?? []), r]);
    let day = "";
    let headerAt = -1;
    for (const r of rows) {
      const pairLegs = r.transferPairId ? legs.get(r.transferPairId) : undefined;
      const pair = pairLegs?.length === 2 ? pairLegs.find((x) => x.id !== r.id) : undefined;
      if (pair && r.amount > 0) continue; // shown with the outgoing leg
      if (r.bookingDate !== day) {
        day = r.bookingDate;
        headerAt = out.push({ kind: "header", key: `h-${day}`, date: day, total: 0 }) - 1;
      }
      if (counted(r)) (out[headerAt] as { total: number }).total += r.amount;
      out.push({ kind: "row", key: `r-${r.id}`, row: r, pair, masked: masked(r) });
    }
    return out;
  }, [rows, filters.transfers, masked]);
  const navigable = useMemo(
    () => items.filter((i): i is Extract<Item, { kind: "row" }> => i.kind === "row" && !i.masked).map((i) => i.row),
    [items],
  );

  // ---------- state ----------
  const [activeId, setActiveId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rangeFrom = useRef<number | null>(null);
  const [panelId, setPanelId] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ ids: number[]; anchor: HTMLElement | null; value: number | null } | null>(null);
  const [editing, setEditing] = useState<{ id: number; field: InlineField } | null>(null);
  const [bulkNote, setBulkNote] = useState<Transaction[] | null>(null);
  const [bulkLabel, setBulkLabel] = useState<Transaction[] | null>(null);
  // The question under a row after a change: a category rule, or a name rule after renaming.
  const [prompt, setPrompt] = useState<
    { rowId: number; kind: "category"; suggestion: RuleSuggestion } | { rowId: number; kind: "label"; suggestion: LabelRuleSuggestion } | null
  >(null);
  const [help, setHelp] = useState(false);
  // Rows on their way out: they collapse before the list reloads without them.
  const [leaving, setLeaving] = useState<readonly number[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // New filters: start over.
  useEffect(() => {
    setActiveId(null);
    setSelected(new Set());
    setPanelId(null);
    setPrompt(null);
    setEditing(null);
  }, [search]);
  // Drop selected rows that left the list.
  useEffect(() => {
    setSelected((s) => (s.size && [...s].some((id) => !byId.has(id)) ? new Set([...s].filter((id) => byId.has(id))) : s));
  }, [byId]);
  // The rule question goes away by itself after 8 s.
  useEffect(() => {
    if (!prompt) return;
    const t = setTimeout(() => setPrompt(null), 8000);
    return () => clearTimeout(t);
  }, [prompt]);

  const onRuleSuggestion = useCallback((rowId: number, suggestion: RuleSuggestion) => setPrompt({ rowId, kind: "category", suggestion }), []);
  const onLabelRuleSuggestion = useCallback((rowId: number, suggestion: LabelRuleSuggestion) => setPrompt({ rowId, kind: "label", suggestion }), []);
  const actions = useTxActions({ ctx, applyLocal, reload, onRuleSuggestion, onLabelRuleSuggestion, onLeaving: setLeaving });
  const acceptPrompt = () => {
    if (!prompt) return;
    if (prompt.kind === "category") actions.createRule(prompt.suggestion);
    else {
      const row = byId.get(prompt.rowId);
      if (row) actions.saveLabelRule([row], prompt.suggestion.label, prompt.suggestion.pattern);
    }
    setPrompt(null);
  };

  // ---------- virtual list ----------
  const listRef = useRef<HTMLDivElement | null>(null);
  // The list's own width: under about 600 px the rows add a phone's line under the name (it shows under 560 px).
  const [measureList, listWidth] = useWidth(1000);
  const setList = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      measureList(el);
    },
    [measureList],
  );
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const m = Math.round((listRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    if (m !== margin) setMargin(m);
  });
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) => (items[i].kind === "header" ? HEADER_H : 56),
    overscan: 12,
    scrollMargin: margin,
    getItemKey: (i) => items[i].key,
  });
  const indexOfRow = useMemo(() => new Map(items.map((it, i) => [it.kind === "row" ? it.row.id : -1, i])), [items]);
  // A new filter or period (and the first rows arriving) lets the list come in.
  const entrance = useListEntrance(`${query}|${data ? "1" : "0"}`);

  const ensureVisible = useCallback(
    (id: number) => {
      const i = indexOfRow.get(id);
      if (i === undefined) return;
      const m = virtualizer.measurementsCache[i];
      if (!m) return virtualizer.scrollToIndex(i, { align: "center" });
      const top = m.start; // document coordinates (the scroll margin is included)
      const bottom = top + m.size;
      const bottomPad = selected.size ? 80 : 16;
      if (top < window.scrollY + HEADER_H) window.scrollTo({ top: top - HEADER_H - 4 });
      else if (bottom > window.scrollY + window.innerHeight - bottomPad) window.scrollTo({ top: bottom - window.innerHeight + bottomPad });
    },
    [indexOfRow, virtualizer, selected.size],
  );

  // A day picked in 'Utgifter per dag': its header to the top, lit up for a moment.
  const [flashDay, setFlashDay] = useState<string | null>(null);
  const scrollToDay = useCallback(
    (date: string) => {
      const i = items.findIndex((it) => it.kind === "header" && it.date === date);
      if (i === -1) return;
      virtualizer.scrollToIndex(i, { align: "start" });
      setFlashDay(date);
    },
    [items, virtualizer],
  );
  useEffect(() => {
    if (!flashDay) return;
    const t = setTimeout(() => setFlashDay(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flashDay]);

  // ---------- actions on the keyboard's targets ----------
  const active = activeId !== null ? byId.get(activeId) ?? null : null;
  const targets = useCallback(
    (): Transaction[] =>
      selected.size ? rows.filter((r) => selected.has(r.id) && !masked(r)) : active && !masked(active) ? [active] : [],
    [selected, rows, active, masked],
  );

  const activate = useCallback(
    (id: number, open = false) => {
      setActiveId(id);
      if (open || panelId !== null) setPanelId(id);
    },
    [panelId],
  );
  const move = (delta: number | "first" | "last") => {
    if (!navigable.length) return;
    let at = activeId === null ? -1 : navigable.findIndex((r) => r.id === activeId);
    let from = at;
    if (at === -1 && activeId !== null && typeof delta === "number") {
      // The active row just left the navigable rows (made private and hidden):
      // continue from where it was in the list.
      const pos = rows.findIndex((r) => r.id === activeId);
      const after = navigable.findIndex((r) => rows.indexOf(r) > pos);
      if (pos !== -1) {
        at = after === -1 ? navigable.length : after;
        from = delta > 0 ? at - 1 : at;
      }
    }
    const next =
      delta === "first"
        ? 0
        : delta === "last"
          ? navigable.length - 1
          : at === -1
            ? delta > 0
              ? 0
              : navigable.length - 1
            : Math.min(navigable.length - 1, Math.max(0, from + delta));
    const id = navigable[next].id;
    activate(id);
    requestAnimationFrame(() => ensureVisible(id));
  };

  const toggleSelect = useCallback(
    (id: number, range: boolean) => {
      // Read the anchor now: the updater below runs later, after it has moved.
      const from = rangeFrom.current;
      setSelected((s) => {
        const next = new Set(s);
        if (range && from !== null) {
          const a = navigable.findIndex((r) => r.id === from);
          const b = navigable.findIndex((r) => r.id === id);
          if (a !== -1 && b !== -1) {
            for (const r of navigable.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(r.id);
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      rangeFrom.current = id;
      setActiveId(id);
    },
    [navigable],
  );

  const openPicker = useCallback(
    (ids: number[], anchor: HTMLElement | null) => {
      if (!ids.length) return;
      setPicker({ ids, anchor, value: ids.length === 1 ? (byId.get(ids[0])?.categoryId ?? null) : null });
    },
    [byId],
  );
  const pickerForTargets = () => {
    const t = targets();
    if (!t.length) return;
    const anchor =
      (selected.size ? document.querySelector<HTMLElement>('[data-bulk-action="Kategori"]') : null) ??
      (panelId === t[0].id && t.length === 1 ? document.querySelector<HTMLElement>("[data-panel-category]") : null) ??
      document.querySelector<HTMLElement>(`[data-row-id="${t[0].id}"] [data-category-chip]`) ??
      document.querySelector<HTMLElement>(`[data-row-id="${t[0].id}"]`);
    openPicker(
      t.map((r) => r.id),
      anchor,
    );
  };

  const remove = (t: Transaction[]) => {
    if (!t.length) return;
    // Keep the cursor where it was: on the row after (or before) the removed ones.
    const gone = new Set(t.map((r) => r.id));
    const at = navigable.findIndex((r) => r.id === (activeId ?? t[0].id));
    const next = navigable.slice(at + 1).find((r) => !gone.has(r.id)) ?? navigable.slice(0, Math.max(at, 0)).reverse().find((r) => !gone.has(r.id));
    setActiveId(next?.id ?? null);
    if (panelId !== null && gone.has(panelId)) setPanelId(next?.id ?? null);
    setSelected(new Set());
    actions.remove(t, showPrivate);
  };

  const onEditDone = useCallback(
    (id: number, field: InlineField, value: string | null) => {
      setEditing(null);
      const r = byId.get(id);
      if (!r || value === null) return;
      if (field === "note" && value !== (r.note ?? "")) actions.patch(r, { note: value });
      if (field === "label" && value !== (r.label ?? "") && (value || r.source !== "manual")) actions.patch(r, { label: value || null });
    },
    [byId, actions],
  );

  // ---------- keyboard ----------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e.target) || picker || help || bulkNote || bulkLabel) return;
    // Another dialog or popover (⌘K, 'Fler filter', a confirm) has the keyboard.
    if (document.querySelector('[role="dialog"][data-state="open"]:not([data-side-panel])')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      if (e.key.toLowerCase() === "a" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSelected(new Set(navigable.map((r) => r.id)));
      }
      return;
    }
    if (e.altKey) return;
    const k = e.key;
    const handled = () => e.preventDefault();
    switch (k) {
      case "ArrowDown":
      case "j":
        handled();
        return move(1);
      case "ArrowUp":
      case "k":
        handled();
        return move(-1);
      case "Home":
        handled();
        return move("first");
      case "End":
        handled();
        return move("last");
      case "Enter":
        if (active) {
          handled();
          setPanelId(active.id);
        }
        return;
      case "Escape":
        if (panelId !== null) return setPanelId(null);
        if (prompt) return setPrompt(null);
        if (selected.size) return setSelected(new Set());
        return;
      case "x":
        if (active) {
          handled();
          toggleSelect(active.id, false);
        }
        return;
      case "X":
        if (active) {
          handled();
          toggleSelect(active.id, true);
        }
        return;
      case "c":
        handled();
        return pickerForTargets();
      case "s":
        handled();
        return targets().length ? actions.toggleShared(targets()) : undefined;
      case "p":
        handled();
        return targets().length ? actions.togglePrivate(targets()) : undefined;
      case "u":
        handled();
        return targets().length ? actions.unknown(targets()) : undefined;
      case "d":
      case "Delete":
      case "Backspace":
        handled();
        return remove(targets());
      case "n":
      case "l":
        if (selected.size) {
          handled();
          return k === "n" ? setBulkNote(targets()) : setBulkLabel(targets());
        }
        if (active && !masked(active)) {
          handled();
          ensureVisible(active.id);
          setEditing({ id: active.id, field: k === "n" ? "note" : "label" });
        }
        return;
      case "r":
        if (prompt) {
          handled();
          acceptPrompt();
        }
        return;
      case "ArrowLeft":
      case "ArrowRight":
        handled();
        return update(stepPeriod(filters, k === "ArrowLeft" ? -1 : 1));
      case "t":
        handled();
        return update({ period: currentMonth(), from: "", to: "" });
      case "/":
        handled();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
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

  // ---------- render ----------
  const accountName = useCallback((id: number | null) => ctx.accounts.find((a) => a.id === id)?.name ?? null, [ctx.accounts]);
  const accountKind = useCallback((id: number | null) => ctx.accounts.find((a) => a.id === id)?.kind ?? null, [ctx.accounts]);
  const onActivate = useCallback((id: number, open: boolean) => activate(id, open), [activate]);
  const onOpenPicker = useCallback((id: number, anchor: HTMLElement) => {
    setActiveId(id);
    openPicker([id], anchor);
  }, [openPicker]);
  const onToggleShared = useCallback((id: number) => byId.has(id) && actions.toggleShared([byId.get(id)!]), [byId, actions]);
  const onTogglePrivate = useCallback((id: number) => byId.has(id) && actions.togglePrivate([byId.get(id)!]), [byId, actions]);
  const acceptRef = useRef(acceptPrompt);
  acceptRef.current = acceptPrompt;
  const onRule = useCallback((accept: boolean) => (accept ? acceptRef.current() : setPrompt(null)), []);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const offset = virtualizer.scrollOffset !== null ? virtualizer.scrollOffset - margin : 0;
  const stickyHeader =
    offset > 0
      ? (items
          .slice(0, (virtualizer.getVirtualItems().find((v) => v.end - margin > offset + 1)?.index ?? 0) + 1)
          .reverse()
          .find((i) => i.kind === "header") as Extract<Item, { kind: "header" }> | undefined)
      : undefined;
  const older = extendOlder(filters);
  const panelRow = panelId !== null ? byId.get(panelId) ?? null : null;
  const hasFilters = activeCount(filters) > 0;
  // 'Rensa' keeps the period and the order.
  function clearFilters() {
    update({ ...defaultFilters(), period: filters.period, from: filters.from, to: filters.to, sort: filters.sort });
  }

  return (
    <div className="space-y-3">
      <HeaderActions>
        <PeriodPicker filters={filters} update={update} onStep={(s) => update(stepPeriod(filters, s))} />
        <SearchBox ref={searchRef} value={filters.q} onChange={(q) => update({ q }, { replace: true })} />
        <KeyHint label="Kortkommandon" keys={["?"]}>
          <Button variant="ghost" size="icon" onClick={() => setHelp(true)} aria-label="Kortkommandon" className="size-9 rounded-[10px] text-ink-2 hover:bg-segment pointer-coarse:hidden">
            <Keyboard />
          </Button>
        </KeyHint>
      </HeaderActions>

      {!data && <TransactionsSummarySkeleton />}
      {data && <SummaryCards totals={data.totals} title={summaryTitle(filters)} month={isMonth(filters.period) ? filters.period : null} today={todayIso()} onPickDay={scrollToDay} />}

      <FilterChips filters={filters} update={update} ctx={ctx} onClear={clearFilters} uncategorized={filters.uncategorized ? (data?.totals.count ?? null) : uncategorized} />

      {!data ? (
        <TransactionsSkeleton />
      ) : rows.length === 0 ? (
        <div className="rounded-card bg-card shadow-card">
          <EmptyState
            icon={Inbox}
            title="Inga transaktioner"
            action={
              hasFilters ? (
                <Button onClick={clearFilters}>Rensa filtren</Button>
              ) : older ? (
                <Button onClick={() => update(older)}>Visa {monthLabel(addMonths(filters.period === "range" ? filters.from.slice(0, 7) : filters.period, -1), true)}</Button>
              ) : undefined
            }
          >
            {hasFilters ? "Inget matchar filtren för perioden." : "Inget importerat för perioden. ← och → byter månad."}
          </EmptyState>
        </div>
      ) : (
        // One white card: the days and rows, and 'Visa äldre' at the bottom.
        <div className="overflow-clip rounded-card bg-card text-ink shadow-card">
          <div
            ref={setList}
            role="grid"
            aria-label="Transaktioner"
            aria-rowcount={navigable.length}
            className="@container relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            <div className="sticky top-0 z-20 h-0">
              {stickyHeader && <DateGroupHeader date={stickyHeader.date} total={stickyHeader.total} flash={stickyHeader.date === flashDay} className="border-t-0 border-b border-b-hairline" />}
            </div>
            {virtualizer.getVirtualItems().map((v) => {
              const it = items[v.index];
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${v.start - margin}px)` }}
                >
                  <Entering index={v.index} entrance={entrance} {...(it.kind === "row" && leaving.includes(it.row.id) ? collapsing : {})}>
                  {it.kind === "header" ? (
                    <DateGroupHeader date={it.date} total={it.total} flash={it.date === flashDay} className={v.index === 0 ? "border-t-0" : undefined} />
                  ) : (
                    <TxRow
                      row={it.row}
                      pair={it.pair}
                      masked={it.masked}
                    compact={listWidth < 600}
                      accountName={accountName}
                      accountKind={accountKind}
                      partnerName={ctx.partnerName}
                      active={it.row.id === activeId}
                      selected={selected.has(it.row.id)}
                      editing={editing?.id === it.row.id ? editing.field : null}
                      rulePrompt={
                        prompt?.rowId === it.row.id && prompt.kind === "category"
                          ? { suggestion: prompt.suggestion, categoryLabel: actions.categoryName(prompt.suggestion.categoryId) }
                          : null
                      }
                      labelPrompt={prompt?.rowId === it.row.id && prompt.kind === "label" ? prompt.suggestion : null}
                      onActivate={onActivate}
                      onToggleSelect={toggleSelect}
                      onOpenPicker={onOpenPicker}
                      onToggleShared={onToggleShared}
                      onTogglePrivate={onTogglePrivate}
                      onOpenRecurring={ctx.openRecurring}
                      onEditDone={onEditDone}
                      onRule={onRule}
                    />
                  )}
                  </Entering>
                </div>
              );
            })}
          </div>
          {older && (
            <button type="button" onClick={() => update(older)} className="block w-full border-t border-hairline py-3.5 text-center text-[13px] font-medium text-accent hover:underline">
              Visa äldre · {monthLabel(older.from.slice(0, 7), true)}
            </button>
          )}
        </div>
      )}

      {data?.truncated && <p className="text-sm text-warning">Visar de första {data.rows.length} raderna. Välj en kortare period.</p>}

      <BulkActionBar
        count={selectedRows.length}
        sum={selectedRows.reduce((s, r) => s + r.amount, 0)}
        onClear={() => setSelected(new Set())}
        actions={[
          { label: "Kategori", icon: <Tag />, keys: ["c"], onClick: pickerForTargets },
          { label: "Delad", icon: <Users />, keys: ["s"], onClick: () => actions.setOwner(selectedRows, "shared") },
          { label: "Egen", icon: <UserRound />, onClick: () => actions.setOwner(selectedRows, "own") },
          { label: `${ctx.partnerName}s`, icon: <User />, onClick: () => actions.setOwner(selectedRows, "partner") },
          { label: "Namn", icon: <PenLine />, keys: ["l"], onClick: () => setBulkLabel(selectedRows.filter((r) => !masked(r))) },
          { label: "Anteckning", icon: <StickyNote />, keys: ["n"], onClick: () => setBulkNote(selectedRows.filter((r) => !masked(r))) },
          { label: "Privat", icon: <EyeOff />, keys: ["p"], onClick: () => actions.togglePrivate(selectedRows) },
          { label: "Vet ej", icon: <CircleHelp />, keys: ["u"], onClick: () => actions.unknown(selectedRows) },
          { label: "Ta bort", icon: <Trash2 />, keys: ["d"], danger: true, onClick: () => remove(selectedRows) },
        ]}
      />

      <BulkLabelDialog rows={bulkLabel} onClose={() => setBulkLabel(null)} onSave={(t, label, pattern) => (pattern ? actions.saveLabelRule(t, label, pattern) : actions.setLabel(t, label))} />
      <BulkNoteDialog rows={bulkNote} onClose={() => setBulkNote(null)} onSave={(t, note) => actions.setNote(t, note)} />

      <CategoryPicker
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        anchor={picker?.anchor ?? null}
        rowIds={picker?.ids ?? []}
        value={picker?.value ?? null}
        title={picker && picker.ids.length > 1 ? `Kategori för ${picker.ids.length} rader` : "Välj kategori"}
        onPick={(c) => {
          const t = (picker?.ids ?? []).map((id) => byId.get(id)).filter((r): r is Transaction => !!r);
          setPicker(null);
          if (t.length) actions.setCategory(t, c);
        }}
      />

      <TxPanel
        row={panelRow}
        ctx={ctx}
        actions={actions}
        showPrivate={showPrivate}
        onClose={() => setPanelId(null)}
        onOpenPicker={(anchor) => panelRow && openPicker([panelRow.id], anchor)}
        onChanged={reload}
        onNameRule={(r) => setBulkLabel([r])}
      />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </div>
  );
}
