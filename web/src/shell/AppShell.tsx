import { useCallback, useEffect, useState, type ReactNode } from "react";
import { TooltipProvider } from "../components/ui/tooltip";
import { runLatestToastAction, Toaster } from "../components/Toast";
import { cn } from "../lib/cn";
import { useNarrow } from "../lib/useNarrow";
import { CommandPalette } from "./CommandPalette";
import { PageHeader } from "./PageHeader";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { refreshBadges } from "./badges";
import { isTyping, useHotkeys } from "./hotkeys";
import { ModuleOff } from "./ModuleOff";
import { loadModules, useModules } from "../lib/modules";
import { navigate, useView, useViews, viewDef, viewKey, type ViewId } from "./routes";

const COLLAPSED_KEY = "privatekonomi.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Sidebar, the current view's header, ⌘K palette and toasts around a view.
 * ⌘/⌃1–8 switch view, ⌘K opens the palette, ⌘\ folds the sidebar.
 */
export function AppShell({ children }: { children: (view: ViewId) => ReactNode }) {
  const view = useView();
  const def = viewDef(view);
  const views = useViews();
  const { modules, loaded } = useModules();
  const narrow = useNarrow();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // Not remembered; fine.
      }
      return !c;
    });
  }, []);

  useHotkeys({
    "mod+k": () => setPaletteOpen((o) => !o),
    "mod+\\": toggleSidebar,
    ...Object.fromEntries(views.flatMap((v, i) => (viewKey(i) ? [[`mod+${viewKey(i)}`, () => navigate(v.id)]] : []))),
  });

  // ⌘Z undoes the latest change that offered 'Ångra' (not while typing: there it undoes text).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z" || isTyping(e.target)) return;
      if (runLatestToastAction()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    void loadModules();
  }, []);
  useEffect(() => {
    refreshBadges();
    window.addEventListener("focus", refreshBadges);
    return () => window.removeEventListener("focus", refreshBadges);
  }, []);
  useEffect(() => {
    document.title = `${viewDef(view).label} · Privatekonomi`;
    refreshBadges();
  }, [view]);

  return (
    <TooltipProvider delayDuration={400}>
      {/* One menu at a time: the sidebar, or under 900 px the tab bar. */}
      {narrow ? (
        <BottomNav current={view} onOpenPalette={() => setPaletteOpen(true)} />
      ) : (
        <Sidebar current={view} collapsed={collapsed} onToggle={toggleSidebar} onOpenPalette={() => setPaletteOpen(true)} />
      )}
      <div
        className={cn(
          "min-h-screen transition-[padding] duration-150 min-[1100px]:in-data-[side-panel=open]:pr-[420px]",
          collapsed ? "nav:pl-16" : "nav:pl-60",
        )}
      >
        {/* Phones: 16 px gutters, room for the tab bar at the bottom. */}
        <main className="mx-auto max-w-[1200px] px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 nav:px-6 nav:pb-16 nav:pt-6">
          <PageHeader title={viewDef(view).label} appearance={["overview", "transactions", "recurring", "shared", "imports", "categories", "commute", "salary", "items", "settings", "analysis"].includes(view) ? "v2" : "default"} />
          {def.module && loaded && !modules[def.module] ? <ModuleOff module={def.module} /> : children(view)}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onToggleSidebar={toggleSidebar} />
      <Toaster />
    </TooltipProvider>
  );
}
