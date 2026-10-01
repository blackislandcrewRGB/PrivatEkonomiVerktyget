import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { sendJson, type Category, type MerchantCategoryMapping } from "../../api";
import { CategoryChip } from "../../components/CategoryChip";
import { CategoryPicker } from "../../components/CategoryPicker";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { fold } from "./treeFilter";

type Filter = "missing" | "all";

/** How long a row that got its category takes to fade out of 'Ej kopplade'. */
const FADE_MS = 300;

/**
 * A bank category worth mapping: none of ours yet, and rows of it still
 * without a category. One whose rows all got theirs from the rules is left
 * alone (the badge doesn't count it).
 */
export const needsMapping = (m: MerchantCategoryMapping) => m.categoryId === null && m.uncategorized > 0;

/**
 * Bank Norwegian's merchant categories and ours, in Design v2: 'Ej kopplade
 * · N' (chosen from the start when there are any) or 'Alla · M', and a
 * search. A row without one of ours has 'Välj kategori ▾', which opens the
 * category picker in place; once chosen, the row fades out of 'Ej kopplade'.
 * The badge, the orange edge and the orange button are for the ones whose
 * rows still lack a category. Used for card rows no rule matches; a change
 * applies to coming imports.
 */
export function MerchantMap({
  mappings,
  categories,
  filterCategory,
  onChanged,
}: {
  mappings: MerchantCategoryMapping[];
  categories: Category[];
  filterCategory: number | null;
  onChanged: (m: MerchantCategoryMapping) => void;
}) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Filter | null>(null);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<{ m: MerchantCategoryMapping; anchor: HTMLElement } | null>(null);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const unmapped = mappings.filter((m) => m.categoryId === null).length;
  const toMap = mappings.filter(needsMapping).length;
  const filter: Filter = chosen ?? (unmapped > 0 ? "missing" : "all");
  // The start is decided once the list is in: choosing the last missing one leaves an empty 'Ej kopplade', not 'Alla'.
  useEffect(() => {
    if (chosen === null && mappings.length > 0) setChosen(unmapped > 0 ? "missing" : "all");
  }, [chosen, mappings.length, unmapped]);
  const needle = fold(q.trim());
  const inCategory = (m: MerchantCategoryMapping) =>
    filterCategory === null || m.categoryId === filterCategory || (m.categoryId !== null && byId.get(m.categoryId)?.parentId === filterCategory);
  const shown = mappings
    .filter(inCategory)
    .filter((m) => filter === "all" || m.categoryId === null || leaving.has(m.id))
    .filter((m) => !needle || fold(m.label).includes(needle))
    .sort((a, b) => Number(a.categoryId !== null && !leaving.has(a.id)) - Number(b.categoryId !== null && !leaving.has(b.id)) || b.timesSeen - a.timesSeen);

  const set = async (m: MerchantCategoryMapping, categoryId: number | null) => {
    try {
      const saved = await sendJson<MerchantCategoryMapping>("PUT", `/merchant-categories/${m.id}`, { categoryId });
      if (filter === "missing" && m.categoryId === null && saved.categoryId !== null) {
        setLeaving((l) => new Set(l).add(m.id));
        setTimeout(
          () =>
            setLeaving((l) => {
              const next = new Set(l);
              next.delete(m.id);
              return next;
            }),
          FADE_MS,
        );
      }
      // The answer is the mapping alone: its rows are the same as before.
      onChanged({ ...m, ...saved });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  const chip = (value: Filter, label: string, n: number) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setChosen(value)}
      className={cn("h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium transition-colors", filter === value ? "bg-ink text-card" : "bg-card-inset text-ink hover:bg-segment")}
    >
      {label} <span className="opacity-60 tabular-nums">· {n}</span>
    </button>
  );

  return (
    <section aria-labelledby="merchant-title" className="min-w-0 overflow-hidden rounded-card bg-card text-ink shadow-card">
      <div className="space-y-3 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="merchant-title" className="flex items-center gap-2 text-base font-semibold">
            Handlarkategorier
            {toMap > 0 && (
              <span className="rounded-full bg-caution px-1.5 py-px text-[10px] font-bold text-white" title="Bankkategorier med köp som saknar kategori">
                {toMap} saknar
              </span>
            )}
          </h2>
          <p className="min-w-56 flex-1 text-[11px] text-ink-3">används för kortrader från Bank Norwegian som ingen regel träffar · ändringar gäller kommande importer</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter" className="flex gap-1.5">
            {chip("missing", "Ej kopplade", unmapped)}
            {chip("all", "Alla", mappings.length)}
          </div>
          <label className="relative ml-auto min-w-40 flex-1 basis-48 sm:max-w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              aria-label="Sök bankens kategorier"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Sök bankens kategori"
              className="h-8 w-full rounded-[9px] bg-card-inset pl-8 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>
      </div>

      <ul aria-label="Handlarkategorier">
        {shown.map((m) => {
          const missing = m.categoryId === null;
          const urgent = needsMapping(m);
          return (
            <li
              key={m.id}
              data-mapping={m.id}
              data-missing={missing || undefined}
              data-urgent={urgent || undefined}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline py-2.5 pl-4 pr-4 transition-opacity sm:pl-5 sm:pr-5",
                urgent && "shadow-[inset_3px_0_0_var(--color-caution)]",
                leaving.has(m.id) && "opacity-0",
              )}
              style={{ transitionDuration: `${FADE_MS}ms` }}
            >
              <span className="min-w-0 flex-1 basis-48 truncate text-[13px] font-medium">
                {m.label}
                {m.uncategorized > 0 && <span className="ml-2 text-[11px] font-normal text-caution-text">{m.uncategorized} köp utan kategori</span>}
              </span>
              <span className="min-w-0 flex-1 basis-40">
                {missing ? (
                  <button
                    type="button"
                    onClick={(e) => setPicker({ m, anchor: e.currentTarget })}
                    aria-label={`Välj kategori för ${m.label}`}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold hover:brightness-95",
                      urgent ? "bg-caution-soft text-caution-text" : "bg-card-inset text-ink-2",
                    )}
                  >
                    Välj kategori <ChevronDown className="size-3" aria-hidden />
                  </button>
                ) : (
                  <CategoryChip
                    categoryId={m.categoryId}
                    onClick={(e) => setPicker({ m, anchor: e.currentTarget })}
                    className="-ml-2 text-[12px]"
                    aria-label={`Vår kategori för ${m.label}`}
                  />
                )}
              </span>
              <span className="w-12 shrink-0 text-right text-[12px] text-ink-3 tabular-nums" title="Rader med kategorin i importerna">
                {m.timesSeen}
              </span>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="border-t border-hairline px-5 py-5 text-center text-[13px] text-ink-3">
            {mappings.length === 0
              ? "Inga kategorier från Bank Norwegian än. De dyker upp när fakturor importeras."
              : filter === "missing" && !needle
                ? "Alla är kopplade."
                : "Inget matchar filtret."}
          </li>
        )}
      </ul>
      <CategoryPicker
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        anchor={picker?.anchor ?? null}
        value={picker?.m.categoryId ?? null}
        includeTransfers={false}
        onPick={(c) => picker && set(picker.m, c.id)}
        title={picker ? `Kategori för ${picker.m.label}` : ""}
      />
    </section>
  );
}
