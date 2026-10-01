import { describe, expect, it } from "vitest";
import type { Affordability } from "../../../api";
import { answerText } from "./AffordCard";

/** A verdict with only what the sentence reads. */
function verdict(o: { verdict: Affordability["verdict"]; lowest: number; end?: number; safeToSpend: number; funding?: "cash" | "savings"; reasons?: string[]; headline?: string }): Affordability {
  return {
    input: { amount: 500000, date: "2026-10-15", accountId: null, shared: false, funding: o.funding ?? "cash", partner: true },
    payment: { payDate: "2026-10-15", card: null, partnerHalf: 0, partnerDate: null },
    netCost: 500000,
    before: { lowest: { date: "2026-10-22", balance: 1753600 }, end: { date: "2026-12-24", balance: 6049000 }, safeToSpend: 1553600, bufferMonths: 1, withSavingsMonths: 10 },
    after: { lowest: { date: "2026-10-22", balance: o.lowest }, end: { date: "2026-12-24", balance: o.end ?? 5549000 }, safeToSpend: o.safeToSpend, bufferMonths: 1, withSavingsMonths: 10 },
    verdict: o.verdict,
    headline: o.headline ?? "",
    reasons: o.reasons ?? [],
    waitUntil: null,
    salary: null,
    alternative: null,
    limits: { buffer: 200000, redBelowMonths: 3 },
    horizon: "2026-12-24",
    monthStarts: [],
  };
}
const plain = (s: string) => s.replace(/\s/g, " ");

describe("the answer in Har jag råd?", () => {
  it("Ja: the lowest point before and after, and where it lands", () => {
    expect(plain(answerText(verdict({ verdict: "green", lowest: 1253600, safeToSpend: 1053600 })))).toBe(
      "Ja. Lägsta punkten blir 12 536 kr den 22/10 i stället för 17 536 kr, och du landar på 55 490 kr den 24/12.",
    );
  });

  it("Knappt: under the buffer, or the server's reason when it is something else", () => {
    expect(plain(answerText(verdict({ verdict: "yellow", lowest: 150000, safeToSpend: -50000 })))).toBe(
      "Knappt – lägsta punkten blir 1 500 kr den 22/10, under bufferten på 2 000 kr.",
    );
    // The money is there first after the salary.
    expect(answerText(verdict({ verdict: "yellow", lowest: 900000, safeToSpend: 700000, reasons: ["Det ryms, men pengarna finns på bankkontona först 23/10."] }))).toBe(
      "Knappt – det ryms, men pengarna finns på bankkontona först 23/10.",
    );
  });

  it("Nej: under zero, or the server's reason (the savings would last too short)", () => {
    expect(plain(answerText(verdict({ verdict: "red", lowest: -441100, safeToSpend: -641100 })))).toBe("Nej – kassan går under noll den 22/10 (−4 411 kr).");
    expect(
      answerText(verdict({ verdict: "red", lowest: 900000, safeToSpend: 700000, funding: "savings", reasons: ["Pengarna räcker 2,5 månader med sparandet efter köpet, under gränsen 3 månader."] })),
    ).toBe("Nej – pengarna räcker 2,5 månader med sparandet efter köpet, under gränsen 3 månader.");
  });
});
