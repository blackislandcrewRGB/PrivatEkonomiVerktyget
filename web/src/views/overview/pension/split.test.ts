import { describe, expect, it } from "vitest";
import type { PensionEntry } from "../../../api";
import { pensionSplit } from "./split";

const entry = (o: Partial<PensionEntry>): PensionEntry => ({
  id: 1,
  kind: "occupational",
  provider: "",
  name: "",
  amountOre: 0,
  valueDate: "2026-09-17",
  placeable: false,
  status: "active",
  monthlyPremiumOre: null,
  premiumDate: null,
  payoutFromAge: null,
  note: null,
  funds: [],
  ...o,
});

describe("Låst till 65+ in two parts", () => {
  it("adds up to the total, each part named from its entries", () => {
    const entries = [
      entry({ kind: "income_pension", provider: "Pensionsmyndigheten", name: "Inkomstpension", amountOre: 38_500_000 }),
      entry({ kind: "premium_pension", provider: "Pensionsmyndigheten", name: "Premiepension", amountOre: 12_250_000, placeable: true }),
      entry({ provider: "Exempelbolaget Pension", name: "Avtalspension Fond", amountOre: 9_800_000, placeable: true }),
      entry({ provider: "ABC Pension", name: "Traditionell försäkring, stängd", amountOre: 250_000, status: "closed" }),
    ];
    const parts = pensionSplit({ entries, placeableOre: 22_050_000, fixedOre: 38_750_000 });
    expect(parts.map((p) => [p.key, p.ore, p.names])).toEqual([
      ["placeable", 22_050_000, "premiepension och avtalspension"],
      ["fixed", 38_750_000, "inkomstpension och ABC"],
    ]);
    expect(parts.reduce((s, p) => s + p.ore, 0)).toBe(entries.reduce((s, e) => s + e.amountOre, 0));
  });
});
