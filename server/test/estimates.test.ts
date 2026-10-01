import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringIncome, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { expenseEstimates, setFoodEstimate, usualSalary } from "../src/recurring/estimates.js";
import { addPrice, setShifts } from "../src/fuel/fuel.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";
import { JULY, pinSalarySettings } from "./payslips.js";
import { addMonths } from "../src/overview/dates.js";
import { deriveConstants, importPayslip, salaryForecasts, setMonth } from "../src/salary/salary.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-19";

let seq = 0;
function buy(db: Db, date: string, ore: number, category: string, shared = false) {
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "X",
      descriptionClean: "X",
      amount: -ore,
      categoryId: getCategoryPathMap(db).get(category)!,
      categorySource: "rule",
      shared,
      fingerprint: `e${++seq}`,
    })
    .run();
}

describe("Fasta utgifter › Uppskattat", () => {
  it("food: the average of Livsmedel, restaurants and takeaway over the last three whole months, and my share; an entered amount wins", () => {
    const db = freshDb({ seeded: true });
    // June–August: 6 000 kr shared groceries (3 000 mine) and 3 000 kr own lunches: 9 000 kr, mine 6 000.
    buy(db, "2026-06-10", 600000, "Mat/Livsmedel", true);
    buy(db, "2026-07-12", 200000, "Mat/Restaurang & café");
    buy(db, "2026-08-20", 100000, "Mat/Hämtmat");
    buy(db, "2026-09-05", 999900, "Mat/Livsmedel"); // this month: not in the average
    buy(db, "2026-05-31", 999900, "Mat/Livsmedel"); // before the three months
    buy(db, "2026-07-20", 90000, "Mat/Alkohol"); // not food here
    const e = expenseEstimates(db, TODAY);
    // Nothing entered: the average is used.
    expect(e.food).toEqual({ amount: 300000, mine: 200000, source: "average", average: { from: "2026-06", to: "2026-08", household: 300000, mine: 200000, mineShare: 0.67 } });
    setFoodEstimate(db, 800000);
    expect(expenseEstimates(db, TODAY).food).toMatchObject({ amount: 800000, mine: 536000, source: "entered" });
    // Nothing to go by and nothing entered: none.
    expect(expenseEstimates(freshDb({ seeded: true }), TODAY).food).toMatchObject({ amount: null, mine: null, source: null });
    expect(() => setFoodEstimate(db, -1)).toThrow();
  });

  it("fuel: Pendling & bränsle's forecast for this month, else the average", () => {
    const db = freshDb({ seeded: true });
    buy(db, "2026-07-05", 150000, "Bil/Drivmedel");
    expect(expenseEstimates(db, TODAY).fuel).toMatchObject({ amount: 50000, mine: 50000, source: "average" });
    addPrice(db, "2026-09-01", 2000);
    setShifts(db, "2026-09", 14);
    const f = expenseEstimates(db, TODAY).fuel;
    expect(f).toMatchObject({ source: "forecast", shifts: 14 });
    expect(f.amount).toBe(Math.round(((14 * 40 + 200) * 6.5 * 2000) / 100));
  });

  it("the usual salary: the average of the last six that came in", () => {
    const db = freshDb({ seeded: true });
    expect(expenseEstimates(db, TODAY).salary).toBeNull();
    const lon = db.insert(recurringIncome).values({ name: "Lön", amount: 2500000, dayOfMonth: 24, matchPattern: "LÖN" }).returning().get();
    const paid = (date: string, ore: number) =>
      db.insert(transactions)
        .values({ source: "swedbank", accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id, bookingDate: date, transactionDate: date, descriptionRaw: "LÖN", descriptionClean: "LÖN", amount: ore, recurringIncomeId: lon.id, fingerprint: `s${++seq}` })
        .run();
    // Seven months: the oldest is left out.
    paid("2026-02-24", 9_000_000);
    for (const [m, ore] of [["03", 2_200_000], ["04", 2_300_000], ["05", 2_400_000], ["06", 2_500_000], ["07", 2_600_000], ["08", 2_700_000]] as const) paid(`2026-${m}-24`, ore);
    expect(expenseEstimates(db, TODAY).salary).toEqual({ average: 2_450_000, gross: null, count: 6, from: "2026-03", to: "2026-08" });
  });

  it("Lön's 'Snitt 12 mån': the same average over twelve; the gross from the payslip, else the forecast", async () => {
    const db = freshDb({ seeded: true });
    const lon = db.insert(recurringIncome).values({ name: "Lön", amount: 2500000, dayOfMonth: 24, matchPattern: "LÖN" }).returning().get();
    const paid = (date: string, ore: number) =>
      db.insert(transactions)
        .values({ source: "swedbank", accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id, bookingDate: date, transactionDate: date, descriptionRaw: "LÖN", descriptionClean: "LÖN", amount: ore, recurringIncomeId: lon.id, fingerprint: `s${++seq}` })
        .run();
    // Thirteen months in: the oldest is left out of twelve, the six latest are Fasta utgifter's.
    for (let i = 0; i < 13; i++) {
      const m = addMonths("2025-08", i);
      paid(`${m}-24`, 2_000_000 + i * 10_000);
    }
    pinSalarySettings(db);
    // July's payslip (paid 24/7) gives its gross; July's work month, paid in August, a forecast.
    importPayslip(db, "Lonespec_2607.htm", JULY);
    deriveConstants(db);
    setMonth(db, "2026-07", { hours: 140 });
    const august = salaryForecasts(db).get("2026-08")!.gross;

    const twelve = usualSalary(db, TODAY, 12)!;
    expect(twelve).toMatchObject({ count: 12, from: "2025-09", to: "2026-08", average: 2_000_000 + 65_000 });
    expect(twelve.gross).toBe(Math.round((2789995 + august) / 2));
    // Six is Fasta utgifter's, to the öre.
    expect(usualSalary(db, TODAY)).toEqual({ ...expenseEstimates(db, TODAY).salary, gross: twelve.gross });
    expect(expenseEstimates(db, TODAY).salary).toMatchObject({ count: 6, from: "2026-03", average: 2_000_000 + 95_000 });
    // And the API's Lön has the twelve.
    const app = createApp(db, { databasePath: ":memory:" });
    const lonApi = await (await app.request("/api/salary")).json();
    expect(lonApi.average).toEqual(usualSalary(db, lonApi.today, 12));
  });

  it("the API saves the food estimate (empty clears it)", async () => {
    const app = createApp(freshDb({ seeded: true }), { databasePath: ":memory:" });
    const put = (food: unknown) => app.request("/api/recurring-expenses/estimates", { method: "PUT", body: JSON.stringify({ food }), headers: { "Content-Type": "application/json" } });
    expect((await (await put(750000)).json()).food.amount).toBe(750000);
    expect((await put("mycket")).status).toBe(400);
    // Cleared: back to the average (none here).
    expect((await (await put(null)).json()).food).toMatchObject({ amount: null, source: null });
  });
});
