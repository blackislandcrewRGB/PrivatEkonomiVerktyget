import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, MoreHorizontal, Search } from "lucide-react";
import { sendJson, uploadIcon, type Category, type Rule } from "../../api";
import { CategoryChip } from "../../components/CategoryChip";
import { CategoryPicker } from "../../components/CategoryPicker";
import { IconUpload, iconFileError, imageFromClipboard, typingInField } from "../../components/IconUpload";
import { MerchantIcon } from "../../components/MerchantIcon";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/popover";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { cn } from "../../lib/cn";
import { useWidth } from "../../lib/useWidth";
import { DIRECTION_LABEL, MATCH_LABEL, PatternTester, type TesterHandle } from "./PatternTester";
import { PruneDialog } from "./PruneDialog";
import { categoryPath, page, ruleView, type RuleSort, type SourceFilter } from "./rulesFilter";

const ORIGIN_LABEL: Record<Rule["createdFrom"], string> = { seed: "grund", manual: "manuell", llm: "LLM" };
const SORT_LABEL: Record<RuleSort, string> = { matches: "Flest träffar", pattern: "A–Ö" };

export interface RulesKeys {
  focusSearch: () => void;
  move: (step: number) => void;
  edit: () => void;
  pickCategory: () => void;
  remove: () => void;
  test: () => void;
}

/** Wide: icon, pattern, type, direction, category, source, hits, menu. Narrow: type, direction and source go under the pattern. */
const WIDE = "grid-cols-[26px_minmax(0,1.1fr)_72px_46px_minmax(0,1fr)_52px_44px_28px]";
const NARROW = "grid-cols-[26px_minmax(0,1fr)_auto_28px]";

/**
 * The rules in Design v2: 'Testa mönster' as its own card above, then a card
 * with search ('/'), chips with counts (Alla / Grund / Manuella, Saknar ikon)
 * and the sort, and the rules 50 at a time, most hits first. Rules that
 * decided no row in 12 months are folded into 'Oanvända', which can be
 * cleaned out ('Rensa oanvända …', only the ones ticked).
 *
 * The first column is the merchant's icon, a grey '?' without one. Clicking
 * it (or dropping a file on it) sets a picture; ⌘V with a picture on the
 * clipboard sets it on the selected rule, so ↓ ⌘V ↓ ⌘V goes down the list.
 */
export function RulesPanel({
  rules,
  categories,
  filterCategory,
  onClearFilter,
  onChanged,
  keysRef,
}: {
  rules: Rule[];
  categories: Category[];
  filterCategory: number | null;
  onClearFilter: () => void;
  onChanged: () => Promise<void>;
  keysRef: React.MutableRefObject<RulesKeys | null>;
}) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [noIcon, setNoIcon] = useState(false);
  const [sort, setSort] = useState<RuleSort>("matches");
  const [showAll, setShowAll] = useState(false);
  const [iconFor, setIconFor] = useState<{ rule: Rule; anchor: HTMLElement } | null>(null);
  const iconAnchor = useRef<HTMLElement | null>(null);
  iconAnchor.current = iconFor?.anchor ?? null;
  const [showUnused, setShowUnused] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ rule: Rule; anchor: HTMLElement } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const tester = useRef<TesterHandle>(null);
  const [measure, width] = useWidth<HTMLElement>(1000);
  const compact = width < 560;

  const view = ruleView(rules, categories, { query: q, source, noIcon, sort, category: filterCategory });
  const { used, unused, counts } = view;
  const paged = page(used, showAll);
  const navigable = showUnused ? [...paged.rows, ...unused] : paged.rows;
  const active = navigable.find((r) => r.id === activeId) ?? null;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await onChanged();
      return true;
    } catch (e) {
      notify({ text: (e as Error).message });
      return false;
    }
  };
  const patch = (r: Rule, body: Partial<Pick<Rule, "pattern" | "matchType" | "direction" | "categoryId">>) =>
    run(async () => {
      const res = await sendJson<{ applied: number }>("PATCH", `/rules/${r.id}`, body);
      if (res.applied > 0) notify({ text: `${res.applied} rader utan kategori fick kategorin.` });
    });
  const remove = (r: Rule) =>
    run(async () => {
      const deleted = await sendJson<Rule>("DELETE", `/rules/${r.id}`, {});
      notify({
        text: `Regeln ${r.pattern} är borttagen. Raderna behåller sina kategorier.`,
        action: { label: "Ångra", run: () => run(() => sendJson("POST", "/rules/restore", deleted)) },
      });
    });
  const prune = async (ids: number[]) => {
    const ok = await run(async () => {
      const deleted = await sendJson<Rule[]>("POST", "/rules/delete", { ids });
      notify({
        text: `${deleted.length} ${deleted.length === 1 ? "oanvänd regel är borttagen" : "oanvända regler är borttagna"}. Raderna behåller sina kategorier.`,
        action: { label: "Ångra", run: () => run(() => sendJson("POST", "/rules/restore", deleted)) },
      });
    });
    if (ok) setPruning(false);
  };

  const setIcon = (r: Rule, file: File) =>
    run(async () => {
      const error = iconFileError(file);
      if (error) throw new Error(error);
      await uploadIcon(`/rules/${r.id}/icon`, file);
      notify({ text: `Bilden gäller alla köp hos ${r.pattern}.` });
    });
  const removeIcon = (r: Rule) => run(() => sendJson("DELETE", `/rules/${r.id}/icon`, {}));

  // ⌘V with a picture: onto the selected rule (the open icon box takes it itself).
  const pasteTarget = useRef<Rule | null>(null);
  pasteTarget.current = iconFor ? null : active;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e);
      const r = pasteTarget.current;
      if (!file || !r || typingInField()) return;
      e.preventDefault();
      void setIcon(r, file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iconButton = (r: Rule) => (
    <button
      type="button"
      data-rule-icon=""
      aria-label={`Ikon för ${r.pattern}`}
      title={r.iconPath ? "Egen bild · klicka för att byta" : r.icon?.brand ? "Varumärkets ikon · klicka för att lägga in en egen bild" : "Ingen ikon · klicka, dra hit eller klistra in (⌘V) en bild"}
      onClick={(e) => {
        e.stopPropagation();
        setActiveId(r.id);
        setIconFor({ rule: r, anchor: e.currentTarget });
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setActiveId(r.id);
        const file = e.dataTransfer.files[0];
        if (file) void setIcon(r, file);
      }}
      className="flex rounded-[7px] outline-offset-2 hover:ring-2 hover:ring-neutral-bar"
    >
      {r.icon ? (
        <MerchantIcon decorative text={r.pattern} icon={r.icon} size={26} shape="square" className="rounded-[7px]" />
      ) : (
        <span data-no-icon="" className="grid size-[26px] place-items-center rounded-[7px] bg-card-inset text-[12px] font-semibold text-ink-3">
          ?
        </span>
      )}
    </button>
  );

  keysRef.current = {
    focusSearch: () => {
      search.current?.focus();
      search.current?.select();
    },
    move: (step) => {
      if (!navigable.length) return;
      const i = navigable.findIndex((r) => r.id === activeId);
      const next = navigable[i < 0 ? (step > 0 ? 0 : navigable.length - 1) : Math.max(0, Math.min(navigable.length - 1, i + step))];
      setActiveId(next.id);
      document.querySelector(`[data-rule="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
    },
    edit: () => active && setEditing(active.id),
    pickCategory: () => {
      const el = active && document.querySelector<HTMLElement>(`[data-rule="${active.id}"] [data-rule-category]`);
      if (active && el) setPicker({ rule: active, anchor: el });
    },
    remove: () => active && remove(active),
    test: () => tester.current?.focus(),
  };

  const menu = (r: Rule) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Mer för ${r.pattern}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel>Typ</DropdownMenuLabel>
        {(["contains", "exact", "regex"] as const).map((t) => (
          <DropdownMenuItem key={t} onSelect={() => t !== r.matchType && patch(r, { matchType: t })}>
            <Check className={cn("size-4", t !== r.matchType && "invisible")} /> {MATCH_LABEL[t]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuLabel>Riktning</DropdownMenuLabel>
        {(["any", "out", "in"] as const).map((d) => (
          <DropdownMenuItem key={d} onSelect={() => d !== r.direction && patch(r, { direction: d })}>
            <Check className={cn("size-4", d !== r.direction && "invisible")} /> {DIRECTION_LABEL[d]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => tester.current?.load(r)}>Testa mönstret</DropdownMenuItem>
        <DropdownMenuItem danger onSelect={() => remove(r)}>
          Ta bort regeln
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const typePill = (r: Rule) => (
    <span data-type={r.matchType} className={cn("justify-self-start rounded-full px-2 py-px text-[11px] font-medium", r.matchType === "regex" ? "bg-accent-soft text-accent" : "bg-card-inset text-ink-2")}>
      {MATCH_LABEL[r.matchType]}
    </span>
  );
  const dir = (r: Rule) => (r.direction === "any" ? "–" : r.direction === "out" ? "ut" : "in");
  const category = (r: Rule) => (
    <CategoryChip
      data-rule-category=""
      categoryId={r.categoryId}
      onClick={(e) => {
        e.stopPropagation();
        setActiveId(r.id);
        setPicker({ rule: r, anchor: e.currentTarget });
      }}
      className="-ml-2 min-w-0 justify-self-start text-[12px]"
    />
  );
  const pattern = (r: Rule) =>
    editing === r.id ? (
      <PatternInput
        value={r.pattern}
        onDone={(v) => {
          setEditing(null);
          if (v && v !== r.pattern) patch(r, { pattern: v });
        }}
      />
    ) : (
      <button
        type="button"
        data-pattern=""
        onClick={() => {
          setActiveId(r.id);
          setEditing(r.id);
        }}
        className="max-w-full truncate justify-self-start rounded px-1 text-left font-mono text-[12px] text-ink hover:bg-card-inset"
        title="Ändra mönstret (Enter)"
      >
        {r.pattern}
      </button>
    );
  const hits = (r: Rule) => (
    <span role="cell" className="text-right text-[13px] font-semibold tabular-nums" title={`${r.hits} gånger totalt`}>
      {r.matches12 > 0 ? r.matches12 : "–"}
    </span>
  );

  const row = (r: Rule) => (
    <div
      key={r.id}
      role="row"
      data-rule={r.id}
      aria-selected={r.id === activeId}
      onClick={() => setActiveId(r.id)}
      className={cn(
        "grid items-center gap-x-2.5 border-t border-hairline px-4 hover:bg-band sm:px-5",
        compact ? cn(NARROW, "gap-y-1 py-2.5") : cn(WIDE, "min-h-11 py-1.5"),
        r.id === activeId && "bg-accent-soft/60 shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-accent-soft/60",
      )}
    >
      <span role="cell" className={cn("flex", compact && "row-span-2 self-start")}>
        {iconButton(r)}
      </span>
      <span role="cell" className="min-w-0">
        {pattern(r)}
      </span>
      {compact ? (
        <>
          {hits(r)}
          <span role="cell">{menu(r)}</span>
          <span role="cell" className="col-span-3 col-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
            {category(r)}
            {typePill(r)}
            {r.direction !== "any" && <span>{DIRECTION_LABEL[r.direction]}</span>}
            <span>{ORIGIN_LABEL[r.createdFrom]}</span>
          </span>
        </>
      ) : (
        <>
          <span role="cell">{typePill(r)}</span>
          <span role="cell" className="text-[12px] text-ink-2">
            {dir(r)}
          </span>
          <span role="cell" className="min-w-0">
            {category(r)}
          </span>
          <span role="cell" className="text-[12px] text-ink-3">
            {ORIGIN_LABEL[r.createdFrom]}
          </span>
          {hits(r)}
          <span role="cell">{menu(r)}</span>
        </>
      )}
    </div>
  );

  const chip = (label: React.ReactNode, on: boolean, onClick: () => void, name: string) => (
    <button
      type="button"
      aria-pressed={on}
      aria-label={name}
      onClick={onClick}
      className={cn("h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium transition-colors", on ? "bg-ink text-card" : "bg-card-inset text-ink hover:bg-segment")}
    >
      {label}
    </button>
  );
  const count = (n: number) => <span className="opacity-60 tabular-nums"> · {n}</span>;

  return (
    <div className="space-y-3">
      <PatternTester
        ref={tester}
        onSaved={async (res) => {
          await onChanged();
          notify({
            text: `Regeln ${res.rule.pattern} är sparad${res.applied ? `, ${res.applied} rader fick kategorin` : ""}.`,
            action: {
              label: "Ångra",
              run: () => run(() => sendJson("POST", `/rules/${res.rule.id}/undo`, { previousCategoryId: res.previousCategoryId, before: res.before })),
            },
          });
        }}
      />

      <section ref={measure} aria-label="Regellista" className="min-w-0 overflow-hidden rounded-card bg-card text-ink shadow-card">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <label className="relative min-w-40 flex-1 basis-52">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              ref={search}
              aria-label="Sök regler"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLInputElement).blur()}
              placeholder="Sök mönster eller kategori"
              className="h-8 w-full rounded-[9px] bg-card-inset pl-8 pr-8 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent/30"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-neutral-bar px-1 font-sans text-[10px] text-ink-3" aria-hidden>
              /
            </kbd>
          </label>
          <div role="group" aria-label="Filter" className="flex max-w-full flex-wrap items-center gap-1.5">
            {chip("Alla", source === "all", () => setSource("all"), `Alla, ${counts.all}`)}
            {chip(<>Grund{count(counts.seed)}</>, source === "seed", () => setSource("seed"), `Grund, ${counts.seed}`)}
            {chip(<>Manuella{count(counts.manual)}</>, source === "manual", () => setSource("manual"), `Manuella, ${counts.manual}`)}
            {chip("Saknar ikon", noIcon, () => setNoIcon((x) => !x), `Saknar ikon, ${counts.noIcon}`)}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`Sortering: ${SORT_LABEL[sort]}`} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-card-inset px-3 text-[12px] font-medium text-ink-2 hover:bg-segment">
                  {SORT_LABEL[sort]} <ChevronDown className="size-3" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["matches", "pattern"] as const).map((k) => (
                  <DropdownMenuItem key={k} onSelect={() => setSort(k)}>
                    <Check className={cn("size-4", k !== sort && "invisible")} /> {SORT_LABEL[k]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {filterCategory !== null && (
              <button type="button" onClick={onClearFilter} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-3 text-[12px] font-medium text-accent">
                {categoryPath(categories, filterCategory)} <span aria-hidden>×</span>
                <span className="sr-only">Visa alla kategorier</span>
              </button>
            )}
          </div>
        </div>

        <div role="table" aria-label="Regler" aria-rowcount={view.shown.length}>
          {!compact && (
            <div role="row" className={cn("grid items-center gap-x-2.5 border-t border-hairline px-4 py-2 text-[11px] text-ink-3 sm:px-5", WIDE)}>
              <span role="columnheader">
                <span className="sr-only">Ikon</span>
              </span>
              <span role="columnheader" className="pl-1">
                Mönster
              </span>
              <span role="columnheader">Typ</span>
              <span role="columnheader">Riktning</span>
              <span role="columnheader">Kategori</span>
              <span role="columnheader">Källa</span>
              <span role="columnheader" className="text-right" title="Rader de senaste 12 månaderna som regeln avgör">
                Träffar
              </span>
              <span role="columnheader">
                <span className="sr-only">Meny</span>
              </span>
            </div>
          )}
          {paged.rows.map(row)}
          {used.length === 0 && (
            <p className="border-t border-hairline px-5 py-5 text-center text-[13px] text-ink-3">
              {view.shown.length === 0 ? "Inga regler matchar filtret." : "Inga regler med träffar de senaste 12 månaderna."}
            </p>
          )}
          {paged.more > 0 && (
            <p className="border-t border-hairline px-5 py-2.5 text-center text-[12px] text-ink-3">
              … {paged.more} {paged.more === 1 ? "regel" : "regler"} till ·{" "}
              <button type="button" onClick={() => setShowAll(true)} className="font-semibold text-accent hover:underline">
                visa alla
              </button>
            </p>
          )}
          {unused.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline bg-band px-4 py-2.5 text-[12px] sm:px-5">
                <button type="button" aria-expanded={showUnused} onClick={() => setShowUnused((s) => !s)} className="flex min-w-0 items-center gap-1.5 text-left">
                  <ChevronRight className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", showUnused && "rotate-90")} aria-hidden />
                  <span className="font-semibold text-ink">Oanvända ({unused.length})</span>
                  <span className="text-ink-3">· ingen träff de senaste 12 månaderna</span>
                </button>
                <button type="button" onClick={() => setPruning(true)} className="font-semibold text-accent hover:underline">
                  Rensa oanvända …
                </button>
              </div>
              {showUnused && unused.map(row)}
            </>
          )}
        </div>
      </section>

      <Popover open={iconFor !== null} onOpenChange={(o) => !o && setIconFor(null)}>
        <PopoverAnchor virtualRef={iconAnchor as React.RefObject<HTMLElement>} />
        <PopoverContent className="w-96" onOpenAutoFocus={(e) => e.preventDefault()}>
          {iconFor && (
            <IconUpload
              preview={<MerchantIcon text={iconFor.rule.pattern} icon={iconFor.rule.icon} size={40} />}
              hasOwn={!!iconFor.rule.iconPath}
              onFile={async (file) => {
                if (await setIcon(iconFor.rule, file)) setIconFor(null);
              }}
              onRemove={async () => {
                if (await removeIcon(iconFor.rule)) setIconFor(null);
              }}
            >
              <span>
                Gäller alla köp som <span className="font-mono">{iconFor.rule.pattern}</span> träffar.
              </span>
            </IconUpload>
          )}
        </PopoverContent>
      </Popover>

      <CategoryPicker
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        anchor={picker?.anchor ?? null}
        value={picker?.rule.categoryId ?? null}
        onPick={(c) => picker && c.id !== picker.rule.categoryId && patch(picker.rule, { categoryId: c.id })}
        title="Regelns kategori"
      />
      <PruneDialog open={pruning} onOpenChange={setPruning} rules={unused} categories={categories} onConfirm={prune} />
    </div>
  );
}

function PatternInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      autoFocus
      aria-label="Mönster"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(value);
      }}
      className="h-7 w-full rounded-md border border-accent bg-card px-1.5 font-mono text-[12px] text-ink outline-none"
    />
  );
}
