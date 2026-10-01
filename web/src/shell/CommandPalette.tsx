import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RefreshCw,
  ArrowRight,
  CalendarPlus,
  Eye,
  EyeOff,
  Inbox,
  Monitor,
  Moon,
  PanelLeft,
  PlusCircle,
  Package,
  Scale,
  Receipt,
  Sun,
  Upload,
  Wallet,
} from "lucide-react";
import { getJson, shortDate, syncSummary, type Account, type BankStatus, type Item, type ItemList, type Transaction } from "../api";
import { usePrivacy } from "../privacy";
import { setThemePreference } from "../lib/theme";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { Kbd } from "../components/KeyHint";
import { Amount } from "../components/Amount";
import { formatKr } from "../lib/format";
import { CategoryChip } from "../components/CategoryChip";
import { navigate, openSettings, useViews, viewKey } from "./routes";
import { openManualEntry } from "../views/overview/ManualEntry";
import { requestIntent } from "./intents";
import { openTransactions } from "./openTransactions";
import { needsPreview, syncNow } from "../views/settings/bankSync";
import { notify } from "../components/Toast";

interface PaletteItem {
  id: string;
  group: "Gå till" | "Åtgärder";
  label: string;
  keywords?: string;
  icon: ReactNode;
  keys?: string[];
  run: () => void;
}

/** Lower case without accents, so 'oversikt' finds 'Översikt'. */
const fold = (s: string) =>
  s
    .toLocaleLowerCase("sv-SE")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function matchesQuery(text: string, query: string): boolean {
  const hay = fold(text);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * ⌘K: jump to a view, run an action, or search transactions (text, amount,
 * contact). Typing filters everything at once.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onToggleSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleSidebar: () => void;
}) {
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [hits, setHits] = useState<{ q: string; rows: Transaction[]; count: number } | null>(null);
  const [things, setThings] = useState<{ q: string; items: Item[] } | null>(null);
  const { showPrivate, setShowPrivate } = usePrivacy();
  const views = useViews();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits(null);
    setThings(null);
    getJson<Account[]>("/accounts").then(setAccounts, () => {});
  }, [open]);

  // Prylar by name or merchant, alongside the transactions.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return setThings(null);
    let live = true;
    const t = setTimeout(() => {
      getJson<ItemList>(`/items?q=${encodeURIComponent(q)}`).then((r) => live && setThings({ q, items: r.items.slice(0, 5) }), () => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, open]);

  // Transaction search, debounced; only for 2+ characters.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return setHits(null);
    let live = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, limit: "8", ...(showPrivate ? { showPrivate: "1" } : {}) });
      getJson<{ rows: Transaction[]; totals: { count: number } }>(`/transactions?${params}`).then(
        (r) => live && setHits({ q, rows: r.rows, count: r.totals.count }),
        () => {},
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, open, showPrivate]);

  const close = () => onOpenChange(false);
  const items = useMemo<PaletteItem[]>(
    () => [
      ...views.map((v, i) => ({
        id: `view-${v.id}`,
        group: "Gå till" as const,
        label: v.label,
        icon: <v.icon />,
        keys: viewKey(i) ? ["ctrl", viewKey(i)!] : undefined,
        run: () => navigate(v.id),
      })),
      {
        id: "review",
        group: "Gå till",
        label: "Att granska",
        keywords: "okategoriserade dubbletter",
        icon: <Inbox />,
        run: () => openTransactions({}, "review"),
      },
      {
        id: "import",
        group: "Åtgärder",
        label: "Importera fil",
        keywords: "csv xlsx pdf faktura swedbank norwegian",
        icon: <Upload />,
        run: () => {
          requestIntent({ kind: "imports.pickFile" });
          navigate("imports");
        },
      },
      {
        id: "bank-sync",
        group: "Åtgärder",
        label: "Synka banker nu",
        keywords: "enable banking hämta swedbank norwegian synk",
        icon: <RefreshCw />,
        run: () => void syncBanksFromPalette(),
      },
      ...accounts.map((a) => ({
        id: `balance-${a.id}`,
        group: "Åtgärder" as const,
        label: `Uppdatera saldo: ${a.name}`,
        keywords: "saldo konto",
        icon: <Wallet />,
        run: () => {
          requestIntent({ kind: "overview.editBalance", accountId: a.id });
          navigate("overview");
        },
      })),
      {
        id: "new-expense",
        group: "Åtgärder",
        label: "Ny fast utgift",
        keywords: "återkommande abonnemang autogiro",
        icon: <CalendarPlus />,
        run: () => {
          requestIntent({ kind: "recurring.new" });
          navigate("recurring");
        },
      },
      {
        id: "afford",
        group: "Åtgärder",
        label: "Har jag råd?",
        keywords: "köp råd kassaflöde scenario budget",
        icon: <Scale />,
        run: () => {
          requestIntent({ kind: "cashflow.afford" });
          navigate("overview", { search: "?flik=kassaflode" });
        },
      },
      {
        id: "register",
        group: "Åtgärder",
        label: "Registrera inkomst eller utgift",
        keywords: "engångs manuell kontant gåva",
        icon: <PlusCircle />,
        run: openManualEntry,
      },
      showPrivate
        ? { id: "private", group: "Åtgärder", label: "Dölj privata", keywords: "privat", icon: <EyeOff />, run: () => setShowPrivate(false) }
        : { id: "private", group: "Åtgärder", label: "Visa privata", keywords: "privat", icon: <Eye />, run: () => setShowPrivate(true) },
      { id: "theme-light", group: "Åtgärder", label: "Tema: Ljust", icon: <Sun />, run: () => setThemePreference("light") },
      { id: "theme-dark", group: "Åtgärder", label: "Tema: Mörkt", icon: <Moon />, run: () => setThemePreference("dark") },
      { id: "theme-system", group: "Åtgärder", label: "Tema: Följ systemet", icon: <Monitor />, run: () => setThemePreference("system") },
      { id: "sidebar", group: "Åtgärder", label: "Fäll ihop eller visa menyn", keywords: "sidomeny", icon: <PanelLeft />, keys: ["mod", "\\"], run: onToggleSidebar },
    ],
    [accounts, showPrivate, setShowPrivate, onToggleSidebar],
  );

  const q = query.trim();
  const shown = q ? items.filter((i) => matchesQuery(`${i.label} ${i.keywords ?? ""}`, q)) : items;
  const groups = (["Gå till", "Åtgärder"] as const).map((g) => [g, shown.filter((i) => i.group === g)] as const);
  const txHits = hits && hits.q === q ? hits : null;
  const itemHits = things && things.q === q ? things.items : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="top-[14vh] max-w-xl overflow-hidden p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Sök och kommandon</DialogTitle>
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Sök transaktioner, gå till en vy eller kör ett kommando…"
            autoFocus
          />
          <CommandList>
            <CommandEmpty>{q.length >= 2 && !txHits && itemHits.length === 0 ? "Söker…" : "Inga träffar."}</CommandEmpty>
            {itemHits.length > 0 && (
              <CommandGroup heading="Prylar">
                {itemHits.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`item-${item.id}`}
                    onSelect={() => {
                      close();
                      navigate("items");
                      requestIntent({ kind: "items.open", itemId: item.id });
                    }}
                  >
                    <Package />
                    <span className="w-10 shrink-0 text-xs text-muted tabular-nums">{shortDate(item.purchaseDate)}</span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.merchant && <span className="hidden shrink-0 text-xs text-muted sm:inline">{item.merchant}</span>}
                    <span className="shrink-0 text-[13px] tabular-nums">{formatKr(item.priceOre, { whole: true })}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {txHits && txHits.rows.length > 0 && (
              <CommandGroup heading="Transaktioner">
                {txHits.rows.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`tx-${r.id}`}
                    onSelect={() => {
                      close();
                      openTransactions({ q });
                    }}
                  >
                    <Receipt />
                    <span className="w-10 shrink-0 text-xs text-muted tabular-nums">{shortDate(r.bookingDate)}</span>
                    <span className="min-w-0 flex-1 truncate">{r.label ?? r.descriptionClean}</span>
                    <CategoryChip categoryId={r.categoryId} short className="hidden sm:inline-flex" />
                    <Amount ore={r.amount} size="sm" />
                  </CommandItem>
                ))}
                <CommandItem
                  value="tx-all"
                  onSelect={() => {
                    close();
                    openTransactions({ q });
                  }}
                >
                  <ArrowRight />
                  <span className="flex-1">
                    Visa {txHits.count === 1 ? "träffen" : `alla ${txHits.count} träffar`} för ”{q}” i Transaktioner
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(
              ([heading, list]) =>
                list.length > 0 && (
                  <CommandGroup key={heading} heading={heading}>
                    {list.map((i) => (
                      <CommandItem
                        key={i.id}
                        value={i.id}
                        onSelect={() => {
                          close();
                          i.run();
                        }}
                      >
                        {i.icon}
                        <span className="flex-1">{i.label}</span>
                        {i.keys && <Kbd keys={i.keys} />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Kbd keys={["↑"]} />
              <Kbd keys={["↓"]} /> välj
            </span>
            <span className="flex items-center gap-1">
              <Kbd keys={["enter"]} /> öppna
            </span>
            <span className="flex items-center gap-1">
              <Kbd keys={["esc"]} /> stäng
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** 'Synka banker nu': the first sync is previewed in Inställningar, later ones run here. */
async function syncBanksFromPalette() {
  try {
    const status = await getJson<BankStatus>("/enable-banking/status");
    if (!status.connections.length || needsPreview(status)) {
      notify({ text: status.connections.length ? "Första hämtningen visas först i Inställningar." : "Ingen bank är kopplad än." });
      openSettings("konton");
      return;
    }
    notify({ text: "Synkar bankerna…" });
    notify({ text: syncSummary(await syncNow()) });
  } catch (e) {
    notify({ text: (e as Error).message });
  }
}
