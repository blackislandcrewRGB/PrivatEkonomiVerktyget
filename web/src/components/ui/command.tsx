import type { ComponentProps } from "react";
import { Command as C } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "../../lib/cn";

// shadcn/ui-style wrappers around cmdk (the ⌘K palette, and later the category picker).

export function Command({ className, ...p }: ComponentProps<typeof C>) {
  return <C className={cn("flex flex-col overflow-hidden text-foreground", className)} {...p} />;
}

export function CommandInput({ className, ...p }: ComponentProps<typeof C.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search className="size-4 shrink-0 text-muted" />
      <C.Input className={cn("h-11 w-full bg-transparent text-sm outline-none placeholder:text-subtle", className)} {...p} />
    </div>
  );
}

export function CommandList({ className, ...p }: ComponentProps<typeof C.List>) {
  return <C.List className={cn("max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1", className)} {...p} />;
}

export function CommandEmpty(p: ComponentProps<typeof C.Empty>) {
  return <C.Empty className="px-3 py-6 text-center text-sm text-muted" {...p} />;
}

export function CommandGroup({ className, ...p }: ComponentProps<typeof C.Group>) {
  return (
    <C.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted",
        className,
      )}
      {...p}
    />
  );
}

export function CommandItem({ className, ...p }: ComponentProps<typeof C.Item>) {
  return (
    <C.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-surface-hover data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted",
        className,
      )}
      {...p}
    />
  );
}

export function CommandSeparator(p: ComponentProps<typeof C.Separator>) {
  return <C.Separator className="my-1 h-px bg-border" {...p} />;
}
