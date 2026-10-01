import { describe, expect, it } from "vitest";
import type { CashEvent, Cashflow } from "../../../api";
import { bigDrops, dropText, MAX_DROPS, paydays, placeBox, yTicks } from "./chartMarks";

type Day = Cashflow["days"][number];
const ev = (kind: CashEvent["kind"], name: string, kr: number): CashEvent => ({ date: "", kind, name, amount: kr * 100 });

/** Days from 1/10 with the given balances (kr) and events. */
const daysOf = (balances: number[], events: Record<number, CashEvent[]> = {}): Day[] =>
  balances.map((b, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, balance: b * 100, variable: 0, events: events[i] ?? [] }));

describe("the marks on the curve", () => {
  it("names a day's fall: fixed ones by name, invoices counted", () => {
    expect(dropText([ev("invoice", "Bank Norwegian: faktura", -6840), ev("fixed", "Hyra", -7500), ev("invoice", "Swedbank Mastercard Guld: nästa faktura", -2760), ev("partner", "Från Mio", 5200)])).toBe(
      "hyra + två fakturor",
    );
    expect(dropText([ev("invoice", "Bank Norwegian: faktura", -5890)])).toBe("kortfaktura");
    expect(dropText([ev("fixed", "CSN", -1500), ev("fixed", "Exempel Gym", -599), ev("fixed", "Tandvård", -190)])).toBe("CSN + Exempel Gym + 1 till");
  });

  it("marks falls of more than 5 000 kr, never more than four: the largest, in date order", () => {
    const balances = [40000, 33000, 33000, 24000, 24000, 18000, 18000, 11000, 11000, 5500, 5500, 4000];
    const days = daysOf(balances, { 1: [ev("fixed", "Hyra", -7000)], 3: [ev("invoice", "Bank Norwegian: faktura", -9000)] });
    // Five falls over 5 000 (7 000, 9 000, 6 000, 7 000, 5 500); 1 500 on the last day is not one.
    const drops = bigDrops(days);
    expect(drops).toHaveLength(MAX_DROPS);
    expect(drops.map((d) => [d.date, d.fall / 100])).toEqual([
      ["2026-10-02", 7000],
      ["2026-10-04", 9000],
      ["2026-10-06", 6000],
      ["2026-10-08", 7000],
    ]);
    expect(drops[0]).toMatchObject({ tone: "other", label: "2/10 hyra" });
    expect(drops[1]).toMatchObject({ tone: "invoice", label: "4/10 kortfaktura" });
    // The lowest day has a mark of its own.
    expect(bigDrops(days, ["2026-10-04"]).map((d) => d.date)).not.toContain("2026-10-04");
  });

  it("finds the paydays", () => {
    const days = daysOf([0, 0, 0], { 1: [ev("income", "Lön (prognos, 145 tim)", 24350)], 2: [ev("income", "Swish", 100)] });
    expect(paydays(days)).toEqual(["2026-10-02"]);
  });

  it("y ticks in round steps from 0: 0, 20k, 40k, 60k for up to 40 410 kr", () => {
    expect(yTicks(1158900, 4041000)).toEqual([0, 2000000, 4000000, 6000000]);
    expect(yTicks(-300000, 900000)).toEqual([-500000, 0, 500000, 1000000]);
  });

  it("puts a label above left of its point, elsewhere when the curve is there, mirrored at the left edge", () => {
    const plot = { x: 0, y: 0, width: 600, height: 300 };
    const size = { width: 100, height: 40 };
    expect(placeBox({ x: 300, y: 200 }, size, plot, [])).toMatchObject({ side: "left", above: true, x: 188, y: 148, covered: 0 });
    // The curve runs through the space above left: above right instead.
    const curve = [{ x: 200, y: 170 }, { x: 290, y: 170 }];
    expect(placeBox({ x: 300, y: 200 }, size, plot, curve)).toMatchObject({ side: "right", above: true, covered: 0 });
    // Near the left edge the right side comes first.
    expect(placeBox({ x: 60, y: 200 }, size, plot, [])).toMatchObject({ side: "right", above: true });
    // Nothing free beside it, above or below: lifted higher up.
    const wall = [...Array(20)].flatMap((_, i) => [{ x: 150 + i * 15, y: 160 }, { x: 150 + i * 15, y: 225 }]);
    const lifted = placeBox({ x: 300, y: 200 }, size, plot, wall);
    expect(lifted.covered).toBe(0);
    expect(lifted.y + lifted.height).toBeLessThan(160);
    // Not allowed to lift (a fall's name): the least covered spot beside it, and says so.
    expect(placeBox({ x: 300, y: 200 }, size, plot, wall, 12, 0).covered).toBeGreaterThan(0);
  });
});
