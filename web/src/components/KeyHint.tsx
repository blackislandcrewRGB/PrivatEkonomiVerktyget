import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { isMac } from "../lib/format";
import { Tooltip } from "./ui/tooltip";

/** 'mod' is ⌘ on a Mac and Ctrl elsewhere. */
export function keyLabel(key: string): string {
  if (key === "mod") return isMac ? "⌘" : "Ctrl";
  if (key === "ctrl") return isMac ? "⌃" : "Ctrl";
  if (key === "shift") return "⇧";
  if (key === "alt") return isMac ? "⌥" : "Alt";
  if (key === "enter") return "↵";
  if (key === "esc") return "Esc";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A key cap: <Kbd keys={["mod", "k"]} /> shows ⌘K. */
export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <kbd
      className={cn(
        // Key caps mean nothing on a touch screen.
        "inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded border border-border bg-surface-muted px-1 font-sans text-[11px] font-medium text-muted pointer-coarse:hidden",
        className,
      )}
    >
      {keys.map(keyLabel).join(isMac ? "" : "+")}
    </kbd>
  );
}

/** Wraps a control with a tooltip that shows its label and keyboard shortcut. */
export function KeyHint({
  label,
  keys,
  children,
  side,
}: {
  label?: ReactNode;
  keys: string[];
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip
      side={side}
      content={
        <>
          {label && <span>{label}</span>}
          <Kbd keys={keys} className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground" />
        </>
      }
    >
      {children}
    </Tooltip>
  );
}
