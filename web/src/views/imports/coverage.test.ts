import { describe, expect, it } from "vitest";
import type { ImportCoverage } from "../../api";
import { accountState, addMonth, coveredTo, feedText, gapText } from "./coverage";

const TODAY = "2026-09-25";
const account = (over: Partial<ImportCoverage> = {}): ImportCoverage => ({
  accountId: 1,
  name: "Konto",
  kind: "bank",
  source: "swedbank",
  importedTo: null,
  importedAt: null,
  via: "enable_banking",
  syncedAt: null,
  lastInvoiceTo: null,
  nextInvoiceTo: null,
  ...over,
});
const daysBack = (n: number) => new Date(Date.parse(TODAY) - n * 86_400_000).toISOString().slice(0, 10);

describe("the status dot by days", () => {
  it("green up to 1 day's gap, orange 2–7, red after", () => {
    const health = (n: number) => accountState(account({ importedTo: daysBack(n) }), TODAY);
    expect(health(0)).toMatchObject({ gap: 0, health: "ok" });
    expect(health(1)).toMatchObject({ gap: 1, health: "ok" });
    expect(health(2)).toMatchObject({ gap: 2, health: "late" });
    expect(health(7)).toMatchObject({ gap: 7, health: "late" });
    expect(health(8)).toMatchObject({ gap: 8, health: "overdue" });
  });

  it("a bank account brought in by hand is judged by days too", () => {
    expect(accountState(account({ via: "file", importedTo: daysBack(8) }), TODAY).health).toBe("overdue");
  });

  it("nothing imported: no date, a grey dot", () => {
    expect(accountState(account(), TODAY)).toEqual({ to: null, gap: null, health: "none", nextInvoice: null });
  });

  it("a bank fetch that brought nothing new still counts, in Swedish time", () => {
    // 23:30 UTC on the 24th is the 25th in Stockholm.
    const quiet = account({ importedTo: "2026-09-10", syncedAt: "2026-09-24T23:30:00Z" });
    expect(coveredTo(quiet)).toBe("2026-09-25");
    expect(accountState(quiet, TODAY)).toMatchObject({ gap: 0, health: "ok" });
    // Not for an account brought in by hand.
    expect(coveredTo({ ...quiet, via: "file" })).toBe("2026-09-10");
  });
});

describe("the status dot by invoice (a credit card brought in by hand)", () => {
  const card = (lastInvoiceTo: string | null, importedTo = lastInvoiceTo) =>
    account({ kind: "credit_card", source: "mastercard", via: "file", importedTo, lastInvoiceTo });

  it("green until the next invoice is expected, orange for 7 days after, then red", () => {
    expect(accountState(card("2026-09-18"), TODAY)).toMatchObject({ gap: 7, health: "ok", nextInvoice: "2026-10-18" });
    expect(accountState(card("2026-08-18"), TODAY)).toMatchObject({ health: "late", nextInvoice: "2026-09-18" }); // 7 days late
    expect(accountState(card("2026-08-17"), TODAY)).toMatchObject({ health: "overdue" }); // 8 days late
    expect(accountState(card("2026-08-25"), TODAY)).toMatchObject({ health: "ok" }); // due today
  });

  it("the invoice's period, not a later printout, sets when the next is due", () => {
    expect(accountState(card("2026-08-18", "2026-09-10"), TODAY)).toMatchObject({ to: "2026-09-10", health: "late", nextInvoice: "2026-09-18" });
  });

  it("where the invoice says the next one ends, when it says", () => {
    const told = { ...card("2026-08-18"), nextInvoiceTo: "2026-09-20" };
    expect(accountState(told, TODAY)).toMatchObject({ health: "late", nextInvoice: "2026-09-20" });
  });

  it("without an invoice, a month from the last import", () => {
    expect(accountState(card(null, "2026-09-01"), TODAY)).toMatchObject({ health: "ok", nextInvoice: "2026-10-01" });
  });
});

describe("addMonth", () => {
  it("keeps the day where the month has it", () => {
    expect(addMonth("2026-09-18")).toBe("2026-10-18");
    expect(addMonth("2026-01-31")).toBe("2026-02-28");
    expect(addMonth("2028-01-31")).toBe("2028-02-29");
    expect(addMonth("2026-12-15")).toBe("2027-01-15");
  });
});

describe("the texts", () => {
  it("the gap and how the account gets its data", () => {
    expect([0, 1, 7].map(gapText)).toEqual(["inget glapp", "1 dags glapp", "7 dagars glapp"]);
    expect(feedText(account())).toBe("Enable Banking");
    expect(feedText(account({ via: "file", source: "mastercard" }))).toBe("faktura-PDF, manuellt");
    expect(feedText(account({ via: "file", source: "norwegian" }))).toBe("XLSX/faktura-PDF, manuellt");
    expect(feedText(account({ via: "file" }))).toBe("CSV, manuellt");
  });
});
