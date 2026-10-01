import type { ComponentProps, ReactNode } from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "../../lib/cn";

export const TooltipProvider = T.Provider;

/** Hover/focus hint. `content` may include a KeyHint. */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  ...p
}: { content: ReactNode; children: ReactNode; side?: ComponentProps<typeof T.Content>["side"]; className?: string } & Omit<
  ComponentProps<typeof T.Root>,
  "children"
>) {
  if (content == null || content === "") return <>{children}</>;
  return (
    <T.Root {...p}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 flex max-w-xs items-center gap-2 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-panel",
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
