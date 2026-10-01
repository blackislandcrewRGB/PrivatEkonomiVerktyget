import { describe, expect, it } from "vitest";
import type { BalanceSheet } from "../../../api";
import { aheadDays, aheadTerms, itemsLine, keyDays } from "./ahead";

type Ahead = NonNullable<BalanceSheet["ahead"]>;

/** 25/9 to 23/11 rent and invoices on the 25th, the salary 23/10, Mio in. */
const AHEAD: Ahead = {
  from: "2026-09-25",
  to: "2026-11-23",
  startOre: 18_250_000,
  items: [
    { date: "2026-09-25", kind: "partner", name: "Från Mio", amount: 300_000, estimate: true },
    { date: "2026-09-25", kind: "fixed", name: "Hyra", amount: -750_000 },
    { date: "2026-09-25", kind: "invoice", name: "Bank Norwegian: faktura", amount: -482_100 },
    { date: "2026-10-23", kind: "income", name: "Lön (prognos, 160 tim)", amount: 2_390_000 },
    { date: "2026-10-25", kind: "partner", name: "Från Mio", amount: 930_000, estimate: true },
    { date: "2026-10-25", kind: "invoice", name: "Bank Norwegian: faktura", amount: -812_300 },
    { date: "2026-10-25", kind: "fixed", name: "Hyra", amount: -750_000 },
    { date: "2026-10-25", kind: "invoice", name: "Swedbank Mastercard Guld: nästa faktura", amount: -275_000 },
    { date: "2026-10-28", kind: "fixed", name: "Bredband", amount: -39_900 },
    { date: "2026-11-01", kind: "planned", name: "Resa", amount: -500_000 },
  ],
  endOre: 0,
  salaries: ["2026-10-23", "2026-11-24"],
};
const START = 18_250_000;
const endOf = (a: Ahead) => a.items.reduce((s, i) => s + i.amount, START);

describe("Framåt as an equation", () => {
  it("sums what comes in and what goes out from the list, the planned ones in a box of their own, to where the list ends", () => {
    const terms = aheadTerms(AHEAD);
    expect(terms).toEqual([
      { key: "in", label: "Lön 23/10 + från Mio", amount: 300_000 + 2_390_000 + 930_000 },
      { key: "out", label: "Hyra, fakturor, fasta utgifter", amount: -(750_000 + 482_100 + 812_300 + 750_000 + 275_000 + 39_900) },
      { key: "planned", label: "Resa", amount: -500_000 },
    ]);
    expect(START + terms.reduce((s, t) => s + t.amount, 0)).toBe(endOf(AHEAD));
    expect(aheadDays(AHEAD, START).at(-1)!.balance).toBe(endOf(AHEAD));
  });

  it("picks the day most goes out, the salary and the next largest outflow, by date", () => {
    expect(keyDays(AHEAD, START).map((d) => [d.date, d.net])).toEqual([
      ["2026-09-25", 300_000 - 750_000 - 482_100],
      ["2026-10-23", 2_390_000],
      ["2026-10-25", 930_000 - 812_300 - 750_000 - 275_000],
    ]);
  });

  it("writes a day's items short, and cuts after four", () => {
    const day = aheadDays(AHEAD, START).find((d) => d.date === "2026-10-25")!;
    expect(itemsLine(day.items).replace(/\s/g, " ")).toBe("Från Mio +9 300 · Norwegian −8 123 · Hyra −7 500 · Mastercard −2 750");
    const more = { ...day, items: [...day.items, { date: "2026-10-25", kind: "fixed" as const, name: "Försäkring", amount: -24_200 }] };
    expect(itemsLine(more.items).replace(/\s/g, " ")).toMatch(/Mastercard −2 750 · …$/);
  });
});
