import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * An Inställningar section as a Design v2 card: the title with its
 * explanation under it and anything the section does (Synka nu, Ändra, a
 * count) to the right; the rows under a hairline; an optional footer row.
 */
export function SettingsCard({
  id,
  title,
  description,
  aside,
  children,
  footer,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("@container scroll-mt-16 nav:scroll-mt-6 overflow-hidden rounded-card bg-card text-ink shadow-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={`${id}-title`} className="text-[15px] font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{description}</p>}
        </div>
        {aside && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{aside}</div>}
      </header>
      <div className="border-t border-hairline">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline px-5 py-3 text-[11px] text-ink-2 sm:px-6">{footer}</footer>}
    </section>
  );
}

/** An Apple-style row: the label with its explanation on the left, the control on the right. */
export function SettingRow({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline px-5 py-3 first:border-t-0 sm:px-6", className)}>
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[13px]">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Design v2's buttons in a section: grey, blue, or a text link. */
export const BUTTON = {
  grey: "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[9px] bg-card-inset px-3 text-[13px] font-semibold text-ink hover:bg-segment disabled:opacity-50",
  blue: "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[9px] bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50",
  link: "text-[13px] font-medium text-accent hover:underline disabled:opacity-50",
  danger: "text-[11px] font-medium text-alarm hover:underline",
} as const;

/** A v2 text field. */
export const FIELD =
  "h-9 w-full rounded-[9px] border border-neutral-bar/70 bg-card px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent disabled:bg-card-inset";
