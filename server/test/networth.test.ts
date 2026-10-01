import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, manualBalances, recurringExpenses, recurringIncome, statements, transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { balanceSheet, cardDebts } from "../src/networth/networth.js";
import { buildOverview } from "../src/overview/overview.js";
import {
  ManualBalanceError,
  createManualBalance,
  currentBalance,
  deleteManualBalance,
  manualBalanceByKey,
  seedManualBalances,
  updateManualBalance,
} from "../src/networth/manualBalances.js";
import { freshDb } from "./helpers.js";

/**
 * Balansräkningen.
 *
 * Every figure here is checked against the rule it is supposed to follow, not
 * against a number someone typed once: that a krona is counted exactly one
 * time, that what isn't known stays unknown, and that the car never sneaks
 * into a total it doesn't belong in.
 */

type Db = ReturnType<typeof freshDb>;

const TODAY = "2026-09-20";

/** The accounts a fresh database seeds, by name. */
const accountId = (db: Db, name: string) => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, name)).get()!.id;

function setBalance(db: Db, name: string, ore: number, updated = `${TODAY}T10:00:00.000Z`) {
  db.update(accounts).set({ balance: ore, balanceUpdatedAt: updated }).where(eq(accounts.name, name)).run();
}

let nextFingerprint = 1;

/** A booked row, with the few fields the balance sheet reads. */
function tx(db: Db, row: { accountId: number; date: string; amount: number; isTransfer?: boolean; counterAccountId?: number; recurringExpenseId?: number; posted?: string }) {
  return db
    .insert(transactions)
    .values({
      accountId: row.accountId,
      bookingDate: row.date,
      transactionDate: row.date,
      postedDate: row.posted ?? row.date,
      descriptionRaw: "rad",
      descriptionClean: "rad",
      amount: row.amount,
      isTransfer: row.isTransfer ?? false,
      counterAccountId: row.counterAccountId ?? null,
      recurringExpenseId: row.recurringExpenseId ?? null,
      source: "manual",
      fingerprint: `nw-${nextFingerprint++}`,
    })
    .returning()
    .get();
}

/** Swedish number formatting puts a non-breaking space in a thousand. */
const plain = (text: string) => text.replace(/\s/g, " ");

const row = (sheet: ReturnType<typeof balanceSheet>, key: string) =>
  [...sheet.liquid, ...sheet.debts, ...sheet.illiquid, ...(sheet.csn ? [sheet.csn] : [])].find((r) => r.key === key);

describe("poster som hålls för hand", () => {
  it("is an anchor and a day, and the charges do the rest", () => {
    const db = freshDb({ seeded: true });
    const expense = db.insert(recurringExpenses).values({ name: "CSN", amount: -180_000, anchorDay: 31, paymentMethod: "autogiro" }).returning().get();
    const loan = createManualBalance(db, { key: "csn", kind: "debt", name: "CSN", amountOre: 20_000_000, valueDate: "2026-09-20", recurringExpenseId: expense.id });
    const bank = accountId(db, "Swedbank Privatkonto");

    // Nothing drawn yet: the anchor is the answer.
    expect(currentBalance(db, loan, "2026-09-25").amountOre).toBe(20_000_000);

    // Three months of charges, one of them a different amount — which is why
    // the charge decides, not the instalment on the expense.
    tx(db, { accountId: bank, date: "2026-09-30", amount: -180_000, recurringExpenseId: expense.id });
    tx(db, { accountId: bank, date: "2026-10-30", amount: -180_000, recurringExpenseId: expense.id });
    tx(db, { accountId: bank, date: "2026-11-30", amount: -180_500, recurringExpenseId: expense.id });

    const after = currentBalance(db, loan, "2026-12-01");
    expect(after.charges).toBe(3);
    expect(after.paidOre).toBe(540_500);
    expect(after.amountOre).toBe(20_000_000 - 540_500);
    expect(after.lastChargeDate).toBe("2026-11-30");
    // A day in the middle counts only what had happened by then.
    expect(currentBalance(db, loan, "2026-10-30").charges).toBe(2);
  });

  it("a correction is nothing but a newer anchor", () => {
    const db = freshDb({ seeded: true });
    const expense = db.insert(recurringExpenses).values({ name: "CSN", amount: -180_000, anchorDay: 31, paymentMethod: "autogiro" }).returning().get();
    const loan = createManualBalance(db, { key: "csn", kind: "debt", name: "CSN", amountOre: 20_000_000, valueDate: "2026-09-20", recurringExpenseId: expense.id });
    tx(db, { accountId: accountId(db, "Swedbank Privatkonto"), date: "2026-09-30", amount: -180_000, recurringExpenseId: expense.id });

    // The real balance turned out to be something else. Moving the day with
    // the amount is the whole point: leave it behind and September's charge
    // would be subtracted a second time.
    const fixed = updateManualBalance(db, loan.id, { amountOre: 38_500_000, valueDate: "2026-10-01" });
    expect(currentBalance(db, fixed, "2026-10-15").amountOre).toBe(38_500_000);
    expect(currentBalance(db, fixed, "2026-10-15").charges).toBe(0);
  });

  it("never carries a debt past zero", () => {
    const db = freshDb({ seeded: true });
    const expense = db.insert(recurringExpenses).values({ name: "CSN", amount: -180_000, anchorDay: 31, paymentMethod: "autogiro" }).returning().get();
    const loan = createManualBalance(db, { key: "csn", kind: "debt", name: "CSN", amountOre: 100_000, valueDate: "2026-09-20", recurringExpenseId: expense.id });
    tx(db, { accountId: accountId(db, "Swedbank Privatkonto"), date: "2026-09-30", amount: -180_000, recurringExpenseId: expense.id });
    // Paid off is paid off, not negative.
    expect(currentBalance(db, loan, "2026-10-01").amountOre).toBe(0);
  });

  it("refuses an amount or a day that can't be true", () => {
    const db = freshDb({ seeded: true });
    const bad = (patch: Record<string, unknown>) => () => createManualBalance(db, { key: "x", kind: "asset", name: "Bilen", amountOre: 1, valueDate: "2026-09-20", ...patch });
    // Debts are written positive, so a minus sign is a mistake, not a debt.
    expect(bad({ amountOre: -1 })).toThrow(ManualBalanceError);
    expect(bad({ amountOre: 1.5 })).toThrow(/antal öre/);
    expect(bad({ valueDate: "20 sep" })).toThrow(/ÅÅÅÅ-MM-DD/);
    expect(bad({ name: "  " })).toThrow(/behöver ett namn/);
  });

  it("seeds the loan and the car once, and doesn't bring back what was deleted", () => {
    const db = freshDb({ seeded: true });
    // freshDb has already seeded them; a second pass adds nothing.
    expect(seedManualBalances(db)).toBe(0);
    expect(manualBalanceByKey(db, "csn")?.amountOre).toBe(20_000_000);
    expect(manualBalanceByKey(db, "car")).toMatchObject({ amountOre: 8_000_000, kind: "asset", liquid: false, source: "exempel" });

    const car = manualBalanceByKey(db, "car")!;
    expect(deleteManualBalance(db, car.id)).toBe(true);
    expect(seedManualBalances(db)).toBe(0);
    expect(manualBalanceByKey(db, "car")).toBeUndefined();
  });
});

describe("kortskulden", () => {
  /** A Mastercard statement, and purchases on either side of its period. */
  function mastercard(db: Db, opts: { paid: boolean }) {
    const card = accountId(db, "Swedbank Mastercard Guld");
    db.insert(statements)
      .values({ accountId: card, periodFrom: "2026-08-08", periodTo: "2026-09-04", dueDate: "2026-09-30", amountDue: 872_460, source: "manual", paidAt: opts.paid ? `${TODAY}T07:00:00.000Z` : null })
      .run();
    tx(db, { accountId: card, date: "2026-08-20", amount: -50_000 }); // on the invoice
    tx(db, { accountId: card, date: "2026-09-10", amount: -120_000 }); // after it
    tx(db, { accountId: card, date: "2026-09-12", amount: 20_000 }); // a refund after it
    return card;
  }

  it("is what is unpaid plus what has been bought since the period closed", () => {
    const db = freshDb({ seeded: true });
    mastercard(db, { paid: false });
    const [debt] = cardDebts(db, TODAY).filter((d) => d.name.includes("Mastercard"));
    // 8 724,60 still due, and 1 200 − 200 bought since 4/9. The purchase on
    // the invoice is not counted twice.
    expect(debt.amountOre).toBe(872_460 + 100_000);
    expect(debt.basis).toContain("obetalt på fakturan som förfaller 30/9");
    // By the month it is paid: the invoice on the 25th, what is bought since with the next one.
    expect(debt.payments).toEqual([
      { payDate: "2026-09-25", amountOre: 872_460 },
      { payDate: "2026-10-25", amountOre: 100_000 },
    ]);
  });

  it("doesn't fall to zero the day the invoice is paid", () => {
    const db = freshDb({ seeded: true });
    mastercard(db, { paid: true });
    const [debt] = cardDebts(db, TODAY).filter((d) => d.name.includes("Mastercard"));
    // The invoice is settled, but a thousand kronor is already spent and will
    // be billed. A net worth that sawed up and down on the payment day would
    // be saying something about the calendar, not about the money.
    expect(debt.amountOre).toBe(100_000);
    expect(plain(debt.basis)).toBe("fakturan 30/9 är betald, 1 000 kr köpt sedan 4/9");
  });

  describe("the card on Översikten", () => {
    const card = (db: Db) => buildOverview(db, TODAY).balances.find((b) => b.name === "Swedbank Mastercard Guld")!;

    it("is the same debt, not the invoice's figure left standing after it is paid", () => {
      const db = freshDb({ seeded: true });
      const id = mastercard(db, { paid: false });
      // What the invoice import leaves: the invoice's debt as the balance.
      setBalance(db, "Swedbank Mastercard Guld", -872_460, "2026-09-18T15:26:49.417Z");
      // Paid from the e-sparkonto: the bank side of the transfer.
      tx(db, { accountId: accountId(db, "Swedbank e-sparkonto"), date: "2026-09-21", amount: -872_460, isTransfer: true, counterAccountId: id });

      const b = buildOverview(db, "2026-09-21").balances.find((x) => x.id === id)!;
      expect(b.balance).toBe(-100_000);
      expect(b.debt).toMatchObject({ invoicePaid: true, unpaid: 0, since: 100_000, settledTo: "2026-09-04", lastPurchase: "2026-09-12" });
      expect(b).toMatchObject({ ageDays: 0, stale: false });
    });

    it("counts what is left on an unpaid invoice", () => {
      const db = freshDb({ seeded: true });
      mastercard(db, { paid: false });
      expect(card(db)).toMatchObject({ balance: -(872_460 + 100_000), debt: { invoicePaid: false, unpaid: 872_460 } });
    });

    it("keeps a debt typed in by hand after the invoice's period, until a later invoice arrives", () => {
      const db = freshDb({ seeded: true });
      const id = mastercard(db, { paid: true });
      db.update(accounts).set({ balance: -5_000, balanceUpdatedAt: "2026-09-15", manuallyEditedAt: "2026-09-15T08:00:00.000Z" }).where(eq(accounts.id, id)).run();
      expect(card(db)).toMatchObject({ balance: -5_000, debt: null, updatedAt: "2026-09-15" });

      // The next invoice closes after the typed figure: it is worked out again.
      db.insert(statements).values({ accountId: id, periodFrom: "2026-09-05", periodTo: "2026-10-07", dueDate: "2026-10-30", amountDue: 100_000, source: "manual" }).run();
      expect(card(db)).toMatchObject({ balance: -100_000, debt: { settledTo: "2026-10-07" } });
    });

    it("leaves a card whose balance isn't followed alone", () => {
      const db = freshDb({ seeded: true });
      const id = mastercard(db, { paid: false });
      db.update(accounts).set({ trackBalance: false, balance: -1 }).where(eq(accounts.id, id)).run();
      expect(card(db)).toMatchObject({ balance: -1, debt: null });
    });
  });

  it("goes by the posting day, so a purchase lands on the invoice it is billed on", () => {
    const db = freshDb({ seeded: true });
    const card = mastercard(db, { paid: true });
    // Bought on the last day of the period, posted the day after: the bank
    // puts it on the next invoice, and so does this.
    tx(db, { accountId: card, date: "2026-09-04", posted: "2026-09-05", amount: -30_000 });
    const [debt] = cardDebts(db, TODAY).filter((d) => d.name.includes("Mastercard"));
    expect(debt.amountOre).toBe(130_000);
  });

  it("uses the invoice cycle for a card that has no statement", () => {
    const db = freshDb({ seeded: true });
    const card = accountId(db, "Bank Norwegian");
    const bank = accountId(db, "Swedbank Privatkonto");
    // The invoice for 16/7–15/8 was paid on 25/8. Everything posted after the
    // 15th of August is still owed — including the purchase made on the 14th
    // that the bank posted on the 16th.
    tx(db, { accountId: bank, date: "2026-08-25", amount: -693_815, isTransfer: true, counterAccountId: card });
    tx(db, { accountId: card, date: "2026-08-10", amount: -40_000 });
    tx(db, { accountId: card, date: "2026-08-14", posted: "2026-08-16", amount: -30_000 });
    tx(db, { accountId: card, date: "2026-09-02", amount: -100_000 });

    const [debt] = cardDebts(db, TODAY).filter((d) => d.name.includes("Norwegian"));
    expect(debt.amountOre).toBe(130_000);
    expect(debt.basis).toContain("fakturaperioden som slutade 15/8");
    expect(debt.payments).toEqual([{ payDate: "2026-09-25", amountOre: 130_000 }]);
    // Posted after the 15th of September: on the next invoice, paid in October.
    tx(db, { accountId: card, date: "2026-09-16", posted: "2026-09-17", amount: -25_000 });
    const [later] = cardDebts(db, "2026-09-24").filter((d) => d.name.includes("Norwegian"));
    expect(later.payments).toEqual([
      { payDate: "2026-09-25", amountOre: 130_000 },
      { payDate: "2026-10-25", amountOre: 25_000 },
    ]);
  });

  it("says a debt is unknown rather than calling it zero", () => {
    const db = freshDb({ seeded: true });
    const card = accountId(db, "Bank Norwegian");
    // Purchases, but no invoice and no payment ever: there is nothing to
    // measure from, and pretending it is nothing would flatter the total.
    tx(db, { accountId: card, date: "2026-09-02", amount: -100_000 });
    const [debt] = cardDebts(db, TODAY).filter((d) => d.name.includes("Norwegian"));
    expect(debt).toMatchObject({ unknown: true, amountOre: 0 });
    expect(balanceSheet(db, TODAY).notes.join(" ")).toContain("skulden är okänd");
  });

  it("leaves a card nobody has used out of the sheet", () => {
    const db = freshDb({ seeded: true });
    expect(cardDebts(db, TODAY)).toEqual([]);
  });
});

describe("balansräkningen", () => {
  function household(db: Db) {
    setBalance(db, "Swedbank Privatkonto", 1_845_000);
    setBalance(db, "Swedbank e-sparkonto", 4_237_500);
  }

  it("counts what is followed, and says what each figure rests on", () => {
    const db = freshDb({ seeded: true });
    household(db);
    const sheet = balanceSheet(db, TODAY);

    expect(row(sheet, `account:${accountId(db, "Swedbank Privatkonto")}`)).toMatchObject({ amountOre: 1_845_000, basis: "saldo från 20/9" });
    expect(sheet.totals.liquidOre).toBe(6_082_500);
    // The loan is never inside the debts: it has a total of its own.
    expect(sheet.debts).toEqual([]);
    expect(sheet.csn).toMatchObject({ name: "CSN", amountOre: 20_000_000 });
    expect(sheet.totals.netExCsnOre).toBe(6_082_500);
    expect(sheet.totals.netIncCsnOre).toBe(6_082_500 - 20_000_000);
  });

  it("keeps the car out of the two totals, and on its own line in the other two", () => {
    const db = freshDb({ seeded: true });
    household(db);
    const sheet = balanceSheet(db, TODAY);

    expect(sheet.illiquid.map((r) => r.key)).toEqual(["car"]);
    expect(sheet.totals.illiquidOre).toBe(8_000_000);
    // A car is worth something and is not money. The headline totals don't
    // know about it; the ones behind the switch do.
    expect(sheet.totals.netExCsnOre).toBe(6_082_500);
    expect(sheet.totals.netExCsnWithIlliquidOre).toBe(6_082_500 + 8_000_000);
    expect(sheet.totals.netIncCsnWithIlliquidOre).toBe(sheet.totals.netIncCsnOre + 8_000_000);
  });

  it("counts an old balance, and says out loud that it is old", () => {
    const db = freshDb({ seeded: true });
    setBalance(db, "Swedbank Privatkonto", 1_845_000, "2026-09-01T10:00:00.000Z");
    const sheet = balanceSheet(db, TODAY);
    expect(sheet.notes.join(" ")).toContain("Swedbank Privatkonto har ett saldo från 1/9 — 19 dagar gammalt.");
    // Still counted: the last known figure is the best one there is.
    expect(row(sheet, `account:${accountId(db, "Swedbank Privatkonto")}`)?.amountOre).toBe(1_845_000);
  });

  it("leaves out an account whose balance isn't followed", () => {
    const db = freshDb({ seeded: true });
    household(db);
    db.update(accounts).set({ trackBalance: false }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    const sheet = balanceSheet(db, TODAY);
    expect(sheet.liquid.map((r) => r.name)).toEqual(["Swedbank Privatkonto"]);
  });

  it("puts what the partner owes on the side it belongs on", () => {
    const db = freshDb({ seeded: true });
    household(db);
    const bank = accountId(db, "Swedbank Privatkonto");
    // A shared purchase I paid: half of it is hers.
    db.update(transactions).set({ shared: true }).where(eq(transactions.id, tx(db, { accountId: bank, date: "2026-09-05", amount: -200_000 }).id)).run();

    const sheet = balanceSheet(db, TODAY);
    const claim = row(sheet, "partner");
    expect(claim).toMatchObject({ amountOre: 100_000 });
    expect(claim?.name).toMatch(/är skyldig dig$/);
    // It is an asset, not a smaller debt.
    expect(sheet.liquid.some((r) => r.key === "partner")).toBe(true);
    // Pengar totalt is the money itself: her debt isn't in it.
    expect(sheet.totals.moneyOre).toBe(sheet.totals.liquidOre - 100_000);
  });

  it("Framåt: the money over the coming salary cycle, by what comes in and goes out of the bank", async () => {
    const db = freshDb({ seeded: true });
    household(db);
    const espar = accountId(db, "Swedbank e-sparkonto");
    db.insert(recurringIncome).values({ name: "Lön", amount: 2_500_000, dayOfMonth: 25, accountId: espar, matchPattern: "LÖN" }).run();
    db.insert(recurringExpenses).values({ name: "Hyra", amount: 700_000, anchorDay: 27, accountId: espar, matchPattern: "HYRA", paymentMethod: "transfer" }).run();
    const app = createApp(db, { databasePath: ":memory:" });
    const d = await (await app.request(`/api/networth?today=${TODAY}`)).json();
    expect(d.totals.moneyOre).toBe(6_082_500);
    // From today to the day before October's salary: September's salary in, the rent out.
    expect(d.ahead).toMatchObject({ from: TODAY, to: "2026-10-24", startOre: 6_082_500, salaries: ["2026-09-25", "2026-10-25"] });
    expect(d.ahead.items.map((i: { date: string; name: string; amount: number }) => [i.date, i.name, i.amount])).toEqual([
      ["2026-09-25", "Lön", 2_500_000],
      ["2026-09-27", "Hyra", -700_000],
    ]);
    expect(d.ahead.endOre).toBe(6_082_500 + 2_500_000 - 700_000);
  });

  it("is honest when the debt runs the other way", () => {
    const db = freshDb({ seeded: true });
    household(db);
    const bank = accountId(db, "Swedbank Privatkonto");
    // She paid a shared purchase, so I owe her half. A negative asset would
    // be arithmetic that happens to work; a debt is what it is.
    db.update(transactions)
      .set({ shared: true, paidBy: "partner", accountId: null })
      .where(eq(transactions.id, tx(db, { accountId: bank, date: "2026-09-05", amount: -200_000 }).id))
      .run();

    const sheet = balanceSheet(db, TODAY);
    expect(sheet.liquid.some((r) => r.key === "partner")).toBe(false);
    expect(row(sheet, "partner")).toMatchObject({ amountOre: 100_000 });
    expect(row(sheet, "partner")?.name).toMatch(/^Du är skyldig /);
  });

  it("doesn't count the loan the seed put there twice", () => {
    const db = freshDb({ seeded: true });
    const sheet = balanceSheet(db, TODAY);
    expect(db.select().from(manualBalances).all()).toHaveLength(2);
    expect(sheet.debts.filter((r) => r.key === "csn")).toEqual([]);
    expect(sheet.totals.csnOre).toBe(sheet.csn?.amountOre);
  });
});
