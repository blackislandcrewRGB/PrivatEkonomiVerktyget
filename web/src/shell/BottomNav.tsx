import { useState } from "react";
import { Dialog as D } from "radix-ui";
import { Ellipsis, EyeOff, Moon, Search, Sun, X } from "lucide-react";
import { cn } from "../lib/cn";
import { resolvedTheme, setThemePreference, useThemePreference } from "../lib/theme";
import { usePrivacy } from "../privacy";
import { useReviewCount } from "./badges";
import { navigate, useViews, type ViewId } from "./routes";

/** In the tab bar; the rest are under 'Mer'. */
const TABS: ViewId[] = ["overview", "transactions", "recurring", "shared"];
const SHORT: Partial<Record<ViewId, string>> = { recurring: "Fasta", shared: "Delad" };

/**
 * Under 900 px the sidebar is this tab bar at the bottom: four views and
 * 'Mer', a sheet with the other views, search (the command palette), theme
 * and private rows.
 */
export function BottomNav({ current, onOpenPalette }: { current: ViewId; onOpenPalette: () => void }) {
  const [more, setMore] = useState(false);
  const toReview = useReviewCount();
  const { showPrivate, setShowPrivate } = usePrivacy();
  useThemePreference();
  const dark = resolvedTheme() === "dark";
  const views = useViews();
  const rest = views.filter((v) => !TABS.includes(v.id));
  const moreActive = rest.some((v) => v.id === current);

  const tab = (id: ViewId) => {
    const v = views.find((x) => x.id === id)!;
    const Icon = v.icon;
    const active = id === current;
    const badge = id === "transactions" && toReview ? toReview : null;
    return (
      <a
        key={id}
        href={v.path}
        onClick={(e) => {
          e.preventDefault();
          navigate(id);
        }}
        aria-current={active ? "page" : undefined}
        className={cn("relative flex flex-col items-center gap-0.5 pb-1 pt-2 text-[11px]", active ? "font-medium text-foreground" : "text-muted")}
      >
        <Icon className="size-[22px]" aria-hidden />
        {SHORT[id] ?? v.label}
        {badge !== null && (
          <span className="absolute left-1/2 top-1 ml-2 min-w-5 rounded-full bg-warning px-1 text-center text-[10px] font-semibold leading-4 text-background tabular-nums" aria-label={`${badge} att granska`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </a>
    );
  };

  const row = "flex h-12 w-full items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-surface-hover";
  return (
    <>
      <nav
        aria-label="Huvudmeny"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur nav:hidden"
      >
        {TABS.map(tab)}
        <button type="button" onClick={() => setMore(true)} aria-expanded={more} className={cn("flex flex-col items-center gap-0.5 pb-1 pt-2 text-[11px]", moreActive ? "font-medium text-foreground" : "text-muted")}>
          <Ellipsis className="size-[22px]" aria-hidden />
          Mer
        </button>
      </nav>

      <D.Root open={more} onOpenChange={setMore}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fade-in_120ms_ease-out]" />
          <D.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 text-foreground shadow-panel outline-none data-[state=open]:animate-[slide-in-up_160ms_ease-out]">
            <div className="mb-1 flex items-center justify-between px-3">
              <D.Title className="text-base font-semibold">Mer</D.Title>
              <D.Close className="rounded-md p-1.5 text-muted hover:bg-surface-hover" aria-label="Stäng">
                <X className="size-5" />
              </D.Close>
            </div>
            <D.Description className="sr-only">Fler vyer, sök och inställningar</D.Description>
            <ul>
              {rest.map((v) => {
                const Icon = v.icon;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className={cn(row, v.id === current && "bg-surface-muted font-medium")}
                      onClick={() => {
                        setMore(false);
                        navigate(v.id);
                      }}
                    >
                      <Icon className="size-5 text-muted" aria-hidden /> {v.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                className={row}
                onClick={() => {
                  setMore(false);
                  onOpenPalette();
                }}
              >
                <Search className="size-5 text-muted" aria-hidden /> Sök och kommandon
              </button>
              <button type="button" className={row} onClick={() => setThemePreference(dark ? "light" : "dark")}>
                {dark ? <Sun className="size-5 text-muted" aria-hidden /> : <Moon className="size-5 text-muted" aria-hidden />}
                {dark ? "Ljust tema" : "Mörkt tema"}
              </button>
              <button type="button" className={cn(row, showPrivate && "text-warning")} onClick={() => setShowPrivate(!showPrivate)}>
                <EyeOff className="size-5 text-muted" aria-hidden /> {showPrivate ? "Dölj privata" : "Visa privata"}
              </button>
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}
