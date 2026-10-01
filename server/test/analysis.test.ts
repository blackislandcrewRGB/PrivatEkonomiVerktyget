import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, imports, recurringExpenses, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import {
  averages,
  byCategoryAndMonth,
  comparePeriods,
  fixedVariable,
  food,
  incompleteMonths,
  loadRows,
  topMerchants,
  wholePeriods,
} from "../src/analysis/analysis.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-18";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const cat = (db: Db, path: string) => getCategoryPathMap(db).get(path)!;

let seq = 0;
function tx(
  db: Db,
  o: {
    date: string;
    amount: number;
    desc?: string;
    category?: string;
    account?: string;
    shared?: boolean;
    forOther?: boolean;
    private?: boolean;
    isTransfer?: boolean;
    paidBy?: "me" | "partner";
    label?: string;
    recurringExpenseId?: number;
  },
) {
  return db
    .insert(transactions)
    .values({
      source: o.paidBy === "partner" ? "manual" : "swedbank",
      accountId: o.paidBy === "partner" ? null : acc(db, o.account ?? "Swedbank Privatkonto"),
      bookingDate: o.date,
      transactionDate: o.date,
      descriptionRaw: o.desc ?? "X",
      descriptionClean: o.desc ?? "X",
      counterparty: o.desc ?? "X",
      label: o.label ?? null,
      amount: o.amount,
      categoryId: o.category ? cat(db, o.category) : null,
      categorySource: o.category ? "rule" : "none",
      shared: o.shared ?? false,
      forOther: o.forOther ?? false,
      private: o.private ?? false,
      isTransfer: o.isTransfer ?? false,
      paidBy: o.paidBy ?? "me",
      recurringExpenseId: o.recurringExpenseId ?? null,
      fingerprint: `a${++seq}`,
    })
    .returning()
    .get();
}

describe("ground rules", () => {
  it("leaves out transfers, partner settlement and what the partner paid; counts shared at half for 'mine'", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -10000, desc: "ICA", category: "Mat/Livsmedel" });
    tx(db, { date: "2026-08-10", amount: -8000, desc: "WILLYS", category: "Mat/Livsmedel", shared: true });
    tx(db, { date: "2026-08-10", amount: -6000, desc: "HENNES", category: "Mat/Livsmedel", forOther: true });
    tx(db, { date: "2026-08-10", amount: -50000, desc: "SPAR", category: "Överföringar & sparande/Sparande", isTransfer: true });
    tx(db, { date: "2026-08-10", amount: -9000, desc: "Swish Mio", category: "Till partner" });
    tx(db, { date: "2026-08-10", amount: -7000, desc: "APOTEK", paidBy: "partner", shared: true });
    const mine = loadRows(db, "2026-08-01", "2026-08-31", "mine");
    expect(mine.map((r) => [r.merchant, r.amount])).toEqual([
      ["ICA", -10000],
      ["WILLYS", -4000],
    ]);
    const household = loadRows(db, "2026-08-01", "2026-08-31", "household");
    expect(household.map((r) => [r.merchant, r.amount])).toEqual([
      ["ICA", -10000],
      ["WILLYS", -8000],
      ["HENNES", -6000],
    ]);
  });

  it("counts private rows in sums but never lists them by name", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -40000, desc: "GULDSMED", category: "Prylar & hem", private: true });
    tx(db, { date: "2026-08-11", amount: -10000, desc: "KJELL", category: "Prylar & hem" });
    const m = topMerchants(db, "2026-08-01", "2026-08-31", "mine", false);
    expect(m.pieces.map((x) => x.key)).toEqual(["KJELL"]);
    expect(m.private).toEqual({ count: 1, total: 40000 });
    expect(topMerchants(db, "2026-08-01", "2026-08-31", "mine", true).pieces.map((x) => x.key)).toEqual(["GULDSMED", "KJELL"]);
    const byCat = byCategoryAndMonth(db, TODAY, 12, "mine", null);
    const aug = byCat.data.find((d) => d.month === "2026-08")!;
    expect(aug[String(cat(db, "Prylar & hem"))]).toBe(50000);
  });

  it("shows Okänt as its own entry, not under Övrigt", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -1000, category: "Övrigt/Okänt" });
    tx(db, { date: "2026-08-10", amount: -2000, category: "Övrigt" });
    tx(db, { date: "2026-08-10", amount: -3000 });
    const aug = byCategoryAndMonth(db, TODAY, 12, "mine", null).data.find((d) => d.month === "2026-08")!;
    expect(aug.unknown).toBe(1000);
    expect(aug[String(cat(db, "Övrigt"))]).toBe(2000);
    expect(aug.none).toBe(3000);
    expect(aug.total).toBe(6000);
  });
});

describe("per category and month", () => {
  it("has the last 12 months and drills down into subcategories", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-09-02", amount: -10000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-09-03", amount: -5000, category: "Mat/Restaurang & café" });
    tx(db, { date: "2026-09-04", amount: -1000, category: "Mat" });
    tx(db, { date: "2026-09-05", amount: 2000, category: "Mat/Livsmedel" }); // refund
    tx(db, { date: "2025-09-30", amount: -99900, category: "Mat/Livsmedel" }); // 13 months ago: outside
    const top = byCategoryAndMonth(db, TODAY, 12, "mine", null);
    expect(top.months).toHaveLength(12);
    expect(top.months[0]).toBe("2025-10");
    expect(top.series.map((s) => s.name)).toEqual(["Mat"]);
    expect(top.data.at(-1)).toMatchObject({ month: "2026-09", [String(cat(db, "Mat"))]: 14000, total: 14000 });
    const drill = byCategoryAndMonth(db, TODAY, 12, "mine", cat(db, "Mat"));
    expect(drill.parent).toEqual({ id: cat(db, "Mat"), name: "Mat" });
    expect(drill.data.at(-1)).toMatchObject({
      [String(cat(db, "Mat/Livsmedel"))]: 8000,
      [String(cat(db, "Mat/Restaurang & café"))]: 5000,
      [`self:${cat(db, "Mat")}`]: 1000,
      total: 14000,
    });
  });

  it("draws subcategories in lighter tones of the main category, and ends at ?to= for a custom period", async () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-03-10", amount: -10000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-03-11", amount: -5000, category: "Mat/Restaurang & café" });
    const drill = byCategoryAndMonth(db, TODAY, 12, "mine", cat(db, "Mat"));
    const colors = drill.series.filter((s) => !s.key.startsWith("self:")).map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.every((c) => c.startsWith("#") && c.toLowerCase() !== "#117733")).toBe(true);

    const app = createApp(db, { databasePath: ":memory:" });
    const res = (await (await app.request("/api/analysis/categories?months=3&to=2026-04-15")).json()) as { months: string[]; data: { total: number }[] };
    expect(res.months).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(res.data[1].total).toBe(15000);
  });
});

describe("averages", () => {
  it("only counts whole weeks (Monday–Sunday) and whole months up to yesterday", () => {
    // 2026-06-03 is a Wednesday; the first whole week starts Monday 8 June.
    const p = wholePeriods("2026-06-03", "2026-09-18", TODAY);
    expect(p.weeks[0]).toEqual({ from: "2026-06-08", to: "2026-06-14" });
    expect(p.weeks.at(-1)).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(p.weeks).toHaveLength(14);
    expect(p.months).toEqual(["2026-07", "2026-08"]);
  });

  it("averages per week and month, per source and per category, and says how many periods", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-07-10", amount: -30000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-08-10", amount: -10000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-08-12", amount: -20000, category: "Bil", account: "Bank Norwegian" });
    tx(db, { date: "2026-09-10", amount: -99900, category: "Bil" }); // September isn't a whole month yet
    const a = averages(db, "2026-07-01", "2026-09-18", TODAY, "mine");
    expect(a.months).toEqual({ count: 2, list: ["2026-07", "2026-08"] });
    expect(a.total.perMonth).toBe(30000);
    const privat = a.bySource.find((s) => s.name === "Swedbank Privatkonto")!;
    expect(privat.perMonth).toBe(20000);
    expect(a.bySource.find((s) => s.name === "Bank Norwegian")!.perMonth).toBe(10000);
    // The kind of account, for its wallet colour.
    expect(privat.kind).toBe("bank");
    expect(a.bySource.find((s) => s.name === "Bank Norwegian")!.kind).toBe("credit_card");
    const mat = a.byCategory.find((c) => c.name === "Mat")!;
    expect(mat).toMatchObject({ parentKey: null, perMonth: 20000 });
    expect(a.byCategory.find((c) => c.name === "Livsmedel")).toMatchObject({ parentKey: String(cat(db, "Mat")), perMonth: 20000 });
    // Colours as in Per kategori: the main category's own, a subcategory's a tone of it.
    const livsmedel = a.byCategory.find((c) => c.name === "Livsmedel")!;
    expect(mat.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(livsmedel.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(a.weeks.count).toBeGreaterThan(8);
  });

  it("marks months the latest import doesn't fully cover", () => {
    const db = freshDb({ seeded: true });
    db.insert(imports).values({ source: "norwegian", filename: "a", periodFrom: "2026-07-01", periodTo: "2026-08-20" }).run();
    db.insert(imports).values({ source: "swedbank", filename: "b", periodFrom: "2026-07-01", periodTo: "2026-09-17" }).run();
    expect(incompleteMonths(db, "2026-07-01", "2026-09-18", TODAY)).toEqual({ swedbank: [], norwegian: ["2026-08", "2026-09"], mastercard: [], csv: [] });
    // Before the first import, and a gap between two exports; a month export starting on the 2nd still covers the month.
    db.insert(imports).values({ source: "norwegian", filename: "c", periodFrom: "2026-04-02", periodTo: "2026-04-29" }).run();
    expect(incompleteMonths(db, "2026-03-01", "2026-07-31", TODAY).norwegian).toEqual(["2026-03", "2026-05", "2026-06"]);
  });
});

describe("food", () => {
  it("compares groceries with restaurants and takeaway per month, with the share not cooked at home", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -30000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-08-11", amount: -10000, category: "Mat/Restaurang & café" });
    tx(db, { date: "2026-08-12", amount: -10000, category: "Mat/Hämtmat" });
    tx(db, { date: "2026-09-11", amount: -5000, category: "Mat/Restaurang & café", shared: true });
    const f = food(db, "2026-08-01", "2026-09-30", "mine");
    expect(f.months).toEqual([
      { month: "2026-08", groceries: 30000, restaurants: 10000, takeaway: 10000, outShare: 0.4 },
      { month: "2026-09", groceries: 0, restaurants: 2500, takeaway: 0, outShare: 1 },
    ]);
    expect(f.total.outShare).toBeCloseTo(22500 / 52500);
  });
});

describe("fixed and variable", () => {
  it("splits spending by matched fixed charges, with income, net and the fixed share of income", () => {
    const db = freshDb({ seeded: true });
    const rent = db.insert(recurringExpenses).values({ name: "Hyra", amount: 700000, paymentMethod: "transfer", shared: true }).returning().get();
    tx(db, { date: "2026-08-25", amount: -700000, category: "Boende/Hyra", shared: true, recurringExpenseId: rent.id });
    tx(db, { date: "2026-08-12", amount: -100000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-08-24", amount: 2500000, category: "Inkomst/Lön" });
    tx(db, { date: "2026-08-26", amount: 500000, category: "Inkomst/Från partner" }); // settlement: never income
    const mine = fixedVariable(db, "2026-08-01", "2026-08-31", "mine").months[0];
    expect(mine).toEqual({ month: "2026-08", fixed: 350000, variable: 100000, income: 2500000, net: 2050000, fixedShareOfIncome: 0.14 });
    expect(fixedVariable(db, "2026-08-01", "2026-08-31", "household").months[0].fixed).toBe(700000);
  });
});

describe("top merchants", () => {
  it("sends purchases per bank text, name, category and town, with the categories they use", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -10000, desc: "ICA NARA", category: "Mat/Livsmedel" });
    tx(db, { date: "2026-08-12", amount: -12000, desc: "ICA NARA", category: "Mat/Livsmedel" });
    tx(db, { date: "2026-08-20", amount: -20000, desc: "ICA NARA", category: "Mat/Livsmedel", label: "Veckohandling" });
    tx(db, { date: "2026-08-15", amount: -5000, desc: "PRESSBYRAN" });
    tx(db, { date: "2026-08-16", amount: 3000, desc: "ICA NARA", category: "Mat/Livsmedel" }); // refund: not a purchase
    const m = topMerchants(db, "2026-08-01", "2026-08-31", "mine", false);
    const food = cat(db, "Mat/Livsmedel");
    // In the order of the first purchase of each piece.
    expect(m.pieces.map(({ icon: _, ...p }) => p)).toEqual([
      { key: "ICA NARA", label: null, contactName: null, categoryId: food, area: null, count: 2, total: 22000, lastDate: "2026-08-12" },
      { key: "PRESSBYRAN", label: null, contactName: null, categoryId: null, area: null, count: 1, total: 5000, lastDate: "2026-08-15" },
      { key: "ICA NARA", label: "Veckohandling", contactName: null, categoryId: food, area: null, count: 1, total: 20000, lastDate: "2026-08-20" },
    ]);
    expect(m.categories.map((c) => c.name).sort()).toEqual(["Livsmedel", "Mat"]);
  });
});

describe("compare two periods", () => {
  it("gives the difference per category in kronor and percent", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -30000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-07-10", amount: -20000, category: "Mat/Livsmedel" });
    tx(db, { date: "2026-07-11", amount: -5000, category: "Bil" });
    const c = comparePeriods(db, { from: "2026-08-01", to: "2026-08-31" }, { from: "2026-07-01", to: "2026-07-31" }, "mine");
    expect(c.rows.find((r) => r.name === "Mat")).toMatchObject({ a: 30000, b: 20000, diff: 10000, pct: 0.5 });
    expect(c.rows.find((r) => r.name === "Livsmedel")).toMatchObject({ a: 30000, b: 20000 });
    expect(c.rows.find((r) => r.name === "Bil")).toMatchObject({ a: 0, b: 5000, diff: -5000, pct: -1 });
    expect(c.total).toMatchObject({ a: 30000, b: 25000, diff: 5000, pct: 0.2 });
    // The total's Δ is the main categories' summed.
    const mains = c.rows.filter((r) => r.parentKey === null);
    expect(mains.reduce((s, r) => s + r.diff, 0)).toBe(c.total.diff);
  });

  it("scales B for an average: August against the twelve months before, as a twelfth", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -30000, category: "Mat/Livsmedel" });
    // 12 × 200 kr over September to August before.
    for (let m = 8; m <= 19; m++) tx(db, { date: `${2025 + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, "0")}-15`, amount: -20000, category: "Mat/Livsmedel" });
    const c = comparePeriods(db, { from: "2026-08-01", to: "2026-08-31" }, { from: "2025-08-01", to: "2026-07-31" }, "mine", 1 / 12);
    expect(c.rows.find((r) => r.name === "Mat")).toMatchObject({ a: 30000, b: 20000, diff: 10000, pct: 0.5 });
  });
});

describe("API", () => {
  it("answers every view", async () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-08-10", amount: -30000, category: "Mat/Livsmedel" });
    const app = createApp(db, { databasePath: ":memory:" });
    const q = `from=2026-06-01&to=2026-09-18&today=${TODAY}`;
    for (const path of ["categories", "averages", "food", "fixed-variable", "merchants", "compare?aFrom=2026-08-01&aTo=2026-08-31&bFrom=2026-07-01&bTo=2026-07-31"]) {
      const res = await app.request(`/api/analysis/${path}${path.includes("?") ? "&" : "?"}${q}`);
      expect(res.status, path).toBe(200);
    }
    expect((await app.request("/api/analysis/compare")).status).toBe(400);
  });
});
