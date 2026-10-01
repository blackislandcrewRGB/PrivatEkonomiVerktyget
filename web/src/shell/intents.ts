import { useEffect, useRef } from "react";

/**
 * Something the command palette asks a view to do once it is shown ('open
 * the new-expense form', 'edit this balance'). Set before navigating; the
 * view consumes it with useIntent when it mounts or is already showing.
 */
export type Intent =
  | { kind: "imports.pickFile" }
  | { kind: "recurring.new" }
  | { kind: "overview.editBalance"; accountId: number }
  | { kind: "items.open"; itemId: number }
  | { kind: "cashflow.afford" };

let pending: Intent | null = null;
const listeners = new Set<() => void>();

export function requestIntent(intent: Intent) {
  pending = intent;
  // Let the target view render first.
  setTimeout(() => listeners.forEach((l) => l()), 0);
}

/** Runs `handler` for a pending intent of this kind, then clears it. */
export function useIntent<K extends Intent["kind"]>(kind: K, handler: (intent: Extract<Intent, { kind: K }>) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const check = () => {
      if (pending?.kind === kind) {
        const intent = pending as Extract<Intent, { kind: K }>;
        pending = null;
        ref.current(intent);
      }
    };
    listeners.add(check);
    check();
    return () => {
      listeners.delete(check);
    };
  }, [kind]);
}
