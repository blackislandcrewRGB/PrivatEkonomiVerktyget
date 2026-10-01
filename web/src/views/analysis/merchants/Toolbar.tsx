import { Check, Search } from "lucide-react";
import { FilterChip } from "../../../components/FilterChip";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Switch } from "../../../components/Switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { cn } from "../../../lib/cn";
import type { Choices, Sort } from "./list";
import type { MerchantCategory } from "./types";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "summa", label: "Summa" },
  { value: "antal", label: "Antal köp" },
  { value: "snitt", label: "Snitt per köp" },
];

/** 'Mat › Livsmedel', or just the main category's name. */
export function categoryPath(id: number | null, categories: MerchantCategory[]): string | null {
  const c = categories.find((x) => x.id === id);
  if (!c) return null;
  const parent = categories.find((x) => x.id === c.parentId);
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** The main categories in name order, each with its subcategories under. */
function menu(categories: MerchantCategory[]) {
  const sv = (a: MerchantCategory, b: MerchantCategory) => a.name.localeCompare(b.name, "sv");
  return categories
    .filter((c) => c.parentId === null)
    .sort(sv)
    .flatMap((top) => [{ c: top, sub: false }, ...categories.filter((c) => c.parentId === top.id).sort(sv).map((c) => ({ c, sub: true }))]);
}

/**
 * Topplista's toolbar (Design v2): the search (name and the bank's text),
 * the order as a segmented control, 'Kategori ▾' filtering on the
 * transactions' category, and to the right 'Slå ihop samma handlare'.
 */
export function Toolbar({
  choices,
  onChoices,
  categories,
  merge,
  onMerge,
}: {
  choices: Choices;
  onChoices: (c: Choices) => void;
  categories: MerchantCategory[];
  merge: boolean;
  onMerge: (on: boolean) => void;
}) {
  const chosen = categoryPath(choices.category, categories);
  const pick = (category: number | null) => onChoices({ ...choices, category });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-8 w-full items-center gap-1.5 rounded-[10px] bg-card-inset px-2.5 text-[13px] @[40rem]:w-56">
        <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <input
          type="search"
          aria-label="Sök handlare"
          placeholder="Sök handlare"
          value={choices.q}
          onChange={(e) => onChoices({ ...choices, q: e.target.value })}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
        />
      </label>
      <SegmentedControl<Sort> label="Sortera" appearance="v2" size="sm" options={SORT_OPTIONS} value={choices.sort} onChange={(sort) => onChoices({ ...choices, sort })} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip active={chosen !== null} caret className={cn("h-7 px-3 text-[12px]", chosen === null && "bg-card-inset shadow-none hover:bg-segment")} data-chip="category">
            {chosen ?? "Kategori"}
          </FilterChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          <DropdownMenuItem onSelect={() => pick(null)} className="gap-2">
            <Check className={cn("size-3.5", choices.category !== null && "invisible")} aria-hidden />
            Alla kategorier
          </DropdownMenuItem>
          {menu(categories).map(({ c, sub }) => (
            <DropdownMenuItem key={c.id} onSelect={() => pick(c.id)} className={cn("gap-2", !sub && "font-semibold")}>
              <Check className={cn("size-3.5", choices.category !== c.id && "invisible")} aria-hidden />
              <span className={cn(sub && "pl-3")}>{c.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Switch checked={merge} onCheckedChange={onMerge} className="ml-auto" title="Rader med samma namn (namnreglerna) räknas som en handlare">
        Slå ihop samma handlare
      </Switch>
    </div>
  );
}
