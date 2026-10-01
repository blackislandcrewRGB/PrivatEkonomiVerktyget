import { memo, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, ExternalLink, Pencil } from "lucide-react";
import type { Transaction } from "../../../api";
import type { CategorySuggestion } from "../../../components/CategoryPicker";
import { Amount } from "../../../components/Amount";
import { AccountBadge } from "../../../components/AccountBadge";
import { MerchantIcon } from "../../../components/MerchantIcon";
import { Kbd, KeyHint } from "../../../components/KeyHint";
import { useCategories } from "../../../categories";
import { cn } from "../../../lib/cn";
import { categoryColor } from "../../../lib/palette";
import { shortDate } from "../../../api";
import { sectionsFor, type ReviewCardData, type Scope } from "./model";

/** '16/9', with the year when it isn't this year ('16/9 2024'). */
const day = (iso: string) => `${shortDate(iso)}${iso.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${iso.slice(0, 4)}` : ""}`;

export interface CardState {
  remember: boolean;
  pattern: string;
  scope: Scope;
  expanded: boolean;
  editingPattern: boolean;
}

/**
 * A merchant waiting for a category: name, count, sum, dates, example rows,
 * six quick picks (1–6), 'Annan…' (C) and 'Vet ej' (U), and 'kom ihåg' (R)
 * with the rule's text behind a pen. A Swish number with money both ways
 * has two sections and 'Samma kategori för båda' (B).
 */
export const ReviewCard = memo(function ReviewCard({
  card,
  state,
  active,
  leaving,
  picks,
  rows,
  accountName,
  accountKind,
  onActivate,
  onPick,
  onOther,
  onUnknown,
  onChange,
  onOpenInList,
}: {
  card: ReviewCardData;
  state: CardState;
  active: boolean;
  leaving: boolean;
  picks: CategorySuggestion[] | undefined;
  rows: Map<number, Transaction>;
  accountName: (id: number | null) => string | null;
  accountKind: (id: number | null) => "bank" | "credit_card" | null;
  onActivate: (key: string) => void;
  onPick: (key: string, categoryId: number) => void;
  onOther: (key: string, anchor: HTMLElement) => void;
  onUnknown: (key: string) => void;
  onChange: (key: string, patch: Partial<CardState>) => void;
  onOpenInList: (merchant: string) => void;
}) {
  const categories = useCategories();
  const ref = useRef<HTMLDivElement>(null);
  const patternRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(state.pattern);
  useEffect(() => setDraft(state.pattern), [state.pattern]);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  useEffect(() => {
    if (state.editingPattern) patternRef.current?.select();
  }, [state.editingPattern]);

  const scoped = sectionsFor(card, state.scope);
  const ids = scoped.flatMap((g) => g.ids);
  const direction = state.scope === "both" || !card.isSwish ? "any" : scoped[0].direction;
  const first = scoped.map((g) => g.first).sort()[0];
  const last = scoped.map((g) => g.last).sort().at(-1)!;
  const total = scoped.reduce((s, g) => s + g.sum, 0);
  const accounts = [...new Set(scoped.flatMap((g) => g.accountIds))];
  const examples = ids
    .map((id) => rows.get(id))
    .filter((r): r is Transaction => !!r)
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
  const shown = state.expanded ? examples : examples.slice(0, 3);
  const path = (id: number) => {
    const c = categories.find((x) => x.id === id);
    const p = c?.parentId != null ? categories.find((x) => x.id === c.parentId) : undefined;
    return c ? (p ? `${p.name} › ${c.name}` : c.name) : "?";
  };

  return (
    <div
      ref={ref}
      data-card={card.key}
      onClick={() => onActivate(card.key)}
      className={cn(
        "card-click rounded-xl border bg-surface p-4 transition-all duration-200",
        active ? "border-ring shadow-panel ring-1 ring-ring" : "border-border opacity-80 hover:opacity-100",
        leaving && "pointer-events-none -translate-x-6 opacity-0",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <MerchantIcon decorative contact={card.name !== card.merchant ? card.name : null} text={card.merchant} icon={card.icon} size={24} className="self-center" />
        <h3 className="text-[15px] font-semibold">{card.name}</h3>
        {card.name !== card.merchant && <span className="font-mono text-xs text-muted">{card.merchant}</span>}
        <span className="flex-1" />
        <span className="text-sm text-muted tabular-nums">
          {ids.length} st · <Amount ore={total} size="sm" /> · {first === last ? day(first) : `${day(first)} – ${day(last)}`}
        </span>
        {accounts.map((id) => (
          <AccountBadge key={id} name={accountName(id)} kind={accountKind(id)} />
        ))}
      </div>

      {card.sections.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {card.sections.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => onChange(card.key, { scope: g.direction })}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                state.scope === g.direction ? "border-ring bg-surface-muted font-medium" : "border-border text-muted",
              )}
            >
              {g.direction === "out" ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5 text-income" />}
              {g.direction === "out" ? "Ut" : "In"} · {g.count} st · <Amount ore={g.sum} size="sm" />
            </button>
          ))}
          <KeyHint keys={["b"]} label="Samma kategori för båda riktningarna (regeln gäller båda)">
            <button
              type="button"
              onClick={() => onChange(card.key, { scope: state.scope === "both" ? card.sections[0].direction : "both" })}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                state.scope === "both" ? "border-ring bg-surface-muted font-medium" : "border-border text-muted",
              )}
            >
              Samma kategori för båda
            </button>
          </KeyHint>
        </div>
      )}

      <ul className="mt-3 divide-y divide-border rounded-md border border-border text-[13px]">
        {shown.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-12 shrink-0 text-muted tabular-nums">{shortDate(r.bookingDate)}</span>
            <span className="min-w-0 flex-1 truncate">
              {r.descriptionClean}
              {r.merchantArea && <span className="ml-2 text-xs text-subtle">{r.merchantArea}</span>}
            </span>
            <Amount ore={r.amount} size="sm" />
          </li>
        ))}
        {examples.length === 0 && <li className="px-3 py-1.5 text-muted">…</li>}
      </ul>
      <div className="mt-1 flex items-center gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
        {examples.length > 3 && (
          <button type="button" onClick={() => onChange(card.key, { expanded: !state.expanded })} className="flex items-center gap-1 text-link hover:underline">
            {state.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {state.expanded ? "Visa färre" : `Visa alla ${examples.length}`}
            <Kbd keys={["o"]} className="ml-1 h-4 min-w-4 text-[10px]" />
          </button>
        )}
        <button type="button" onClick={() => onOpenInList(card.merchant)} className="flex items-center gap-1 text-muted hover:text-foreground">
          <ExternalLink className="size-3.5" /> Öppna i Transaktioner
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {(picks ?? []).slice(0, 6).map((p, i) => (
          <button
            key={p.categoryId}
            type="button"
            onClick={() => onPick(card.key, p.categoryId)}
            title={p.detail}
            className="group/pick inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] hover:border-border-strong hover:bg-surface-hover"
          >
            <kbd className="inline-flex size-5 items-center justify-center rounded border border-border bg-surface-muted text-[11px] text-muted">{i + 1}</kbd>
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(categories.find((c) => c.id === p.categoryId), categories) }} />
            <span className="truncate">{path(p.categoryId)}</span>
          </button>
        ))}
        {picks === undefined && <span className="px-1 py-1.5 text-xs text-subtle">Hämtar förslag…</span>}
        <button
          type="button"
          data-other=""
          onClick={(e) => onOther(card.key, e.currentTarget)}
          className="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[13px] text-muted hover:text-foreground"
        >
          Annan… <Kbd keys={["c"]} />
        </button>
        <button
          type="button"
          onClick={() => onUnknown(card.key)}
          className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-foreground"
          title="Övrigt › Okänt, utan regel"
        >
          Vet ej <Kbd keys={["u"]} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted" onClick={(e) => e.stopPropagation()}>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={state.remember} onChange={(e) => onChange(card.key, { remember: e.target.checked })} className="size-3.5" />
          Kom ihåg
          <Kbd keys={["r"]} className="h-4 min-w-4 text-[10px]" />
        </label>
        {state.remember && (
          <>
            <span>– regel för text som innehåller</span>
            {state.editingPattern ? (
              <input
                ref={patternRef}
                aria-label="Regelns text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => onChange(card.key, { pattern: draft.trim() || card.merchant, editingPattern: false })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setDraft(state.pattern);
                    onChange(card.key, { editingPattern: false });
                  }
                }}
                className="w-48 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-foreground"
              />
            ) : (
              <button
                type="button"
                onClick={() => onChange(card.key, { editingPattern: true })}
                className="inline-flex items-center gap-1 rounded px-1 font-mono text-foreground hover:bg-surface-hover"
                title="Ändra regelns text (E)"
              >
                {state.pattern} <Pencil className="size-3 text-muted" />
              </button>
            )}
            {direction !== "any" && <span>({direction === "in" ? "bara pengar in" : "bara pengar ut"})</span>}
          </>
        )}
        {!state.remember && <span>– bara de här raderna, ingen regel</span>}
      </div>
    </div>
  );
});
