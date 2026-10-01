import { describe, expect, it } from "vitest";
import type { Flow } from "../../../api";
import { incomeBar, surplusBar } from "./flowBars";

/** June–August: 27 500 kr in, 9 800 fixed, 11 500 variable, 6 200 left. */
const FLOW: Pick<Flow, "perMonth" | "destinations"> = {
  perMonth: { incomeOre: 2_750_000, fixedOre: 980_000, variableOre: 1_150_000, leftOre: 620_000 },
  destinations: { portfolioOre: 700_000, bufferOre: 90_000, bufferAccount: { id: 2, name: "Swedbank e-sparkonto" }, unexplainedOre: -170_000 },
};

describe("Flöde per månad's bars", () => {
  it("splits the net income in fixed, variable and left", () => {
    const { parts, scale } = incomeBar(FLOW.perMonth);
    expect(scale).toBe(2_750_000);
    expect(parts.map((p) => [p.key, p.from, p.width])).toEqual([
      ["fixed", 0, 980_000 / 2_750_000],
      ["variable", 980_000 / 2_750_000, 1_150_000 / 2_750_000],
      ["left", (980_000 + 1_150_000) / 2_750_000, 620_000 / 2_750_000],
    ]);
  });

  it("where it went, on the same scale, stops where Kvar does: 7 000 + 900 − 1 700 = 6 200", () => {
    const { parts, scale } = incomeBar(FLOW.perMonth);
    const left = parts.find((p) => p.key === "left")!;
    const second = surplusBar(FLOW, scale);
    expect(second.parts.map((p) => [p.key, p.subtracts ?? false])).toEqual([
      ["portfolio", false],
      ["buffer", false],
      ["unexplained", true],
    ]);
    expect(second.net).toBeCloseTo(left.width, 12);
    // The negative rest is drawn over the end of the others, ending where they do.
    const [portfolio, buffer, unexplained] = second.parts;
    expect(unexplained.from + unexplained.width).toBeCloseTo(buffer.from + buffer.width, 12);
    expect(portfolio.from).toBe(0);
  });

  it("a positive rest is a grey part of its own", () => {
    const flow = { ...FLOW, perMonth: { ...FLOW.perMonth, leftOre: 1_000_000 }, destinations: { ...FLOW.destinations, unexplainedOre: 210_000 } };
    const { scale } = incomeBar(flow.perMonth);
    const second = surplusBar(flow, scale);
    const rest = second.parts.find((p) => p.key === "unexplained")!;
    expect(rest.subtracts).toBeUndefined();
    expect(rest.from).toBeCloseTo((700_000 + 90_000) / scale, 12);
    expect(second.net).toBeCloseTo(1_000_000 / scale, 12);
  });
});
