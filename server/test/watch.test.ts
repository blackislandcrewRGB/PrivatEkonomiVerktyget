import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, duplicateDismissals, recurringExpenseMarks, recurringExpenses, transactions, watchFindings } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { linkRecurring } from "../src/recurring/link.js";
import { acceptFinding, dismissFinding, findings, merchantKey, mutedSeries, muteSeries, notification, restoreFinding, runWatch, setWatchKinds, unmuteSeries } from "../src/watch/watch.js";
import { buildOverview } from "../src/overview/overview.js";
import { createApp } from "../src/app.js";
import { buildCsv, freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-19";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;
const PRIVAT = "Swedbank Privatkonto";
const ESPAR = "Swedbank e-sparkonto";
const MASTERCARD = "Swedbank Mastercard Guld";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

let seq = 0;
function tx(db: Db, o: { account?: string; date: string; amount: number; desc: string; category?: string }) {
  const cat = o.category ? getCategoryPathMap(db).get(o.category)! : null;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: acc(db, o.account ?? PRIVAT),
      bookingDate: o.date,
      transactionDate: o.date,
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      counterparty: o.desc,
      amount: o.amount,
      categoryId: cat,
      categorySource: cat ? "rule" : "none",
      fingerprint: `w${++seq}`,
    })
    .returning()
    .get();
}

function expense(db: Db, o: { name: string; amount: number; day: number; account?: string; pattern: string }) {
  return db
    .insert(recurringExpenses)
    .values({ name: o.name, amount: o.amount, anchorDay: o.day, accountId: acc(db, o.account ?? PRIVAT), matchPattern: o.pattern, paymentMethod: "autogiro" })
    .returning()
    .get();
}

/**
 * The findings this file is about.
 *
 * The balance-sheet ones — a buffer under three months, a pension value gone
 * stale — fire on almost any database with a krona of spending in it, and
 * would drown every assertion here. They have their own tests.
 */
const watched = (db: Db, today = TODAY) => findings(db, today).filter((f) => f.kind !== "buffer_low" && f.kind !== "pension_stale");

const kinds = (db: Db, today = TODAY) => watched(db, today).map((f) => [f.kind, f.text.replace(/ /g, " ")]);

describe("Vakt", () => {
  it("merchant keys: the same merchant across varying texts", () => {
    expect(merchantKey({ counterparty: "GOOGLE*CLOUD KLM", descriptionClean: "" })).toBe("google cloud");
    expect(merchantKey({ counterparty: "GOOGLE*CLOUD PQR", descriptionClean: "" })).toBe("google cloud");
    expect(merchantKey({ counterparty: "Podme 5C8-2F40A1", descriptionClean: "" })).toBe("podme");
    expect(merchantKey({ counterparty: "+46701234567", descriptionClean: "Swish skickad" })).toBe("+46701234567");
  });

  it("price drift: a subscription-like merchant off its median by more than 3 %; a varying merchant never", () => {
    const db = freshDb({ seeded: true });
    for (const d of ["2026-05-20", "2026-06-20", "2026-07-20", "2026-08-20"]) tx(db, { date: d, amount: -9900, desc: "NETFLIX.COM" });
    tx(db, { date: "2026-09-19", amount: -10900, desc: "NETFLIX.COM" });
    // Groceries: different amounts every time, so no 'usual price'.
    for (const [d, a] of [["2026-07-01", -21000], ["2026-08-01", -9000], ["2026-08-30", -34000], ["2026-09-18", -50000]] as const) tx(db, { date: d, amount: a, desc: "ICA NARA" });
    // Within 3 %: not drift.
    for (const d of ["2026-06-02", "2026-07-02", "2026-08-02"]) tx(db, { date: d, amount: -10000, desc: "PODME 1" });
    tx(db, { date: "2026-09-02", amount: -10200, desc: "PODME 2" });
    expect(kinds(db)).toEqual([["price_drift", "NETFLIX.COM: 109 kr i stället för 99 kr (+10 %)"]]);
  });

  it("price drift of a fixed expense; 'acceptera nytt belopp' sets the expense's amount and the new price is the baseline", () => {
    const db = freshDb({ seeded: true });
    const e = expense(db, { name: "Spotify", amount: 16900, day: 23, pattern: "SPOTIFY" });
    for (const m of ["05", "06", "07"]) tx(db, { date: `2026-${m}-23`, amount: -16900, desc: "SPOTIFY" });
    const latest = tx(db, { date: "2026-08-24", amount: -18900, desc: "SPOTIFY" });
    linkRecurring(db);
    const [f] = watched(db, "2026-09-10");
    expect(f).toMatchObject({ kind: "price_drift", key: `price_drift:expense:${e.id}:${latest.id}`, expenseId: e.id, oldAmount: 16900, newAmount: 18900 });
    // The overview shows it once: the older 'drogs med ett annat belopp' task steps aside.
    const tasks = buildOverview(db, "2026-09-10").tasks;
    expect(tasks.filter((t) => t.finding?.kind === "price_drift")).toHaveLength(1);
    expect(tasks.some((t) => t.kind === "amount_changed")).toBe(false);

    acceptFinding(db, f.key, "2026-09-10");
    expect(db.select().from(recurringExpenses).where(eq(recurringExpenses.id, e.id)).get()!.amount).toBe(18900);
    expect(watched(db, "2026-09-10")).toEqual([]);
    // Next month at the new price: nothing; at yet another: drift from the accepted amount.
    tx(db, { date: "2026-09-23", amount: -18900, desc: "SPOTIFY" });
    linkRecurring(db);
    expect(watched(db, "2026-09-26")).toEqual([]);
    tx(db, { date: "2026-10-23", amount: -19900, desc: "SPOTIFY" });
    linkRecurring(db);
    expect(kinds(db, "2026-10-26")).toEqual([["price_drift", "Spotify: 199 kr i stället för 189 kr (+5 %)"]]);
  });

  it("'varierar – fråga inte': a series with varying amounts isn't watched, until watched again", () => {
    const db = freshDb({ seeded: true });
    const e = expense(db, { name: "Parkster", amount: 20000, day: 17, pattern: "PARKSTER" });
    for (const m of ["06", "07", "08"]) tx(db, { date: `2026-${m}-17`, amount: -20000, desc: "PARKSTER" });
    tx(db, { date: "2026-09-17", amount: -21500, desc: "PARKSTER" });
    linkRecurring(db);
    const [f] = watched(db, TODAY);
    muteSeries(db, f.key, TODAY);
    expect(watched(db, TODAY)).toEqual([]);
    expect(mutedSeries(db)).toEqual([{ series: `expense:${e.id}`, name: "Parkster" }]);
    unmuteSeries(db, `expense:${e.id}`);
    expect(watched(db, TODAY).map((x) => x.key)).toEqual([f.key]);
  });

  it("a fixed expense whose amount already is the new one isn't asked about", () => {
    const db = freshDb({ seeded: true });
    expense(db, { name: "Hemförsäkring", amount: 23900, day: 31, pattern: "EXEMPEL FÖRSÄKRING" });
    for (const m of ["05-31", "06-30", "07-31"]) tx(db, { date: `2026-${m}`, amount: -12900, desc: "EXEMPEL FÖRSÄKRING" });
    tx(db, { date: "2026-08-31", amount: -23900, desc: "EXEMPEL FÖRSÄKRING" });
    linkRecurring(db);
    expect(watched(db, TODAY).filter((f) => f.kind === "price_drift")).toEqual([]);
  });

  it("double charge: same account, merchant and amount within 2 days; 'behåll båda' also clears the possible duplicate", () => {
    const db = freshDb({ seeded: true });
    const a = tx(db, { date: "2026-09-10", amount: -28500, desc: "EXEMPEL RESTAURANG", category: "Mat/Restaurang & café" });
    const b = tx(db, { date: "2026-09-12", amount: -28500, desc: "EXEMPEL RESTAURANG", category: "Mat/Restaurang & café" });
    tx(db, { date: "2026-09-16", amount: -28500, desc: "EXEMPEL RESTAURANG", category: "Mat/Restaurang & café" }); // 4 days later: not
    tx(db, { account: ESPAR, date: "2026-09-12", amount: -28500, desc: "EXEMPEL RESTAURANG", category: "Mat/Restaurang & café" }); // another account
    expect(kinds(db)).toEqual([["double_charge", "EXEMPEL RESTAURANG: 285 kr dragen två gånger (10/9 och 12/9)"]]);
    const key = `double_charge:${a.id}:${b.id}`;
    dismissFinding(db, key, TODAY);
    expect(watched(db, TODAY)).toEqual([]);
    expect(db.select().from(duplicateDismissals).all()).toEqual([expect.objectContaining({ olderId: a.id, newerId: b.id })]);
    restoreFinding(db, key);
    expect(watched(db, TODAY).map((f) => f.key)).toEqual([key]);
    expect(db.select().from(duplicateDismissals).all()).toEqual([]);
  });

  it("unusual amount: over 500 kr and over 3 × the category's median the 6 months before", () => {
    const db = freshDb({ seeded: true });
    const food = "Mat/Livsmedel";
    ["2026-04-02", "2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02"].forEach((d, i) => tx(db, { date: d, amount: -(15000 + i * 1000), desc: `ICA ${i}`, category: food }));
    tx(db, { date: "2026-09-15", amount: -57800, desc: "WILLYS EXEMPELSTAD", category: food });
    tx(db, { date: "2026-09-16", amount: -40000, desc: "ICA 1", category: food }); // over 3× but under 500 kr
    expect(kinds(db).filter(([k]) => k === "unusual_amount")).toEqual([["unusual_amount", "WILLYS EXEMPELSTAD: 578 kr 15/9, 3 gånger det vanliga för Livsmedel (170 kr)"]]);
  });

  it("new merchant: the first purchase ever, over 300 kr (and only in the last 30 days)", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-03-01", amount: -50000, desc: "ADIDAS SE" });
    tx(db, { date: "2026-09-10", amount: -59800, desc: "ADIDAS SE" }); // not the first
    tx(db, { date: "2026-09-11", amount: -120500, desc: "Exempel Hotels" });
    tx(db, { date: "2026-09-12", amount: -20000, desc: "Nytt Café" }); // under 300 kr
    tx(db, { date: "2026-08-01", amount: -90000, desc: "Gammal Handlare" }); // over 30 days ago
    expect(kinds(db).filter(([k]) => k === "new_merchant")).toEqual([["new_merchant", "Exempel Hotels: första köpet, 1 205 kr 11/9"]]);
  });

  it("missed draw: 3 days after the day, only when the account's data reaches that far; ticked off it goes", () => {
    const db = freshDb({ seeded: true });
    const gym = expense(db, { name: "Gym", amount: 59900, day: 10, pattern: "GYM" });
    tx(db, { date: "2026-08-10", amount: -59900, desc: "GYM" });
    linkRecurring(db);
    tx(db, { date: "2026-09-12", amount: -1000, desc: "Kaffe" });
    // The account's data reaches 12/9, before 13/9 (the day + 3): unknown yet.
    expect(watched(db, TODAY)).toEqual([]);
    tx(db, { date: "2026-09-14", amount: -1500, desc: "Kaffe" });
    expect(kinds(db)).toEqual([["missed_charge", "Gym (599 kr) skulle dragits 10/9 från Swedbank Privatkonto men syns inte"]]);
    expect(watched(db, "2026-09-13")).toEqual([]); // not 3 days yet
    db.insert(recurringExpenseMarks).values({ recurringExpenseId: gym.id, period: "2026-09" }).run();
    expect(watched(db, TODAY)).toEqual([]);
  });

  it("a subscription not drawn two periods in a row: 'avslutat? pausa' instead of its missed months", () => {
    const db = freshDb({ seeded: true });
    const splice = expense(db, { name: "Splice", amount: 15903, day: 20, account: MASTERCARD, pattern: "SPLICE" });
    for (const m of ["04", "05", "06"]) tx(db, { account: MASTERCARD, date: `2026-${m}-20`, amount: -15903, desc: "SPLICE" });
    linkRecurring(db);
    tx(db, { account: MASTERCARD, date: "2026-09-18", amount: -5000, desc: "Annat" });
    expect(watched(db, TODAY).map((f) => [f.kind, f.key])).toEqual([["subscription_stopped", `subscription_stopped:${splice.id}:2026-06`]]);
    expect(kinds(db)[0][1]).toBe("Splice har inte dragits sedan juni – avslutat? Pausa den i verktyget");
    db.update(recurringExpenses).set({ paused: true }).where(eq(recurringExpenses.id, splice.id)).run();
    expect(watched(db, TODAY)).toEqual([]);
  });

  it("yearly: a reminder within its days before the date, gone when paid ahead or turned off; a bill says 'betald senast'", () => {
    const db = freshDb({ seeded: true });
    const yearly = (o: { name: string; amount: number; day: number; month: number; pattern: string; method?: "card" | "transfer"; account?: string; remindDays?: number | null }) =>
      db
        .insert(recurringExpenses)
        .values({ name: o.name, amount: o.amount, anchorDay: o.day, anchorMonth: o.month, billingCycle: "yearly", accountId: acc(db, o.account ?? PRIVAT), matchPattern: o.pattern, paymentMethod: o.method ?? "card", remindDays: o.remindDays ?? null })
        .returning()
        .get();
    const iptv = yearly({ name: "TV-paketet", amount: 180000, day: 1, month: 10, pattern: "EXEMPELTV" });
    const tax = yearly({ name: "Bilskatt", amount: 284000, day: 30, month: 9, pattern: "FORDONSSKATT", method: "transfer", account: ESPAR });
    const far = yearly({ name: "TiviMate", amount: 13900, day: 20, month: 6, pattern: "GOOGLE", account: MASTERCARD });
    expect(kinds(db)).toEqual([
      ["yearly_renewal", "TV-paketet förnyas 1/10 (1 800 kr), om 12 dagar – behålla den?"],
      ["yearly_renewal", "Bilskatt (2 840 kr) ska vara betald senast 30/9, om 11 dagar"],
    ]);
    expect(watched(db, TODAY).find((f) => f.expenseId === tax.id)).toMatchObject({ invoice: true, period: "2026-09", yearly: true });
    expect(watched(db, TODAY).some((f) => f.expenseId === far.id)).toBe(false);
    // Paid ahead: linked, no reminder.
    tx(db, { account: ESPAR, date: "2026-09-10", amount: -284000, desc: "FORDONSSKATT EXEMPEL" });
    linkRecurring(db);
    expect(watched(db, TODAY).map((f) => f.expenseId)).toEqual([iptv.id]);
    // Fewer days: not yet; 0: never.
    db.update(recurringExpenses).set({ remindDays: 7 }).where(eq(recurringExpenses.id, iptv.id)).run();
    expect(watched(db, TODAY)).toEqual([]);
    expect(kinds(db, "2026-09-25")).toEqual([["yearly_renewal", "TV-paketet förnyas 1/10 (1 800 kr), om 6 dagar – behålla den?"]]);
    db.update(recurringExpenses).set({ remindDays: 0 }).where(eq(recurringExpenses.id, iptv.id)).run();
    expect(watched(db, "2026-09-30")).toEqual([]);
  });

  it("a watched subscription asks before every charge, until it is paused", () => {
    const db = freshDb({ seeded: true });
    // A subscription started for a while: warn me before it takes money again.
    const podme = db
      .insert(recurringExpenses)
      .values({
        name: "Podme",
        amount: 9900,
        anchorDay: 22,
        accountId: acc(db, PRIVAT),
        matchPattern: "Podme",
        paymentMethod: "card",
        dateBasis: "transaction",
        remindBeforeCharge: true,
      })
      .returning()
      .get();

    // Three days before, and not a day earlier: it is a reminder to act on.
    expect(watched(db, "2026-09-18")).toEqual([]);
    expect(kinds(db)).toEqual([["charge_coming", "Podme dras 22/9 (99 kr), om 3 dagar – säga upp den innan dess?"]]);
    expect(kinds(db, "2026-09-22")).toEqual([["charge_coming", "Podme dras 22/9 (99 kr), i dag – säga upp den innan dess?"]]);
    // The key holds the charge, so a dismissed question comes back next month.
    expect(watched(db, TODAY)[0].key).toBe(`charge_coming:${podme.id}:2026-09`);
    expect(watched(db, "2026-10-20")[0].key).toBe(`charge_coming:${podme.id}:2026-10`);

    // Drawn already: nothing left to say about that one.
    tx(db, { date: "2026-09-19", amount: -9900, desc: "Podme 5C8-2F40A1" });
    linkRecurring(db);
    expect(watched(db, TODAY).some((f) => f.kind === "charge_coming")).toBe(false);

    // Cancelled and paused: the question stops for good.
    db.update(recurringExpenses).set({ paused: true }).where(eq(recurringExpenses.id, podme.id)).run();
    expect(watched(db, "2026-10-20")).toEqual([]);
  });

  it("only asks for the ones being watched, and never twice for a yearly one", () => {
    const db = freshDb({ seeded: true });
    const make = (o: Record<string, unknown>) =>
      db
        .insert(recurringExpenses)
        .values({ name: "X", amount: 9900, anchorDay: 22, accountId: acc(db, PRIVAT), paymentMethod: "card", ...o } as never)
        .returning()
        .get();
    // Not watched: a fixed expense one knows about doesn't need warning about.
    make({ name: "Spotify", matchPattern: "SPOTIFY" });
    // Watched, but the reminder is turned off.
    make({ name: "Podme", matchPattern: "Podme", remindBeforeCharge: true, remindDays: 0 });
    // Yearly: `yearly_renewal` already asks, and asks better (14 days).
    make({ name: "TV-paketet", matchPattern: "EXEMPELTV", remindBeforeCharge: true, billingCycle: "yearly", anchorMonth: 10, anchorDay: 1 });
    expect(kinds(db)).toEqual([["yearly_renewal", "TV-paketet förnyas 1/10 (99 kr), om 12 dagar – behålla den?"]]);
  });

  it("yearly: a missed renewal 10 days after its date (bills are paid ahead), once it has been drawn before; pausable", () => {
    const db = freshDb({ seeded: true });
    const wu = db
      .insert(recurringExpenses)
      .values({ name: "Kursappen", amount: 29900, anchorDay: 30, anchorMonth: 6, billingCycle: "yearly", accountId: acc(db, PRIVAT), matchPattern: "KURSAPP", paymentMethod: "card", remindDays: 0 })
      .returning()
      .get();
    tx(db, { date: "2025-06-30", amount: -29900, desc: "KURSAPP EXEMPEL" });
    linkRecurring(db);
    tx(db, { date: "2026-07-12", amount: -1000, desc: "Kaffe" });
    expect(watched(db, "2026-07-09")).toEqual([]); // within the 10 days
    expect(watched(db, "2026-07-12").map((f) => [f.kind, f.text.replace(/ /g, " "), f.yearly])).toEqual([
      ["missed_charge", "Kursappen (299 kr per år) skulle dragits 30/6 från Swedbank Privatkonto men syns inte", true],
    ]);
    expect(watched(db, "2026-10-30")).toEqual([]); // older than 90 days
    // Drawn late, still within its window: linked, nothing missed.
    tx(db, { date: "2026-07-08", amount: -30500, desc: "KURSAPP EXEMPEL" });
    linkRecurring(db);
    expect(watched(db, "2026-07-12")).toEqual([]);
    expect(db.select().from(transactions).where(eq(transactions.recurringExpenseId, wu.id)).all()).toHaveLength(2);
  });

  it("each kind can be turned off", () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-09-11", amount: -120500, desc: "Exempel Hotels" });
    expect(watched(db, TODAY)).toHaveLength(1);
    setWatchKinds(db, { new_merchant: false });
    expect(watched(db, TODAY)).toEqual([]);
  });

  it("a run remembers what it found and notifies the new ones together, once", async () => {
    const db = freshDb({ seeded: true });
    tx(db, { date: "2026-09-11", amount: -120500, desc: "Exempel Hotels" });
    tx(db, { date: "2026-09-12", amount: -59800, desc: "ADIDAS SE" });
    const ntfy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", ntfy);
    const first = await runWatch(db, TODAY, "min-topic");
    expect(first).toMatchObject({ notified: true });
    expect(first.fresh).toHaveLength(2);
    expect(ntfy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((ntfy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ topic: "min-topic", title: "Vakt: 2 nya fynd" });
    expect(body.message.split("\n")).toHaveLength(2);
    // Nothing new: no notification.
    expect((await runWatch(db, TODAY, "min-topic")).fresh).toEqual([]);
    expect(ntfy).toHaveBeenCalledTimes(1);
    expect(db.select().from(watchFindings).all()).toHaveLength(2);
  });

  it("a notification has at most 8 lines", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, kind: "new_merchant" as const, text: `Fynd ${i}`, date: TODAY }));
    const n = notification(many);
    expect(n.title).toBe("Vakt: 11 nya fynd");
    expect(n.message.split("\n")).toHaveLength(8);
    expect(n.message.split("\n").at(-1)).toBe("• … och 4 till");
  });

  it("an import runs it (no topic: no notification); the API dismisses and turns kinds off", async () => {
    const db = freshDb({ seeded: true });
    const ntfy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", ntfy);
    // A fixed day: on the real one, the seeded pension value (28/11 2025) goes stale from 28/11 2026.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-19T10:00:00"));
    const app = createApp(db, { databasePath: ":memory:" });
    const today = "2026-09-19";
    const csv = buildCsv([{ date: today, desc: "Helt Ny Handlare", amount: "-1234.00" }], { meta: null });
    const form = new FormData();
    form.append("files", new File([new Uint8Array(csv)], "Transaktioner_2026.csv"));
    await app.request("/api/imports", { method: "POST", body: form });
    expect(ntfy).not.toHaveBeenCalled();
    expect(db.select().from(watchFindings).all().map((r) => r.kind)).toEqual(["new_merchant"]);

    const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    const { findings: list } = await (await app.request("/api/watch")).json();
    await app.request("/api/watch/dismiss", json({ key: list[0].key }));
    expect((await (await app.request("/api/watch")).json()).findings).toEqual([]);
    const s = await (await app.request("/api/watch/settings", { ...json({ kinds: { double_charge: false } }), method: "PUT" })).json();
    expect(s.kinds).toMatchObject({ double_charge: false, new_merchant: true });
  });
});
