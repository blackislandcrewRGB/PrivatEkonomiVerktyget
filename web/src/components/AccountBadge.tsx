import { CreditCard, Landmark } from "lucide-react";
import { cn } from "../lib/cn";

/** 'Swedbank Privatkonto' -> 'Privatkonto', 'Bank Norwegian' -> 'Norwegian'. */
export function shortAccountName(name: string): string {
  return name.replace(/^(Swedbank|Bank)\s+/i, "").replace(/\s+Guld$/i, "") || name;
}

/** A compact account label with a card or bank icon. The full name is the tooltip. */
export function AccountBadge({
  name,
  kind = "bank",
  className,
}: {
  name: string | null;
  kind?: "bank" | "credit_card" | null;
  className?: string;
}) {
  if (!name) return <span className={cn("text-xs text-subtle", className)}>–</span>;
  const Icon = kind === "credit_card" ? CreditCard : Landmark;
  return (
    <span
      title={name}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-muted",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{shortAccountName(name)}</span>
    </span>
  );
}
