import type { PortfolioValue } from "../../../api";

export type AllocationKey = "base" | "bet" | "cash";

export interface AllocationSegment {
  key: AllocationKey;
  ore: number;
  /** Of the bar (securities and cash), 0–1. */
  width: number;
  /** A zone's share of the securities, as the policy counts it; null for the cash. */
  share: number | null;
}

/**
 * The one allocation bar: the base, the bet zone and the cash, each as wide
 * as its part of everything on the account. The zones are labelled with
 * their share of the securities, which is what the policy is about. The
 * target mark stands where the base would end at its target share.
 */
export function allocation(p: Pick<PortfolioValue, "zones" | "totalOre" | "accounts">): { total: number; cash: number; segments: AllocationSegment[]; mark: number; target: { base: number; bet: number } } {
  const cash = p.accounts.reduce((s, a) => s + (a.cashOre ?? 0), 0);
  const total = p.totalOre + cash;
  const part = (ore: number) => (total > 0 ? Math.max(0, ore) / total : 0);
  const segments: AllocationSegment[] = [
    { key: "base", ore: p.zones.base.valueOre, width: part(p.zones.base.valueOre), share: p.zones.base.share },
    { key: "bet", ore: p.zones.bet.valueOre, width: part(p.zones.bet.valueOre), share: p.zones.bet.share },
  ];
  if (cash > 0) segments.push({ key: "cash", ore: cash, width: part(cash), share: null });
  return {
    total,
    cash,
    segments,
    mark: total > 0 ? p.zones.base.targetShare * (p.totalOre / total) : p.zones.base.targetShare,
    target: { base: p.zones.base.targetShare, bet: p.zones.bet.targetShare },
  };
}
