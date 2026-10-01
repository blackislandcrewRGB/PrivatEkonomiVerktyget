import { useMemo, useSyncExternalStore } from "react";
import { useModules, type ModuleId } from "../lib/modules";
import {
  ArrowLeftRight,
  Banknote,
  ChartColumn,
  CalendarClock,
  Fuel,
  LayoutDashboard,
  Package,
  Settings,
  Tags,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

export type ViewId =
  | "overview"
  | "transactions"
  | "recurring"
  | "commute"
  | "salary"
  | "shared"
  | "analysis"
  | "imports"
  | "categories"
  | "items"
  | "settings";

export interface ViewDef {
  id: ViewId;
  label: string;
  path: string;
  icon: LucideIcon;
  /** An optional part: in the menu only when it is switched on (Inställningar › Moduler). */
  module?: ModuleId;
}

/** The sidebar, in order; ⌘1–⌘9 and ⌘0 follow this order (see viewKey). */
export const VIEWS: ViewDef[] = [
  { id: "overview", label: "Översikt", path: "/", icon: LayoutDashboard },
  { id: "transactions", label: "Transaktioner", path: "/transaktioner", icon: ArrowLeftRight },
  { id: "recurring", label: "Fasta utgifter", path: "/fasta-utgifter", icon: CalendarClock },
  { id: "shared", label: "Delad ekonomi", path: "/delad-ekonomi", icon: Users },
  { id: "analysis", label: "Analys", path: "/analys", icon: ChartColumn },
  { id: "imports", label: "Importer", path: "/importer", icon: Upload },
  { id: "categories", label: "Kategorier & regler", path: "/kategorier", icon: Tags },
  { id: "commute", label: "Pendling & bränsle", path: "/pendling", icon: Fuel, module: "commute" },
  { id: "salary", label: "Lön", path: "/lon", icon: Banknote, module: "salary" },
  { id: "items", label: "Prylar", path: "/prylar", icon: Package },
  { id: "settings", label: "Inställningar", path: "/installningar", icon: Settings },
];

export const viewDef = (id: ViewId) => VIEWS.find((v) => v.id === id)!;

/** The views in the menu: the optional ones only when they are on. ⌘1–⌘0 follow this order. */
export function useViews(): ViewDef[] {
  const { modules } = useModules();
  return useMemo(() => VIEWS.filter((v) => !v.module || modules[v.module]), [modules]);
}

/** The number key for the view at an index: 1–9, then 0 for the tenth. */
export const viewKey = (i: number) => (i < 9 ? String(i + 1) : i === 9 ? "0" : null);

function viewFromPath(pathname: string): ViewId {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return (
    VIEWS.find((v) => v.path === clean)?.id ??
    VIEWS.find((v) => v.path !== "/" && clean.startsWith(`${v.path}/`))?.id ??
    "overview"
  );
}

// The current view (and its sub-page and filters) live in the URL, so
// back/forward, reloads and links work.
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") window.addEventListener("popstate", emit);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// The transaction list remembers its last filters for the session, so the
// sidebar brings you back to what you were looking at.
const LAST_TX_SEARCH = "transactions.search";
export function rememberTransactionsSearch(search: string) {
  try {
    sessionStorage.setItem(LAST_TX_SEARCH, search);
  } catch {
    // Not remembered; fine.
  }
}
function rememberedTransactionsSearch(): string {
  try {
    return sessionStorage.getItem(LAST_TX_SEARCH) ?? "";
  } catch {
    return "";
  }
}

/**
 * Goes to a view. `sub` is a sub-page ('granska' -> /transaktioner/granska),
 * `search` its query string. Without `search`, the transaction list gets its
 * filters from last time.
 */
export function navigate(view: ViewId, opts: { replace?: boolean; sub?: string; search?: string } = {}) {
  const base = viewDef(view).path;
  const path = opts.sub ? `${base === "/" ? "" : base}/${opts.sub}` : base;
  const search = opts.search ?? (view === "transactions" && !opts.sub ? rememberedTransactionsSearch() : "");
  const url = `${path}${search}`;
  if (`${window.location.pathname}${window.location.search}` === url) return emit();
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  if (viewFromPath(path) !== viewFromPath(window.location.pathname) || !opts.replace) window.scrollTo(0, 0);
  emit();
}

/** Scrolls to a card by its id once the view has rendered it: it may appear only when its data is in. */
export function scrollToAnchor(id: string) {
  let tries = 0;
  const find = () => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    else if (++tries < 30) setTimeout(find, 100);
  };
  setTimeout(find, 0);
}

/**
 * Inställningar at one of its sections (#vakt, #konton …), folded out when it
 * is one of the compact ones (?oppen=bil): both are in the address, so the
 * page opens there and a reload stays.
 */
export function openSettings(section: string) {
  navigate("settings", { search: `?oppen=${section}` });
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${section}`);
  emit();
  scrollToAnchor(section);
}

/** Changes only the query string of the current page (filters). */
export function setSearch(search: string, opts: { replace?: boolean } = {}) {
  const url = `${window.location.pathname}${search}`;
  if (`${window.location.pathname}${window.location.search}` === url) return;
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  emit();
}

export function useView(): ViewId {
  return useSyncExternalStore(subscribe, () => viewFromPath(window.location.pathname));
}

/** The part of the path after the view ('granska' in /transaktioner/granska), or ''. */
export function useSubPath(): string {
  return useSyncExternalStore(subscribe, () => {
    const base = viewDef(viewFromPath(window.location.pathname)).path;
    return base === "/" ? "" : window.location.pathname.slice(base.length).replace(/^\/+|\/+$/g, "");
  });
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}
