import { describe, expect, it } from "vitest";
import type { SheetRow } from "../../../api";
import { moneyParts } from "./moneyBar";

const row = (key: string, name: string, amountOre: number, unknown = false): SheetRow => ({ key, name, amountOre, basis: "", asOf: null, unknown });

const SHEET = {
  liquid: [
    row("account:1", "Swedbank Privatkonto", 11_400),
    row("account:2", "Swedbank e-sparkonto", 19_000),
    row("securities:isk", "ISK värdepapper", 15_250_000),
    row("cash:isk", "ISK likvider", 350_000),
    row("partner", "Mio är skyldig dig", 520_000),
  ],
  illiquid: [row("car", "Bilen", 6_000_000)],
};

describe("the bar under Pengar totalt", () => {
  it("has a part per account and ISK in the Wallet colours, and not what Mio owes", () => {
    expect(moneyParts(SHEET, false).map((p) => [p.key, p.name, p.colour])).toEqual([
      ["account:1", "Privatkonto", "bg-wallet-private"],
      ["account:2", "e-sparkonto", "bg-wallet-savings"],
      ["securities:isk", "ISK värdepapper", "bg-accent"],
      ["cash:isk", "ISK likvider", "bg-wallet-isk"],
    ]);
  });

  it("gets the car, grey, only with the illiquid shown; an unknown figure is left out", () => {
    expect(moneyParts(SHEET, true).at(-1)).toMatchObject({ key: "car", colour: "bg-ink-3" });
    const unknown = { ...SHEET, liquid: [...SHEET.liquid, row("account:9", "Swedbank Annat", 0, true)] };
    expect(moneyParts(unknown, false).map((p) => p.key)).not.toContain("account:9");
  });
});
