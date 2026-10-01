import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { formatKr } from "../lib/format";
import { KeyHint } from "./KeyHint";

export interface BulkAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  keys?: string[];
  danger?: boolean;
}

/**
 * Fixed at the bottom while rows are selected: how many, their sum, and
 * what can be done to all of them.
 */
export function BulkActionBar({
  count,
  sum,
  actions,
  onClear,
}: {
  count: number;
  sum?: number;
  actions: BulkAction[];
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Åtgärder för markerade rader"
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto nav:bottom-4 flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 rounded-xl border border-border bg-surface px-2 py-1.5 shadow-panel animate-[slide-in-up_160ms_ease-out]"
    >
      <span className="px-2 text-sm font-medium">
        {count} {count === 1 ? "markerad" : "markerade"}
        {sum !== undefined && <span className="ml-2 font-normal text-muted tabular-nums">{formatKr(sum)}</span>}
      </span>
      <span className="mx-1 h-5 w-px bg-border" />
      {actions.map((a) => {
        const button = (
          <button
            key={a.label}
            type="button"
            data-bulk-action={a.label}
            onClick={a.onClick}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-surface-hover [&_svg]:size-4",
              a.danger && "text-danger",
            )}
          >
            {a.icon}
            {a.label}
          </button>
        );
        return a.keys ? (
          <KeyHint key={a.label} keys={a.keys}>
            {button}
          </KeyHint>
        ) : (
          button
        );
      })}
      <span className="mx-1 h-5 w-px bg-border" />
      <KeyHint label="Avmarkera" keys={["esc"]}>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
          aria-label="Avmarkera"
        >
          <X className="size-4" />
        </button>
      </KeyHint>
    </div>
  );
}
