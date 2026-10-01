import { useSyncExternalStore } from "react";
import { Toast as T } from "radix-ui";
import { X } from "lucide-react";

export interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

// One app-wide queue: any view can call notify(), the Toaster in the shell shows it.
let queue: ToastMessage[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a message bottom-right, with an optional action ('Ångra'). Gone after 4 s, 8 s with an action. */
export function notify(t: Omit<ToastMessage, "id">): number {
  const id = ++seq;
  queue = [...queue.slice(-2), { ...t, id }];
  emit();
  return id;
}

/** ⌘Z: runs the newest visible toast's action ('Ångra'). Returns false if there is none. */
export function runLatestToastAction(): boolean {
  const t = [...queue].reverse().find((x) => x.action);
  if (!t) return false;
  t.action!.run();
  dismissToast(t.id);
  return true;
}

export function dismissToast(id: number) {
  queue = queue.filter((t) => t.id !== id);
  emit();
}

/** Mounted once in the shell. */
export function Toaster() {
  const toasts = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue,
  );
  return (
    <T.Provider swipeDirection="right" label="Meddelande">
      {toasts.map((t) => (
        <T.Root
          key={t.id}
          duration={t.action ? 8000 : 4000}
          onOpenChange={(open) => !open && dismissToast(t.id)}
          className="flex items-center gap-3 rounded-lg border border-border bg-primary px-4 py-3 text-sm text-primary-foreground shadow-panel data-[state=open]:animate-[slide-in-up_160ms_ease-out] data-[swipe=end]:animate-[fade-out_100ms_ease-in]"
        >
          <T.Description className="flex-1">{t.text}</T.Description>
          {t.action && (
            <T.Action
              altText={t.action.label}
              onClick={() => t.action!.run()}
              className="rounded-md bg-primary-foreground/15 px-2 py-0.5 font-medium hover:bg-primary-foreground/25"
            >
              {t.action.label}
            </T.Action>
          )}
          <T.Close className="opacity-60 hover:opacity-100" aria-label="Stäng">
            <X className="size-4" />
          </T.Close>
        </T.Root>
      ))}
      <T.Viewport className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-[60] nav:bottom-4 flex transition-[right] duration-150 min-[1100px]:in-data-[side-panel=open]:right-[436px] w-[min(420px,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </T.Provider>
  );
}
