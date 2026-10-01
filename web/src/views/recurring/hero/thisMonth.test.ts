import { describe, expect, it } from "vitest";
import type { ExpenseStatus, RecurringExpense } from "../../../api";
import { monthProgress } from "./thisMonth";

const row = (amount: number, status: ExpenseStatus | null, over: Partial<RecurringExpense> = {}) =>
  ({
    shared: false,
    paused: false,
    thisMonth: status ? { period: "2026-09", dueDate: "2026-09-25", status, amount, transaction: null } : null,
    ...over,
  }) as RecurringExpense;

describe("monthProgress", () => {
  it("left to draw: everything not drawn or marked paid this month, shared at half for Min del", () => {
    const rows = [
      row(750000, "kommande", { shared: true }),
      row(59900, "dragen"),
      row(18900, "forfallen"),
      row(12000, "markerad_betald"),
      row(4500, "passerad"),
      row(289900, null, { billingCycle: "yearly" }),
    ];
    expect(monthProgress(rows, "household")).toEqual({ leftOre: 750000 + 18900 + 4500, leftCount: 3, total: 5, drawnShare: 2 / 5 });
    expect(monthProgress(rows, "mine").leftOre).toBe(375000 + 18900 + 4500);
  });

  it("nothing this month: nothing left and nothing drawn", () => {
    expect(monthProgress([row(1000, null, { paused: true })], "mine")).toEqual({ leftOre: 0, leftCount: 0, total: 0, drawnShare: 0 });
  });
});
