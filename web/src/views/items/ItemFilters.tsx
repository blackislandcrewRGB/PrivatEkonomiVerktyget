import { Check, ChevronDown, X } from "lucide-react";
import type { ItemList, ItemOwner, ItemStatus } from "../../api";
import { FilterChip } from "../../components/FilterChip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { activeFilters, monthLabel, ownerLabel, SORT_LABELS, type Filters, type Sort } from "./filters";
import { STATUS_LABELS } from "./ItemPanel";

type Option = { value: string; label: string; hint?: string };

/**
 * Prylar's filters as chips under the header (Design v2): År, Kategori,
 * Handlare, Vems and Status each open a menu of their choices; one that is on
 * is black with its value and ✕, and a click takes it off. A month (from a
 * bar in the calendar) and the search show as chips of their own. 'Rensa'
 * when anything is on; the order to the right. On a phone the row scrolls
 * sideways.
 */
export function ItemFilters({
  filters,
  set,
  onClear,
  data,
  partnerName,
  sort,
  onSort,
}: {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  onClear: () => void;
  data: ItemList | null;
  partnerName: string;
  sort: Sort;
  onSort: (s: Sort) => void;
}) {
  const on = (label: string, onRemove: () => void, key: string) => (
    <FilterChip key={key} active onClick={onRemove} aria-label={`Ta bort filtret ${label}`}>
      <span className="inline-flex items-center gap-1">
        {label}
        <X className="size-3.5 opacity-70" aria-hidden />
      </span>
    </FilterChip>
  );
  const menu = (key: keyof Filters, name: string, options: Option[], label: (value: string) => string) =>
    filters[key] ? (
      on(label(filters[key]), () => set({ [key]: "" }), key)
    ) : (
      <DropdownMenu key={key}>
        <DropdownMenuTrigger asChild>
          <FilterChip active={false} caret disabled={options.length === 0}>
            {name}
          </FilterChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {options.map((o) => (
            <DropdownMenuItem key={o.value} onSelect={() => set({ [key]: o.value })} className="justify-between gap-4">
              {o.label}
              {o.hint && <span className="text-[11px] text-ink-3 tabular-nums">{o.hint}</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  const owners: ItemOwner[] = ["me", "shared", "partner"];
  return (
    <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] nav:mx-0 nav:flex-wrap nav:overflow-visible nav:px-0" role="group" aria-label="Filter">
      {menu(
        "year",
        "År",
        (data?.years ?? []).map((y) => ({ value: y, label: y })),
        (y) => `År: ${y}`,
      )}
      {filters.month && on(`Månad: ${monthLabel(filters.month)}`, () => set({ month: "" }), "month")}
      {menu(
        "category",
        "Kategori",
        (data?.categories ?? []).map((c) => ({ value: c, label: c })),
        (c) => `Kategori: ${c}`,
      )}
      {menu(
        "merchant",
        "Handlare",
        (data?.merchants ?? []).map((m) => ({ value: m.name, label: m.name, hint: String(m.count) })),
        (m) => `Handlare: ${m}`,
      )}
      {menu(
        "owner",
        "Vems",
        owners.map((o) => ({ value: o, label: ownerLabel(o, partnerName) })),
        (o) => ownerLabel(o as ItemOwner, partnerName),
      )}
      {menu(
        "status",
        "Status",
        (Object.keys(STATUS_LABELS) as ItemStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
        (s) => `Status: ${STATUS_LABELS[s as ItemStatus]}`,
      )}
      {filters.q && on(`Sök: ”${filters.q}”`, () => set({ q: "" }), "q")}

      {activeFilters(filters) > 0 && (
        <button type="button" onClick={onClear} className="shrink-0 whitespace-nowrap px-1 text-[13px] font-medium text-accent hover:underline">
          Rensa
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap pl-2 text-[13px] text-ink-2 hover:text-ink">
            Sortering: {SORT_LABELS[sort]}
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {(
            [
              ["date", "Datum, nyast först"],
              ["price", "Pris, dyrast först"],
              ["name", "Namn, A–Ö"],
            ] as const
          ).map(([value, label]) => (
            <DropdownMenuItem key={value} onSelect={() => onSort(value)} className="justify-between gap-4">
              {label}
              {sort === value && <Check className="size-3.5" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
