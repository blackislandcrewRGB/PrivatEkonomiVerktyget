import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { BUTTON } from "./ui";

/** The sections folded out, in the address (?oppen=bil,lon), so a reload or a link keeps them open. */
const readOpen = () => new Set((new URLSearchParams(window.location.search).get("oppen") ?? "").split(",").filter(Boolean));
const listeners = new Set<() => void>();
let cache = { key: "", set: readOpen() };
const snapshot = () => {
  const key = window.location.search;
  if (key !== cache.key) cache = { key, set: readOpen() };
  return cache.set;
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("popstate", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("popstate", l);
  };
};

export function useOpenSections() {
  const open = useSyncExternalStore(subscribe, snapshot);
  const toggle = useCallback((id: string) => {
    const next = new Set(readOpen());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const q = new URLSearchParams(window.location.search);
    if (next.size) q.set("oppen", [...next].join(","));
    else q.delete("oppen");
    const search = q.toString().replace(/%2C/g, ",");
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    listeners.forEach((l) => l());
  }, []);
  return { open, toggle };
}

/** The compact sections, one card. */
export function CompactList({ children }: { children: ReactNode }) {
  return (
    // Hidden when the search leaves none of its rows.
    <section aria-label="Fler inställningar" className="@container overflow-hidden rounded-card bg-card text-ink shadow-card [&:not(:has(li))]:hidden">
      <ul>{children}</ul>
    </section>
  );
}

/**
 * A section in one line: its name in bold, what it is set to now in a
 * sentence and its explanation under it, a chevron. A click folds the
 * section out in place, in full.
 */
export function CompactRow({
  id,
  name,
  summary,
  hint,
  badge,
  open,
  onToggle,
  children,
}: {
  id: string;
  name: string;
  summary: ReactNode;
  hint?: ReactNode;
  badge?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <li id={id} className="scroll-mt-16 border-t nav:scroll-mt-6 border-hairline first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 text-left hover:bg-band sm:px-6 @[40rem]:grid-cols-[12rem_minmax(0,1fr)_auto]"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <span id={`${id}-title`}>{name}</span>
          {badge ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-caution px-1 text-[10px] font-bold text-white tabular-nums">{badge}</span> : null}
        </span>
        <span className="col-start-1 row-start-2 min-w-0 @[40rem]:col-start-2 @[40rem]:row-start-1">
          <span className="block text-[13px]" data-summary>
            {summary}
          </span>
          {hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{hint}</span>}
        </span>
        <ChevronRight className={cn("col-start-2 row-span-2 size-4 text-ink-3 transition-transform @[40rem]:col-start-3 @[40rem]:row-span-1", open && "rotate-90")} aria-hidden />
      </button>
      {open && (
        <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-title`} className="border-t border-hairline bg-band/60 px-5 py-4 sm:px-6">
          {children}
        </div>
      )}
    </li>
  );
}

/**
 * A folded-out section's content with 'Ändra' to its right; 'Ändra' switches
 * to the form with 'Spara' and 'Avbryt', and saving runs `onSave` and closes
 * it (its error stays with the form).
 */
export function Editable({
  children,
  edit,
  onEdit,
  onSave,
  description,
}: {
  children: ReactNode;
  edit: ReactNode;
  onEdit?: () => void;
  onSave: () => Promise<void>;
  description?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          {description && <p className="text-[12px] leading-snug text-ink-2">{description}</p>}
          {!editing && children}
        </div>
        {!editing && (
          <button
            type="button"
            className={BUTTON.link}
            onClick={() => {
              onEdit?.();
              setEditing(true);
            }}
          >
            Ändra
          </button>
        )}
      </div>
      {editing && (
        <>
          {edit}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BUTTON.blue} onClick={save} disabled={busy}>
              Spara
            </button>
            <button type="button" className={BUTTON.link} onClick={() => (setEditing(false), setError(null))}>
              Avbryt
            </button>
            {error && <span className="text-[12px] text-alarm">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** A labelled field in a folded-out section's form. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1", className)}>
      <span className="text-[11px] text-ink-2">{label}</span>
      {children}
    </label>
  );
}
