import { cn } from "../lib/cn";
import { formatKr } from "../lib/format";

export type AmountKind = "expense" | "income" | "transfer" | "neutral";
export type AmountSize = "sm" | "md" | "lg" | "xl";

export interface AmountProps {
  ore: number;
  /** Default: income when positive, expense otherwise. */
  kind?: AmountKind;
  whole?: boolean;
  size?: AmountSize;
  className?: string;
  strike?: boolean;
}

/** Income when positive unless the caller says otherwise. */
export const amountKind = (ore: number, kind?: AmountKind): AmountKind => kind ?? (ore > 0 ? "income" : "expense");

/** How an amount looks, shared with AnimatedAmount so the two can't drift apart. */
export function amountClass({ kind, size = "md", strike, className }: { kind: AmountKind; size?: AmountSize; strike?: boolean; className?: string }): string {
  return cn(
    "whitespace-nowrap tabular-nums",
    size === "sm" && "text-[13px]",
    size === "md" && "text-[15px] font-medium",
    size === "lg" && "text-xl font-semibold tracking-tight",
    size === "xl" && "text-[40px] font-semibold leading-none tracking-tight",
    kind === "income" && "text-income",
    kind === "expense" && "text-expense",
    kind === "transfer" && "text-transfer",
    kind === "neutral" && "text-foreground",
    strike && "line-through opacity-60",
    className,
  );
}

/** The text of an amount: '−1 234,56 kr', incomes with '+'. */
export const amountText = (ore: number, kind: AmountKind, whole?: boolean) => formatKr(ore, { sign: kind === "income" ? "always" : "auto", whole });

/**
 * An amount in öre. Expenses are plain text (the normal case), incomes green
 * with '+', transfers muted blue. Always tabular; the caller right-aligns.
 */
export function Amount({ ore, kind, whole, size = "md", className, strike }: AmountProps) {
  const k = amountKind(ore, kind);
  return <span className={amountClass({ kind: k, size, strike, className })}>{amountText(ore, k, whole)}</span>;
}
