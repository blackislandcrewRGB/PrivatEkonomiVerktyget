import { useEffect, useState, useSyncExternalStore } from "react";
import { getJson, sendJson, type Category } from "./api";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";
import { cn } from "./lib/cn";
import { CATEGORY_PALETTE } from "./lib/palette";

// One shared category list for every view, so a category created from a
// picker (or renamed in 'Kategorier & regler') shows up everywhere at once.
let cache: Category[] = [];
let loading: Promise<void> | null = null;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Waits after a failed load: 1, 2, 4 … s, at most 30 s. */
export const retryDelay = (failures: number) => Math.min(30_000, 1000 * 2 ** (failures - 1));

/**
 * Loads the list again. Never rejects: a failed load (the server restarting,
 * say) is tried again after a while as long as some view uses the list, so
 * the list is never left empty for good.
 */
export function reloadCategories(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  loading = getJson<Category[]>("/categories").then(
    (rows) => {
      failures = 0;
      cache = rows;
      listeners.forEach((l) => l());
    },
    () => {
      failures++;
      loading = null;
      if (listeners.size > 0) retryTimer = setTimeout(reloadCategories, retryDelay(failures));
    },
  );
  return loading;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** All categories; loads them the first time. Empty until loaded. */
export function useCategories(): Category[] {
  const categories = useSyncExternalStore(subscribe, () => cache);
  useEffect(() => {
    if (!loading) reloadCategories();
  }, []);
  return categories;
}

// ---------- '+ Ny kategori…' dialog ----------

type Pending = { id: number; resolve: (c: Category | null) => void; parentId: number | null } | null;
let pending: Pending = null;
let dialogSeq = 0;
const dialogListeners = new Set<() => void>();

/** Opens the new-category dialog; resolves with the created category, or null if cancelled. */
export function openNewCategoryDialog(parentId: number | null = null): Promise<Category | null> {
  return new Promise((resolve) => {
    pending?.resolve(null);
    pending = { id: ++dialogSeq, resolve, parentId };
    dialogListeners.forEach((l) => l());
  });
}

function closeDialog(result: Category | null) {
  pending?.resolve(result);
  pending = null;
  dialogListeners.forEach((l) => l());
}

/** Mounted once in App. */
export function NewCategoryHost() {
  const open = useSyncExternalStore(
    (l) => {
      dialogListeners.add(l);
      return () => dialogListeners.delete(l);
    },
    () => pending,
  );
  if (!open) return null;
  return <NewCategoryDialog key={open.id} initialParent={open.parentId} />;
}

function NewCategoryDialog({ initialParent }: { initialParent: number | null }) {
  const categories = useCategories();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | null>(initialParent);
  // A main category: a palette colour no other main category has (the server picks the first free one if none is chosen).
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tops = categories.filter((c) => c.parentId === null);
  const taken = new Set(tops.map((t) => t.color?.toLowerCase()));
  const free = CATEGORY_PALETTE.filter((c) => !taken.has(c.toLowerCase()));

  const save = async () => {
    try {
      const created = await sendJson<Category>("POST", "/categories", { name, parentId, color: parentId ? null : color });
      await reloadCategories();
      closeDialog(created);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const field = "mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

  return (
    <Dialog open onOpenChange={(o) => !o && closeDialog(null)}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogTitle>Ny kategori</DialogTitle>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="block text-sm">
            <span className="text-xs text-muted">Namn</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-muted">Ligger under</span>
            <select value={parentId ?? ""} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)} className={field}>
              <option value="">Ingen: ny huvudkategori</option>
              {tops.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {parentId === null ? (
            <div className="text-sm">
              <span className="text-xs text-muted">Färg</span>
              {free.length === 0 ? (
                <p className="mt-1 text-xs text-muted">Alla 16 palettfärger används redan: den blir grå. Du kan byta färg sedan.</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Färg">
                  {free.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c || (color === null && c === free[0])}
                      aria-label={c}
                      onClick={() => setColor(c)}
                      className={cn("size-6 rounded-full", (color === c || (color === null && c === free[0])) && "ring-2 ring-foreground ring-offset-2 ring-offset-surface")}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">Får en ljusare ton av huvudkategorins färg.</p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => closeDialog(null)}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Skapa
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
