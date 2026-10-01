import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { buildOverview, eatingOutDays, groceryWeeks, isoWeek, noSpendDays } from "../src/overview/overview.js";
import { setCash } from "../src/savings/portfolio.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-10";
let seq = 0;
function buy(db: Db, o: { account?: string; date: string; amount: number; desc: string; category?: string; booked?: string; recurringExpenseId?: number; isTransfer?: boolean }) {
  const cat = o.category ? getCategoryPathMap(db).get(o.category)! : null;
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, o.account ?? "Swedbank Privatkonto")).get()!.id,
      bookingDate: o.booked ?? o.date,
      transactionDate: o.date,
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      counterparty: o.desc,
      amount: o.amount,
      categoryId: cat,
      recurringExpenseId: o.recurringExpenseId ?? null,
      isTransfer: o.isTransfer ?? false,
      fingerprint: `ns${++seq}`,
    })
    .run();
}

describe("dagar utan köp", () => {
  it("green the days nothing was bought; the food shop, the car, fixed expenses and transfers aren't purchases", () => {
    const db = freshDb({ seeded: true });
    buy(db, { date: "2026-09-01", amount: -30000, desc: "ICA", category: "Mat/Livsmedel" });
    buy(db, { date: "2026-09-02", amount: -80000, desc: "CIRCLE K", category: "Bil/Drivmedel" });
    buy(db, { date: "2026-09-03", amount: -12000, desc: "MAX", category: "Mat/Restaurang & café" });
    // The car's other charges must be paid too.
    buy(db, { date: "2026-09-09", amount: -900, desc: "Infrastrukturavg", category: "Bil/Trängselskatt" });
    buy(db, { date: "2026-09-09", amount: -4500, desc: "EASYPARK", category: "Bil/Parkering" });
    const rent = db.insert(recurringExpenses).values({ name: "Hyra", amount: 700000, anchorDay: 4, paymentMethod: "transfer" }).returning().get();
    buy(db, { date: "2026-09-04", amount: -700000, desc: "HYRA", recurringExpenseId: rent.id });
    buy(db, { date: "2026-09-05", amount: -500000, desc: "TILL SPAR", isTransfer: true });
    // Bought on the card the 6th, booked the 8th: it is the 6th that isn't free.
    buy(db, { account: "Bank Norwegian", date: "2026-09-06", booked: "2026-09-08", amount: -29900, desc: "KJELL" });
    // Income isn't spending.
    buy(db, { date: "2026-09-07", amount: 2500000, desc: "LÖN" });

    const n = noSpendDays(db, TODAY);
    const status = (d: string) => n.days.find((x) => x.date === d)!.status;
    expect(["01", "02", "04", "05", "07", "08", "09"].map((d) => status(`2026-09-${d}`))).toEqual(Array(7).fill("free"));
    expect(status("2026-09-03")).toBe("spent");
    expect(n.days.find((x) => x.date === "2026-09-06")).toMatchObject({ status: "spent", items: [{ name: "KJELL", amount: 29900 }] });
    expect(status("2026-09-10")).toBe("today");
    expect(status("2026-09-11")).toBe("future");
    expect(n).toMatchObject({ month: "2026-09", free: 7, past: 9 });
    expect(n.days).toHaveLength(30);
    // What was bought: the restaurant and Kjell, not the food shop, the car or the rent.
    expect(n.amount).toBe(12000 + 29900);
  });

  it("what was bought against the usual: the same things, the same days of the last three months", () => {
    const db = freshDb({ seeded: true });
    // By the 10th: a cable in July and takeaway in August; later in August, Amazon.
    buy(db, { date: "2026-07-03", amount: -20000, desc: "KJELL", category: "Prylar & hem/Elektronik" });
    buy(db, { date: "2026-08-08", amount: -10000, desc: "FOODORA", category: "Mat/Hämtmat" });
    buy(db, { date: "2026-08-20", amount: -60000, desc: "AMAZON" });
    // Not counted: the food shop, the car, a fixed expense.
    buy(db, { date: "2026-07-04", amount: -90000, desc: "ICA", category: "Mat/Livsmedel" });
    buy(db, { date: "2026-07-05", amount: -90000, desc: "CIRCLE K", category: "Bil/Drivmedel" });
    const rent = db.insert(recurringExpenses).values({ name: "Hyra", amount: 700000, anchorDay: 4, paymentMethod: "transfer" }).returning().get();
    buy(db, { date: "2026-08-04", amount: -700000, desc: "HYRA", recurringExpenseId: rent.id });
    expect(noSpendDays(db, TODAY).usual).toEqual({ toDate: 10000, perMonth: 30000, day: 10, from: "2026-06", to: "2026-08" });
  });

  it("Pengar nu: the bank accounts and the cash on ISK", () => {
    const db = freshDb({ seeded: true });
    db.update(accounts).set({ balance: 30000 }).where(eq(accounts.name, "Swedbank Privatkonto")).run();
    db.update(accounts).set({ balance: 19000 }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
    setCash(db, "isk", TODAY, 426000);
    expect(buildOverview(db, TODAY).money).toMatchObject({ bankOre: 49000, iskOre: 426000, totalOre: 475000 });
  });

  it("restaurang och hämtmat: the days the household ate out, how many and what it cost", () => {
    const db = freshDb({ seeded: true });
    buy(db, { date: "2026-09-02", amount: -14500, desc: "MAX", category: "Mat/Restaurang & café" });
    buy(db, { date: "2026-09-02", amount: -5500, desc: "ESPRESSO HOUSE", category: "Mat/Restaurang & café" });
    buy(db, { account: "Bank Norwegian", date: "2026-09-06", booked: "2026-09-08", amount: -32000, desc: "FOODORA", category: "Mat/Hämtmat" });
    // Not eating out: the food shop, and a refund.
    buy(db, { date: "2026-09-03", amount: -40000, desc: "ICA", category: "Mat/Livsmedel" });
    buy(db, { date: "2026-09-04", amount: 5500, desc: "ESPRESSO HOUSE RETUR", category: "Mat/Restaurang & café" });
    const e = eatingOutDays(db, TODAY);
    expect(e.days.filter((d) => d.status === "out").map((d) => d.date)).toEqual(["2026-09-02", "2026-09-06"]);
    expect(e).toMatchObject({ month: "2026-09", count: 2, amount: 52000 });
    expect(e.days.find((d) => d.date === "2026-09-02")!.items.map((i) => i.name)).toEqual(["MAX", "ESPRESSO HOUSE"]);
    expect(e.days.find((d) => d.date === "2026-09-10")!.status).toBe("today");
  });

  it("restaurang och hämtmat against the usual: the last three months by the same day, and a whole month", () => {
    const db = freshDb({ seeded: true });
    // June–August: 300 kr by the 10th (the 5th of July), 900 kr more later (the 20th of August, takeaway).
    buy(db, { date: "2026-07-05", amount: -30000, desc: "MAX", category: "Mat/Restaurang & café" });
    buy(db, { date: "2026-08-20", amount: -90000, desc: "FOODORA", category: "Mat/Hämtmat" });
    // Not eating out, and before the three months.
    buy(db, { date: "2026-07-06", amount: -50000, desc: "ICA", category: "Mat/Livsmedel" });
    buy(db, { date: "2026-05-05", amount: -99900, desc: "MAX", category: "Mat/Restaurang & café" });
    expect(eatingOutDays(db, TODAY).usual).toEqual({ toDate: 10000, perMonth: 40000, day: 10, from: "2026-06", to: "2026-08" });
  });
});

describe("livsmedel per vecka", () => {
  it("the ISO week of a day", () => {
    expect(["2026-09-01", "2026-09-06", "2026-09-07", "2026-12-31", "2027-01-01", "2027-01-04"].map(isoWeek)).toEqual([36, 36, 37, 53, 53, 1]);
  });

  it("this month's groceries Monday to Sunday, cut at the month's ends, by the purchase day; the usual week from the last three months", () => {
    const db = freshDb({ seeded: true });
    buy(db, { date: "2026-09-02", amount: -30000, desc: "ICA", category: "Mat/Livsmedel" });
    // Bought the 6th (a Sunday), booked the 8th: week 36.
    buy(db, { account: "Bank Norwegian", date: "2026-09-06", booked: "2026-09-08", amount: -20000, desc: "WILLYS", category: "Mat/Livsmedel" });
    buy(db, { date: "2026-09-07", amount: -45000, desc: "COOP", category: "Mat/Livsmedel" });
    // Not the grocery shop.
    buy(db, { date: "2026-09-08", amount: -12000, desc: "MAX", category: "Mat/Restaurang & café" });
    // August, before the month: 31 000 kr over June–August (92 days) is 2 359 kr a week.
    buy(db, { date: "2026-08-31", amount: -3100000, desc: "ICA", category: "Mat/Livsmedel" });
    const g = groceryWeeks(db, TODAY);
    expect(g.weeks.map((w) => `${w.week} ${w.from}–${w.to} ${w.amount} ${w.status}`)).toEqual([
      "36 2026-09-01–2026-09-06 50000 past",
      "37 2026-09-07–2026-09-13 45000 current",
      "38 2026-09-14–2026-09-20 0 future",
      "39 2026-09-21–2026-09-27 0 future",
      "40 2026-09-28–2026-09-30 0 future",
    ]);
    expect(g).toMatchObject({ month: "2026-09", total: 95000, averagePerWeek: Math.round((3100000 / 92) * 7), averageFrom: "2026-06", averageTo: "2026-08" });
    expect(buildOverview(db, TODAY).groceryWeeks.total).toBe(95000);
    // The usual by the 10th: only August's purchase on the 31st, so nothing by then; a whole month 31 000 / 3.
    expect(g.usual).toEqual({ toDate: 0, perMonth: Math.round(3100000 / 3), day: 10, from: "2026-06", to: "2026-08" });
    buy(db, { date: "2026-07-04", amount: -60000, desc: "ICA", category: "Mat/Livsmedel" });
    expect(groceryWeeks(db, TODAY).usual.toDate).toBe(20000);
  });
});
