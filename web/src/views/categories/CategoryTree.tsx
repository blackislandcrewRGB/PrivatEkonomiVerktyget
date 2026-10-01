import { useState, type DragEvent } from "react";
import { ChevronRight, GripVertical, MoreHorizontal, Plus, Search } from "lucide-react";
import type { Category, CategoryUsage } from "../../api";
import { openNewCategoryDialog } from "../../categories";
import { amountKind, amountText } from "../../components/Amount";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useLocalStorage } from "../../lib/useLocalStorage";
import { categoryStats, filterTree, isOpen, toggleFolded, type UsagePeriod } from "./treeFilter";
import { CategorySelect } from "../../components/CategorySelect";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/popover";
import { cn } from "../../lib/cn";
import { CATEGORY_PALETTE, NEUTRAL_COLOR, categoryColor } from "../../lib/palette";

type Needs = { transactions: number; deletedTransactions: number; rules: number; recurringExpenses: number; merchantCategories: number };

/** fetch that lets 409 (a category that needs its rows moved first) through. */
async function request<T>(method: "PATCH" | "POST" | "DELETE", path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return { status: res.status, data };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
function describeNeeds(n: Needs): string {
  const parts = [
    n.transactions + n.deletedTransactions > 0 && plural(n.transactions + n.deletedTransactions, "transaktion", "transaktioner"),
    n.rules > 0 && plural(n.rules, "regel", "regler"),
    n.recurringExpenses > 0 && plural(n.recurringExpenses, "fast utgift", "fasta utgifter"),
    n.merchantCategories > 0 && plural(n.merchantCategories, "bankkategori", "bankkategorier"),
  ].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} och ${parts.at(-1)}` : (parts[0] ?? "");
}

type Action = { kind: "merge" | "move" | "delete"; category: Category; needs?: Needs };

/**
 * The category tree as Design v2's card: rows and sum over 12 months or this
 * year, a search on names, and main categories that fold (remembered in this
 * browser). Click filters the right side; the ⋯ menu (or right-click)
 * renames, recolours, moves, merges and deletes; a subcategory can be dragged
 * to another main category.
 */
export function CategoryTree({
  categories,
  usage,
  selected,
  onSelect,
  onChanged,
  onError,
  className,
}: {
  categories: Category[];
  usage: CategoryUsage;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  className?: string;
}) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [coloring, setColoring] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [dragging, setDragging] = useState<Category | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useLocalStorage<UsagePeriod>("categories.period", "12m", (v) => (v === "12m" || v === "ytd" ? v : null));
  const [folded, setFolded] = useLocalStorage<number[]>("categories.folded", [], (v) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : null));

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await onChanged();
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  };
  const children = (id: number) => categories.filter((c) => c.parentId === id);
  const tree = filterTree(categories, query);

  const move = (c: Category, parentId: number) => run(() => request("PATCH", `/categories/${c.id}`, { parentId }));
  const remove = async (c: Category, moveTo?: number) => {
    try {
      const r = await request<{ needsMove?: Needs }>("DELETE", `/categories/${c.id}${moveTo ? `?moveTo=${moveTo}` : ""}`);
      if (r.status === 409 && r.data.needsMove) return setAction({ kind: "delete", category: c, needs: r.data.needsMove });
      if (selected === c.id) onSelect(null);
      await onChanged();
      setAction(null);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const canDrop = (top: Category) => !!dragging && dragging.parentId !== top.id;
  const onDragOver = (top: Category) => (e: DragEvent) => {
    if (!canDrop(top)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(top.id);
  };
  const onDrop = (top: Category) => (e: DragEvent) => {
    e.preventDefault();
    const c = dragging;
    setDragging(null);
    setDropTarget(null);
    if (c && canDrop(top)) move(c, top.id);
  };

  const row = (c: Category) => {
    const isTop = c.parentId === null;
    const s = categoryStats(c, categories, usage, period);
    const movable = !isTop && !c.systemKey;
    const open = isOpen(c.id, folded, tree.searching);
    const hasChildren = isTop && (tree.children.get(c.id)?.length ?? 0) > 0;
    return (
      <div
        key={c.id}
        data-category={c.id}
        draggable={movable}
        onDragStart={(e) => {
          if (!movable) return;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(c.id));
          setDragging(c);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropTarget(null);
        }}
        onDragOver={isTop ? onDragOver(c) : undefined}
        onDragLeave={isTop ? () => setDropTarget((t) => (t === c.id ? null : t)) : undefined}
        onDrop={isTop ? onDrop(c) : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuFor(c.id);
        }}
        className={cn(
          "group relative flex items-center gap-1.5 pr-1.5 text-[13px]",
          isTop ? "h-9 pl-3" : "h-8 pl-10",
          selected === c.id ? "bg-accent-soft" : "hover:bg-card-inset/60",
          dropTarget === c.id && "bg-accent-soft ring-1 ring-inset ring-accent",
          dragging?.id === c.id && "opacity-50",
        )}
      >
        {movable ? <GripVertical className="absolute left-4 size-3.5 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100" aria-hidden /> : null}
        {isTop &&
          (hasChildren && !tree.searching ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Fäll ihop" : "Fäll ut"} ${c.name}`}
              onClick={() => setFolded((f) => toggleFolded(f, c.id))}
              className="-ml-1 grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="-ml-1 size-5 shrink-0" aria-hidden />
          ))}
        <ColorDot
          category={c}
          categories={categories}
          open={coloring === c.id}
          onOpenChange={(o) => setColoring(o ? c.id : null)}
          onPick={(color) => run(() => request("PATCH", `/categories/${c.id}`, { color }))}
          className={isTop ? "size-2.5" : "size-2 opacity-70"}
        />
        {renaming === c.id ? (
          <RenameInput
            name={c.name}
            onDone={async (name) => {
              setRenaming(null);
              if (name && name !== c.name) await run(() => request("PATCH", `/categories/${c.id}`, { name }));
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelect(selected === c.id ? null : c.id)}
            onDoubleClick={() => setRenaming(c.id)}
            aria-pressed={selected === c.id}
            className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left", isTop ? "font-semibold text-ink" : "text-ink")}
            title="Visa reglerna för kategorin (dubbelklick byter namn)"
          >
            <span className="truncate">{c.name}</span>
            {c.isTransfer && isTop && <Tag tone="grey">överföring</Tag>}
            {c.isSettlement && <Tag tone="purple">avstämning</Tag>}
            {c.systemKey === "unknown" && <Tag tone="grey">Vet ej</Tag>}
          </button>
        )}
        <span className={"w-8 shrink-0 text-right text-[11px] tabular-nums text-ink-3"} title={period === "ytd" ? "Rader i år" : "Rader senaste 12 månaderna"} data-count>
          {s.count > 0 ? s.count : ""}
        </span>
        <span
          className={cn(
            "w-[4.75rem] shrink-0 text-right text-[12px] tabular-nums",
            isTop ? cn("font-semibold", s.sum > 0 ? "text-positive-text" : "text-ink") : "text-ink-2",
          )}
          title={period === "ytd" ? "Summa i år" : "Summa senaste 12 månaderna"}
          data-sum
        >
          {s.count > 0 && amountText(Math.round(s.sum / 100) * 100, amountKind(s.sum), true)}
        </span>
        <DropdownMenu open={menuFor === c.id} onOpenChange={(o) => setMenuFor(o ? c.id : null)}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="-mr-1 size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Mer för ${c.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={() => setRenaming(c.id)}>Byt namn</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setColoring(c.id), 0)}>Färg…</DropdownMenuItem>
            {isTop && (
              <DropdownMenuItem onSelect={() => openNewCategoryDialog(c.id).then((x) => x && onChanged())}>
                <Plus /> Ny underkategori…
              </DropdownMenuItem>
            )}
            {c.systemKey ? (
              <>
                <DropdownMenuSeparator />
                <p className="px-2 py-1 text-xs text-muted">Används av verktyget: kan bara byta namn och färg.</p>
              </>
            ) : (
              <>
                <DropdownMenuSeparator />
                {!isTop && <DropdownMenuItem onSelect={() => setAction({ kind: "move", category: c })}>Flytta till…</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setAction({ kind: "merge", category: c })}>Slå ihop med…</DropdownMenuItem>
                <DropdownMenuItem danger disabled={children(c.id).length > 0} onSelect={() => remove(c)}>
                  Ta bort{children(c.id).length > 0 ? " (har underkategorier)" : ""}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <section aria-labelledby="tree-title" className={cn("min-w-0 overflow-hidden rounded-card bg-card text-ink shadow-card", className)}>
      <div className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="tree-title" className="text-base font-semibold">
            Kategorier
          </h2>
          <SegmentedControl<UsagePeriod>
            label="Period för rader och summa"
            size="sm"
            appearance="v2"
            options={[
              { value: "12m", label: "12 mån" },
              { value: "ytd", label: "i år" },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            aria-label="Sök kategori"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Sök kategori"
            className="h-8 w-full rounded-[9px] bg-card-inset pl-8 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent/30"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 border-t border-hairline px-4 text-left text-[13px] font-semibold",
          selected === null ? "bg-accent-soft text-ink" : "text-ink hover:bg-card-inset/60",
        )}
      >
        Alla kategorier
        <span className="text-[11px] font-normal text-ink-3">rader · summa</span>
      </button>
      <div role="tree" aria-label="Kategorier">
        {tree.tops.map((top) => {
          const open = isOpen(top.id, folded, tree.searching);
          return (
            <div key={top.id} role="treeitem" aria-expanded={open} aria-selected={selected === top.id} className="border-t border-hairline py-0.5">
              {row(top)}
              {open && tree.children.get(top.id)!.map(row)}
            </div>
          );
        })}
        {tree.tops.length === 0 && <p className="border-t border-hairline px-4 py-4 text-[13px] text-ink-3">Ingen kategori heter så.</p>}
      </div>
      <p className="border-t border-hairline px-4 py-3 text-[11px] text-ink-3">
        Dra en underkategori till en annan huvudkategori för att flytta den. Högerklick eller ⋯ för fler val.
      </p>
      <ActionDialog action={action} categories={categories} onClose={() => setAction(null)} run={run} remove={remove} />
    </section>
  );
}

function Tag({ tone, children }: { tone: "purple" | "grey"; children: React.ReactNode }) {
  return (
    <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium", tone === "purple" ? "bg-purple-soft text-purple-text" : "bg-card-inset text-ink-2")}>
      {children}
    </span>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  return (
    <input
      autoFocus
      aria-label="Nytt namn"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(name);
      }}
      className="h-7 min-w-0 flex-1 rounded-md border border-ring bg-surface px-1.5 text-sm outline-none"
    />
  );
}

/**
 * The colour dot and its picker: the 16 palette colours (a main category
 * can't take one another main category has), neutral grey, or your own; a
 * subcategory can follow its main category (lighter tones).
 */
function ColorDot({
  category: c,
  categories,
  open,
  onOpenChange,
  onPick,
  className,
}: {
  category: Category;
  categories: Category[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (color: string) => void;
  className?: string;
}) {
  const parent = c.parentId !== null ? categories.find((x) => x.id === c.parentId) : undefined;
  const takenBy = (color: string) =>
    c.parentId === null ? categories.find((x) => x.parentId === null && x.id !== c.id && x.color?.toLowerCase() === color.toLowerCase()) : undefined;
  const pick = (color: string) => {
    onOpenChange(false);
    if (color.toLowerCase() !== (c.color ?? "").toLowerCase()) onPick(color);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className={cn("size-3 shrink-0 rounded-full ring-offset-2 ring-offset-card hover:ring-2 hover:ring-neutral-bar", className)}
          style={{ background: categoryColor(c, categories) }}
          aria-label={`Färg för ${c.name}`}
        />
      </PopoverAnchor>
      <PopoverContent className="w-60 p-3">
        <p className="mb-2 text-xs font-medium text-muted">Färg för {c.name}</p>
        {parent && (
          <Button size="sm" className="mb-2 w-full justify-start" onClick={() => pick(parent.color ?? NEUTRAL_COLOR)}>
            <span className="size-3 rounded-full" style={{ background: parent.color ?? NEUTRAL_COLOR }} /> Följ {parent.name} (ljusare ton)
          </Button>
        )}
        <div className="grid grid-cols-8 gap-1.5">
          {[...CATEGORY_PALETTE, NEUTRAL_COLOR].map((color) => {
            const other = takenBy(color);
            const current = (c.color ?? "").toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                disabled={!!other && color !== NEUTRAL_COLOR}
                onClick={() => pick(color)}
                title={other && color !== NEUTRAL_COLOR ? `${color} – används av ${other.name}` : color}
                aria-label={other && color !== NEUTRAL_COLOR ? `${color}, används av ${other.name}` : color}
                className={cn("size-6 rounded-full disabled:cursor-not-allowed disabled:opacity-25", current && "ring-2 ring-foreground ring-offset-2 ring-offset-surface")}
                style={{ background: color }}
              />
            );
          })}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted">
          Egen färg
          <input type="color" value={c.color ?? NEUTRAL_COLOR} onChange={(e) => pick(e.target.value)} className="h-6 w-10 cursor-pointer rounded border border-border bg-surface" />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function ActionDialog({
  action,
  categories,
  onClose,
  run,
  remove,
}: {
  action: Action | null;
  categories: Category[];
  onClose: () => void;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  remove: (c: Category, moveTo?: number) => Promise<void>;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const c = action?.category;
  const hasChildren = !!c && categories.some((x) => x.parentId === c.id);
  const path = (id: number | null) => {
    const x = categories.find((k) => k.id === id);
    const p = x?.parentId ? categories.find((k) => k.id === x.parentId) : undefined;
    return x ? (p ? `${p.name} › ${x.name}` : x.name) : "";
  };
  const close = () => {
    setTarget(null);
    onClose();
  };
  const select = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm";
  if (!action || !c) return null;
  const options =
    action.kind === "move"
      ? categories.filter((x) => x.parentId === null && x.id !== c.parentId)
      : action.kind === "merge"
        ? categories.filter((x) => x.id !== c.id && x.parentId !== c.id && (!hasChildren || x.parentId === null))
        : categories.filter((x) => x.id !== c.id);
  const confirm = async () => {
    if (target === null) return;
    if (action.kind === "delete") {
      await remove(c, target);
      return setTarget(null);
    }
    const ok = await run(() =>
      action.kind === "move" ? request("PATCH", `/categories/${c.id}`, { parentId: target }) : request("POST", `/categories/${c.id}/merge`, { into: target }),
    );
    if (ok) close();
  };
  const title = action.kind === "move" ? `Flytta ${c.name}` : action.kind === "merge" ? `Slå ihop ${c.name}` : `Ta bort ${c.name}`;
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent aria-describedby="category-action-desc">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription id="category-action-desc" className="mt-1">
          {action.kind === "move"
            ? "Välj huvudkategori. Raderna och reglerna följer med."
            : action.kind === "merge"
              ? `Allt i ${c.name}${hasChildren ? " (och underkategorierna)" : ""} flyttas till den du väljer, och ${c.name} tas bort.`
              : `${c.name} har ${describeNeeds(action.needs!)}. Välj vart de ska flyttas innan kategorin tas bort.`}
        </DialogDescription>
        <div className="mt-4">
          {action.kind === "move" ? (
            <select aria-label="Huvudkategori" className={select} value={target ?? ""} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Välj huvudkategori…</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <CategorySelect categories={options} value={target} onChange={setTarget} emptyLabel="Välj kategori…" allowCreate={false} className={select} />
          )}
          {target !== null && action.kind !== "move" && <p className="mt-2 text-xs text-muted">Till {path(target)}.</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Avbryt
          </Button>
          <Button variant={action.kind === "delete" ? "danger" : "primary"} disabled={target === null} onClick={confirm}>
            {action.kind === "move" ? "Flytta" : action.kind === "merge" ? "Slå ihop" : "Flytta och ta bort"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
