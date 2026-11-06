import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenseMarks, recurringExpenses, recurringIncome, recurringIncomeOverrides, statements, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { linkRecurring } from "../src/recurring/link.js";
import { buildOverview, cardInvoices, expenseOccurrences, monthByCategory, nextPayday, spendingPace } from "../src/overview/overview.js";
import { addDays, addMonths, dueDateIn } from "../src/overview/dates.js";
import { createApp } from "../src/app.js";
import { setSalarySettings } from "../src/salary/salary.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!;
const PRIVAT = "Swedbank Privatkonto";
const ESPAR = "Swedbank e-sparkonto";
const NORWEGIAN = "Bank Norwegian";
const MASTERCARD = "Swedbank Mastercard Guld";

let seq = 0;
function tx(
  db: Db,
  o: { account: string; date: string; amount: number; desc?: string; category?: string; isTransfer?: boolean; counterAccount?: string; source?: "swedbank" | "norwegian" | "manual" },
) {
  const cat = o.category ? getCategoryPathMap(db).get(o.category)! : null;
  return db
    .insert(transactions)
    .values({
      source: o.source ?? "swedbank",
      accountId: acc(db, o.account).id,
      bookingDate: o.date,
      transactionDate: o.date,
      descriptionRaw: o.desc ?? "X",
      descriptionClean: o.desc ?? "X",
      counterparty: o.desc ?? "X",
      amount: o.amount,
      categoryId: cat,
      categorySource: cat ? "rule" : "none",
      isTransfer: o.isTransfer ?? false,
      counterAccountId: o.counterAccount ? acc(db, o.counterAccount).id : null,
      fingerprint: `t${++seq}`,
    })
    .returning()
    .get();
}

function salary(db: Db, day = 24, amount = 2500000) {
  return db.insert(recurringIncome).values({ name: "Lön", amount, dayOfMonth: day, accountId: acc(db, ESPAR).id, matchPattern: "LÖN" }).returning().get();
}

function expense(db: Db, o: { name: string; amount: number; day: number; account: string; pattern?: string; method?: "autogiro" | "credit_card" | "card" | "transfer" }) {
  return db
    .insert(recurringExpenses)
    .values({ name: o.name, amount: o.amount, anchorDay: o.day, accountId: acc(db, o.account).id, matchPattern: o.pattern ?? null, paymentMethod: o.method ?? "autogiro" })
    .returning()
    .get();
}

describe("date helpers", () => {
  it("clamps due days to short months and shifts months", () => {
    expect(dueDateIn("2026-02", 31)).toBe("2026-02-28");
    expect(dueDateIn("2028-02", 30)).toBe("2028-02-29");
    expect(dueDateIn("2026-09", 31)).toBe("2026-09-30");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("next payday", () => {
  it("is this month's salary day until the salary has arrived, then next month's", () => {
    const db = freshDb({ seeded: true });
    salary(db);
    expect(nextPayday(db, "2026-09-18")).toMatchObject({ date: "2026-09-24", month: "2026-09", daysUntil: 6, late: false, received: null });
    tx(db, { account: ESPAR, date: "2026-09-23", amount: 2480000, desc: "LÖN" });
    linkRecurring(db);
    expect(nextPayday(db, "2026-09-23")).toMatchObject({
      date: "2026-10-24",
      month: "2026-10",
      received: { month: "2026-09", bookingDate: "2026-09-23", amount: 2480000 },
    });
  });

  it("a salary booked the day before it is in the balance is still to come until that day", () => {
    const db = freshDb({ seeded: true });
    salary(db, 25);
    // Swedbank books it on the 24th with the 25th as its transaction day; the available balance has it on the 25th.
    const t = tx(db, { account: ESPAR, date: "2026-09-24", amount: 2650000, desc: "LÖN" });
    db.update(transactions).set({ transactionDate: "2026-09-25" }).where(eq(transactions.id, t.id)).run();
    linkRecurring(db);
    expect(nextPayday(db, "2026-09-24")).toMatchObject({
      date: "2026-09-25",
      month: "2026-09",
      daysUntil: 1,
      late: false,
      expected: 2650000,
      received: null,
      pending: { bookingDate: "2026-09-24", availableDate: "2026-09-25", amount: 2650000 },
    });
    // On the 25th it has come: received, on the day it was in the balance, and the next one is October's.
    expect(nextPayday(db, "2026-09-25")).toMatchObject({
      date: "2026-10-25",
      pending: null,
      received: { month: "2026-09", bookingDate: "2026-09-24", availableDate: "2026-09-25", amount: 2650000 },
    });
  });

  it("keeps expecting a late salary for a few days, flagged late", () => {
    const db = freshDb({ seeded: true });
    salary(db);
    expect(nextPayday(db, "2026-09-26")).toMatchObject({ date: "2026-09-24", late: true, daysUntil: 0 });
    expect(nextPayday(db, "2026-09-30")).toMatchObject({ date: "2026-10-24", late: false });
  });

  it("uses the month's expected amount when set, else the estimate", () => {
    const db = freshDb({ seeded: true });
    const i = salary(db);
    expect(nextPayday(db, "2026-09-18")).toMatchObject({ expected: 2500000, expectedSource: "estimate" });
    db.insert(recurringIncomeOverrides).values({ recurringIncomeId: i.id, month: "2026-09", amount: 2610000 }).run();
    expect(nextPayday(db, "2026-09-18")).toMatchObject({ expected: 2610000, expectedSource: "override", estimate: 2500000 });
    // Still September's (late) salary on the 25th; October's (no override) from the 30th.
    expect(nextPayday(db, "2026-09-25")?.expectedSource).toBe("override");
    expect(nextPayday(db, "2026-09-30")).toMatchObject({ month: "2026-10", expectedSource: "estimate" });
  });

  it("uses day 31 as the last day of short months", () => {
    const db = freshDb({ seeded: true });
    salary(db, 31);
    expect(nextPayday(db, "2026-02-10")?.date).toBe("2026-02-28");
  });

  it("is null without a recurring income", () => {
    expect(nextPayday(freshDb({ seeded: true }), "2026-09-18")).toBeNull();
  });
});

describe("recurring expense status", () => {
  const today = "2026-09-18";
  const setup = () => {
    const db = freshDb({ seeded: true });
    // e-sparkonto is imported (has rows); Mastercard is not.
    tx(db, { account: ESPAR, date: "2026-09-01", amount: -100, desc: "ANNAT" });
    const hyra = expense(db, { name: "Hyra", amount: 750000, day: 25, account: ESPAR, pattern: "EXEMPELHYRA", method: "transfer" });
    const csn = expense(db, { name: "CSN", amount: 230000, day: 5, account: ESPAR, pattern: "CSN" });
    const tele = expense(db, { name: "Tele2", amount: 89900, day: 10, account: ESPAR, pattern: "TELE2" });
    const spotify = expense(db, { name: "Spotify", amount: 18900, day: 2, account: MASTERCARD, method: "credit_card" });
    const claude = expense(db, { name: "Claude", amount: 120000, day: 30, account: MASTERCARD, method: "credit_card" });
    const early = expense(db, { name: "Tandvård", amount: 15500, day: 20, account: ESPAR, pattern: "FOLKTANDV" });
    tx(db, { account: ESPAR, date: "2026-09-10", amount: -89900, desc: "TELE2" });
    tx(db, { account: ESPAR, date: "2026-09-17", amount: -15500, desc: "FOLKTANDVÅRD" }); // drawn 3 days early
    linkRecurring(db);
    return { db, hyra, csn, tele, spotify, claude, early };
  };

  it("classifies each occurrence this month", () => {
    const { db } = setup();
    const occ = expenseOccurrences(db, today, "2026-09-24");
    const status = Object.fromEntries(occ.map((o) => [o.name, o.status]));
    expect(status).toEqual({
      Hyra: "kommande",
      CSN: "forfallen", // imported account, due 5/9, nothing matched
      Tele2: "dragen",
      Spotify: "passerad", // Mastercard isn't imported
      Claude: "kommande",
      Tandvård: "dragen", // drawn before the due day
    });
    expect(occ.find((o) => o.name === "Tele2")!.transaction).toMatchObject({ bookingDate: "2026-09-10", amount: -89900 });
  });

  it("'markera som betald' applies to that period only", () => {
    const { db, spotify } = setup();
    db.insert(recurringExpenseMarks).values({ recurringExpenseId: spotify.id, period: "2026-09" }).run();
    expect(expenseOccurrences(db, today, "2026-09-24").find((o) => o.name === "Spotify")!.status).toBe("markerad_betald");
    const oct = expenseOccurrences(db, "2026-10-03", "2026-10-24").find((o) => o.name === "Spotify" && o.period === "2026-10")!;
    expect(oct.status).toBe("passerad");
  });

  it("only coming charges on bank accounts before payday count in the forecast", () => {
    const { db } = setup();
    const inForecast = (payday: string) =>
      expenseOccurrences(db, today, payday)
        .filter((o) => o.inForecast)
        .map((o) => `${o.name} ${o.dueDate}`);
    expect(inForecast("2026-09-24")).toEqual([]); // Hyra is the 25th, Claude is on the card
    expect(inForecast("2026-10-24")).toEqual(["Hyra 2026-09-25", "CSN 2026-10-05", "Tele2 2026-10-10", "Tandvård 2026-10-20"]);
  });
});

describe("card invoices", () => {
  it("is paid when a card payment from the bank covers it, partial when less", () => {
    const db = freshDb({ seeded: true });
    const nor = acc(db, NORWEGIAN);
    db.insert(statements).values({ accountId: nor.id, periodFrom: "2026-08-16", periodTo: "2026-09-15", dueDate: "2026-09-28", amountDue: 482150, source: "pdf" }).run();
    expect(cardInvoices(db, "2026-09-18")[0]).toMatchObject({ status: "unpaid", paidAmount: 0, daysUntilDue: 10 });
    tx(db, { account: ESPAR, date: "2026-09-20", amount: -300000, desc: "Bank Norwegian", isTransfer: true, counterAccount: NORWEGIAN });
    expect(cardInvoices(db, "2026-09-21")[0]).toMatchObject({ status: "partial", paidAmount: 300000 });
    tx(db, { account: ESPAR, date: "2026-09-25", amount: -182150, desc: "Bank Norwegian", isTransfer: true, counterAccount: NORWEGIAN });
    expect(cardInvoices(db, "2026-09-26")[0]).toMatchObject({ status: "paid", paidBy: "payment" });
  });

  it("uses the card's own 'Inbetalning' when the bank side isn't imported, and never counts both sides", () => {
    const db = freshDb({ seeded: true });
    const nor = acc(db, NORWEGIAN);
    db.insert(statements).values({ accountId: nor.id, periodTo: "2026-08-15", dueDate: "2026-08-28", amountDue: 712300, source: "pdf" }).run();
    tx(db, { account: NORWEGIAN, date: "2026-08-25", amount: 712300, desc: "Inbetalning", isTransfer: true, source: "norwegian" });
    expect(cardInvoices(db, "2026-08-26")[0]).toMatchObject({ status: "paid", paidAmount: 712300 });
    tx(db, { account: ESPAR, date: "2026-08-25", amount: -712300, desc: "Bank Norwegian", isTransfer: true, counterAccount: NORWEGIAN });
    expect(cardInvoices(db, "2026-08-26")[0].paidAmount).toBe(712300);
  });

  it("a payment before the invoice period ended doesn't pay it; ticking off does", () => {
    const db = freshDb({ seeded: true });
    const nor = acc(db, NORWEGIAN);
    const s = db.insert(statements).values({ accountId: nor.id, periodTo: "2026-09-15", dueDate: "2026-09-28", amountDue: 482150, source: "pdf" }).returning().get();
    tx(db, { account: ESPAR, date: "2026-08-25", amount: -712300, desc: "Bank Norwegian", isTransfer: true, counterAccount: NORWEGIAN });
    expect(cardInvoices(db, "2026-09-18")[0].status).toBe("unpaid");
    db.update(statements).set({ paidAt: "2026-09-18T10:00:00Z" }).where(eq(statements.id, s.id)).run();
    expect(cardInvoices(db, "2026-09-18")[0]).toMatchObject({ status: "paid", paidBy: "manual" });
  });
});

describe("forecast", () => {
  it("bank balances minus coming bank charges and unpaid invoices before payday", () => {
    const db = freshDb({ seeded: true });
    salary(db, 24);
    db.update(accounts).set({ balance: 300000, balanceUpdatedAt: "2026-09-18" }).where(eq(accounts.name, PRIVAT)).run();
    db.update(accounts).set({ balance: 1200000, balanceUpdatedAt: "2026-09-18" }).where(eq(accounts.name, ESPAR)).run();
    // Card debt is not part of the start (it's the invoice that matters).
    db.update(accounts).set({ balance: -482150, balanceUpdatedAt: "2026-09-15" }).where(eq(accounts.name, NORWEGIAN)).run();
    tx(db, { account: ESPAR, date: "2026-09-01", amount: -100 });
    expense(db, { name: "Gym", amount: 39900, day: 20, account: ESPAR, pattern: "GYM" }); // before payday: counts
    expense(db, { name: "Hyra", amount: 750000, day: 25, account: ESPAR, pattern: "EXEMPELHYRA" }); // after payday
    expense(db, { name: "Spotify", amount: 18900, day: 23, account: MASTERCARD, method: "credit_card" }); // on the card
    db.insert(statements).values({ accountId: acc(db, MASTERCARD).id, dueDate: "2026-09-22", amountDue: 250000, source: "manual" }).run();
    db.insert(statements).values({ accountId: acc(db, NORWEGIAN).id, periodTo: "2026-09-15", dueDate: "2026-09-28", amountDue: 482150, source: "pdf" }).run();

    const o = buildOverview(db, "2026-09-18");
    expect(o.forecast).toMatchObject({
      start: 1500000,
      fixed: 39900,
      fixedCount: 1,
      invoices: [{ accountName: MASTERCARD, dueDate: "2026-09-22", amount: 250000 }],
      left: 1500000 - 39900 - 250000,
      days: 6,
      perDay: Math.round((1500000 - 39900 - 250000) / 6),
    });
  });

  it("transfers between the bank accounts don't change the start", () => {
    const db = freshDb({ seeded: true });
    salary(db);
    db.update(accounts).set({ balance: 100000 }).where(eq(accounts.name, PRIVAT)).run();
    db.update(accounts).set({ balance: 900000 }).where(eq(accounts.name, ESPAR)).run();
    const before = buildOverview(db, "2026-09-18").forecast!.start;
    // Moving 500 kr: both balances change, the sum doesn't.
    db.update(accounts).set({ balance: 150000 }).where(eq(accounts.name, PRIVAT)).run();
    db.update(accounts).set({ balance: 850000 }).where(eq(accounts.name, ESPAR)).run();
    expect(buildOverview(db, "2026-09-18").forecast!.start).toBe(before);
  });

  it("an account whose balance isn't followed is left out of the start and never asked for", async () => {
    const db = freshDb({ seeded: true });
    salary(db);
    db.update(accounts).set({ balance: 100000, balanceUpdatedAt: "2026-09-18" }).where(eq(accounts.name, PRIVAT)).run();
    db.update(accounts).set({ balance: 900000 }).where(eq(accounts.name, ESPAR)).run(); // never updated: stale
    const app = createApp(db, { databasePath: ":memory:" });
    const patch = (body: unknown) =>
      app.request(`/api/accounts/${acc(db, ESPAR).id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect((await patch({ trackBalance: "nej" })).status).toBe(400);
    expect((await patch({ trackBalance: false })).status).toBe(200);
    const o = buildOverview(db, "2026-09-18");
    expect(o.forecast!.start).toBe(100000);
    expect(o.balances.find((b) => b.name === ESPAR)).toMatchObject({ trackBalance: false });
    expect(o.tasks.filter((t) => t.kind === "stale_balance")).toEqual([]);
  });
});

describe("spending", () => {
  it("pace counts variable spending only (no fixed, transfers, settlement or income) over 30 days", () => {
    const db = freshDb({ seeded: true });
    const hyra = expense(db, { name: "Hyra", amount: 750000, day: 25, account: ESPAR, pattern: "EXEMPELHYRA" });
    tx(db, { account: PRIVAT, date: "2026-09-10", amount: -30000, desc: "ICA", category: "Mat/Livsmedel" });
    tx(db, { account: PRIVAT, date: "2026-08-20", amount: -15000, desc: "EXEMPELSTAD", category: "Mat/Restaurang & café" }); // first day of the window
    tx(db, { account: PRIVAT, date: "2026-08-19", amount: -99999, desc: "FÖR GAMMAL" }); // outside
    tx(db, { account: ESPAR, date: "2026-08-25", amount: -750000, desc: "EXEMPELHYRA" }); // fixed
    tx(db, { account: PRIVAT, date: "2026-09-11", amount: -500000, desc: "Överföring", isTransfer: true });
    tx(db, { account: PRIVAT, date: "2026-09-12", amount: -20000, desc: "Swish skickad +46765550019", category: "Till partner" });
    tx(db, { account: ESPAR, date: "2026-09-01", amount: 2500000, desc: "LÖN", category: "Inkomst/Lön" });
    linkRecurring(db);
    expect(db.select().from(transactions).where(eq(transactions.recurringExpenseId, hyra.id)).all()).toHaveLength(1);
    expect(spendingPace(db, "2026-09-18")).toMatchObject({ from: "2026-08-20", total: 45000, perDay: 1500 });
  });

  it("compares this month to the same days of the three previous months", () => {
    const db = freshDb({ seeded: true });
    const add = (date: string, amount: number, category: string) => tx(db, { account: PRIVAT, date, amount, category });
    add("2026-09-05", -30000, "Mat/Livsmedel");
    add("2026-09-18", -10000, "Mat/Restaurang & café"); // today counts
    add("2026-08-10", -30000, "Mat/Livsmedel");
    add("2026-08-19", -90000, "Mat/Livsmedel"); // after day 18: not compared
    add("2026-07-18", -60000, "Mat/Livsmedel");
    add("2026-06-01", -15000, "Bil/Drivmedel");
    add("2026-09-06", 5000, "Mat/Livsmedel"); // a refund reduces spending
    const rows = monthByCategory(db, "2026-09-18");
    expect(rows).toEqual([
      { categoryId: getCategoryPathMap(db).get("Mat"), name: "Mat", color: expect.any(String), current: 35000, average: 30000 },
      { categoryId: getCategoryPathMap(db).get("Bil"), name: "Bil", color: expect.any(String), current: 0, average: 5000 },
    ]);
  });
});

describe("warnings", () => {
  it("lists what needs action", () => {
    const db = freshDb({ seeded: true });
    salary(db);
    db.update(accounts).set({ balance: 100, balanceUpdatedAt: "2026-09-01" }).where(eq(accounts.name, PRIVAT)).run();
    db.update(accounts).set({ balance: 100, balanceUpdatedAt: "2026-09-17" }).where(eq(accounts.name, ESPAR)).run();
    tx(db, { account: ESPAR, date: "2026-09-01", amount: -100, desc: "UNCAT" });
    const csn = expense(db, { name: "CSN", amount: 225000, day: 5, account: ESPAR, pattern: "CSN" });
    // August's charge (a 31 Aug charge would count as September's: within ±5 days of 5 Sep).
    tx(db, { account: ESPAR, date: "2026-08-05", amount: -230000, desc: "CSN" });
    linkRecurring(db);
    void csn;
    db.insert(statements).values({ accountId: acc(db, NORWEGIAN).id, periodTo: "2026-09-15", dueDate: "2026-09-21", amountDue: 482150, source: "pdf" }).run();
    const kinds = buildOverview(db, "2026-09-18").warnings.map((w) => w.kind);
    expect(kinds).toEqual(expect.arrayContaining(["overdue_expense", "invoice_due", "stale_balance", "amount_changed", "review"]));
    const texts = buildOverview(db, "2026-09-18").warnings.map((w) => w.text).join("\n");
    expect(texts).toContain("Swedbank Privatkonto uppdaterades för 17 dagar sedan");
    expect(texts).not.toContain("Swedbank e-sparkonto uppdaterades");
    expect(texts).toContain("förfaller 2026-09-21 – om 3 dagar");
  });
});

describe("Att göra", () => {
  it("groups the warnings into tasks with stable ids and what their buttons need", () => {
    const db = freshDb({ seeded: true });
    salary(db);
    db.update(accounts).set({ balance: 100, balanceUpdatedAt: "2026-09-01" }).where(eq(accounts.name, PRIVAT)).run();
    db.update(accounts).set({ balance: 100, balanceUpdatedAt: "2026-09-17" }).where(eq(accounts.name, ESPAR)).run();
    tx(db, { account: ESPAR, date: "2026-09-01", amount: -100, desc: "UNCAT" });
    const csn = expense(db, { name: "CSN", amount: 225000, day: 5, account: ESPAR, pattern: "CSN" });
    const gym = expense(db, { name: "Gym", amount: 39900, day: 10, account: ESPAR, pattern: "GYM" });
    tx(db, { account: ESPAR, date: "2026-08-05", amount: -230000, desc: "CSN" });
    linkRecurring(db);
    const card = acc(db, MASTERCARD).id;
    const s = db.insert(statements).values({ accountId: card, dueDate: "2026-09-30", amountDue: 954320, source: "manual" }).returning().get();

    // The e-sparkonto's data reaches 17/9 (a row), so draws due by 14/9 are known to be missing.
    tx(db, { account: ESPAR, date: "2026-09-17", amount: -100, desc: "UNCAT2" });

    const tasks = buildOverview(db, "2026-09-18").tasks;
    expect(tasks.map((t) => [t.kind, t.text.replace(/\u00a0/g, " ")])).toEqual([
      // Due within the timeline's 14 days (the warning only says so 5 days before).
      ["invoice_due", `${MASTERCARD}: faktura 9 543 kr förfaller 30/9`],
      ["stale_balance", `${PRIVAT}: saldot uppdaterades för 17 dagar sedan`],
      ["review", "3 att granska"],
      // Vakt: the buffer is thinner than three months of spending, and a
      // missed draw each, 3 days after its day.
      // No buffer_low: the buffer is what is left on the 1st, after this month's salary — not the 1 kr before it.
      ["watch", `Gym (399 kr) skulle dragits 10/9 från ${ESPAR} men syns inte`],
      ["watch", `CSN (2 250 kr) skulle dragits 5/9 från ${ESPAR} men syns inte`],
      ["amount_changed", "CSN drogs med 2 300 kr, utgiften säger 2 250 kr"],
    ]);
    expect(tasks[0]).toMatchObject({ id: `invoice:${s.id}`, statementId: s.id, accountId: card });
    expect(tasks[3]).toMatchObject({ id: `missed_charge:${gym.id}:2026-09`, finding: { kind: "missed_charge", expenseId: gym.id, period: "2026-09" } });
    expect(tasks[4].finding).toMatchObject({ expenseId: csn.id, period: "2026-09", amount: 225000 });
    expect(tasks[1]).toMatchObject({ id: `balance:${acc(db, PRIVAT).id}:2026-09-01`, accountId: acc(db, PRIVAT).id });
    expect(tasks[5].items).toEqual([{ expenseId: csn.id, name: "CSN", amount: 225000, latest: 230000 }]);
    // The same things give the same ids tomorrow (dismissed for the day stays dismissed today only).
    expect(buildOverview(db, "2026-09-18").tasks.map((t) => t.id)).toEqual(tasks.map((t) => t.id));

    db.update(statements).set({ paidAt: "2026-09-18" }).where(eq(statements.id, s.id)).run();
    expect(buildOverview(db, "2026-09-18").tasks.map((t) => t.kind)).not.toContain("invoice_due");
  });
});

describe("timeline, the next 14 days", () => {
  it("has salary, fixed expenses (bank and card), invoices, and per bank account what is drawn before payday", () => {
    const db = freshDb({ seeded: true });
    setSalarySettings(db, { scheduleNoticeDays: 6 });
    salary(db, 24, 2420000);
    db.insert(recurringIncome).values({ name: "Barnbidrag", amount: 125000, dayOfMonth: 20, accountId: acc(db, PRIVAT).id }).run();
    expense(db, { name: "Gym", amount: 39900, day: 20, account: ESPAR, pattern: "GYM" });
    expense(db, { name: "Försäkring", amount: 24200, day: 22, account: ESPAR, pattern: "FÖRS" });
    expense(db, { name: "Hyra", amount: 750000, day: 25, account: ESPAR, pattern: "EXEMPELHYRA" });
    expense(db, { name: "El", amount: 50000, day: 21, account: PRIVAT, pattern: "EL" });
    expense(db, { name: "Spotify", amount: 18900, day: 23, account: MASTERCARD, method: "credit_card" });
    expense(db, { name: "Pocket", amount: 1700, day: 4, account: PRIVAT, pattern: "APPLE" }); // 4/10: outside
    expense(db, { name: "Tidigt", amount: 1000, day: 2, account: PRIVAT, pattern: "TIDIGT" }); // 2/10: the last day
    db.insert(statements).values({ accountId: acc(db, MASTERCARD).id, dueDate: "2026-09-30", amountDue: 954320, source: "manual" }).run();

    const t = buildOverview(db, "2026-09-19").timeline;
    expect(t).toMatchObject({ from: "2026-09-19", to: "2026-10-02", payday: "2026-09-24" });
    expect(t.events.map((e) => [e.date, e.kind, e.name, e.amount, e.onCard])).toEqual([
      ["2026-09-20", "income", "Barnbidrag", 125000, false],
      ["2026-09-20", "expense", "Gym", 39900, false],
      ["2026-09-21", "expense", "El", 50000, false],
      ["2026-09-22", "expense", "Försäkring", 24200, false],
      ["2026-09-23", "expense", "Spotify", 18900, true],
      ["2026-09-24", "income", "Lön", 2420000, false],
      ["2026-09-25", "expense", "Hyra", 750000, false],
      // Jobb: October's work schedule due at the latest (the notice from the settings, 6 days before).
      ["2026-09-25", "work", "Schemadeadline: schema för oktober ska vara mottaget", 0, false],
      ["2026-09-30", "invoice", MASTERCARD, 954320, false],
      ["2026-10-02", "expense", "Tidigt", 1000, false],
    ]);
    // Before payday (what the forecast counts) and in the whole 14 days; cards last.
    expect(t.accounts.map((a) => [a.accountName, a.total, a.count, a.windowTotal, a.windowCount, a.before])).toEqual([
      [PRIVAT, 50000, 1, 51000, 2, "2026-09-24"],
      [ESPAR, 64100, 2, 814100, 3, "2026-09-24"],
      [MASTERCARD, 18900, 1, 18900, 1, "2026-09-24"],
    ]);
    expect(t.accounts[1].items.map((i) => [i.name, i.beforePayday])).toEqual([
      ["Gym", true],
      ["Försäkring", true],
      ["Hyra", false],
    ]);
    // The period's lists on Fasta utgifter don't grow with the timeline (September only).
    const privat = buildOverview(db, "2026-09-19").recurring.find((g) => g.accountName === PRIVAT)!;
    expect(privat.items.map((o) => o.dueDate)).toEqual(["2026-09-02", "2026-09-04", "2026-09-21"]);
    // Payday within the 14 days: the rows cover the 14 days.
    expect(t).toMatchObject({ accountsTo: "2026-10-02", accountsTotal: 51000 + 814100 + 18900 });
  });

  it("the account rows reach the next salary when it is further off than the 14 days", () => {
    const db = freshDb({ seeded: true });
    salary(db, 23, 2390000);
    // September's salary is in: the next is 23/10.
    tx(db, { account: ESPAR, date: "2026-09-23", amount: 2650000, desc: "LÖN" });
    expense(db, { name: "Hyra", amount: 750000, day: 25, account: ESPAR, pattern: "EXEMPELHYRA" });
    expense(db, { name: "Elen", amount: 50000, day: 15, account: PRIVAT, pattern: "ELEN" }); // 15/10: after the 14 days, before payday
    expense(db, { name: "Senare", amount: 9900, day: 23, account: PRIVAT, pattern: "SENARE" }); // 23/10: payday itself
    linkRecurring(db);
    const t = buildOverview(db, "2026-09-24").timeline;
    expect(t).toMatchObject({ to: "2026-10-07", payday: "2026-10-23", accountsTo: "2026-10-22" });
    expect(t.accounts.flatMap((a) => a.items.map((i) => [i.name, i.dueDate]))).toEqual([
      ["Elen", "2026-10-15"],
      ["Hyra", "2026-09-25"],
    ]);
    expect(t.accountsTotal).toBe(50000 + 750000);
    // The calendar itself is still 14 days.
    expect(t.events.some((e) => e.date > "2026-10-07")).toBe(false);
  });
});

describe("overview API", () => {
  it("sets balances, enters a Mastercard bill, ticks off invoices and expenses", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const put = (url: string, body: unknown) => app.request(url, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    const post = (url: string, body: unknown) => app.request(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    const privat = acc(db, PRIVAT);
    const mc = acc(db, MASTERCARD);

    expect((await put(`/api/accounts/${privat.id}/balance`, { balance: 1234500, date: "2026-09-18" })).status).toBe(200);
    expect(acc(db, PRIVAT)).toMatchObject({ balance: 1234500, balanceUpdatedAt: "2026-09-18" });
    expect((await put(`/api/accounts/${privat.id}/balance`, { balance: "mycket" })).status).toBe(400);

    const s = (await (await post("/api/statements", { accountId: mc.id, amountDue: 645210, dueDate: "2026-09-30" })).json()) as { id: number };
    expect(acc(db, MASTERCARD).balance).toBe(-645210);
    expect((await post("/api/statements", { accountId: privat.id, amountDue: 1, dueDate: "2026-09-30" })).status).toBe(400);
    await put(`/api/statements/${s.id}/paid`, { paid: true });
    expect(cardInvoices(db, "2026-09-18").find((i) => i.accountId === mc.id)).toMatchObject({ status: "paid", paidBy: "manual" });

    const e = expense(db, { name: "Spotify", amount: 18900, day: 2, account: MASTERCARD, method: "credit_card" });
    await put(`/api/recurring-expenses/${e.id}/marks/2026-09`, { paid: true });
    expect(db.select().from(recurringExpenseMarks).all()).toHaveLength(1);
    await put(`/api/recurring-expenses/${e.id}/marks/2026-09`, { paid: false });
    expect(db.select().from(recurringExpenseMarks).all()).toHaveLength(0);

    const res = await app.request("/api/overview?today=2026-09-18");
    expect(res.status).toBe(200);
    const o = (await res.json()) as { today: string; balances: unknown[] };
    expect(o.today).toBe("2026-09-18");
    expect(o.balances).toHaveLength(4);
  });
});
