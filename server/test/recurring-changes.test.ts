import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenseMarks, recurringExpenses, transactions } from "../src/db/schema.js";
import { linkRecurring } from "../src/recurring/link.js";
import { accountFor, activeIn, periodMonth } from "../src/recurring/changes.js";
import { nextOccurrence } from "../src/recurring/schedule.js";
import { expenseOccurrences } from "../src/overview/overview.js";
import { todayLocal } from "../src/overview/dates.js";
import { setSettlementStart } from "../src/settings.js";
import { sharedMonth } from "../src/shared/settlement.js";
import { findings } from "../src/watch/watch.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const MASTERCARD = "Swedbank Mastercard Guld";
const NORWEGIAN = "Bank Norwegian";

let seq = 0;
function charge(db: Db, account: string, date: string, amount: number, desc: string) {
  return db
    .insert(transactions)
    .values({
      source: account === NORWEGIAN ? "norwegian" : "mastercard",
      accountId: acc(db, account),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount,
      fingerprint: `c${++seq}`,
    })
    .returning()
    .get().id;
}

const patch = (db: Db, id: number, body: object) =>
  createApp(db, { databasePath: ":memory:" }).request(`/api/recurring-expenses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const linkedTo = (db: Db, id: number) =>
  db
    .select({ date: transactions.bookingDate, accountId: transactions.accountId })
    .from(transactions)
    .where(eq(transactions.recurringExpenseId, id))
    .all()
    .map((t) => t.date)
    .sort();
const expense = (db: Db, id: number) => db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get()!;

/** Hostbox on the Mastercard, 149 kr the 18th, July and August drawn. */
function hostbox() {
  const db = freshDb({ seeded: true });
  const id = db
    .insert(recurringExpenses)
    .values({ name: "Hostbox", amount: 14900, anchorDay: 18, dateBasis: "transaction", paymentMethod: "credit_card", accountId: acc(db, MASTERCARD), matchPattern: "HOSTBOX", shared: true })
    .returning()
    .get().id;
  for (const d of ["2026-07-18", "2026-08-18"]) charge(db, MASTERCARD, d, -14900, "HOSTBOX");
  linkRecurring(db);
  return { db, id };
}

describe("changes.ts", () => {
  const e = { accountId: 2, previousAccountId: 1, accountFrom: "2026-10", anchorMonth: 3, paused: true, lastPeriod: "2026-09" };
  it("the account for a period: the one before the move for the periods before it", () => {
    expect(accountFor(e, "2026-09")).toBe(1);
    expect(accountFor(e, "2026-10")).toBe(2);
    expect(accountFor({ ...e, previousAccountId: null }, "2026-09")).toBe(2);
    // A yearly period is its draw's month.
    expect(periodMonth(e, "2026")).toBe("2026-03");
    expect(accountFor(e, "2027")).toBe(2);
  });
  it("a paused one counts up to its last draw; without one, not at all", () => {
    expect(activeIn(e, "2026-09")).toBe(true);
    expect(activeIn(e, "2026-10")).toBe(false);
    expect(activeIn({ ...e, lastPeriod: null }, "2026-09")).toBe(false);
    expect(activeIn({ ...e, paused: false }, "2027-01")).toBe(true);
  });
});

describe("moved to another card, from a month", () => {
  it("the charges on the old card keep their links; the new card's from the month of the move", async () => {
    const { db, id } = hostbox();
    expect((await patch(db, id, { accountId: acc(db, NORWEGIAN), accountFrom: "2026-10" })).status).toBe(200);
    expect(expense(db, id)).toMatchObject({ accountId: acc(db, NORWEGIAN), previousAccountId: acc(db, MASTERCARD), accountFrom: "2026-10" });
    expect(linkedTo(db, id)).toEqual(["2026-07-18", "2026-08-18"]);

    // September's charge comes with the Mastercard invoice, after the move: still Hostbox's.
    charge(db, MASTERCARD, "2026-09-18", -14900, "HOSTBOX");
    // October on the new card; one on the old card too is not taken as it.
    charge(db, NORWEGIAN, "2026-10-18", -14900, "HOSTBOX");
    const stray = charge(db, MASTERCARD, "2026-10-19", -14900, "HOSTBOX");
    linkRecurring(db);
    expect(linkedTo(db, id)).toEqual(["2026-07-18", "2026-08-18", "2026-09-18", "2026-10-18"]);
    expect(db.select().from(transactions).where(eq(transactions.id, stray)).get()!.recurringExpenseId).toBeNull();
  });

  it("the month drawn on the old card is 'dragen', never 'förfallen' for being there", async () => {
    const { db, id } = hostbox();
    charge(db, MASTERCARD, "2026-09-18", -14900, "HOSTBOX");
    linkRecurring(db);
    await patch(db, id, { accountId: acc(db, NORWEGIAN), accountFrom: "2026-10" });
    const sep = expenseOccurrences(db, "2026-09-25", null).find((o) => o.expenseId === id && o.period === "2026-09")!;
    expect(sep).toMatchObject({ status: "dragen", accountId: acc(db, MASTERCARD) });
    const oct = expenseOccurrences(db, "2026-10-25", null).find((o) => o.expenseId === id && o.period === "2026-10")!;
    // Once Norwegian has imported rows, a missing charge there is 'förfallen'.
    charge(db, NORWEGIAN, "2026-10-02", -5000, "ICA");
    expect(expenseOccurrences(db, "2026-10-25", null).find((o) => o.expenseId === id && o.period === "2026-10")).toMatchObject({ status: "forfallen", accountId: acc(db, NORWEGIAN) });
    expect(oct.accountId).toBe(acc(db, NORWEGIAN));
  });

  it("by default the move holds from the next draw; 'the account was wrong' moves all of it", async () => {
    const { db, id } = hostbox();
    const before = expense(db, id);
    await patch(db, id, { accountId: acc(db, NORWEGIAN) });
    expect(expense(db, id).accountFrom).toBe(periodMonth(before, nextOccurrence(before, todayLocal())!.period));
    expect(linkedTo(db, id)).toEqual(["2026-07-18", "2026-08-18"]);
    // A correction: no account before, the Mastercard charges aren't Hostbox's on Norwegian.
    await patch(db, id, { previousAccountId: null });
    expect(expense(db, id)).toMatchObject({ previousAccountId: null, accountFrom: null });
    expect(linkedTo(db, id)).toEqual([]);
  });

  it("a second move keeps the first card's links", async () => {
    const { db, id } = hostbox();
    await patch(db, id, { accountId: acc(db, NORWEGIAN), accountFrom: "2026-09" });
    charge(db, NORWEGIAN, "2026-09-18", -14900, "HOSTBOX");
    linkRecurring(db);
    await patch(db, id, { accountId: acc(db, "Swedbank Privatkonto"), accountFrom: "2026-10" });
    expect(expense(db, id)).toMatchObject({ previousAccountId: acc(db, NORWEGIAN), accountFrom: "2026-10" });
    expect(linkedTo(db, id)).toEqual(["2026-07-18", "2026-08-18", "2026-09-18"]);
  });
});

describe("cancelled after a last draw", () => {
  /** Musikapp on Norwegian, shared, drawn in August and September. */
  function musikapp() {
    const db = freshDb({ seeded: true });
    setSettlementStart(db, "2026-08");
    const id = db
      .insert(recurringExpenses)
      .values({ name: "Musikapp", amount: 14900, anchorDay: 20, dateBasis: "transaction", paymentMethod: "credit_card", accountId: acc(db, NORWEGIAN), matchPattern: "MUSIKAPP", shared: true })
      .returning()
      .get().id;
    for (const d of ["2026-08-20", "2026-09-20"]) charge(db, NORWEGIAN, d, -14900, "MUSIKAPP.COM");
    linkRecurring(db);
    return { db, id };
  }
  const musikappRows = (db: Db) =>
    ["2026-09", "2026-10", "2026-11", "2026-12"].flatMap((m) =>
      sharedMonth(db, m, "2026-09-23")
        .iPaid.groups.flatMap((g) => g.rows)
        .filter((r) => /musikapp/i.test(r.description))
        .map((r) => `${m} ${r.amount} ${r.status ?? "rad"}`),
    );

  it("pausing keeps the drawn charges and still shares them; nothing expected after the last draw", async () => {
    const { db, id } = musikapp();
    const before = musikappRows(db);
    expect(before.filter((r) => r.endsWith("forvantat")).length).toBeGreaterThan(0);

    expect((await patch(db, id, { paused: true })).status).toBe(200);
    // The last draw is the latest charge's month; its links stay, and it is still shared.
    expect(expense(db, id)).toMatchObject({ paused: true, lastPeriod: "2026-09" });
    expect(linkedTo(db, id)).toEqual(["2026-08-20", "2026-09-20"]);
    const after = musikappRows(db);
    expect(after.filter((r) => r.endsWith("dragen"))).toEqual(before.filter((r) => r.endsWith("dragen")));
    expect(after.some((r) => r.endsWith("forvantat"))).toBe(false);
    // Not a draw after it, and not in this view.
    expect(expenseOccurrences(db, "2026-10-01", null, "2026-10-31").some((o) => o.expenseId === id)).toBe(false);
  });

  it("a charge after the last draw is not the subscription's (and not shared); unpausing takes it again", async () => {
    const { db, id } = musikapp();
    await patch(db, id, { paused: true });
    const late = charge(db, NORWEGIAN, "2026-10-20", -14900, "MUSIKAPP.COM");
    linkRecurring(db);
    expect(db.select().from(transactions).where(eq(transactions.id, late)).get()).toMatchObject({ recurringExpenseId: null, shared: false });
    await patch(db, id, { paused: false });
    expect(expense(db, id).lastPeriod).toBeNull();
    expect(linkedTo(db, id)).toEqual(["2026-08-20", "2026-09-20", "2026-10-20"]);
  });

  it("an earlier last draw undoes the links after it; a charge imported late up to it is taken", async () => {
    const { db, id } = musikapp();
    await patch(db, id, { paused: true, lastPeriod: "2026-08" });
    expect(linkedTo(db, id)).toEqual(["2026-08-20"]);
    await patch(db, id, { lastPeriod: "2026-09" });
    expect(linkedTo(db, id)).toEqual(["2026-08-20", "2026-09-20"]);
    expect((await patch(db, id, { lastPeriod: "2026-13" })).status).toBe(400);
  });
});

describe("not drawn for a while", () => {
  /** Musikapp on Norwegian, shared: drawn in June, paused in July and August, drawn again in September. */
  function musikapp() {
    const db = freshDb({ seeded: true });
    setSettlementStart(db, "2026-06");
    const id = db
      .insert(recurringExpenses)
      .values({ name: "Musikapp", amount: 14900, anchorDay: 20, dateBasis: "transaction", paymentMethod: "credit_card", accountId: acc(db, NORWEGIAN), matchPattern: "MUSIKAPP", shared: true })
      .returning()
      .get().id;
    for (const d of ["2026-06-20", "2026-09-20"]) charge(db, NORWEGIAN, d, -14900, "MUSIKAPP.COM");
    // Norwegian's rows reach past the missed draws.
    charge(db, NORWEGIAN, "2026-09-22", -5000, "ICA");
    linkRecurring(db);
    return { db, id };
  }
  const mark = (db: Db, id: number, period: string, body: object) =>
    createApp(db, { databasePath: ":memory:" }).request(`/api/recurring-expenses/${id}/marks/${period}`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  const expectedRows = (db: Db) =>
    ["2026-07", "2026-08", "2026-09", "2026-10"].flatMap((m) =>
      sharedMonth(db, m, "2026-09-23")
        .iPaid.groups.flatMap((g) => g.rows)
        .filter((r) => /musikapp/i.test(r.description) && r.status === "forvantat")
        .map((r) => r.date),
    );
  const musikappsTasks = (db: Db, id: number) => findings(db, "2026-09-23").filter((f) => f.expenseId === id).map((f) => `${f.kind} ${f.period}`);

  it("the months marked are neither expected, missed nor shared; the drawn ones still are", async () => {
    const { db, id } = musikapp();
    expect(expectedRows(db)).toEqual(expect.arrayContaining(["2026-07-20", "2026-08-20"]));
    expect(musikappsTasks(db, id)).toContain("missed_charge 2026-08");

    for (const p of ["2026-07", "2026-08"]) expect((await mark(db, id, p, { skipped: true })).status).toBe(200);
    expect(expectedRows(db).filter((d) => d < "2026-09")).toEqual([]);
    expect(musikappsTasks(db, id)).toEqual([]);
    expect(expenseOccurrences(db, "2026-08-01", null, "2026-08-31").some((o) => o.expenseId === id)).toBe(false);
    // September's charge is there as before.
    expect(expenseOccurrences(db, "2026-09-23", null).find((o) => o.expenseId === id && o.period === "2026-09")).toMatchObject({ status: "dragen" });
    // Listed on the expense.
    const listed = (await (await createApp(db, { databasePath: ":memory:" }).request("/api/recurring-expenses")).json()) as { id: number; skippedPeriods: string[] }[];
    expect(listed.find((e) => e.id === id)!.skippedPeriods).toEqual(["2026-07", "2026-08"]);
  });

  it("a charge that comes anyway links and counts; a month has one mark, undone by its kind", async () => {
    const { db, id } = musikapp();
    await mark(db, id, "2026-08", { skipped: true });
    charge(db, NORWEGIAN, "2026-08-20", -14900, "MUSIKAPP.COM");
    linkRecurring(db);
    expect(linkedTo(db, id)).toEqual(["2026-06-20", "2026-08-20", "2026-09-20"]);
    expect(expenseOccurrences(db, "2026-08-25", null).find((o) => o.expenseId === id && o.period === "2026-08")).toMatchObject({ status: "dragen" });

    const kinds = () => db.select().from(recurringExpenseMarks).all().map((m) => `${m.period} ${m.kind}`);
    await mark(db, id, "2026-07", { skipped: true });
    await mark(db, id, "2026-07", { paid: true });
    expect(kinds()).toEqual(["2026-08 skipped", "2026-07 paid"]);
    // Undoing 'skipped' leaves a 'paid' alone.
    await mark(db, id, "2026-07", { skipped: false });
    expect(kinds()).toEqual(["2026-08 skipped", "2026-07 paid"]);
    await mark(db, id, "2026-08", { skipped: false });
    expect(kinds()).toEqual(["2026-07 paid"]);
    expect((await mark(db, id, "2026-07", { paid: true, skipped: true })).status).toBe(400);
    expect((await mark(db, id, "2026-07", {})).status).toBe(400);
  });
});
