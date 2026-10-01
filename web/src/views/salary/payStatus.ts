import type { SalaryMonth } from "../../api";
import { kr } from "../overview/format";

export type PayStatus = { kind: "exact" } | { kind: "off"; diff: number } | { kind: "forecast" };

/**
 * A month's salary against its forecast: in to the krona ('kom in exakt'),
 * off by some kronor ('avvek +120 kr'), or not in yet ('prognos', also when
 * the pay day has passed: the overview flags a late salary).
 */
export function payStatus(m: Pick<SalaryMonth, "actual" | "diff">): PayStatus {
  if (!m.actual || m.diff === null) return { kind: "forecast" };
  return Math.round(m.diff / 100) === 0 ? { kind: "exact" } : { kind: "off", diff: m.diff };
}

export const payStatusLabel = (s: PayStatus) =>
  s.kind === "exact" ? "kom in exakt" : s.kind === "off" ? `avvek ${s.diff > 0 ? "+" : "−"}${kr(Math.abs(s.diff))}` : "prognos";

export const PAY_STATUS_STYLE: Record<PayStatus["kind"], string> = {
  exact: "bg-positive-soft text-positive-text",
  off: "bg-caution-soft text-caution-text",
  forecast: "bg-accent-soft text-accent",
};
