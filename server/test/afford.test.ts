import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, recurringIncome, transactions } from "../src/db/schema.js";
import { affordability, setRedBelowMonths, type AffordInput } from "../src/afford/afford.js";
import { setCash } from "../src/savings/portfolio.js";
import { snapshot } from "../src/afford/snapshot.js";
import { getPartnerName } from "../src/settings.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-19";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;

/**
 * 10 000 kr on the bank accounts (6 000 kr of it on the e-sparkonto, the
 * buffer account), the salary 25 000 kr on the 24th, rent 7 000 kr on the
 * 25th; no spending pace. The lowest point is today's 10 000 kr; the buffer
 * 2 000 kr. The savings limit is 0 unless a test sets it.
 */
function base() {
  const db = freshDb({ seeded: true });
  db.update(accounts).set({ balance: 400000, balanceUpdatedAt: TODAY }).where(eq(accounts.name, "Swedbank Privatkonto")).run();
  db.update(accounts).set({ balance: 600000, balanceUpdatedAt: TODAY }).where(eq(accounts.name, "Swedbank e-sparkonto")).run();
  db.insert(recurringIncome).values({ name: "Lön", amount: 2500000, dayOfMonth: 24, accountId: acc(db, "Swedbank e-sparkonto"), matchPattern: "LÖN" }).run();
  db.insert(recurringExpenses)
    .values({ name: "Hyra", amount: 700000, anchorDay: 25, accountId: acc(db, "Swedbank e-sparkonto"), matchPattern: "HYRA", paymentMethod: "transfer" })
    .run();
  setRedBelowMonths(db, 0);
  return db;
}
/** The reasons with plain spaces (the amounts are grouped with a no-break space). */
const ask = (db: Db, o: Partial<AffordInput>) => {
  const r = affordability(db, TODAY, { amount: 500000, date: TODAY, accountId: null, shared: false, funding: "cash", partner: true, ...o });
  return { ...r, reasons: r.reasons.map((x) => x.replace(/\s/g, " ")) };
};

describe("Har jag råd?", () => {
  it("green when the cash flow stays over the buffer; yellow under it; red under zero, with ISK as the way out", () => {
    const db = base();
    const green = ask(db, { amount: 500000 });
    expect(green).toMatchObject({ verdict: "green", headline: "Ja, det ryms", before: { lowest: { balance: 1000000 }, safeToSpend: 800000 }, after: { lowest: { balance: 500000 }, safeToSpend: 300000 } });
    expect(green.reasons[0]).toBe("Kassaflödet håller sig över bufferten: lägst 5 000 kr den 19/9, safe to spend 3 000 kr efter köpet.");
    // Where it lands on the 90th day, without and with the purchase.
    expect(green.before.end.date).toBe(green.horizon);
    expect(green.after.end).toEqual({ date: green.horizon, balance: green.before.end.balance - 500000 });
    // The salary the verdict counts on.
    expect(green.salary).toMatchObject({ date: "2026-09-24", amount: 2500000, forecast: true });
    expect(green.reasons.at(-1)).toBe("Räknar med lön 24/9 på 25 000 kr, en prognos.");

    expect(ask(db, { amount: 900000 })).toMatchObject({ verdict: "yellow", headline: "Ja, men det går under bufferten" });
    const red = ask(db, { amount: 1200000 });
    expect(red).toMatchObject({ verdict: "red", headline: "Nej, inte från kassaflödet", alternative: { funding: "savings", verdict: "yellow" } });
    expect(red.reasons[0]).toBe("Kassaflödet går under noll: lägst −2 000 kr den 19/9 (utan köpet 10 000 kr).");
    expect(red.reasons[1]).toMatch(/^Tas pengarna från sparandet på ISK blir det gult/);
    // After the salary it fits.
    expect(ask(db, { amount: 1200000, date: "2026-09-24" }).verdict).toBe("green");
  });

  it("yellow while the bank accounts can't pay it: wait for the salary (the Avanza cash takes a day to move)", () => {
    const db = base();
    setCash(db, "isk", TODAY, 1000000);
    const r = ask(db, { amount: 1200000 });
    expect(r).toMatchObject({ verdict: "yellow", headline: "Ja, efter 24/9", waitUntil: "2026-09-24" });
    expect(r.reasons[0]).toBe("Det ryms, men pengarna finns på bankkontona först 24/9.");
  });

  it("on a card it is paid on the invoice's pay day; a shared one costs half once Mio has paid", () => {
    const db = base();
    const norwegian = acc(db, "Bank Norwegian");
    const r = ask(db, { amount: 1200000, accountId: norwegian });
    expect(r).toMatchObject({ verdict: "green", payment: { payDate: "2026-10-25", card: "Bank Norwegian" } });
    expect(r.reasons).toContain("På Bank Norwegian dras det 25/10.");
    // Paid in October: September's 1st-of-month figure is untouched, from 1/11 it is 12 000 kr less.
    expect(r.monthStarts.slice(0, 2).map((m) => m.before - m.after)).toEqual([0, 1200000]);
    expect(r.reasons).toContain("Kvar vid månadsskiftet 1/11 blir 34 000 kr (utan köpet 46 000 kr).");
    const shared = ask(db, { amount: 1200000, accountId: norwegian, shared: true });
    expect(shared).toMatchObject({ netCost: 600000, payment: { partnerDate: "2026-10-25", partnerHalf: 600000 } });
    expect(shared.reasons).toContain("På Bank Norwegian dras det 25/10, och Mios halva 6 000 kr kommer tillbaka 25/10.");
    // Without her payments, nothing comes back.
    expect(ask(db, { amount: 1200000, accountId: norwegian, shared: true, partner: false }).netCost).toBe(1200000);
  });

  it("from the savings on ISK: yellow at best, red when the money would last under the limit", () => {
    const db = base();
    const r = ask(db, { amount: 1200000, funding: "savings" });
    expect(r).toMatchObject({ verdict: "yellow", headline: "Ja, med pengar från sparandet", after: { lowest: { balance: 1000000 } } });
    // Left on the 1st, 28 000 kr (10 000 + the salary 25 000 − the rent 7 000), less 12 000 kr: 2,3 months of 7 000 kr.
    setRedBelowMonths(db, 3);
    const red = ask(db, { amount: 1200000, funding: "savings" });
    expect(red).toMatchObject({ verdict: "red", headline: "Nej, sparandet räcker inte" });
    expect(red.reasons[0]).toBe("Pengarna räcker 2,3 månader med sparandet efter köpet, under gränsen 3 månader.");
    // Measured against what would have to be paid: spending that could be cut doesn't shorten it.
    for (const m of ["06", "07", "08"]) {
      db.insert(transactions)
        .values({ source: "manual", accountId: acc(db, "Swedbank Privatkonto"), bookingDate: `2026-${m}-10`, descriptionRaw: "köp", descriptionClean: "köp", amount: -1_000_000, fingerprint: `af${m}` })
        .run();
    }
    expect(ask(db, { amount: 1200000, funding: "savings" }).reasons[0]).toBe("Pengarna räcker 2,3 månader med sparandet efter köpet, under gränsen 3 månader.");
  });

  it("the API, and the limit in the settings", async () => {
    const db = base();
    const app = createApp(db, { databasePath: ":memory:" });
    const r = await (await app.request(`/api/afford?today=${TODAY}&amount=500000&date=${TODAY}`)).json();
    expect(r.verdict).toBe("green");
    expect((await app.request(`/api/afford?today=${TODAY}&amount=0`)).status).toBe(400);
    expect((await app.request(`/api/afford?today=${TODAY}&amount=100&date=2026-09-01`)).status).toBe(400);
    expect((await app.request(`/api/afford?today=${TODAY}&amount=100&accountId=999`)).status).toBe(400);
    expect((await app.request(`/api/afford?today=${TODAY}&amount=100&funding=loan`)).status).toBe(400);
    const put = (body: object) => app.request("/api/afford/settings", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect(await (await put({ redBelowMonths: 6 })).json()).toEqual({ redBelowMonths: 6 });
    expect((await put({ redBelowMonths: -1 })).status).toBe(400);
    expect(await (await app.request("/api/afford/settings")).json()).toEqual({ redBelowMonths: 6 });
  });

  it("Kopiera läget: the position as Markdown, rounded, without names; with the purchase and the verdict", async () => {
    const db = base();
    const plain = snapshot(db, TODAY).replace(/\s/g, " ");
    expect(plain).toContain("# Ekonomiskt läge 19/9 2026");
    // How the month is counted, so the reader counts the same way.
    expect(plain).toContain("## Så räknar jag");
    expect(plain).toContain("Kortfakturorna (Bank Norwegian och Mastercard) hör till nästa månads lön");
    expect(plain).toContain("- 1/10, när septembers räkningar är betalda: 28 000 kr");
    setCash(db, "isk", TODAY, 430_000);
    expect(snapshot(db, TODAY).replace(/\s/g, " ")).toContain("- 1/10, när septembers räkningar är betalda: 32 300 kr (varav 4 300 kr på ISK)");
    expect(plain).toContain("- Bankkonton: 10 000 kr");
    expect(plain).toContain("- 24/9: lön 25 000 kr (uppskattning)");
    expect(plain).toContain("- Lägsta punkt: 10 000 kr den 19/9");
    expect(plain).toMatch(/Hur ser mitt ekonomiska läge ut/);

    const shared = ask(db, { amount: 1234567, accountId: acc(db, "Bank Norwegian"), shared: true });
    const md = snapshot(db, TODAY, affordability(db, TODAY, shared.input)).replace(/\s/g, " ");
    // Rounded to hundreds, the partner never by name.
    expect(md).toContain("- 12 300 kr den 19/9, på Bank Norwegian, dras 25/10, delat med partnern, från kassaflödet");
    expect(md).toContain("partnerns halva");
    expect(md).not.toContain(getPartnerName(db));
    expect(md).toMatch(/Har jag råd med det här köpet\?/);

    const app = createApp(db, { databasePath: ":memory:" });
    expect((await (await app.request(`/api/afford/snapshot?today=${TODAY}`)).json()).markdown).toContain("## Pengar nu");
    expect((await app.request(`/api/afford/snapshot?today=${TODAY}&amount=-5`)).status).toBe(400);
  });
});
