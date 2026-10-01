import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

/** Centered icon, title, one line of help and an optional action, for a view or list with nothing in it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="mb-1 rounded-full bg-surface-muted p-3 text-muted">
          <Icon className="size-5" />
        </span>
      )}
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
