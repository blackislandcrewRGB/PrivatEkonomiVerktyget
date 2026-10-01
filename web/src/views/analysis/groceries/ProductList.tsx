import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";
import { shortDate, type Product, type ProductGroup } from "../../../api";
import { FilterChip } from "../../../components/FilterChip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { cn } from "../../../lib/cn";
import { useWidth } from "../../../lib/useWidth";
import { setSearch, useSearch } from "../../../shell/routes";
import { CsvButton, Money } from "../common";
import { PAGE, SORT_LABEL, SORT_MENU, filterProducts, listFromSearch, listSearch, shelfChips, sortProducts, type ProductSort, type ShelfFilter } from "./listOrder";
import { shelfColour } from "./shelves";

/** A chip's width with the gap after it, near enough (measured: 6,4 px a character at 12 px, 16 px padding, 6 px gap); 'fler ▾' 68. */
const chipWidth = (label: string) => Math.ceil(label.length * 6.5) + 24;
const MORE = 68;
/**
 * How many shelves stand as chips before 'fler ▾': as many as the row has
 * room for after Alla and Utan hylla, at most five, keeping room for 'fler'.
 * On a phone (under 640 px) all of them, and the row scrolls sideways.
 */
function chipsThatFit(room: number, cardWidth: number, fixed: string[], labels: string[]): number {
  if (cardWidth < 640) return labels.length;
  let left = room - fixed.reduce((s, l) => s + chipWidth(l), 0);
  let n = 0;
  for (const l of labels.slice(0, 5)) {
    const rest = labels.length - n - 1 > 0 ? MORE : 0;
    if (chipWidth(l) + rest > left) break;
    left -= chipWidth(l);
    n++;
  }
  return n;
}
const chip = "h-7 px-3 text-[12px]";
const idle = "bg-card-inset shadow-none hover:bg-segment";
/** Senast is left out on a narrow card (a phone), and the shelf goes under the name. */
const wide = "hidden @[36rem]:table-cell";

/** A grocery's shelf as a pill with its colour, over a native select to change it; orange without one. */
function ShelfPill({ product, groups, disabled, onChange }: { product: Product; groups: ProductGroup[]; disabled: boolean; onChange: (groupId: number | null) => void }) {
  const none = product.groupId === null;
  return (
    <span
      className={cn(
        "relative inline-flex h-6 max-w-44 items-center gap-1.5 rounded-full px-2.5 text-[11px]",
        none ? "bg-caution-soft text-caution-text" : "bg-card-inset text-ink",
      )}
      data-shelf-pill={none ? "none" : product.groupId}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: shelfColour({ id: product.groupId, name: product.groupName, color: product.groupColor }) }} aria-hidden />
      <span className="truncate">{product.groupName ?? "Utan hylla"}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      <select
        aria-label={`Hylla för ${product.name}`}
        value={none ? "" : String(product.groupId)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
      >
        <option value="">Utan hylla</option>
        {groups.map((g) => (
          <option key={g.id} value={String(g.id)}>
            {g.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Matvaror's list (Design v2): a search, the shelves as chips with how many
 * groceries each (Utan hylla orange while any wait), and the order; the
 * filter and the order stand in the address. The groceries without a shelf
 * are named in an orange row with Visa dem and Föreslå hyllor. A row: its
 * checkbox (for merging), the name with 'N namn' when the shops printed
 * more than one, the shelf as a pill to change it, times, last and total.
 * Fifty at a time, with Visa fler.
 */
export function ProductList({
  rows,
  groups,
  busy,
  selected,
  onToggle,
  onOpen,
  onShelf,
  onSuggest,
  footer,
}: {
  rows: Product[];
  groups: ProductGroup[];
  busy: boolean;
  selected: number[];
  onToggle: (id: number) => void;
  onOpen: (id: number) => void;
  onShelf: (product: Product, groupId: number | null) => void;
  onSuggest: () => void;
  footer?: ReactNode;
}) {
  const search = useSearch();
  const { shelf, sort } = listFromSearch(new URLSearchParams(search));
  const [text, setText] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [measure, width] = useWidth<HTMLElement>(1200);
  const [measureRow, room] = useWidth(1000);
  // 36 rem, as the container query that leaves out Senast.
  const narrow = width < 576;
  const setList = (next: { shelf?: ShelfFilter; sort?: ProductSort }) =>
    setSearch(listSearch(window.location.search, { shelf, sort, ...next }), { replace: true });

  const shown = useMemo(() => sortProducts(filterProducts(rows, shelf, text), sort), [rows, shelf, text, sort]);
  // A new filter, order or search starts from the top again.
  useEffect(() => setLimit(PAGE), [shelf, sort, text]);
  const unplaced = rows.filter((p) => p.groupId === null).length;
  const chips = shelfChips(rows, groups);
  const visible = chips.slice(0, chipsThatFit(room, width, [`Alla · ${rows.length}`, `Utan hylla · ${unplaced}`], chips.map((g) => `${g.name} · ${g.count}`)));
  const active = chips.find((g) => String(g.id) === shelf);
  if (active && !visible.includes(active)) visible.push(active);
  const more = chips.filter((g) => !visible.includes(g));

  return (
    <section ref={measure} className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="products-title" data-card="products">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4 sm:px-6">
        <div className="min-w-0">
          <h2 id="products-title" className="text-[15px] font-semibold">
            Matvaror <span className="text-[12px] font-normal text-ink-3">· {rows.length} varor ur kvittona</span>
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">namn och hyllor är dina svar och ändrar ingen summa · ett kvitto räknas helt, oavsett Min del och Hushållet</p>
        </div>
        <CsvButton
          filename="matvaror"
          header={["Vara", "Hylla", "Gånger", "Senast", "Totalt"]}
          rows={() => shown.map((p) => [p.name, p.groupName ?? "", p.times, p.lastPurchase ?? "", (p.totalOre / 100).toFixed(2).replace(".", ",")])}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 sm:px-6">
        <label className="flex h-8 w-full items-center gap-1.5 rounded-[10px] bg-card-inset px-2.5 text-[13px] @[40rem]:w-52">
          <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
          <input aria-label="Sök vara" placeholder="Sök vara" value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
        </label>
        {/* On a phone the chips scroll sideways. */}
        <div className="-mx-5 flex w-[calc(100%+2.5rem)] min-w-0 gap-1.5 overflow-x-auto px-5 [scrollbar-width:none] @[40rem]:mx-0 @[40rem]:w-auto @[40rem]:flex-1 @[40rem]:px-0" ref={measureRow} role="group" aria-label="Hylla">
          <FilterChip active={shelf === "all"} className={cn(chip, shelf !== "all" && idle)} onClick={() => setList({ shelf: "all" })} data-chip="all">
            Alla · {rows.length}
          </FilterChip>
          <FilterChip
            active={shelf === "unplaced"}
            className={cn(chip, shelf !== "unplaced" && (unplaced > 0 ? "bg-caution-soft text-caution-text shadow-none hover:bg-caution-soft/70" : idle))}
            onClick={() => setList({ shelf: "unplaced" })}
            data-chip="unplaced"
          >
            Utan hylla · {unplaced}
          </FilterChip>
          {visible.map((g) => (
            <FilterChip key={g.id} active={shelf === String(g.id)} className={cn(chip, shelf !== String(g.id) && idle)} onClick={() => setList({ shelf: String(g.id) })} data-chip={g.id}>
              {g.name} · {g.count}
            </FilterChip>
          ))}
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <FilterChip active={false} caret className={cn(chip, idle)} data-chip="more">
                  fler
                </FilterChip>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {more.map((g) => (
                  <DropdownMenuItem key={g.id} onSelect={() => setList({ shelf: String(g.id) })} className="gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: shelfColour(g) }} aria-hidden />
                    <span className="flex-1">{g.name}</span>
                    <span className="text-ink-3 tabular-nums">{g.count}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap text-[12px] text-ink-2 hover:text-ink">
              Sortering: {SORT_LABEL[sort]}
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {(Object.keys(SORT_MENU) as ProductSort[]).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => setList({ sort: s })} className="justify-between gap-4">
                {SORT_MENU[s]}
                {sort === s && <Check className="size-3.5" aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {unplaced > 0 && (
        <div className="mx-5 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-inset bg-caution-soft px-4 py-2.5 text-[13px] sm:mx-6" role="note" aria-label="Utan hylla">
          <span className="min-w-0 basis-full text-ink-2 @[36rem]:basis-0 @[36rem]:flex-1">
            <span className="mr-1.5 font-bold text-caution-text" aria-hidden>
              !
            </span>
            {unplaced === 1 ? "En vara väntar på en hylla" : `${unplaced} varor väntar på en hylla`} – reglerna känner inte igen {unplaced === 1 ? "dess namn" : "deras namn"}.
          </span>
          <button type="button" onClick={() => setList({ shelf: "unplaced" })} className="font-medium text-accent hover:underline">
            Visa dem
          </button>
          <button type="button" disabled={busy} onClick={onSuggest} title="Kör reglerna en gång till över varorna utan hylla" className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-50">
            <Sparkles className="size-3.5" aria-hidden /> Föreslå hyllor
          </button>
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12px] @[36rem]:text-[13px]" aria-label="Matvaror">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="w-8 py-2 pl-5 font-normal sm:pl-6" aria-label="Välj" />
              <th className="py-2 pl-2 pr-3 text-left font-normal">Vara</th>
              {!narrow && <th className="px-3 py-2 text-left font-normal">Hylla</th>}
              <th className="px-2 py-2 text-right font-normal @[36rem]:px-3">Gånger</th>
              <th className={cn(wide, "px-3 py-2 text-right font-normal")}>Senast</th>
              <th className="py-2 pl-2 pr-5 text-right font-normal sm:pr-6 @[36rem]:pl-3">Totalt</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((p) => (
              <tr key={p.id} className={cn("border-b border-hairline hover:bg-band", selected.includes(p.id) && "bg-band")} data-product={p.id}>
                <td className="py-2 pl-5 sm:pl-6">
                  <input type="checkbox" aria-label={`Välj ${p.name}`} checked={selected.includes(p.id)} onChange={() => onToggle(p.id)} className="size-4 accent-accent" />
                </td>
                <td className="w-full max-w-0 py-2 pl-2 pr-3">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <button type="button" onClick={() => onOpen(p.id)} className="min-w-0 truncate text-left font-medium hover:underline">
                      {p.name}
                    </button>
                    {p.aliases.length > 1 && <span className="shrink-0 text-[11px] text-ink-3">{p.aliases.length} namn</span>}
                  </span>
                  {/* On a phone the shelf goes under the name (one pill, so one control). */}
                  {narrow && (
                    <span className="mt-1 block">
                      <ShelfPill product={p} groups={groups} disabled={busy} onChange={(id) => onShelf(p, id)} />
                    </span>
                  )}
                </td>
                {!narrow && (
                  <td className="px-3 py-2">
                    <ShelfPill product={p} groups={groups} disabled={busy} onChange={(id) => onShelf(p, id)} />
                  </td>
                )}
                <td className="px-2 py-2 text-right tabular-nums text-ink-2 @[36rem]:px-3">{p.times || <span className="text-ink-3">–</span>}</td>
                <td className={cn(wide, "whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2")}>{p.lastPurchase ? shortDate(p.lastPurchase) : <span className="text-ink-3">–</span>}</td>
                <td className="whitespace-nowrap py-2 pl-2 pr-5 text-right font-semibold tabular-nums sm:pr-6 @[36rem]:pl-3">
                  <Money ore={p.totalOre} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="px-5 py-6 text-center text-[13px] text-ink-3 sm:px-6">Ingen vara matchar.</p>}

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-5 py-3 text-[12px] sm:px-6">
        <span className="text-ink-3 tabular-nums" data-testid="products-count">
          {Math.min(limit, shown.length)} av {shown.length} visas
        </span>
        {shown.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="font-medium text-accent hover:underline">
            Visa {Math.min(PAGE, shown.length - limit)} till ›
          </button>
        )}
      </div>
      {footer}
    </section>
  );
}
