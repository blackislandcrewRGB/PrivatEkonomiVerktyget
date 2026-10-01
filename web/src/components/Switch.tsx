import type { ReactNode } from "react";
import { Switch as S } from "radix-ui";
import { cn } from "../lib/cn";

/**
 * Design v2's on/off switch (Radix Switch): green when on, with its label
 * beside it and clickable. For settings that take effect at once.
 */
export function Switch({
  checked,
  onCheckedChange,
  children,
  title,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  /** The switch's accessible name, when the text beside it isn't all of it. */
  label?: string;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-[13px] text-ink", disabled ? "cursor-default" : "cursor-pointer", className)} title={title}>
      <S.Root
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
        className="relative h-[22px] w-[38px] shrink-0 rounded-full bg-segment transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=checked]:bg-positive disabled:opacity-50"
      >
        <S.Thumb className="block size-[18px] translate-x-0.5 rounded-full bg-white shadow-segment transition-transform data-[state=checked]:translate-x-[18px]" />
      </S.Root>
      {children}
    </label>
  );
}
