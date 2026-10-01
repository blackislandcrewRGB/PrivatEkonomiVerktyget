import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringIncome, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { buildOverview } from "../src/overview/overview.js";
import { addPrice, addReading, calibration, fuelUntilPayday, getFuelSettings, monthActuals, monthForecast, odometerCheck, setFuelSettings, setShiftDay, setShifts } from "../src/fuel/fuel.js";
import { addMonths } from "../src/overview/dates.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-19";
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});

let seq = 0;
function fuel(db: Db, date: string, ore: number, o: { note?: string; label?: string; category?: string } = {}) {
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Mastercard Guld")).get()!.id,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: "CIRCLE K EXEMPELSTAD",
      descriptionClean: "CIRCLE K EXEMPELSTAD",
      counterparty: "CIRCLE K EXEMPELSTAD",
      amount: -ore,
      categoryId: getCategoryPathMap(db).get(o.category ?? "Bil/Drivmedel")!,
      categorySource: "rule",
      note: o.note ?? null,
      label: o.label ?? null,
      fingerprint: `f${++seq}`,
    })
    .run();
}

/**
 * June–August: 16, 10 and 15 shifts, fuel for 6.0, 7.0 and 6.5 l/100 km at
 * 19,25 kr/l, a trip in July. September: 14 shifts, 585 kr bought, 19,50 kr/l.
 */
function setup() {
  const db = freshDb({ seeded: true });
  addPrice(db, "2026-06-01", 1925);
  addPrice(db, "2026-09-01", 1950);
  setShifts(db, "2026-06", 16); // 840 km
  setShifts(db, "2026-07", 10); // 600 km
  setShifts(db, "2026-08", 15); // 800 km
  fuel(db, "2026-06-12", 97020);
  fuel(db, "2026-07-08", 80850);
  fuel(db, "2026-07-20", 90000, { note: "Resa Exempelvik" });
  fuel(db, "2026-08-15", 100100);
  setShifts(db, "2026-09", 14); // 760 km
  fuel(db, "2026-09-05", 58500);
  return db;
}
// All litres bought over all km: (97 020 + 80 850 + 100 100) / 1 925 / 2 240 × 100.
const CALIBRATED = ((97020 + 80850 + 100100) / 1925 / 2240) * 100;

describe("settings", () => {
  it("start at 40 km a shift, 200 km other driving and 6.5 l/100 km, with Bil › Drivmedel as fuel", () => {
    const db = freshDb({ seeded: true });
    expect(getFuelSettings(db)).toMatchObject({
      kmPerShift: 40,
      otherKmPerMonth: 200,
      baseConsumption: 6.5,
      congestionPerShift: 0,
      useCalibrated: true,
      fuelCategoryId: getCategoryPathMap(db).get("Bil/Drivmedel"),
    });
    setFuelSettings(db, { otherKmPerMonth: 250, congestionPerShift: 2200 });
    expect(getFuelSettings(db)).toMatchObject({ otherKmPerMonth: 250, congestionPerShift: 2200, kmPerShift: 40 });
    expect(() => setFuelSettings(db, { baseConsumption: -1 })).toThrow();
    expect(() => setFuelSettings(db, { kmPerShift: "40" })).toThrow();
  });
});

describe("calibration", () => {
  it("averages the last three finished months: litres bought over km driven, trips left out", () => {
    const db = setup();
    const c = calibration(db, TODAY)!;
    expect(c.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(c.l100).toBeCloseTo(CALIBRATED, 6);
    expect(c.min).toBeCloseTo(6.0, 3);
    expect(c.max).toBeCloseTo(7.0, 3);
  });

  it("needs shifts, fuel and a price; a month without shifts is left out", () => {
    const db = setup();
    setShifts(db, "2026-07", null);
    expect(calibration(db, TODAY)!.months).toEqual(["2026-06", "2026-08"]);
    const empty = freshDb({ seeded: true });
    setShifts(empty, "2026-08", 15);
    fuel(empty, "2026-08-15", 100100);
    expect(calibration(empty, TODAY)).toBeNull(); // no price
  });
});

describe("prices", () => {
  it("turn each purchase into litres at the price on its day; the month shows the average paid", () => {
    const db = freshDb({ seeded: true });
    addPrice(db, "2026-05-01", 1800);
    addPrice(db, "2026-05-20", 2000);
    setShifts(db, "2026-05", 14); // 760 km
    fuel(db, "2026-05-10", 45000); // 25 l
    fuel(db, "2026-05-25", 30000); // 15 l
    const [may] = monthActuals(db, "2026-05", "2026-05");
    expect(may).toMatchObject({ litres: 40, priceLater: false, price: { price: 1875 } });
    expect(may.l100).toBeCloseTo((40 / 760) * 100, 6);
  });

  it("a month whose purchases only have a later price is marked, and left out of the calibration", () => {
    const empty = freshDb({ seeded: true });
    addPrice(empty, "2026-09-19", 2258);
    setShifts(empty, "2026-08", 15);
    fuel(empty, "2026-08-15", 100100);
    const [aug] = monthActuals(empty, "2026-08", "2026-08");
    expect(aug).toMatchObject({ priceLater: true, price: { date: "2026-09-19" } });
    expect(aug.l100).not.toBeNull();
    expect(calibration(empty, TODAY)).toBeNull();
    // With a price from before the purchase it counts.
    addPrice(empty, "2026-08-01", 1850);
    expect(calibration(empty, TODAY)!.months).toEqual(["2026-08"]);
  });
});

describe("this month", () => {
  it("expects (shifts × km + other km) × l/100 km × price, less what is already bought", () => {
    const db = setup();
    const f = monthForecast(db, "2026-09", TODAY).forecast!;
    expect(f).toMatchObject({ shifts: 14, km: 760, consumptionSource: "calibrated", spent: 58500, price: { price: 1950 } });
    expect(f.consumption).toBeCloseTo(CALIBRATED, 6);
    expect(f.expectedFuel).toBe(Math.round((760 * CALIBRATED * 1950) / 100));
    expect(f.remaining).toBe(f.expectedFuel - 58500);
    expect(f.perShift).toBe(Math.round((40 * CALIBRATED * 1950) / 100));

    setFuelSettings(db, { useCalibrated: false, congestionPerShift: 1100 });
    const base = monthForecast(db, "2026-09", TODAY).forecast!;
    expect(base).toMatchObject({ consumption: 6.5, consumptionSource: "base", expectedFuel: 96330, expectedCongestion: 14 * 1100 });
    expect(base.perShift).toBe(Math.round((40 * 6.5 * 1950) / 100) + 1100);
  });

  it("says what is missing: shifts or a price", () => {
    const db = freshDb({ seeded: true });
    expect(monthForecast(db, "2026-09", TODAY)).toEqual({ forecast: null, missing: "shifts" });
    setShifts(db, "2026-09", 12);
    expect(monthForecast(db, "2026-09", TODAY)).toEqual({ forecast: null, missing: "price" });
  });

  it("marking days worked sets the month's number of shifts", () => {
    const db = freshDb({ seeded: true });
    setShiftDay(db, "2026-10-01", true);
    expect(setShiftDay(db, "2026-10-02", true)).toEqual({ month: "2026-10", days: ["2026-10-01", "2026-10-02"], shifts: 2 });
    expect(setShiftDay(db, "2026-10-01", false).shifts).toBe(1);
  });
});

describe("the overview", () => {
  it("sets aside the fuel still to buy in 'kvar att leva på', and asks for the shifts when they are missing", () => {
    const db = setup();
    db.insert(recurringIncome)
      .values({ name: "Lön", amount: 2500000, dayOfMonth: 24, accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!.id, matchPattern: "LÖN" })
      .run();
    const remaining = monthForecast(db, "2026-09", TODAY).forecast!.remaining;
    const withFuel = buildOverview(db, TODAY);
    expect(withFuel.forecast!.fuel).toMatchObject({ month: "2026-09", thisMonth: remaining, next: null, amount: remaining });
    expect(withFuel.tasks.some((t) => t.kind === "fuel_shifts")).toBe(false);

    setShifts(db, "2026-09", null);
    const without = buildOverview(db, TODAY);
    expect(without.forecast!.fuel).toBeNull();
    expect(without.forecast!.left - withFuel.forecast!.left).toBe(remaining);
    expect(without.tasks.find((t) => t.kind === "fuel_shifts")!.text).toBe("Fyll i antal arbetspass för september, så räknas bränslet in");
  });

  it("after payday, also sets aside next month's fuel up to payday (with this month's shifts until next month's are entered)", () => {
    const db = setup();
    const f = fuelUntilPayday(db, "2026-09-26", "2026-10-24")!;
    const oct = monthForecast(db, "2026-10", "2026-09-26", 14).forecast!;
    expect(f.next).toEqual({ month: "2026-10", amount: Math.round(oct.expectedFuel * (23 / 31)), estimated: true });
    expect(f.amount).toBe(f.thisMonth + f.next!.amount);
    setShifts(db, "2026-10", 8);
    expect(fuelUntilPayday(db, "2026-09-26", "2026-10-24")!.next!.estimated).toBe(false);
  });
});

describe("odometer", () => {
  it("compares the km the model gives with the odometer, and suggests other driving when it is off by more than 10 %", () => {
    const db = freshDb({ seeded: true });
    addReading(db, "2025-08-01", 120000);
    addReading(db, "2026-08-10", 129000);
    setShifts(db, "2026-08", 16);
    expect(odometerCheck(db)).toMatchObject({ actualKm: 9000, modelKm: null, suggestedOtherKm: null });
    expect(odometerCheck(db)!.missing).toHaveLength(12);

    for (let m = "2025-08"; m <= "2026-07"; m = addMonths(m, 1)) setShifts(db, m, 16);
    // 12 whole months and 9 of August's 31 days: 16 × 40 × 12.29 + 200 × 12.29 ≈ 10 324 km.
    const c = odometerCheck(db)!;
    expect(c.missing).toEqual([]);
    expect(c.modelKm).toBe(10324);
    expect(c.deviation).toBeCloseTo((10324 - 9000) / 9000, 3);
    expect(c.suggestedOtherKm).toBe(90);

    setFuelSettings(db, { otherKmPerMonth: 90 });
    expect(odometerCheck(db)!.suggestedOtherKm).toBeNull();
  });
});

describe("API", () => {
  it("gives the view everything in one call, and validates what is entered", async () => {
    const db = setup();
    const app = createApp(db, { databasePath: ":memory:" });
    const r = await (await app.request(`/api/fuel?today=${TODAY}`)).json();
    expect(r).toMatchObject({ latestPrice: { date: "2026-09-01", price: 1950, ageDays: 18 }, current: { shifts: 14 }, missing: null });
    // Three months ahead, as far as Kassaflöde reaches (19/9 + 90 days = 18/12).
    expect(r.months[0].month).toBe("2026-12");
    expect(r.months).toHaveLength(16);
    expect(r.months.find((m: { month: string }) => m.month === "2026-07")).toMatchObject({ shifts: 10, spent: 80850, trips: 90000 });
    expect(r.purchases).toEqual([expect.objectContaining({ date: "2026-09-05", amount: 58500, trip: false })]);

    expect((await app.request("/api/fuel/shifts/2026-10", json("PUT", { shifts: 40 }))).status).toBe(400);
    expect((await app.request("/api/fuel/shifts/2026-10", json("PUT", { shifts: 12 }))).status).toBe(200);
    expect((await app.request("/api/fuel/prices", json("POST", { date: "2026-09-19", price: 5 }))).status).toBe(400);
    expect((await app.request("/api/fuel/settings", json("PUT", { otherKmPerMonth: -3 }))).status).toBe(400);
    const history = await (await app.request(`/api/fuel/history?from=2026-06&to=2026-08&today=${TODAY}`)).json();
    expect(history.months.map((m: { month: string; l100: number }) => [m.month, Math.round(m.l100 * 10) / 10])).toEqual([
      ["2026-06", 6],
      ["2026-07", 7],
      ["2026-08", 6.5],
    ]);
    // September isn't over: no consumption yet.
    const sep = await (await app.request(`/api/fuel/history?from=2026-09&to=2026-09&today=${TODAY}`)).json();
    expect(sep.months[0]).toMatchObject({ month: "2026-09", spent: 58500, l100: null, perShift: null });
  });
});
