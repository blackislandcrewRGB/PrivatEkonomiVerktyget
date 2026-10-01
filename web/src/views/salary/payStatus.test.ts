import { describe, expect, it } from "vitest";
import { payStatus, payStatusLabel } from "./payStatus";

const paid = (diff: number) => ({ actual: { bookingDate: "2026-09-24", amount: 2450000 + diff }, diff });

describe("the pay status pill", () => {
  it("in to the krona: 'kom in exakt'", () => {
    expect(payStatus(paid(0))).toEqual({ kind: "exact" });
    expect(payStatus(paid(40))).toEqual({ kind: "exact" });
    expect(payStatusLabel(payStatus(paid(0)))).toBe("kom in exakt");
  });

  it("off by kronor: 'avvek' with the sign", () => {
    expect(payStatus(paid(12000))).toEqual({ kind: "off", diff: 12000 });
    expect(payStatusLabel(payStatus(paid(12000)))).toMatch(/^avvek \+120\skr$/);
    expect(payStatusLabel(payStatus(paid(-150000)))).toMatch(/^avvek −1\s500\skr$/);
  });

  it("not in yet: 'prognos'", () => {
    expect(payStatus({ actual: null, diff: null })).toEqual({ kind: "forecast" });
    expect(payStatusLabel({ kind: "forecast" })).toBe("prognos");
  });
});
