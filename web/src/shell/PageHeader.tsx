import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

// The shell draws each view's header (title on the left). A view puts its
// period picker and primary action on the right with <HeaderActions>, and
// tabs right after the title with <HeaderTabs>.
type SlotName = "actions" | "tabs";
const slots: Record<SlotName, HTMLElement | null> = { actions: null, tabs: null };
const listeners = new Set<() => void>();

function setSlot(name: SlotName, el: HTMLElement | null) {
  if (slots[name] === el) return;
  slots[name] = el;
  listeners.forEach((l) => l());
}
const setActions = (el: HTMLElement | null) => setSlot("actions", el);
const setTabs = (el: HTMLElement | null) => setSlot("tabs", el);

/** appearance "v2": Design v2's larger, bolder title (the views redone so far; the others keep theirs until they are). */
export function PageHeader({ title, subtitle, appearance = "default" }: { title: string; subtitle?: ReactNode; appearance?: "default" | "v2" }) {
  return (
    <header className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 pb-5">
      {/* Phones: the title on its own line, the tabs and the view's buttons under it. */}
      <div className="min-w-0 basis-full nav:basis-auto">
        <h1 className={cn("truncate", appearance === "v2" ? "text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink" : "text-xl font-semibold tracking-tight")}>{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      <div ref={setTabs} className="min-w-0 max-w-full empty:hidden" />
      <div className="hidden flex-1 nav:block" />
      <div ref={setActions} className="flex flex-wrap items-center gap-2 empty:hidden max-nav:basis-full" />
    </header>
  );
}

function useSlot(name: SlotName) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => slots[name],
  );
}

/** Renders its children in the right side of the current view's header. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const el = useSlot("actions");
  return el ? createPortal(children, el) : null;
}

/** Renders its children right after the current view's title: the view's own tabs. */
export function HeaderTabs({ children }: { children: ReactNode }) {
  const el = useSlot("tabs");
  return el ? createPortal(children, el) : null;
}
