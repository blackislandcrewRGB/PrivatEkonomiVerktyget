import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { ensureSeries, putPoints } from "../src/prices/series.js";
import { KPI_TOTAL } from "../src/salary/annualIncome.js";
import {
  AvanzaStatementError,
  avanzaLedger,
  deleteAvanzaStatement,
  listAvanzaStatements,
  parseStatementLines,
  saveAvanzaStatement,
  SECURITY,
} from "../src/savings/avanzaStatement.js";
import { netOfDebt, ownFlows, realSavings } from "../src/savings/real.js";
import { savingsCategoryIds } from "../src/savings/savings.js";
import { setQuarterValue } from "../src/tax/isk.js";
import { freshDb } from "./helpers.js";

/** A made-up kontobesked in the layout the PDF gives: a line's cells joined by ' | '. */
function statement(kind: "Investeringssparkonto" | "Kreditkonto", from: string, to: string, opening: string, closing: string, rows: string[]) {
  return [
    `Kontobesked | Avanza Bank | ${from} - ${to}`,
    "Utskriftsdatum",
    "2026-09-28",
    "Konto | Kontotyp",
    `1234567 | ${kind} | Kim Exempel`,
    "Kontosammanställning (SEK)",
    `Likvida medel | ${opening} | ${closing}`,
    "Transaktionsredovisning (SEK)",
    "Bokföringsdatum | Transaktion | Belopp (SEK) | Saldo",
    `${from} | Ingående saldo | ${opening}`,
    ...rows,
    "Avanza Bank, Box 1399, 111 93 Stockholm. | 1",
  ];
}
const ISK_2024 = statement("Investeringssparkonto", "2024-01-01", "2024-12-31", "0,00", "-1 000,00", [
  "2024-05-02",
  "INSÄTTNING | 20 000,00 | 20 000,00",
  "2024-05-02 | 2024-05-02",
  "2024-05-03 | EXEMPELFONDEN",
  "-25 000,00 | -5 000,00",
  "2024-05-03 | 2024-05-06 | KÖPT | 10 | st | à 2 500 SEK",
  "2024-05-03",
  "KREDIT INS | 5 000,00 | 0,00",
  "2024-05-03 | 2024-05-03",
  "2024-11-04",
  "MOMS | -3,00 | -3,00",
  "2024-12-30",
  "KREDITREGL | -997,00 | -1 000,00",
]);
const CREDIT_2024 = statement("Kreditkonto", "2024-05-03", "2024-12-31", "0,00", "-4 100,00", [
  "2024-05-03",
  "KREDIT UTTAG | -5 000,00 | -5 000,00",
  "2024-10-01",
  "INSÄTTNING | 1 000,00 | -4 000,00",
  "2024-10-31",
  "KAP DEB RÄNTA | -100,00 | -4 100,00",
]);

describe("Avanza's kontobesked", () => {
  it("reads the account, the period and every movement with its balance, securities without their names", () => {
    const s = parseStatementLines(ISK_2024);
    expect([s.account, s.from, s.to, s.openingOre, s.closingOre]).toEqual(["isk", "2024-01-01", "2024-12-31", 0, -100_000]);
    expect(s.movements.map((m) => [m.date, m.kind, m.amountOre, m.balanceOre])).toEqual([
      ["2024-05-02", "INSÄTTNING", 2_000_000, 2_000_000],
      ["2024-05-03", SECURITY, -2_500_000, -500_000],
      ["2024-05-03", "KREDIT INS", 500_000, 0],
      ["2024-11-04", "MOMS", -300, -300],
      ["2024-12-30", "KREDITREGL", -99_700, -100_000],
    ]);
    expect(parseStatementLines(CREDIT_2024).account).toBe("credit");
    // No name, no number: only what the rows above hold.
    expect(JSON.stringify(s)).not.toMatch(/Kim|1234567|EXEMPELFONDEN/);
  });

  it("refuses a statement whose balances don't add up, and anything that isn't one", () => {
    // The purchase's line is missing: the balance after the credit doesn't follow.
    const broken = ISK_2024.filter((l) => l !== "-25 000,00 | -5 000,00");
    expect(() => parseStatementLines(broken)).toThrow(/saldot 2024-05-03 stämmer inte/);
    expect(() => parseStatementLines(["Årsbesked", "Något annat"])).toThrow(AvanzaStatementError);
    expect(() => parseStatementLines(statement("Kreditkonto", "2024-01-01", "2024-12-31", "0,00", "5,00", []))).toThrow(/utgående saldo/);
  });

  it("keeps one per account and start: reading it again replaces it, and it can be removed", () => {
    const db = freshDb();
    saveAvanzaStatement(db, parseStatementLines(ISK_2024));
    const again = saveAvanzaStatement(db, parseStatementLines(ISK_2024));
    saveAvanzaStatement(db, parseStatementLines(CREDIT_2024));
    const list = listAvanzaStatements(db);
    expect(list.map((s) => [s.account, s.periodFrom, s.movements, s.depositedOre])).toEqual([
      ["credit", "2024-05-03", 3, 100_000],
      ["isk", "2024-01-01", 5, 2_000_000],
    ]);
    expect(deleteAvanzaStatement(db, again.id)).toBe(true);
    expect(listAvanzaStatements(db)).toHaveLength(1);
  });

  it("the ledger: own money in and out on both accounts, the credit's debt and the ISK's cash on a day, the interest", () => {
    const db = freshDb();
    saveAvanzaStatement(db, parseStatementLines(ISK_2024));
    saveAvanzaStatement(db, parseStatementLines(CREDIT_2024));
    const l = avanzaLedger(db)!;
    expect(l.coverage).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    // The moves between the accounts (KREDIT INS, KREDIT UTTAG, KREDITREGL) are the same money: left out.
    expect(l.ownFlows).toEqual([
      { date: "2024-05-02", amount: 2_000_000 },
      { date: "2024-10-01", amount: 100_000 },
    ]);
    // Before the credit account opened, nothing; at the start of 1 October, 5 000 kr owed; after the year, its last balance.
    expect([l.creditAt("2024-04-01"), l.creditAt("2024-10-01"), l.creditAt("2024-10-02"), l.creditAt("2026-01-01")]).toEqual([0, -500_000, -400_000, -410_000]);
    expect([l.iskCashAt("2024-05-03"), l.iskCashAt("2024-07-01"), l.iskCashAt("2023-12-31")]).toEqual([2_000_000, 0, null]);
    expect(l.interestBetween("2024-01-01", "2024-12-31")).toBe(10_000);
  });

  it("the values net of the debt, and Avanza's money in its years, the bank's after", () => {
    const db = freshDb();
    saveAvanzaStatement(db, parseStatementLines(ISK_2024));
    saveAvanzaStatement(db, parseStatementLines(CREDIT_2024));
    const l = avanzaLedger(db)!;
    const net = netOfDebt(
      [
        { date: "2024-10-01", valueOre: 3_000_000, source: "entered" },
        // 1 January is just after the statements: the ISK's cash was −1 000 kr, which Avanza's quarter value leaves out.
        { date: "2025-01-01", valueOre: 3_200_000, source: "entered" },
        { date: "2025-06-01", valueOre: 3_500_000, source: "today" },
      ],
      l,
    );
    expect(net.map((p) => [p.valueOre, p.debtOre])).toEqual([
      [2_500_000, -500_000],
      [3_200_000 - 410_000 - 100_000, -510_000],
      // After the statements: the credit's last balance, and today's value has its own cash in it.
      [3_500_000 - 410_000, -410_000],
    ]);
    const flows = ownFlows(
      [
        { date: "2024-09-01", amount: 700_000 },
        { date: "2025-02-01", amount: 300_000 },
      ],
      l,
    );
    expect(flows).toEqual([
      { date: "2024-05-02", amount: 2_000_000 },
      { date: "2024-10-01", amount: 100_000 },
      { date: "2025-02-01", amount: 300_000 },
    ]);
  });

  it("from the database: the ISK's quarters less the debt, and the credit's interest beside the gain", async () => {
    const db = freshDb({ seeded: true });
    const series = ensureSeries(db, { key: KPI_TOTAL, name: "KPI totalt", unit: "index", source: "scb", frequency: "monthly" });
    putPoints(db, series, [
      { date: "2024-09-01", value: 10000 },
      { date: "2024-12-01", value: 10100 },
    ]);
    setQuarterValue(db, "2024-10-01", 3_000_000);
    setQuarterValue(db, "2025-01-01", 3_200_000);
    saveAvanzaStatement(db, parseStatementLines(ISK_2024));
    saveAvanzaStatement(db, parseStatementLines(CREDIT_2024));
    // A Sparande transfer in the statements' year is Avanza's already: not counted twice.
    const bank = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
    db.insert(transactions)
      .values({ source: "swedbank", accountId: bank, bookingDate: "2024-10-01", descriptionRaw: "X", descriptionClean: "X", amount: -100_000, categoryId: savingsCategoryIds(db)[0], fingerprint: "b1" })
      .run();
    const r = realSavings(db, "2025-01-01");
    expect(r.points.map((p) => p.valueOre)).toEqual([2_500_000, 2_690_000]);
    expect(r.totals!.netOre).toBe(100_000);
    // 26 900 − 25 000 − 1 000 put in.
    expect(r.totals!.nominalGainOre).toBe(90_000);
    expect(r.totals!.creditInterestOre).toBe(10_000);
    expect(r.avanza!.statements).toHaveLength(2);

    const app = createApp(db, { databasePath: ":memory:" });
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1, 2, 3])], "inte.pdf", { type: "application/pdf" }));
    const res = await app.request("/api/savings/avanza-statements", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/PDF|kontobesked/);
  });
});

