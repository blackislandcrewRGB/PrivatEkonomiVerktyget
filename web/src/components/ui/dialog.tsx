import type { ComponentProps, ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

// shadcn/ui-style wrappers around Radix Dialog: a centred Dialog and a Sheet
// that slides in from the right (the base of SidePanel).

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export const DialogTitle = ({ className, ...p }: ComponentProps<typeof D.Title>) => (
  <D.Title className={cn("text-base font-semibold", className)} {...p} />
);
export const DialogDescription = ({ className, ...p }: ComponentProps<typeof D.Description>) => (
  <D.Description className={cn("text-sm text-muted", className)} {...p} />
);

function Overlay({ className, ...p }: ComponentProps<typeof D.Overlay>) {
  return <D.Overlay className={cn("fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fade-in_120ms_ease-out]", className)} {...p} />;
}

export function DialogContent({
  className,
  children,
  hideClose,
  ...p
}: ComponentProps<typeof D.Content> & { hideClose?: boolean }) {
  return (
    <D.Portal>
      <Overlay />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-xl border border-border bg-surface p-5 text-foreground shadow-panel outline-none",
          "data-[state=open]:animate-[dialog-in_150ms_ease-out]",
          className,
        )}
        {...p}
      >
        {children}
        {!hideClose && <CloseButton className="absolute right-3 top-3" />}
      </D.Content>
    </D.Portal>
  );
}

export function SheetContent({
  className,
  children,
  title,
  description,
  footer,
  overlay = true,
  ...p
}: Omit<ComponentProps<typeof D.Content>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  overlay?: boolean;
}) {
  return (
    <D.Portal>
      {overlay && <Overlay className="bg-overlay/40" />}
      <D.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border pb-[env(safe-area-inset-bottom)] nav:max-w-[420px] bg-surface text-foreground shadow-panel outline-none data-[state=open]:animate-[slide-in-right_160ms_ease-out]",
          className,
        )}
        {...p}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-0.5">{description}</DialogDescription>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : "Detaljer"}</D.Description>
            )}
          </div>
          <CloseButton />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </D.Content>
    </D.Portal>
  );
}

function CloseButton({ className }: { className?: string }) {
  return (
    <D.Close
      className={cn("rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground", className)}
      aria-label="Stäng"
    >
      <X className="size-4" />
    </D.Close>
  );
}
