import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-surface text-foreground hover:bg-surface-hover",
  ghost: "text-muted hover:bg-surface-hover hover:text-foreground",
  danger: "border border-border bg-surface text-danger hover:bg-danger-soft",
};
const SIZES: Record<Size, string> = {
  sm: "h-7 gap-1.5 px-2 text-xs",
  md: "h-8 gap-2 px-3 text-sm",
  icon: "size-8 justify-center",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = "secondary", size = "md", className, type = "button", ...p }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        // The press gives a little (0.97) and springs back: the button answers
        // before the work it starts does.
        "inline-flex shrink-0 items-center rounded-md font-medium transition-[color,background-color,border-color,opacity,transform] duration-[180ms] ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...p}
    />
  );
});
