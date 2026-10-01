import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, recurringIncome, recurringIncomeOverrides, statements, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { linkRecurring } from "../src/recurring/link.js";
import { cashflow, monthStartTerms, monthStart, setBuffer } from "../src/cashflow/cashflow.js";
import { addPrice, setShifts } from "../src/fuel/fuel.js";
import { setPartnerNumbers } from "../src/settings.js";
import { createApp } from "../src/app.js";
import { liquidCash, setCash } from "../src/savings/portfolio.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-19";
const PRIVAT = "Swedbank Privatkonto";
const ESPAR = "Swedbank e-sparkonto";
const MASTERCARD = "Swedbank Mastercard Guld";
const NORWEGIAN = "Bank Norwegian";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const json = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });

let seq = 0;
function tx(db: Db, o: { account: string; date: string; amount: number; desc?: string; category?: string; posted?: string }) {
  const cat = o.category ? getCategoryPathMap(db).get(o.category)! : null;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: acc(db, o.account),
      bookingDate: o.date,
      transactionDate: o.date,
      postedDate: o.posted ?? null,
      descriptionRaw: o.desc ?? "X",
      descriptionClean: o.desc ?? "X",
      counterparty: o.desc ?? "X",
      amount: o.amount,
      categoryId: cat,
      categorySource: cat ? "rule" : "none",
      fingerprint: `c${++seq}`,
    })
    .returning()
    .get();
}

function expense(db: Db, o: { name: string; amount: number; day: number; account: string; pattern?: string }) {
  return db
    .insert(recurringExpenses)
    .values({ name: o.name, amount: o.amount, anchorDay: o.day, accountId: acc(db, o.account), matchPattern: o.pattern ?? o.name.toUpperCase(), paymentMethod: "autogiro" })
    .returning()
    .get();
}

/** 10 000 kr on the bank accounts; salary 25 000 kr on the 24th into the e-sparkonto; rent 7 000 kr on the 25th. */
function base() {
  const db = freshDb({ seeded: true });
  db.update(accounts).set({ balance: 400000, balanceUpdatedAt: TODAY }).where(eq(accounts.name, PRIVAT)).run();
  db.update(accounts).set({ balance: 600000, balanceUpdatedAt: TODAY }).where(eq(accounts.name, ESPAR)).run();
  // A card's own balance is never counted.
  db.update(accounts).set({ balance: -500000 }).where(eq(accounts.name, MASTERCARD)).run();
  db.insert(recurringIncome).values({ name: "Lön", amount: 2500000, dayOfMonth: 24, accountId: acc(db, ESPAR), matchPattern: "LÖN" }).run();
  expense(db, { name: "Hyra", amount: 700000, day: 25, account: ESPAR });
  return db;
}

const day = (d: ReturnType<typeof cashflow>, date: string) => d.days.find((x) => x.date === date)!;

describe("Kassaflöde", () => {
  it("day by day from today's balances: incomes, fixed expenses, the pace every day; the lowest point and safe to spend", () => {
    const db = base();
    // The pace: 3 000 kr the last 30 days = 100 kr/day (not today: it starts tomorrow).
    tx(db, { account: PRIVAT, date: "2026-09-10", amount: -300000, desc: "ICA", category: "Mat/Livsmedel" });
    // A month planned with its own salary.
    const lon = db.select().from(recurringIncome).get()!;
    db.insert(recurringIncomeOverrides).values({ recurringIncomeId: lon.id, month: "2026-10", amount: 2600000 }).run();

    const d = cashflow(db, TODAY);
    expect(d.start).toBe(1000000);
    expect(d.days).toHaveLength(91);
    expect(d.variable.perDay).toBe(10000);
    expect(day(d, TODAY).balance).toBe(1000000);
    expect(day(d, "2026-09-23").balance).toBe(1000000 - 4 * 10000);
    expect(day(d, "2026-09-24").events).toEqual([expect.objectContaining({ kind: "income", name: "Lön", amount: 2500000 })]);
    expect(day(d, "2026-10-24").events[0].amount).toBe(2600000);
    expect(day(d, "2026-09-25").balance).toBe(1000000 - 6 * 10000 + 2500000 - 700000);
    // Lowest: the day before the salary.
    expect(d.lowest).toEqual({ date: "2026-09-23", balance: 1000000 - 4 * 10000 });
    expect(d.safeToSpend).toBe(d.lowest.balance - 200000);
    setBuffer(db, 500000);
    expect(cashflow(db, TODAY).safeToSpend).toBe(d.lowest.balance - 500000);
  });

  it("a salary booked the day before its pay day comes in on the pay day: the balance has it only then", () => {
    const db = base();
    // Booked the 23rd, in the available balance from the 24th (the tool's balance is from the 23rd).
    db.update(accounts).set({ balanceUpdatedAt: "2026-09-23T10:00:00.000Z" }).where(eq(accounts.name, ESPAR)).run();
    const lon = tx(db, { account: ESPAR, date: "2026-09-23", amount: 2480000, desc: "SWED2609240EXEMPEL" });
    db.update(transactions).set({ transactionDate: "2026-09-24" }).where(eq(transactions.id, lon.id)).run();
    const income = db.select().from(recurringIncome).get()!;
    db.update(transactions).set({ recurringIncomeId: income.id }).where(eq(transactions.id, lon.id)).run();
    const d = cashflow(db, "2026-09-23");
    // Not the forecast (the month has its salary), but the booked amount on its day.
    expect(day(d, "2026-09-24").events).toEqual([expect.objectContaining({ kind: "income", name: "Lön (bokförd 23/9, i saldot 24/9)", amount: 2480000 })]);
    expect(d.events.filter((e) => e.kind === "income" && e.date < "2026-10-01")).toHaveLength(1);
    // Before the sync on the 24th, the balance is still the 23rd's: it comes today.
    expect(day(cashflow(db, "2026-09-24"), "2026-09-24").events[0]).toMatchObject({ amount: 2480000 });
    // Once the balance is from the 24th it has it, and nothing more comes.
    db.update(accounts).set({ balanceUpdatedAt: "2026-09-24T10:00:00.000Z" }).where(eq(accounts.name, ESPAR)).run();
    expect(cashflow(db, "2026-09-24").events.filter((e) => e.kind === "income" && e.date < "2026-10-01")).toEqual([]);
  });

  it("what has come in or been drawn isn't counted again; a salary up to 5 days late still comes (today)", () => {
    const db = base();
    tx(db, { account: ESPAR, date: "2026-09-24", amount: 2500000, desc: "LÖN" });
    tx(db, { account: ESPAR, date: "2026-09-25", amount: -700000, desc: "HYRA" });
    linkRecurring(db);
    const d = cashflow(db, "2026-09-26");
    expect(d.events.filter((e) => e.date < "2026-10-01")).toEqual([]);
    // Not in by the 27th: expected today.
    const late = cashflow(base(), "2026-09-27");
    expect(late.events[0]).toMatchObject({ date: "2026-09-27", kind: "income" });
    expect(cashflow(base(), "2026-09-30").events.some((e) => e.kind === "income" && e.date === "2026-09-30")).toBe(false);
  });

  it("card invoices: the imported one unpaid; Mastercard's and Norwegian's coming ones as bought so far + fixed + the card's share of the pace", () => {
    const db = base();
    const mc = acc(db, MASTERCARD);
    db.insert(statements).values({ accountId: mc, periodFrom: "2026-08-08", periodTo: "2026-09-04", dueDate: "2026-09-30", amountDue: 872460, nextPeriodTo: "2026-10-07", source: "pdf" }).run();
    tx(db, { account: MASTERCARD, date: "2026-09-10", amount: -50000, desc: "KÖP" });
    expense(db, { name: "Spotify", amount: 18900, day: 23, account: MASTERCARD });
    // Norwegian: bought 1 000 kr posted in the open period 16/9–15/10, paid the 25th of October.
    tx(db, { account: NORWEGIAN, date: "2026-09-16", posted: "2026-09-17", amount: -100000, desc: "LIDL" });
    // The period 16/8–15/9 (paid 25/9): 400 kr.
    tx(db, { account: NORWEGIAN, date: "2026-09-01", posted: "2026-09-02", amount: -40000, desc: "ICA" });

    // The pace, 30 days: Mastercard 500 kr (16,67 kr/day), Norwegian 1 400 kr (46,67 kr/day), from tomorrow 20/9.
    const d = cashflow(db, TODAY, { partner: false });
    expect(d.variable).toMatchObject({ perDay: 6333, bankPerDay: 0 });
    expect(d.variable.cards.map((c) => [c.name, c.perDay])).toEqual([
      [MASTERCARD, 1667],
      [NORWEGIAN, 4667],
    ]);
    const inv = d.events.filter((e) => e.kind === "invoice");
    // Mastercard is due the last bank day of the month and paid the 25th, with the salary.
    expect(inv.map((e) => [e.date, e.name, e.amount])).toEqual([
      ["2026-09-25", "Swedbank Mastercard Guld: faktura", -872460],
      // Closed 15/9: what was bought, nothing more to come.
      ["2026-09-25", "Bank Norwegian: faktura", -40000],
      // 16/9–15/10: 1 000 kr bought + 26 days of the card's pace.
      ["2026-10-25", "Bank Norwegian: faktura", -(100000 + 121333)],
      // Bought 500 kr + Spotify 23/9 + 18 days of the pace (the period ends 7/10).
      ["2026-10-25", "Swedbank Mastercard Guld: nästa faktura", -(68900 + 30000)],
      // 16/10–15/11: 31 days of the pace.
      ["2026-11-25", "Bank Norwegian: faktura", -144667],
      // 8/10–7/11: Spotify 23/10 + 31 days of the pace.
      ["2026-11-25", "Swedbank Mastercard Guld: faktura", -(18900 + 51667)],
    ]);
    // Bought on the cards: nothing leaves the bank day by day.
    expect(d.days.every((x) => x.variable === 0)).toBe(true);
    // Paid by the bank side: gone.
    tx(db, { account: ESPAR, date: "2026-09-18", amount: -872460, desc: "MASTERCARD" });
    db.update(transactions).set({ counterAccountId: mc, isTransfer: true }).where(eq(transactions.descriptionClean, "MASTERCARD")).run();
    expect(cashflow(db, TODAY, { partner: false }).events.some((e) => e.name === "Swedbank Mastercard Guld: faktura" && e.date === "2026-09-30")).toBe(false);
  });

  it("Norwegian's invoice paid from the bank on its pay day isn't counted again: the balance already has it", () => {
    const db = base();
    const nor = acc(db, NORWEGIAN);
    // The period 16/8–15/9 (paid 25/9): 6 500 kr bought.
    tx(db, { account: NORWEGIAN, date: "2026-09-01", posted: "2026-09-02", amount: -650000, desc: "ICA" });
    const invoice = (today: string) => cashflow(db, today, { partner: false }).events.find((e) => e.name === "Bank Norwegian: faktura" && e.date === "2026-09-25");
    expect(invoice("2026-09-25")?.amount).toBe(-650000);
    // A payment before the period closed is the last invoice's, not this one's.
    const early = tx(db, { account: ESPAR, date: "2026-09-10", amount: -100000, desc: "Bank Norwegian PG" });
    db.update(transactions).set({ counterAccountId: nor, isTransfer: true }).where(eq(transactions.id, early.id)).run();
    expect(invoice("2026-09-25")?.amount).toBe(-650000);
    // Part of it paid in the morning: the rest is still to come.
    const part = tx(db, { account: ESPAR, date: "2026-09-25", amount: -200000, desc: "Bank Norwegian PG" });
    db.update(transactions).set({ counterAccountId: nor, isTransfer: true }).where(eq(transactions.id, part.id)).run();
    expect(invoice("2026-09-25")?.amount).toBe(-450000);
    // All of it: nothing more leaves the bank for it, and Kvar vid månadsskiftet doesn't take it twice.
    const rest = tx(db, { account: ESPAR, date: "2026-09-25", amount: -450000, desc: "Bank Norwegian PG" });
    db.update(transactions).set({ counterAccountId: nor, isTransfer: true }).where(eq(transactions.id, rest.id)).run();
    expect(invoice("2026-09-25")).toBeUndefined();
    expect(monthStart(db, "2026-09-25")!.terms!.flatMap((t) => t.items).some((i) => i.name === "Bank Norwegian: faktura")).toBe(false);
  });

  it("fuel by Pendling & bränsle's month forecast instead of the fuel rows in the pace", () => {
    const db = base();
    tx(db, { account: MASTERCARD, date: "2026-09-05", amount: -150000, desc: "CIRCLE K", category: "Bil/Drivmedel" });
    tx(db, { account: PRIVAT, date: "2026-09-10", amount: -300000, desc: "ICA", category: "Mat/Livsmedel" });
    expect(cashflow(db, TODAY).variable).toMatchObject({ perDay: 15000, fuel: null });
    addPrice(db, "2026-09-01", 2000);
    setShifts(db, "2026-09", 30);
    const d = cashflow(db, TODAY);
    expect(d.variable.perDay).toBe(10000);
    expect(d.variable.fuel).toBeGreaterThan(0);
    expect(day(d, "2026-09-20").variable).toBeGreaterThan(10000);
  });

  it("'räkna bara med mat på kortet': only the food on the card in the pace, the fuel from the bank; the invoices and the fixed expenses stay", async () => {
    const db = base();
    // 30 days: food 3 000 kr with the bank card and 2 400 kr on Norwegian, a phone 9 000 kr, something uncategorized 600 kr, fuel 1 500 kr.
    tx(db, { account: PRIVAT, date: "2026-09-10", amount: -300000, desc: "ICA", category: "Mat/Livsmedel" });
    tx(db, { account: NORWEGIAN, date: "2026-09-09", amount: -240000, desc: "LIDL", category: "Mat/Livsmedel" });
    tx(db, { account: PRIVAT, date: "2026-09-11", amount: -900000, desc: "ELGIGANTEN", category: "Prylar & hem/Elektronik" });
    tx(db, { account: PRIVAT, date: "2026-09-12", amount: -60000, desc: "OKÄNT" });
    tx(db, { account: MASTERCARD, date: "2026-09-05", amount: -150000, desc: "CIRCLE K", category: "Bil/Drivmedel" });
    const app = createApp(db, { databasePath: ":memory:" });
    const before = cashflow(db, TODAY);
    expect(before).toMatchObject({ foodOnly: false, variable: { perDay: 55000, fullPerDay: 55000 } });

    expect(await (await app.request("/api/cashflow/settings", json("PUT", { foodOnly: true }))).json()).toEqual({ buffer: 200000, foodOnly: true });
    const d = cashflow(db, TODAY);
    // The food on Norwegian (80 kr/day, with its invoice) + the fuel (no forecast: its rows, 50 kr/day from the bank); not the bank card's food.
    expect(d).toMatchObject({ foodOnly: true, variable: { perDay: 13000, bankPerDay: 5000, fullPerDay: 55000 } });
    expect(d.variable.cards.map((c) => [c.name, c.perDay])).toEqual([[NORWEGIAN, 8000]]);
    // The rent is still drawn, the salary still comes.
    expect(d.events.filter((e) => e.kind !== "invoice").map((e) => e.name)).toEqual(before.events.filter((e) => e.kind !== "invoice").map((e) => e.name));
    // With a fuel forecast the fuel is counted by it, and nothing else leaves the bank day by day.
    addPrice(db, "2026-09-01", 2000);
    setShifts(db, "2026-09", 20);
    const withFuel = cashflow(db, TODAY);
    expect(withFuel.variable).toMatchObject({ perDay: 8000, bankPerDay: 0 });
    expect(withFuel.variable.fuel).toBeGreaterThan(0);
    // Remembered, and turned off again.
    expect(await (await app.request("/api/cashflow/settings")).json()).toMatchObject({ foodOnly: true });
    await app.request("/api/cashflow/settings", json("PUT", { foodOnly: false }));
    expect(cashflow(db, TODAY).foodOnly).toBe(false);
    expect((await app.request("/api/cashflow/settings", json("PUT", { foodOnly: "ja" }))).status).toBe(400);
    expect((await app.request("/api/cashflow/settings", json("PUT", {}))).status).toBe(400);
  });

  it("Kvar vid månadsskiftet: the balance when this month's bills are paid, next month's card invoices not yet", async () => {
    const db = base();
    // Norwegian: bought 1 000 kr in the open period 16/9–15/10, paid 25/10 — October's bill, not September's.
    tx(db, { account: NORWEGIAN, date: "2026-09-16", posted: "2026-09-17", amount: -100000, desc: "LIDL" });
    const m = monthStart(db, TODAY)!;
    // 10 000 kr + salary 25 000 kr (24/9) − rent 7 000 kr (25/9); the card's purchases leave with the October invoice.
    expect(m).toMatchObject({ date: "2026-10-01", month: "2026-09", balance: 2800000, foodOnly: false });
    expect(m.balance).toBe(day(cashflow(db, TODAY), "2026-09-30").balance);
    const o = await (await createApp(db, { databasePath: ":memory:" }).request(`/api/overview?today=${TODAY}`)).json();
    expect(o.monthStart).toMatchObject({ date: "2026-10-01", balance: 2800000 });
  });

  it("Kvar vid månadsskiftet as terms: the money now plus each term is the balance, to the öre", () => {
    const db = base();
    // A pace that doesn't come out even: 1 000 kr the last 30 days, 33,33 kr a day from the bank.
    tx(db, { account: PRIVAT, date: "2026-09-10", amount: -100000, desc: "ICA", category: "Mat/Livsmedel" });
    const m = monthStart(db, TODAY)!;
    const perDay = cashflow(db, TODAY).variable.bankPerDay;
    expect(m.start).toBe(1000000);
    expect(m.start + m.terms.reduce((s, t) => s + t.amount, 0)).toBe(m.balance);
    expect(m.terms.map((t) => [t.key, t.label, t.amount, t.from, t.to])).toEqual([
      ["income", "Lön", 2500000, "2026-09-24", "2026-09-24"],
      // Rent, and 11 days of the pace (20/9–30/9), as the flow draws it.
      ["bills", "Räkningar", -700000 - 11 * perDay, "2026-09-20", "2026-09-25"],
    ]);
    expect(m.terms[1].items.map((i) => i.name)).toEqual(["Rörligt från banken", "Hyra"]);
    expect(m.terms[1].estimate).toBe(true);

    // The partner's settlement is a term of its own, and a planned purchase is a bill.
    const flow = cashflow(db, TODAY);
    const withPartner = {
      ...flow,
      days: flow.days.map((d) => (d.date === "2026-09-25" ? { ...d, events: [...d.events, { date: d.date, kind: "partner" as const, name: "Från Mio", amount: 765000, estimate: true }] } : d)),
    };
    const last = "2026-09-30";
    const balance = day(flow, last).balance + 765000;
    const terms = monthStartTerms(withPartner, last, balance);
    expect(terms.map((t) => [t.key, t.label, t.amount])).toEqual([
      ["income", "Lön", 2500000],
      ["partner", "Från Mio", 765000],
      ["bills", "Räkningar", -700000 - 11 * perDay],
    ]);
    expect(flow.start + terms.reduce((s, t) => s + t.amount, 0)).toBe(balance);
  });

  it("without a salary before the month is out there is no income term", () => {
    const db = base();
    db.update(recurringIncome).set({ dayOfMonth: 2 }).run();
    const m = monthStart(db, TODAY)!;
    expect(m.terms.map((t) => t.key)).toEqual(["bills"]);
    expect(m.start + m.terms.reduce((s, t) => s + t.amount, 0)).toBe(m.balance);
  });

  it("counts the cash on Avanza as money to spend, and money moved there stays in the pot", () => {
    const db = base();
    setCash(db, "isk", "2026-09-15", 1_375_000);
    // Moved to Avanza after the cash was entered: out of the bank, into the cash.
    tx(db, { account: ESPAR, date: "2026-09-17", amount: -200000, desc: "AVANZA", category: "Överföringar & sparande/Sparande" });
    db.update(transactions).set({ isTransfer: true }).where(eq(transactions.descriptionClean, "AVANZA")).run();
    // Before the cash was entered: already in it.
    tx(db, { account: ESPAR, date: "2026-09-10", amount: -100000, desc: "AVANZA2", category: "Överföringar & sparande/Sparande" });
    db.update(transactions).set({ isTransfer: true }).where(eq(transactions.descriptionClean, "AVANZA2")).run();

    expect(liquidCash(db, TODAY)).toEqual({
      accounts: [{ account: "isk", name: "ISK", ore: 1_375_000, date: "2026-09-15" }],
      depositedOre: 200000,
      since: "2026-09-15",
      totalOre: 1_575_000,
    });
    const d = cashflow(db, TODAY, { partner: false });
    // The banks' 10 000 kr (the balances, set by hand, already after the transfer) + 15 750 kr on Avanza.
    expect(d.start).toBe(1000000 + 1_575_000);
    expect(d.liquid.totalOre).toBe(1_575_000);
    // A transfer is never in the pace.
    expect(d.variable.perDay).toBe(0);
    expect(d.lowest.balance).toBe(1000000 + 1_575_000);
  });

  it("assumes no cash on Avanza when none was ever entered", () => {
    const db = base();
    tx(db, { account: ESPAR, date: "2026-09-17", amount: -200000, desc: "AVANZA", category: "Överföringar & sparande/Sparande" });
    expect(liquidCash(db, TODAY)).toMatchObject({ accounts: [], depositedOre: 0, since: null, totalOre: 0 });
    expect(cashflow(db, TODAY).start).toBe(1000000);
  });

  it("takes what came back from Avanza off the cash, never below nothing", () => {
    const db = base();
    setCash(db, "isk", "2026-09-15", 100000);
    tx(db, { account: ESPAR, date: "2026-09-16", amount: 300000, desc: "AVANZA", category: "Överföringar & sparande/Sparande" });
    expect(liquidCash(db, TODAY)).toMatchObject({ depositedOre: -300000, totalOre: 0 });
  });

  it("the pace counts what I pay in full: Mio's half of shared purchases comes back in her payments", () => {
    const db = base();
    // 30 days: my own 900 kr, a shared 1 200 kr, one wholly hers I paid 300 kr, one she paid 600 kr (shared).
    tx(db, { account: PRIVAT, date: "2026-09-10", amount: -90000, desc: "ICA", category: "Mat/Livsmedel" });
    const shared = tx(db, { account: NORWEGIAN, date: "2026-09-11", amount: -120000, desc: "COOP", category: "Mat/Livsmedel" });
    const hers = tx(db, { account: PRIVAT, date: "2026-09-12", amount: -30000, desc: "APOTEK", category: "Mat/Livsmedel" });
    const paidByHer = tx(db, { account: PRIVAT, date: "2026-09-13", amount: -60000, desc: "HEMKÖP", category: "Mat/Livsmedel" });
    db.update(transactions).set({ shared: true }).where(eq(transactions.id, shared.id)).run();
    db.update(transactions).set({ forOther: true }).where(eq(transactions.id, hers.id)).run();
    db.update(transactions).set({ shared: true, paidBy: "partner" }).where(eq(transactions.id, paidByHer.id)).run();

    // Paid from my accounts: 900 + 1 200 + 300 = 2 400 kr = 80 kr/day. (My part would be 900 + 600 + 0 + 300 = 1 800 kr.)
    const d = cashflow(db, TODAY, { partner: false });
    expect(d.variable.perDay).toBe(8000);
    // The shared 1 200 kr was bought on Norwegian: its 40 kr/day goes with the invoice, the bank's 40 kr/day every day.
    expect(d.variable.bankPerDay).toBe(4000);
    expect(day(d, "2026-09-20").variable).toBe(4000);
    expect(day(d, "2026-09-23").balance).toBe(1000000 - 4 * 4000);
    // With or without her payments, the same pace: they are events of their own.
    expect(cashflow(db, TODAY).variable.perDay).toBe(8000);
  });

  it("Mio's monthly payment on the 25th: this month what she owes now, later the average of three months; can be left out", () => {
    const db = base();
    setPartnerNumbers(db, ["+46765550019"]);
    for (const [date, amount] of [["2026-06-25", 900000], ["2026-07-24", 1000000], ["2026-08-25", 800000]] as const) {
      tx(db, { account: ESPAR, date, amount, desc: "+46765550019", category: "Inkomst/Från partner" });
    }
    const d = cashflow(db, TODAY);
    const partner = d.events.filter((e) => e.kind === "partner");
    expect(partner.filter((e) => e.date > "2026-09-30").map((e) => [e.date, e.amount])).toEqual([
      ["2026-10-25", 900000],
      ["2026-11-25", 900000],
    ]);
    expect(partner.map((e) => [e.name, e.estimate])).toEqual(partner.map(() => ["Från Mio", true]));
    expect(cashflow(db, TODAY, { partner: false }).events.some((e) => e.kind === "partner")).toBe(false);
  });

  it("the API: planned items in the forecast until their day has passed; the buffer", async () => {
    const db = base();
    const app = createApp(db, { databasePath: ":memory:" });
    expect((await app.request("/api/cashflow/planned", json("POST", { date: "2026-11-10", amount: 0, description: "x" }))).status).toBe(400);
    const p = await (await app.request("/api/cashflow/planned", json("POST", { date: "2026-11-10", amount: -1500000, description: " Resa i november " }))).json();
    expect(p).toMatchObject({ date: "2026-11-10", amount: -1500000, description: "Resa i november" });
    const d = await (await app.request(`/api/cashflow?today=${TODAY}`)).json();
    expect(d.events).toContainEqual(expect.objectContaining({ date: "2026-11-10", kind: "planned", name: "Resa i november", amount: -1500000, plannedId: p.id }));
    expect(d.planned).toHaveLength(1);
    expect((await (await app.request("/api/cashflow?today=2026-11-11")).json()).planned).toEqual([]);
    await app.request(`/api/cashflow/planned/${p.id}`, json("DELETE"));
    expect((await (await app.request(`/api/cashflow?today=${TODAY}`)).json()).planned).toEqual([]);

    expect(await (await app.request("/api/cashflow/settings")).json()).toEqual({ buffer: 200000, foodOnly: false });
    expect((await app.request("/api/cashflow/settings", json("PUT", { buffer: -1 }))).status).toBe(400);
  });

  it("a planned purchase on a card is paid on its invoice's pay day; a shared one's half comes back with Mio's next payment", async () => {
    const db = base();
    const mc = acc(db, MASTERCARD);
    const nw = acc(db, NORWEGIAN);
    db.insert(statements).values({ accountId: mc, periodFrom: "2026-08-08", periodTo: "2026-09-04", dueDate: "2026-09-30", amountDue: 0, nextPeriodTo: "2026-10-07", source: "pdf" }).run();
    const app = createApp(db, { databasePath: ":memory:" });
    const plan = async (body: object) => (await app.request("/api/cashflow/planned", json("POST", { amount: -800000, description: "Telefon", ...body }))).json();
    const at = async (q: string) => (await app.request(`/api/cashflow/pay-day?today=${TODAY}&amount=-800000&${q}`)).json();

    // Mastercard: the next invoice (period to 7/10) is due the last bank day of October and paid the 25th; after it, November's.
    expect(await at(`date=2026-09-24&accountId=${mc}`)).toEqual({ payDate: "2026-10-25", card: MASTERCARD, partnerHalf: 0, partnerDate: null });
    expect((await at(`date=2026-10-10&accountId=${mc}`)).payDate).toBe("2026-11-25");
    // Norwegian: 16/9–15/10 is paid the 25th of October, by the posting day (the day after the purchase).
    expect((await at(`date=2026-09-24&accountId=${nw}`)).payDate).toBe("2026-10-25");
    expect((await at(`date=2026-10-15&accountId=${nw}`)).payDate).toBe("2026-11-25");
    // The bank: the day itself. Shared: half back on the 25th on or after the pay day.
    expect(await at(`date=2026-09-24&accountId=${acc(db, PRIVAT)}&shared=1`)).toEqual({ payDate: "2026-09-24", card: null, partnerHalf: 400000, partnerDate: "2026-09-25" });
    expect(await at(`date=2026-09-24&accountId=${mc}&shared=1`)).toMatchObject({ payDate: "2026-10-25", partnerDate: "2026-10-25" });

    const p = await plan({ date: "2026-09-24", accountId: nw, shared: true });
    expect(p).toMatchObject({ accountId: nw, shared: true });
    const d = cashflow(db, TODAY);
    expect(d.events.filter((e) => e.plannedId === p.id).map((e) => [e.date, e.kind, e.name, e.amount])).toEqual([
      ["2026-10-25", "planned", "Telefon (Bank Norwegian, köpt 24/9)", -800000],
      ["2026-10-25", "partner", "Från Mio: halva Telefon", 400000],
    ]);
    expect(d.planned[0]).toMatchObject({ payDate: "2026-10-25", card: NORWEGIAN, partnerHalf: 400000, partnerDate: "2026-10-25" });
    // Without Mio's payments, her half is left out too.
    expect(cashflow(db, TODAY, { partner: false }).events.filter((e) => e.plannedId === p.id).map((e) => e.kind)).toEqual(["planned"]);

    // An income is neither shared nor on a card; the account must exist.
    expect((await app.request("/api/cashflow/planned", json("POST", { date: "2026-10-01", amount: 500000, description: "Sålt", shared: true }))).status).toBe(400);
    expect((await app.request("/api/cashflow/planned", json("POST", { date: "2026-10-01", amount: 500000, description: "Sålt", accountId: mc }))).status).toBe(400);
    expect((await app.request("/api/cashflow/planned", json("POST", { date: "2026-10-01", amount: -500, description: "x", accountId: 999 }))).status).toBe(400);
  });

  it("the buffer is set in whole öre", async () => {
    const app = createApp(base(), { databasePath: ":memory:" });
    expect((await app.request("/api/cashflow/settings", json("PUT", { buffer: -1 }))).status).toBe(400);
    expect(await (await app.request("/api/cashflow/settings", json("PUT", { buffer: 350000 }))).json()).toEqual({ buffer: 350000, foodOnly: false });
  });
});

describe("yearly expenses in the overview, the calendar and the cash flow", () => {
  it("drawn once, on their date: in the occurrences, the calendar's month and the 90 days; the other months nothing", async () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 1000000, balanceUpdatedAt: TODAY }).where(eq(accounts.name, PRIVAT)).run();
    const iptv = db
      .insert(recurringExpenses)
      .values({ name: "TV-paketet", amount: 150000, anchorDay: 1, anchorMonth: 10, billingCycle: "yearly", accountId: acc(db, PRIVAT), matchPattern: "TV-paketetBOLAG", paymentMethod: "card", shared: true })
      .returning()
      .get();
    const { expenseOccurrences } = await import("../src/overview/overview.js");
    const occ = expenseOccurrences(db, TODAY, null, "2027-12-31").filter((o) => o.expenseId === iptv.id);
    expect(occ.map((o) => [o.dueDate, o.status, o.amount])).toEqual([
      ["2026-10-01", "kommande", 150000],
      ["2027-10-01", "kommande", 150000],
    ]);
    const flow = cashflow(db, TODAY);
    expect(flow.events.filter((e) => e.name === "TV-paketet")).toEqual([expect.objectContaining({ date: "2026-10-01", kind: "fixed", amount: -150000 })]);

    const app = createApp(db, { databasePath: ":memory:" });
    const inMonth = async (m: string) => (await (await app.request(`/api/recurring-expenses/calendar?month=${m}`)).json()).filter((d: { expenseId: number }) => d.expenseId === iptv.id);
    expect(await inMonth("2026-10")).toEqual([{ expenseId: iptv.id, period: "2026-10", date: "2026-10-01" }]);
    expect(await inMonth("2026-11")).toEqual([]);
  });
});
