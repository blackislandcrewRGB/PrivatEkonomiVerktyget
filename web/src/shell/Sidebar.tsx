import { EyeOff, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, Wallet } from "lucide-react";
import { cn } from "../lib/cn";
import { resolvedTheme, setThemePreference, useThemePreference } from "../lib/theme";
import { usePrivacy } from "../privacy";
import { KeyHint, Kbd } from "../components/KeyHint";
import { Tooltip } from "../components/ui/tooltip";
import { useReviewCount } from "./badges";
import { navigate, useViews, viewKey, type ViewId } from "./routes";

/**
 * The app menu: 240 px with labels, or 64 px with icons only. The
 * Transaktioner badge is the number of rows to review.
 */
export function Sidebar({
  current,
  collapsed,
  onToggle,
  onOpenPalette,
}: {
  current: ViewId;
  collapsed: boolean;
  onToggle: () => void;
  onOpenPalette: () => void;
}) {
  const views = useViews();
  const toReview = useReviewCount();
  const { showPrivate, setShowPrivate } = usePrivacy();
  useThemePreference(); // re-render when the theme changes
  const dark = resolvedTheme() === "dark";

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-sidebar transition-[width] duration-150 nav:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center gap-2.5", collapsed ? "justify-center" : "px-4")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Wallet className="size-4" />
        </span>
        {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight">Privatekonomi</span>}
      </div>

      <div className="px-3 pb-2">
        <Tooltip content={collapsed ? "Sök och kommandon" : null} side="right">
          <button
            type="button"
            onClick={onOpenPalette}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface text-sm text-muted hover:border-border-strong hover:text-foreground",
              collapsed ? "justify-center" : "px-2.5",
            )}
            aria-label="Sök och kommandon"
          >
            <Search className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Sök…</span>
                <Kbd keys={["mod", "k"]} />
              </>
            )}
          </button>
        </Tooltip>
      </div>

      <nav aria-label="Huvudmeny" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
        {views.map((v, i) => {
          const active = v.id === current;
          const badge = v.id === "transactions" && toReview ? toReview : null;
          const Icon = v.icon;
          return (
            <KeyHint key={v.id} label={collapsed ? v.label : undefined} keys={viewKey(i) ? ["ctrl", viewKey(i)!] : []} side="right">
              <a
                href={v.path}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  navigate(v.id);
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-3 rounded-md text-sm transition-colors",
                  collapsed ? "justify-center" : "px-2.5",
                  active
                    ? "bg-surface-muted font-medium text-foreground"
                    : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon className={cn("size-[18px] shrink-0", active && "text-foreground")} />
                {!collapsed && <span className="flex-1 truncate">{v.label}</span>}
                {badge !== null &&
                  (collapsed ? (
                    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-warning" aria-label={`${badge} att granska`} />
                  ) : (
                    <span
                      className="rounded-full bg-warning-soft px-1.5 text-xs font-medium text-warning tabular-nums"
                      title={`${badge} att granska`}
                    >
                      {badge}
                    </span>
                  ))}
              </a>
            </KeyHint>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-border px-3 py-2">
        {showPrivate && (
          <Tooltip content="Privata rader visas. Klicka för att dölja dem igen." side="right">
            <button
              type="button"
              onClick={() => setShowPrivate(false)}
              className={cn(
                "flex h-8 w-full items-center gap-3 rounded-md bg-warning-soft text-sm text-warning",
                collapsed ? "justify-center" : "px-2.5",
              )}
            >
              <EyeOff className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">Visar privata · dölj</span>}
            </button>
          </Tooltip>
        )}
        <Tooltip content={collapsed ? (dark ? "Ljust tema" : "Mörkt tema") : null} side="right">
          <button
            type="button"
            onClick={() => setThemePreference(dark ? "light" : "dark")}
            className={cn(
              "flex h-8 w-full items-center gap-3 rounded-md text-sm text-muted hover:bg-surface-hover hover:text-foreground",
              collapsed ? "justify-center" : "px-2.5",
            )}
          >
            {dark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
            {!collapsed && <span>{dark ? "Ljust tema" : "Mörkt tema"}</span>}
          </button>
        </Tooltip>
        <KeyHint label={collapsed ? "Visa menyn" : "Fäll ihop menyn"} keys={["mod", "\\"]} side="right">
          <button
            type="button"
            data-sidebar-toggle
            onClick={onToggle}
            className={cn(
              "flex h-8 w-full items-center gap-3 rounded-md text-sm text-muted hover:bg-surface-hover hover:text-foreground",
              collapsed ? "justify-center" : "px-2.5",
            )}
            aria-label={collapsed ? "Visa menyn" : "Fäll ihop menyn"}
          >
            {collapsed ? <PanelLeftOpen className="size-4 shrink-0" /> : <PanelLeftClose className="size-4 shrink-0" />}
            {!collapsed && <span>Fäll ihop</span>}
          </button>
        </KeyHint>
      </div>
    </aside>
  );
}
