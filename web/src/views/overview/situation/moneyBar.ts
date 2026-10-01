import type { BalanceSheet } from "../../../api";
import { shortAccountName } from "../../../components/AccountBadge";
import { ISK_COLOUR, walletColour } from "../wallet";

export interface MoneyPart {
  key: string;
  name: string;
  ore: number;
  /** A Tailwind background class. */
  colour: string;
}

/**
 * What Pengar totalt is made of, one part per row in it: the bank accounts
 * in their Wallet colours, the ISK securities blue and the ISK cash in the
 * ISK colour, and with the illiquid shown the car grey. What Mio owes is
 * not in the figure (her payment is counted in Framåt), so not in the bar.
 */
export function moneyParts(sheet: Pick<BalanceSheet, "liquid" | "illiquid">, withIlliquid: boolean): MoneyPart[] {
  const parts: MoneyPart[] = [];
  for (const r of sheet.liquid) {
    if (r.unknown) continue;
    if (r.key.startsWith("account:")) parts.push({ key: r.key, name: shortAccountName(r.name), ore: r.amountOre, colour: walletColour({ name: r.name, kind: "bank" }) });
    else if (r.key.startsWith("securities:")) parts.push({ key: r.key, name: r.name, ore: r.amountOre, colour: "bg-accent" });
    else if (r.key.startsWith("cash:")) parts.push({ key: r.key, name: r.name, ore: r.amountOre, colour: ISK_COLOUR });
  }
  if (withIlliquid) for (const r of sheet.illiquid) if (!r.unknown) parts.push({ key: r.key, name: r.name, ore: r.amountOre, colour: "bg-ink-3" });
  return parts;
}
