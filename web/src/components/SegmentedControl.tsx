import { useRef } from "react";
import { cn } from "../lib/cn";

/**
 * 'Min del | Hushållet' style switch. ←/→ move between the options.
 * appearance "v2": Design v2's grey track with a white, lifted choice
 * (Översikt; the other views keep the old look until they are redone).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  appearance = "default",
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  appearance?: "default" | "v2";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        appearance === "v2" ? "inline-flex gap-0.5 rounded-[10px] bg-segment p-[3px]" : "inline-flex rounded-lg border border-border bg-surface-muted p-0.5",
        className,
      )}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = (index + step + options.length) % options.length;
        onChange(options[next].value);
        refs.current[next]?.focus();
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cn(
            appearance === "v2"
              ? cn(
                  "whitespace-nowrap rounded-lg text-[13px] text-ink transition-colors",
                  size === "sm" ? "px-3 py-1" : "px-3.5 py-1.5",
                  o.value === value ? "bg-segment-on font-semibold shadow-segment" : "hover:bg-segment-on/50",
                )
              : cn(
                  "rounded-md font-medium transition-colors",
                  size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
                  o.value === value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
                ),
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
