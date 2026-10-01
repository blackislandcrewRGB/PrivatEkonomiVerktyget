import type { ComponentProps } from "react";
import { DropdownMenu as M } from "radix-ui";
import { cn } from "../../lib/cn";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;

export function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...p }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("z-50 min-w-44 rounded-lg border border-border bg-surface p-1 text-foreground shadow-panel", className)}
        {...p}
      />
    </M.Portal>
  );
}

export function DropdownMenuItem({ className, danger, ...p }: ComponentProps<typeof M.Item> & { danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50",
        danger && "text-danger",
        className,
      )}
      {...p}
    />
  );
}

export function DropdownMenuSeparator({ className, ...p }: ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("my-1 h-px bg-border", className)} {...p} />;
}

export function DropdownMenuLabel({ className, ...p }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2 py-1 text-xs font-medium text-muted", className)} {...p} />;
}
