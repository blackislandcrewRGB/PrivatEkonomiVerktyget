import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { getJson, type CategoryUsage, type LabelRule, type MerchantCategoryMapping, type Rule } from "../../api";
import { openNewCategoryDialog, reloadCategories, useCategories } from "../../categories";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { clearCategorySuggestions } from "../../components/CategoryPicker";
import { isTyping } from "../../shell/hotkeys";
import { cn } from "../../lib/cn";
import { useWidth } from "../../lib/useWidth";
import { HeaderActions } from "../../shell/PageHeader";
import { setSearch, useSearch } from "../../shell/routes";
import { ShortcutsDialog, type ShortcutGroups } from "../transactions/ShortcutsDialog";
import { CategoryTree } from "./CategoryTree";
import { MerchantMap, needsMapping } from "./MerchantMap";
import { NameRules } from "./NameRules";
import { RulesPanel, type RulesKeys } from "./RulesPanel";

const SHORTCUTS: ShortcutGroups = [
  {
    group: "Regler",
    items: [
      { keys: [["/"]], label: "Sök bland reglerna" },
      { keys: [["↓"], ["j"]], label: "Nästa regel" },
      { keys: [["↑"], ["k"]], label: "Föregående regel" },
      { keys: [["enter"]], label: "Ändra mönstret" },
      { keys: [["c"]], label: "Byt kategori" },
      { keys: [["d"]], label: "Ta bort regeln (med Ångra)" },
      { keys: [["t"]], label: "Testa mönster" },
    ],
  },
  {
    group: "Vyn",
    items: [
      { keys: [["h"]], label: "Regler / Namnregler / Handlarkategorier" },
      { keys: [["?"]], label: "Den här rutan" },
    ],
  },
];

type Tab = "tree" | "rules" | "names" | "merchants";
const TAB_PARAM: Record<Tab, string | null> = { tree: "kategorier", rules: null, names: "namnregler", merchants: "handlarkategorier" };
/** Below this width (the view's own) the tree is a tab of its own rather than a column. */
const SPLIT_PX = 832;

/**
 * Kategorier & regler: the category tree on the left (click filters the
 * right side), the rules, the name rules or Bank Norwegian's merchant
 * categories on the right. Narrower than 52 rem, the tree is a tab of its
 * own ('Kategorier' first), and choosing a category there goes on to its
 * rules. Tab and category filter live in the URL
 * (?flik=handlarkategorier&kategori=5).
 */
export function CategoriesView() {
  const categories = useCategories();
  const [rules, setRules] = useState<Rule[]>([]);
  const [mappings, setMappings] = useState<MerchantCategoryMapping[]>([]);
  const [nameRules, setNameRules] = useState<LabelRule[]>([]);
  const [usage, setUsage] = useState<CategoryUsage>({});
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const rulesKeys = useRef<RulesKeys | null>(null);

  const [measure, width] = useWidth(1200);
  const split = width >= SPLIT_PX;
  // Phones: short tab names without counts, so all four fit.
  const tight = width < 480;
  const TABS: Tab[] = split ? ["rules", "names", "merchants"] : ["tree", "rules", "names", "merchants"];
  const params = new URLSearchParams(useSearch());
  const tab: Tab = TABS.find((t) => TAB_PARAM[t] !== null && TAB_PARAM[t] === params.get("flik")) ?? "rules";
  const selectedParam = Number(params.get("kategori"));
  const selected = categories.some((c) => c.id === selectedParam) ? selectedParam : null;
  const setView = (next: { tab?: Tab; category?: number | null }) => {
    const p = new URLSearchParams();
    const flik = TAB_PARAM[next.tab ?? tab];
    if (flik) p.set("flik", flik);
    const cat = next.category !== undefined ? next.category : selected;
    if (cat !== null) p.set("kategori", String(cat));
    const s = p.toString();
    setSearch(s ? `?${s}` : "", { replace: true });
  };

  const loadRules = useCallback(() => getJson<Rule[]>("/rules").then(setRules), []);
  const loadUsage = useCallback(() => getJson<CategoryUsage>("/categories/usage").then(setUsage), []);
  const loadNameRules = useCallback(() => getJson<LabelRule[]>("/label-rules").then((r) => setNameRules(Array.isArray(r) ? r : []), () => {}), []);
  useEffect(() => {
    loadRules();
    loadUsage();
    getJson<MerchantCategoryMapping[]>("/merchant-categories").then(setMappings);
    loadNameRules();
  }, [loadRules, loadUsage, loadNameRules]);
  // After any change: categories everywhere, counts, rules and cached suggestions.
  const changed = useCallback(async () => {
    setError(null);
    clearCategorySuggestions();
    await Promise.all([reloadCategories(), loadUsage(), loadRules()]);
  }, [loadRules, loadUsage]);

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || help) return;
    if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
    const r = rulesKeys.current;
    const handled = () => e.preventDefault();
    switch (e.key) {
      case "h":
        handled();
        return setView({ tab: TABS[(TABS.indexOf(tab) + 1) % TABS.length] });
      case "?":
        handled();
        return setHelp(true);
    }
    if (tab !== "rules" || !r) return;
    switch (e.key) {
      case "/":
        handled();
        return r.focusSearch();
      case "ArrowDown":
      case "j":
        handled();
        return r.move(1);
      case "ArrowUp":
      case "k":
        handled();
        return r.move(-1);
      case "Enter":
        handled();
        return r.edit();
      case "c":
        handled();
        return r.pickCategory();
      case "d":
        handled();
        return r.remove();
      case "t":
        handled();
        return r.test();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Only bank categories whose rows still lack a category count: the rest have theirs from the rules.
  const unmapped = mappings.filter(needsMapping).length;
  // As a tab (narrow), choosing a category goes on to its rules.
  const tree = (asTab: boolean) => (
    <CategoryTree
      categories={categories}
      usage={usage}
      selected={selected}
      onSelect={(id) => setView(asTab && id !== null ? { category: id, tab: "rules" } : { category: id })}
      onChanged={changed}
      onError={setError}
      className={asTab ? undefined : "sticky top-4"}
    />
  );
  return (
    <div className="space-y-4">
      <HeaderActions>
        <Button
          size="sm"
          onClick={() => openNewCategoryDialog(null).then((c) => c && changed())}
          className="h-9 rounded-[10px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover"
        >
          <Plus /> Ny huvudkategori
        </Button>
      </HeaderActions>
      {error && <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>}

      <div ref={measure} className={cn("grid grid-cols-1 items-start gap-5", split && "grid-cols-[340px_minmax(0,1fr)]")}>
        {split && tree(false)}

        <section className="min-w-0 space-y-3">
          <SegmentedControl<Tab>
            label="Visa"
            appearance="v2"
            size={tight ? "sm" : "md"}
            className="max-w-full overflow-x-auto"
            options={[
              ...(split ? [] : [{ value: "tree" as const, label: "Kategorier" }]),
              { value: "rules", label: <TabLabel name="Regler" count={tight ? undefined : rules.length} /> },
              { value: "names", label: <TabLabel name={tight ? "Namn" : "Namnregler"} count={tight ? undefined : nameRules.length} /> },
              {
                value: "merchants",
                label: (
                  <TabLabel name={tight ? "Handlare" : "Handlarkategorier"}>
                    {unmapped > 0 && (
                      <span data-badge="unmapped" className="rounded-full bg-caution px-1.5 py-px text-[10px] font-bold text-white">
                        {tight ? unmapped : `${unmapped} saknar`}
                      </span>
                    )}
                  </TabLabel>
                ),
              },
            ]}
            value={tab}
            onChange={(t) => setView({ tab: t })}
          />
          {tab === "tree" ? (
            tree(true)
          ) : tab === "rules" ? (
            <RulesPanel rules={rules} categories={categories} filterCategory={selected} onClearFilter={() => setView({ category: null })} onChanged={changed} keysRef={rulesKeys} />
          ) : tab === "names" ? (
            <NameRules rules={nameRules} onChanged={loadNameRules} />
          ) : (
            <MerchantMap
              mappings={mappings}
              categories={categories}
              filterCategory={selected}
              onChanged={(m) => setMappings((ms) => ms.map((x) => (x.id === m.id ? m : x)))}
            />
          )}
        </section>
      </div>
      <ShortcutsDialog open={help} onOpenChange={setHelp} title="Kortkommandon i Kategorier & regler" groups={SHORTCUTS} />
    </div>
  );
}

/** A tab's name with its count in grey ('Regler 220'), or a badge after it. */
function TabLabel({ name, count, children }: { name: string; count?: number; children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {name}
      {count !== undefined && <span className="font-normal tabular-nums opacity-55">{count}</span>}
      {children}
    </span>
  );
}
