import type { ComponentProps } from "react";
import { Popover as P } from "radix-ui";
import { cn } from "../../lib/cn";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = "start", sideOffset = 6, ...p }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 rounded-lg border border-border bg-surface p-3 text-foreground shadow-panel outline-none",
          className,
        )}
        {...p}
      />
    </P.Portal>
  );
}
