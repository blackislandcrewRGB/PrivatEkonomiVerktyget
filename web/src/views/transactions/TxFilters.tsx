import { forwardRef, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { getJson, shortDate, type Category } from "../../api";
import { cn } from "../../lib/cn";
import { categoryColor } from "../../lib/palette";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { KeyHint, Kbd } from "../../components/KeyHint";
import { SegmentedControl } from "../../components/SegmentedControl";
import { FilterChip as Chip } from "../../components/FilterChip";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Button } from "../../components/ui/button";
import { activeCount, addMonths, currentMonth, monthLabel, periodLabel, type Filters } from "./filters";
import type { PageContext } from "./TransactionsPage";
import { todayIso } from "../../lib/today";

type Update = (patch: Partial<Filters>, opts?: { replace?: boolean }) => void;

interface Invoice {
  month: string;
  from: string;
  to: string;
  payDate: string;
}

/** ‹ september 2026 › with a menu of months, Norwegian invoices, all dates and a custom range. */
export function PeriodPicker({ filters, update, onStep }: { filters: Filters; update: Update; onStep: (step: -1 | 1) => void }) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [range, setRange] = useState({ from: filters.from, to: filters.to });
  useEffect(() => {
    getJson<Invoice[]>("/shared/invoices?count=12").then(setInvoices, () => setInvoices([]));
  }, []);
  useEffect(() => setRange({ from: filters.from, to: filters.to }), [filters.from, filters.to]);
  const months = useMemo(() => Array.from({ length: 24 }, (_, i) => addMonths(currentMonth(), -i)), []);
  const today = todayIso();
  const choose = (patch: Partial<Filters>) => {
    update({ from: "", to: "", ...patch });
    setOpen(false);
  };

  return (
    <div className="flex h-9 items-center gap-0.5 rounded-[10px] bg-segment p-[3px]">
      <KeyHint label="Föregående månad" keys={["←"]}>
        <button type="button" onClick={() => onStep(-1)} className="grid h-full w-7 place-items-center rounded-lg text-ink-2 hover:bg-segment-on/50 hover:text-ink" aria-label="Föregående månad">
          <ChevronLeft className="size-4" />
        </button>
      </KeyHint>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="flex h-full min-w-36 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-segment-on px-3 text-[13px] font-semibold text-ink shadow-segment">
            {periodLabel(filters)}
            <ChevronDown className="size-3.5 text-ink-2" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-72 p-2">
          <div className="grid grid-cols-3 gap-1">
            {months.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => choose({ period: m })}
                className={cn(
                  "rounded-md px-2 py-1 text-left text-xs capitalize hover:bg-surface-hover",
                  filters.period === m && "bg-surface-muted font-medium",
                )}
              >
                {monthLabel(m)}
              </button>
            ))}
          </div>
          <div className="my-2 h-px bg-border" />
          <button type="button" onClick={() => choose({ period: "all" })} className="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-surface-hover">
            Alla datum
          </button>
          {invoices.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted">Bank Norwegian-faktura (bokföringsdag)</p>
              {invoices.slice(0, 6).map((inv) => (
                <button
                  key={inv.month}
                  type="button"
                  onClick={() => choose({ period: `inv:${inv.month}` })}
                  className={cn(
                    "w-full rounded-md px-2 py-1 text-left text-xs hover:bg-surface-hover",
                    filters.period === `inv:${inv.month}` && "bg-surface-muted font-medium",
                  )}
                >
                  Faktura {shortDate(inv.payDate)} · köp {shortDate(inv.from)}–{shortDate(inv.to)}
                  {inv.to >= today ? " (pågår)" : ""}
                </button>
              ))}
            </>
          )}
          <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted">Anpassad</p>
          <form
            className="flex items-center gap-1 px-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (range.from || range.to) choose({ period: "range", ...range });
            }}
          >
            <input type="date" aria-label="Från" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="min-w-0 flex-1 rounded border border-border bg-surface px-1 text-xs" />
            <span className="text-subtle">–</span>
            <input type="date" aria-label="Till" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="min-w-0 flex-1 rounded border border-border bg-surface px-1 text-xs" />
            <Button type="submit" size="sm" variant="secondary">
              Visa
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <KeyHint label="Nästa månad" keys={["→"]}>
        <button type="button" onClick={() => onStep(1)} className="grid h-full w-7 place-items-center rounded-lg text-ink-2 hover:bg-segment-on/50 hover:text-ink" aria-label="Nästa månad">
          <ChevronRight className="size-4" />
        </button>
      </KeyHint>
    </div>
  );
}

/** The search in the header. / focuses it; Enter or Esc goes back to the list. */
export const SearchBox = forwardRef<HTMLInputElement, { value: string; onChange: (q: string) => void }>(function SearchBox({ value, onChange }, ref) {
  const [q, setQ] = useState(value);
  useEffect(() => setQ(value), [value]);
  // Debounced into the URL (replace, so typing doesn't fill the history).
  useEffect(() => {
    if (q === value) return;
    const t = setTimeout(() => onChange(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <label className="relative flex min-w-0 flex-1 items-center max-sm:order-last max-sm:basis-full nav:flex-none">
      <Search className="pointer-events-none absolute left-2.5 size-4 text-ink-3" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            if (e.key === "Escape" && q) setQ("");
            onChange(e.key === "Escape" ? "" : q);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Sök text, belopp, kontakt…"
        aria-label="Sök transaktioner"
        className="h-9 w-full min-w-0 rounded-[10px] bg-segment pl-8 pr-9 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent/30 nav:w-64 [&::-webkit-search-cancel-button]:hidden"
      />
      <Kbd keys={["/"]} className="pointer-events-none absolute right-2 border-0 bg-segment-on text-ink-2 shadow-segment" />
    </label>
  );
});

const SOURCE_NAMES: Record<Exclude<Filters["source"], "">, string> = { swedbank: "Swedbank", norwegian: "Bank Norwegian", mastercard: "Mastercard", manual: "Manuella" };

/**
 * The filters as a row of chips under the summary: Utan kategori (with how
 * many there are in the period), Konto ▾ and Kategori ▾ (today's panels),
 * Delade med partnern, Återkommande, Med kvitto, then 'Fler ▾' with the
 * rest; a filter on from there, and the search, shows as its own chip with ×.
 * The order sits to the right. On a phone the row scrolls sideways.
 */
export function FilterChips({
  filters,
  update,
  onClear,
  ctx,
  uncategorized,
}: {
  filters: Filters;
  update: Update;
  onClear: () => void;
  ctx: PageContext;
  /** Rows without a category in the period (with the other filters); null until known. */
  uncategorized: number | null;
}) {
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const account = ctx.accounts.find((a) => String(a.id) === filters.account);
  const [accountOpen, setAccountOpen] = useState(false);

  // The filters under 'Fler' that are on, each as a chip that takes it off.
  const removable: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.uncategorized && filters.includeUnknown) removable.push({ key: "unknown", label: "inkl. Okänt", onRemove: () => update({ includeUnknown: false }) });
  if (filters.source) removable.push({ key: "source", label: `Källa: ${SOURCE_NAMES[filters.source]}`, onRemove: () => update({ source: "" }) });
  if (filters.owner === "own") removable.push({ key: "owner", label: "Bara egna", onRemove: () => update({ owner: "" }) });
  if (filters.owner === "other") removable.push({ key: "owner", label: `Bara ${ctx.partnerName}s`, onRemove: () => update({ owner: "" }) });
  if (filters.transfers) removable.push({ key: "transfers", label: "Med överföringar", onRemove: () => update({ transfers: false }) });
  if (filters.privateOnly) removable.push({ key: "private", label: "Bara privata", onRemove: () => update({ privateOnly: false }) });
  if (filters.min || filters.max) removable.push({ key: "amount", label: `Belopp: ${filters.min || "0"}–${filters.max || "…"} kr`, onRemove: () => update({ min: "", max: "" }) });
  if (filters.q) removable.push({ key: "q", label: `Sök: ”${filters.q}”`, onRemove: () => update({ q: "" }) });

  return (
    <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] nav:mx-0 nav:flex-wrap nav:overflow-visible nav:px-0" role="group" aria-label="Filter">
      <Chip
        active={filters.uncategorized}
        aria-pressed={filters.uncategorized}
        onClick={() => update(filters.uncategorized ? { uncategorized: false, includeUnknown: false } : { uncategorized: true, categories: [] })}
      >
        Utan kategori{uncategorized !== null && <span className="tabular-nums"> · {uncategorized}</span>}
      </Chip>

      <Popover open={accountOpen} onOpenChange={setAccountOpen}>
        <PopoverTrigger asChild>
          <Chip active={!!account} caret>
            {account ? `Konto: ${account.name}` : "Konto"}
          </Chip>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-1">
          {[{ id: "", name: "Alla konton" }, ...ctx.accounts.map((a) => ({ id: String(a.id), name: a.name }))].map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={filters.account === a.id}
              onClick={() => {
                update({ account: a.id });
                setAccountOpen(false);
              }}
              className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover", filters.account === a.id && "font-medium")}
            >
              {a.name}
              {filters.account === a.id && <Check className="size-3.5" aria-hidden />}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Chip active={filters.categories.length > 0} caret>
            {filters.categories.length ? `Kategori: ${filters.categories.map((id) => byId.get(id)?.name ?? "?").join(", ")}` : "Kategori"}
          </Chip>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2">
          <CategoryTree
            categories={ctx.categories}
            value={filters.categories}
            onChange={(categories) => update({ categories, ...(categories.length ? { uncategorized: false, includeUnknown: false } : {}) })}
          />
          {filters.categories.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => update({ categories: [] })}>
              Alla kategorier
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <Chip active={filters.owner === "shared"} aria-pressed={filters.owner === "shared"} onClick={() => update({ owner: filters.owner === "shared" ? "" : "shared" })}>
        Delade med {ctx.partnerName}
      </Chip>
      <Chip active={filters.recurring} aria-pressed={filters.recurring} onClick={() => update({ recurring: !filters.recurring })}>
        Återkommande
      </Chip>
      <Chip active={filters.receipt} aria-pressed={filters.receipt} onClick={() => update({ receipt: !filters.receipt })}>
        Med kvitto
      </Chip>

      {removable.map((c) => (
        <Chip key={c.key} active onClick={c.onRemove} aria-label={`Ta bort filtret ${c.label}`}>
          <span className="inline-flex items-center gap-1">
            {c.label}
            <X className="size-3.5 opacity-70" aria-hidden />
          </span>
        </Chip>
      ))}

      <Popover>
        <PopoverTrigger asChild>
          <Chip active={false} caret>
            Fler
          </Chip>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <MoreFilters filters={filters} update={update} ctx={ctx} />
        </PopoverContent>
      </Popover>

      {activeCount(filters) > 0 && (
        <button type="button" onClick={onClear} className="shrink-0 whitespace-nowrap px-1 text-[13px] font-medium text-accent hover:underline">
          Rensa
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap pl-2 text-[13px] text-ink-2 hover:text-ink">
            Sortering: {filters.sort === "oldest" ? "äldst först" : "datum"}
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {(
            [
              ["newest", "Datum, nyast först"],
              ["oldest", "Datum, äldst först"],
            ] as const
          ).map(([value, label]) => (
            <DropdownMenuItem key={value} onSelect={() => update({ sort: value })} className="justify-between">
              {label}
              {filters.sort === value && <Check className="size-3.5" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** 'Fler': the source, whose, the amount, Okänt with Utan kategori, transfers and private rows. */
function MoreFilters({ filters, update, ctx }: { filters: Filters; update: Update; ctx: PageContext }) {
  const [min, setMin] = useState(filters.min);
  const [max, setMax] = useState(filters.max);
  useEffect(() => {
    setMin(filters.min);
    setMax(filters.max);
  }, [filters.min, filters.max]);
  const select = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm";
  return (
    <div className="space-y-3 text-sm">
      <Row label="Källa">
        <select className={select} value={filters.source} onChange={(e) => update({ source: e.target.value as Filters["source"] })}>
          <option value="">Alla källor</option>
          <option value="swedbank">Swedbank</option>
          <option value="norwegian">Bank Norwegian</option>
          <option value="mastercard">Mastercard</option>
          <option value="manual">Manuella</option>
        </select>
      </Row>
      <Row label="Vems">
        <SegmentedControl<Filters["owner"]>
          size="sm"
          label="Vems"
          value={filters.owner}
          onChange={(owner) => update({ owner })}
          options={[
            { value: "", label: "Alla" },
            { value: "own", label: "Egna" },
            { value: "shared", label: "Delade" },
            { value: "other", label: `${ctx.partnerName}s` },
          ]}
        />
      </Row>
      <Row label="Belopp">
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            update({ min: min.trim(), max: max.trim() });
          }}
        >
          <input value={min} onChange={(e) => setMin(e.target.value)} onBlur={() => update({ min: min.trim(), max: max.trim() })} placeholder="från" inputMode="decimal" className="h-8 w-20 rounded-md border border-border bg-surface px-2" />
          <span className="text-subtle">–</span>
          <input value={max} onChange={(e) => setMax(e.target.value)} onBlur={() => update({ min: min.trim(), max: max.trim() })} placeholder="till" inputMode="decimal" className="h-8 w-20 rounded-md border border-border bg-surface px-2" />
          <span className="text-muted">kr</span>
        </form>
      </Row>
      <div className="space-y-1.5">
        {filters.uncategorized && (
          <CheckRow checked={filters.includeUnknown} onChange={(v) => update({ includeUnknown: v })}>
            Utan kategori inkl. Okänt (Vet ej)
          </CheckRow>
        )}
        <CheckRow checked={filters.transfers} onChange={(v) => update({ transfers: v })}>
          Visa överföringar
        </CheckRow>
        <CheckRow checked={filters.privateOnly} onChange={(v) => update({ privateOnly: v })}>
          Bara privata
        </CheckRow>
      </div>
    </div>
  );
}

/** Main categories with their subcategories, each with a checkbox. A checked main category includes its subcategories. */
function CategoryTree({ categories, value, onChange }: { categories: Category[]; value: number[]; onChange: (ids: number[]) => void }) {
  const on = new Set(value);
  const toggle = (id: number, children: number[]) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      children.forEach((c) => next.delete(c)); // the main category covers them
    }
    onChange([...next]);
  };
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
      {categories
        .filter((c) => c.parentId === null)
        .map((top) => {
          const kids = categories.filter((c) => c.parentId === top.id);
          return (
            <div key={top.id}>
              <CheckRow checked={on.has(top.id)} onChange={() => toggle(top.id, kids.map((k) => k.id))}>
                <span className="size-2 rounded-full" style={{ background: categoryColor(top, categories) }} />
                <span className="font-medium">{top.name}</span>
              </CheckRow>
              {!on.has(top.id) &&
                kids.map((k) => (
                  <CheckRow key={k.id} checked={on.has(k.id)} onChange={() => toggle(k.id, [])} className="pl-5">
                    {k.name}
                  </CheckRow>
                ))}
            </div>
          );
        })}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-hover", className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5" />
      <span className="flex items-center gap-1.5">{children}</span>
    </label>
  );
}
