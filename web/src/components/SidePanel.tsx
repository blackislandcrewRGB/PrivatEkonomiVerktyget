import { useEffect, type ReactNode } from "react";
import { Dialog, SheetContent } from "./ui/dialog";
import { isTyping } from "../shell/hotkeys";

/**
 * A 420 px panel from the right for details and forms. Esc or ✕ closes it.
 * modal={false}: no dimming, the page behind stays usable (clicks there don't
 * close it) and focus stays where it was, so a list's keyboard keeps working.
 */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  modal = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  modal?: boolean;
}) {
  // A non-modal panel sits beside the page: the shell makes room for it on wide screens.
  useEffect(() => {
    if (modal || !open) return;
    document.documentElement.dataset.sidePanel = "open";
    return () => {
      delete document.documentElement.dataset.sidePanel;
    };
  }, [modal, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <SheetContent
        title={title}
        description={description}
        footer={footer}
        overlay={modal}
        data-side-panel=""
        {...(modal
          ? {}
          : {
              onOpenAutoFocus: (e: Event) => e.preventDefault(),
              onCloseAutoFocus: (e: Event) => e.preventDefault(),
              onInteractOutside: (e: Event) => e.preventDefault(),
              // Esc in a field leaves the field; the next Esc closes the panel.
              onEscapeKeyDown: (e: KeyboardEvent) => {
                if (isTyping(document.activeElement)) {
                  e.preventDefault();
                  (document.activeElement as HTMLElement).blur();
                }
              },
            })}
      >
        {children}
      </SheetContent>
    </Dialog>
  );
}
