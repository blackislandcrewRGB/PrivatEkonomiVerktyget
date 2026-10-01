import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover as P } from "radix-ui";
import { Check, Plus } from "lucide-react";
import { Command as C } from "cmdk";
import { getJson, type Category } from "../api";
import { openNewCategoryDialog, useCategories } from "../categories";
import { cn } from "../lib/cn";
import { categoryColor } from "../lib/palette";
import { recentCategories, rememberCategory } from "../lib/recentCategories";
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";

export interface CategorySuggestion {
  categoryId: number;
  reason: "rule" | "merchant_category" | "history" | "similar" | "popular";
  detail: string;
  rows: number;
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase("sv-SE")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Suggestions per set of rows, for the session: reopening the picker on the same row is instant.
const cache = new Map<string, CategorySuggestion[]>();

/** Fetches the picker's suggestions for these rows (rule, Norwegian category, same merchant before). */
export function useCategorySuggestions(rowIds: number[], enabled = true): CategorySuggestion[] | null {
  const key = [...rowIds].sort((a, b) => a - b).join(",");
  const [state, setState] = useState<{ key: string; list: CategorySuggestion[] } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    if (cache.has(key)) return setState({ key, list: cache.get(key)! });
    let live = true;
    getJson<CategorySuggestion[]>(`/transactions/category-suggestions?ids=${key}`).then(
      (list) => {
        cache.set(key, list);
        if (live) setState({ key, list });
      },
      () => live && setState({ key, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [key, enabled]);
  if (!key) return [];
  return state?.key === key ? state.list : cache.get(key) ?? null;
}

/** Forget cached suggestions (after a rule or category changed). */
export function clearCategorySuggestions() {
  cache.clear();
}

/**
 * The one category picker, used in the list, the detail panel and for bulk
 * changes. Suggested categories first (numbered, 1–9 picks them while the
 * search is empty), then the five used most recently, then every category
 * searchable by name. '+ Ny kategori…' at the bottom. Anchored to `anchor`
 * (any element, e.g. the row's category chip).
 */
export function CategoryPicker({
  open,
  onOpenChange,
  anchor,
  rowIds = [],
  value = null,
  onPick,
  includeTransfers = true,
  allowCreate = true,
  title = "Välj kategori",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: HTMLElement | null;
  rowIds?: number[];
  value?: number | null;
  onPick: (category: Category) => void;
  includeTransfers?: boolean;
  allowCreate?: boolean;
  title?: string;
}) {
  const categories = useCategories();
  const [query, setQuery] = useState("");
  const suggestions = useCategorySuggestions(rowIds, open);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const usable = (c: Category | undefined): c is Category => !!c && (includeTransfers || !c.isTransfer);
  const path = (c: Category) => {
    const parent = c.parentId != null ? byId.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };

  // Numbered: suggestions, then recent ones not already suggested; at most 9.
  const suggested = (suggestions ?? []).map((s) => ({ c: byId.get(s.categoryId), s })).filter((x) => usable(x.c)) as {
    c: Category;
    s: CategorySuggestion;
  }[];
  const recent = recentCategories()
    .map((id) => byId.get(id))
    .filter((c): c is Category => usable(c) && !suggested.some((x) => x.c.id === c.id));
  const numbered = [...suggested.map((x) => x.c), ...recent].slice(0, 9);
  const numberOf = (c: Category) => numbered.indexOf(c) + 1;

  const q = fold(query.trim());
  const matches = (c: Category) => !q || fold(path(c)).includes(q);
  const tree = categories
    .filter((c) => c.parentId === null && usable(c))
    .map((top) => ({ top, children: categories.filter((c) => c.parentId === top.id && usable(c)) }));

  const pick = (c: Category) => {
    rememberCategory(c.id);
    onOpenChange(false);
    onPick(c);
  };
  const create = () => {
    onOpenChange(false);
    const current = value != null ? byId.get(value) : undefined;
    openNewCategoryDialog(current ? (current.parentId ?? current.id) : null).then((c) => c && pick(c));
  };

  const item = (c: Category, key: string, extra?: ReactNode, indent = false) => {
    // Numbers only in the suggested and recent sections, not again in the tree.
    const n = key.startsWith("c-") ? 0 : numberOf(c);
    return (
      <CommandItem key={key} value={key} onSelect={() => pick(c)} className={cn(indent && "pl-6")}>
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(c, categories) }} />
        <span className={cn("min-w-0 flex-1 truncate", key.startsWith("c-") && c.parentId === null && "font-medium")}>
          {indent ? c.name : path(c)}
        </span>
        {extra}
        {c.id === value && <Check className="!text-foreground" />}
        {n > 0 && !q && (
          <kbd className="inline-flex size-5 items-center justify-center rounded border border-border bg-surface-muted text-[11px] text-muted">
            {n}
          </kbd>
        )}
      </CommandItem>
    );
  };

  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Anchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[340px] overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-panel outline-none animate-[pop-in_120ms_ease-out]"
          aria-label={title}
        >
          <C
            shouldFilter={false}
            loop
            onKeyDown={(e) => {
              // 1–9 pick a numbered category while nothing is typed.
              if (!query && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const c = numbered[Number(e.key) - 1];
                e.preventDefault();
                if (c && suggestions !== null) pick(c);
              }
            }}
          >
            <CommandInput value={query} onValueChange={setQuery} placeholder="Sök kategori…" autoFocus />
            <CommandList className="max-h-[min(55vh,380px)]">
              <CommandEmpty>Ingen kategori heter så.</CommandEmpty>
              {!q && suggested.length > 0 && (
                <CommandGroup heading="Föreslagna">
                  {suggested.map(({ c, s }) =>
                    item(c, `s-${c.id}`, <span className="max-w-32 truncate text-xs text-subtle">{s.detail}</span>),
                  )}
                </CommandGroup>
              )}
              {!q && suggestions === null && rowIds.length > 0 && (
                <p className="px-3 py-2 text-xs text-subtle">Hämtar förslag…</p>
              )}
              {!q && recent.length > 0 && (
                <CommandGroup heading="Senast använda">{recent.map((c) => item(c, `r-${c.id}`))}</CommandGroup>
              )}
              <CommandGroup heading={q ? "Kategorier" : "Alla kategorier"}>
                {tree.flatMap(({ top, children }) => {
                  const kids = children.filter(matches);
                  if (!matches(top) && kids.length === 0) return [];
                  return [
                    q && !matches(top) ? null : item(top, `c-${top.id}`),
                    ...kids.map((c) => (q ? item(c, `c-${c.id}`) : item(c, `c-${c.id}`, undefined, true))),
                  ];
                })}
              </CommandGroup>
              {allowCreate && (
                <CommandGroup>
                  <CommandItem value="new-category" onSelect={create}>
                    <Plus />
                    <span>Ny kategori…</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </C>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
