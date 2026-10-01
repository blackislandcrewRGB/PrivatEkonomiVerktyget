import { describe, expect, it } from "vitest";
import type { CashEvent, Cashflow } from "../../../api";
import { dayRows, listEnd } from "./dayRows";

type Day = Cashflow["days"][number];
const ev = (kind: CashEvent["kind"], name: string, kr: number): CashEvent => ({ date: "", kind, name, amount: kr * 100 });

/**
 * 25/9 to 23/12 (90 days): rent every 25th, the salary 23/10, 24/11 and
 * 23/12, bills 28/9 and 1/11. The lowest point 22/10, a day with nothing on it.
 */
function flow(): Pick<Cashflow, "today" | "days" | "lowest"> {
  const days: Day[] = Array.from({ length: 90 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10);
    return { date, balance: 2000000 - i * 1000, variable: 1000, events: [] };
  });
  const on = (date: string, ...events: CashEvent[]) => (days.find((d) => d.date === date)!.events = events.map((e) => ({ ...e, date })));
  for (const d of ["2026-09-25", "2026-10-25", "2026-11-25"]) on(d, ev("fixed", "Hyra", -7500));
  on("2026-09-28", ev("fixed", "Bredband", -399));
  on("2026-10-23", ev("income", "Lön (prognos, 160 tim)", 23900));
  on("2026-10-25", ev("fixed", "Hyra", -7500), ev("invoice", "Bank Norwegian: faktura", -8123));
  on("2026-11-01", ev("fixed", "TV-paketet", -1500));
  on("2026-11-24", ev("income", "Lön (prognos, 140 tim)", 22000));
  on("2026-12-23", ev("income", "Lön (prognos, 150 tim)", 24000));
  return { today: "2026-09-25", days, lowest: { date: "2026-10-22", balance: 1500000 } };
}

describe("Dag för dag", () => {
  it("till nästa lön runs through the salary and the bills it pays; 30 days; 90 days", () => {
    const data = flow();
    expect(listEnd(data, "salary")).toBe("2026-10-25");
    expect(listEnd(data, "30")).toBe("2026-10-25");
    expect(listEnd(data, "90")).toBe("2026-12-23");
    // The days with something on them in the range, and the lowest day.
    expect(dayRows(data, "salary").map((r) => r.date)).toEqual(["2026-09-25", "2026-09-28", "2026-10-22", "2026-10-23", "2026-10-25"]);
    expect(dayRows(data, "90")).toHaveLength(9);
    // 30 days from today is also 25/10 here; a shorter month to the salary is not.
    const early = { ...data, days: data.days.map((d) => (d.date === "2026-10-23" ? { ...d, events: [] } : d.date === "2026-10-10" ? { ...d, events: [ev("income", "Lön", 20000)] } : d)) };
    expect(listEnd(early, "salary")).toBe("2026-10-10");
  });

  it("the lowest day has a row of its own even without events, and today is marked", () => {
    const rows = dayRows(flow(), "salary");
    expect(rows.find((r) => r.date === "2026-10-22")).toMatchObject({ lowest: true, events: [] });
    expect(rows[0]).toMatchObject({ date: "2026-09-25", today: true, lowest: false });
  });

  it("without a salary in sight: 30 days", () => {
    const data = flow();
    const none = { ...data, days: data.days.map((d) => ({ ...d, events: d.events.filter((e) => e.kind !== "income") })) };
    expect(listEnd(none, "salary")).toBe("2026-10-25");
  });
});
