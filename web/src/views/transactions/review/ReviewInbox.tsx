import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Keyboard } from "lucide-react";
import { getJson, sendJson, type ReviewGroups, type Transaction } from "../../../api";
import { useShowPrivate } from "../../../privacy";
import { CategoryPicker, clearCategorySuggestions, type CategorySuggestion } from "../../../components/CategoryPicker";
import { EmptyState } from "../../../components/EmptyState";
import { KeyHint } from "../../../components/KeyHint";
import { Button } from "../../../components/ui/button";
import { HeaderActions } from "../../../shell/PageHeader";
import { isTyping } from "../../../shell/hotkeys";
import { openTransactions } from "../../../shell/openTransactions";
import { ShortcutsDialog, type ShortcutGroups } from "../ShortcutsDialog";
import type { PageContext } from "../TransactionsPage";
import { ReviewCard, type CardState } from "./ReviewCard";
import { addDoneToday, defaultScope, doneToday, picksKey, sectionsFor, toCards, type ReviewCardData } from "./model";
import { motion } from "motion/react";
import { useTransition } from "../../../lib/motion";

export const REVIEW_SHORTCUTS: ShortcutGroups = [
  {
    group: "Välj kategori för kortet",
    items: [
      { keys: [["1"], ["6"]], label: "Snabbval 1–6" },
      { keys: [["c"]], label: "Annan kategori (väljaren)" },
      { keys: [["u"]], label: "Vet ej (Övrigt › Okänt, ingen regel)" },
      { keys: [["mod", "z"]], label: "Ångra (medan meddelandet visas)" },
    ],
  },
  {
    group: "Kortet",
    items: [
      { keys: [["shift", "j"], ["↓"]], label: "Nästa kort" },
      { keys: [["shift", "k"], ["↑"]], label: "Föregående kort" },
      { keys: [["r"]], label: "Kom ihåg (regel) av/på" },
      { keys: [["e"]], label: "Ändra regelns text" },
      { keys: [["b"]], label: "Samma kategori för båda riktningarna (Swish)" },
      { keys: [["o"]], label: "Visa alla rader" },
      { keys: [["?"]], label: "Den här rutan" },
    ],
  },
];

interface Undo {
  rows: unknown[];
  rule: { id: number; previousCategoryId: number | null; before: unknown[] } | null;
}

/**
 * Att granska as an inbox: one card per merchant, most rows first. Pick a
 * category with 1–6 (suggested), C (any) or U (don't know); the card slides
 * out and the next one is active. 'Kom ihåg' makes a rule for future rows.
 */
export function ReviewInbox({ ctx }: { ctx: PageContext }) {
  const fill = useTransition("number");
  const showPrivate = useShowPrivate();
  const [data, setData] = useState<ReviewGroups | null>(null);
  const [rows, setRows] = useState<Map<number, Transaction>>(new Map());
  const [picks, setPicks] = useState<Record<string, CategorySuggestion[]>>({});
  const [states, setStates] = useState<Map<string, CardState>>(new Map());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(doneToday);
  const [picker, setPicker] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    const d = await getJson<ReviewGroups>(`/review/groups${showPrivate ? "?showPrivate=1" : ""}`);
    setData(d);
    setLeaving(new Set());
    const ids = d.groups.flatMap((g) => g.ids).slice(0, 1000);
    if (ids.length) sendJson<Transaction[]>("POST", "/review/rows", { ids }).then((r) => setRows(new Map(r.map((t) => [t.id, t]))));
  }, [showPrivate]);
  useEffect(() => {
    load();
  }, [load]);

  const cards = useMemo(() => (data ? toCards(data.groups) : []), [data]);
  const visible = cards.filter((c) => !leaving.has(c.key) || c.key === activeKey);
  const stateOf = useCallback(
    (c: ReviewCardData): CardState =>
      states.get(c.key) ?? { remember: true, pattern: c.merchant, scope: defaultScope(c), expanded: false, editingPattern: false },
    [states],
  );

  // Quick picks for every card (and a two-way card's 'both'), in one request.
  useEffect(() => {
    if (!cards.length) return;
    const groups = cards.flatMap((c) => {
      const out = c.sections.map((g) => ({ key: g.key, ids: g.ids }));
      if (c.sections.length > 1) out.push({ key: picksKey(c, "both"), ids: c.sections.flatMap((g) => g.ids) });
      return out;
    });
    sendJson<Record<string, CategorySuggestion[]>>("POST", "/review/quick-picks", { groups }).then(setPicks, () => setPicks({}));
  }, [cards]);

  // Keep a card active. After a reload the active card may have a new key (a
  // two-way Swish card with one direction done): stay on the same merchant,
  // else on the card now in its place.
  const lastActive = useRef<{ merchant: string; index: number } | null>(null);
  useEffect(() => {
    const live = cards.filter((c) => !leaving.has(c.key));
    if (!live.length) return setActiveKey(null);
    const current = cards.find((c) => c.key === activeKey);
    if (current) {
      lastActive.current = { merchant: current.merchant, index: live.indexOf(current) };
      return;
    }
    const prev = lastActive.current;
    const same = prev && live.find((c) => c.merchant === prev.merchant);
    setActiveKey((same ?? live[Math.min(prev?.index ?? 0, live.length - 1)] ?? live[0]).key);
  }, [cards, leaving, activeKey]);

  const change = useCallback((key: string, patch: Partial<CardState>) => {
    setStates((m) => {
      const card = cards.find((c) => c.key === key);
      if (!card) return m;
      const cur = m.get(key) ?? { remember: true, pattern: card.merchant, scope: defaultScope(card), expanded: false, editingPattern: false };
      return new Map(m).set(key, { ...cur, ...patch });
    });
  }, [cards]);

  const categoryName = useCallback(
    (id: number) => {
      const c = ctx.categories.find((x) => x.id === id);
      const p = c?.parentId != null ? ctx.categories.find((x) => x.id === c.parentId) : undefined;
      return c ? (p ? `${p.name} › ${c.name}` : c.name) : "";
    },
    [ctx.categories],
  );

  /** Categorises the card's rows (its current scope); the card slides out and the next one is active. */
  const apply = useCallback(
    async (key: string, categoryId: number, unknown = false) => {
      const card = cards.find((c) => c.key === key);
      if (!card) return;
      const st = stateOf(card);
      const scoped = sectionsFor(card, st.scope);
      const ids = scoped.flatMap((g) => g.ids);
      const direction = st.scope === "both" || !card.isSwish ? "any" : scoped[0].direction;
      const rule = st.remember && !unknown ? { pattern: st.pattern, matchType: "contains", direction } : null;
      const whole = scoped.length === card.sections.length;
      if (whole) {
        // Move on at once; the card animates out.
        const live = cards.filter((c) => !leaving.has(c.key) && c.key !== key);
        const at = cards.findIndex((c) => c.key === key);
        const next = live.find((c) => cards.indexOf(c) > at) ?? live.at(-1);
        setLeaving((s) => new Set(s).add(key));
        setActiveKey(next?.key ?? null);
      }
      try {
        const r = await sendJson<{ byRule: number; manual: number; undo: Undo }>("POST", "/transactions/categorize", { ids, categoryId, rule });
        const n = r.byRule + r.manual;
        const others = Math.max(0, n - ids.length);
        setDone(addDoneToday());
        ctx.notify({
          text:
            `${card.name}: ${ids.length} ${ids.length === 1 ? "rad" : "rader"} → ${unknown ? "Vet ej" : categoryName(categoryId)}.` +
            (rule ? ` Regel sparad${others ? `, ${others} till fick kategori` : ""}.` : ""),
          action: {
            label: "Ångra",
            run: async () => {
              if (r.undo.rule) await sendJson("POST", `/rules/${r.undo.rule.id}/undo`, r.undo.rule);
              await sendJson("POST", "/transactions/undo", { rows: r.undo.rows });
              setDone(addDoneToday(-1));
              clearCategorySuggestions();
              ctx.refreshCounts();
              load();
            },
          },
        });
        clearCategorySuggestions();
        ctx.refreshCounts();
        setTimeout(load, whole ? 220 : 0);
      } catch (e) {
        ctx.notify({ text: (e as Error).message });
        setLeaving((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
        load();
      }
    },
    [cards, leaving, stateOf, ctx, categoryName, load],
  );

  const unknownId = ctx.categories.find((c) => c.systemKey === "unknown")?.id ?? null;
  const onPick = useCallback((key: string, id: number) => apply(key, id), [apply]);
  const onUnknown = useCallback((key: string) => unknownId !== null && apply(key, unknownId, true), [apply, unknownId]);
  const onOther = useCallback((key: string, anchor: HTMLElement) => {
    setActiveKey(key);
    setPicker({ key, anchor });
  }, []);
  const onActivate = useCallback((key: string) => setActiveKey(key), []);
  const onOpenInList = useCallback((merchant: string) => openTransactions({ period: "all", categoryId: "none", q: merchant }), []);
  const accountName = useCallback((id: number | null) => ctx.accounts.find((a) => a.id === id)?.name ?? null, [ctx.accounts]);
  const accountKind = useCallback((id: number | null) => ctx.accounts.find((a) => a.id === id)?.kind ?? null, [ctx.accounts]);

  // ---------- keyboard ----------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e.target) || picker || help) return;
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const live = cards.filter((c) => !leaving.has(c.key));
    const card = live.find((c) => c.key === activeKey);
    const move = (step: number) => {
      if (!live.length) return;
      const at = card ? live.indexOf(card) : -1;
      setActiveKey(live[Math.min(live.length - 1, Math.max(0, at + step))].key);
    };
    const k = e.key;
    if (k === "J" || k === "ArrowDown") return e.preventDefault(), move(1);
    if (k === "K" || k === "ArrowUp") return e.preventDefault(), move(-1);
    if (k === "?") return e.preventDefault(), setHelp(true);
    if (!card) return;
    const st = stateOf(card);
    if (/^[1-6]$/.test(k)) {
      const p = picks[picksKey(card, st.scope)]?.[Number(k) - 1];
      if (p) {
        e.preventDefault();
        apply(card.key, p.categoryId);
      }
      return;
    }
    switch (k) {
      case "c": {
        e.preventDefault();
        const anchor = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(card.key)}"] [data-other]`);
        if (anchor) setPicker({ key: card.key, anchor });
        return;
      }
      case "u":
        e.preventDefault();
        return onUnknown(card.key);
      case "r":
        e.preventDefault();
        return change(card.key, { remember: !st.remember });
      case "e":
        e.preventDefault();
        return change(card.key, { remember: true, editingPattern: true });
      case "b":
        if (card.sections.length > 1) {
          e.preventDefault();
          change(card.key, { scope: st.scope === "both" ? defaultScope(card) : "both" });
        }
        return;
      case "o":
        e.preventDefault();
        return change(card.key, { expanded: !st.expanded });
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!data) return null;
  const remainingRows = cards.filter((c) => !leaving.has(c.key)).reduce((s, c) => s + c.count, 0);
  const remainingCards = cards.filter((c) => !leaving.has(c.key)).length;
  const progress = done + remainingCards > 0 ? done / (done + remainingCards) : 1;
  const pickerCard = picker ? cards.find((c) => c.key === picker.key) : undefined;

  return (
    <div className="space-y-4">
      <HeaderActions>
        <KeyHint label="Kortkommandon" keys={["?"]}>
          <Button variant="ghost" size="icon" onClick={() => setHelp(true)} aria-label="Kortkommandon" className="pointer-coarse:hidden">
            <Keyboard />
          </Button>
        </KeyHint>
      </HeaderActions>

      <div className="space-y-1.5">
        <p className="text-sm">
          <span className="font-medium">
            {remainingRows} {remainingRows === 1 ? "rad" : "rader"} i {remainingCards} {remainingCards === 1 ? "grupp" : "grupper"}
          </span>
          <span className="text-muted"> · {done} gjorda i dag</span>
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <motion.div className="h-full rounded-full bg-income" initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={fill} />
        </div>
        {data.privateHidden > 0 && (
          <p className="text-xs text-muted">
            {data.privateHidden} {data.privateHidden === 1 ? "privat rad" : "privata rader"} utan kategori visas inte. Slå på Visa privata för att granska{" "}
            {data.privateHidden === 1 ? "den" : "dem"}.
          </p>
        )}
      </div>

      {remainingCards === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState icon={CheckCircle2} title="Allt är granskat">
            Nya rader utan kategori hamnar här efter nästa import.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <ReviewCard
              key={c.key}
              card={c}
              state={stateOf(c)}
              active={c.key === activeKey}
              leaving={leaving.has(c.key)}
              picks={picks[picksKey(c, stateOf(c).scope)]}
              rows={rows}
              accountName={accountName}
              accountKind={accountKind}
              onActivate={onActivate}
              onPick={onPick}
              onOther={onOther}
              onUnknown={onUnknown}
              onChange={change}
              onOpenInList={onOpenInList}
            />
          ))}
        </div>
      )}

      <CategoryPicker
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        anchor={picker?.anchor ?? null}
        rowIds={pickerCard ? sectionsFor(pickerCard, stateOf(pickerCard).scope).flatMap((g) => g.ids) : []}
        onPick={(c) => {
          const key = picker!.key;
          setPicker(null);
          apply(key, c.id, c.systemKey === "unknown");
        }}
      />
      <ShortcutsDialog open={help} onOpenChange={setHelp} title="Kortkommandon i Att granska" groups={REVIEW_SHORTCUTS} />
    </div>
  );
}
