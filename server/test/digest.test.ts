import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, recurringExpenses, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { buildDigest, lastSent, sendDigest, weekEnding } from "../src/digest/digest.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const SUNDAY = "2026-09-20";
const PRIVAT = "Swedbank Privatkonto";
const acc = (db: Db, name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!.id;

afterEach(() => vi.unstubAllGlobals());

let seq = 0;
function buy(db: Db, date: string, ore: number, desc: string, o: { shared?: boolean; category?: string } = {}) {
  db.insert(transactions)
    .values({
      source: "swedbank",
      accountId: acc(db, PRIVAT),
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount: -ore,
      categoryId: getCategoryPathMap(db).get(o.category ?? "Mat/Livsmedel")!,
      categorySource: "rule",
      shared: o.shared ?? false,
      fingerprint: `d${++seq}`,
    })
    .run();
}

function setup() {
  const db = freshDb({ seeded: true });
  db.update(accounts).set({ balance: 1000000, balanceUpdatedAt: SUNDAY }).where(eq(accounts.name, PRIVAT)).run();
  // The 8 weeks before (27/7–13/9): 8 × 1 000 kr.
  for (let i = 0; i < 8; i++) buy(db, `2026-0${i < 5 ? 8 : 9}-${String(i < 5 ? 3 + i * 7 : 7 + (i - 5) * 3).padStart(2, "0")}`, 100000, "ICA");
  // The week 14–20/9: 500 + 300 + 200 (shared: my part 100) + 50 kr.
  buy(db, "2026-09-14", 50000, "WILLYS");
  buy(db, "2026-09-16", 30000, "COOP");
  buy(db, "2026-09-18", 20000, "LIDL", { shared: true });
  buy(db, "2026-09-20", 5000, "PRESSBYRÅN");
  db.insert(recurringExpenses).values({ name: "Hyra", amount: 750000, anchorDay: 25, accountId: acc(db, PRIVAT), matchPattern: "HYRA", paymentMethod: "autogiro" }).run();
  return db;
}

describe("Veckodigest", () => {
  it("the latest whole week ends on Sunday", () => {
    expect(weekEnding("2026-09-20")).toBe("2026-09-20");
    expect(weekEnding("2026-09-23")).toBe("2026-09-20");
    expect(weekEnding("2026-09-19")).toBe("2026-09-13");
  });

  it("the week: variable spending (my part) against 8 weeks, the three largest, next week's draws, to review, safe to spend", () => {
    const d = buildDigest(setup(), SUNDAY);
    expect(d).toMatchObject({ from: "2026-09-14", to: "2026-09-20", title: "Veckan som gick (14–20/9)", spent: 95000, average: 100000, comingTotal: 750000, review: 0 });
    expect(d.largest.map((l) => [l.name, l.amount])).toEqual([["WILLYS", 50000], ["COOP", 30000], ["LIDL", 20000]]);
    expect(d.coming).toEqual([{ name: "Hyra", date: "2026-09-25", amount: 750000 }]);
    expect(d.lines.map((l) => l.replace(/[  ]/g, " "))).toEqual([
      "**Rörligt, min del:** 950 kr (snitt 8 veckor 1 000 kr, −5 %)",
      "**Största köp:** WILLYS 500 kr, COOP 300 kr, LIDL 200 kr",
      "**Nästa vecka:** 1 dragning, 7 500 kr",
      "Hyra 7 500 kr 25/9",
      "**Att granska:** 0",
      expect.stringMatching(/^\*\*Safe to spend:\*\* .+ \(lägst .+ den \d+\/\d+\)$/),
    ]);
    expect(d.lines.length).toBeLessThanOrEqual(8);
    expect(d.markdown.split("\n")[0]).toBe(`- ${d.lines[0]}`);
  });

  it("is sent to ntfy as Markdown and remembers when; the API sends only with a topic", async () => {
    const db = setup();
    const ntfy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", ntfy);
    const r = await sendDigest(db, SUNDAY, "min-topic", new Date("2026-09-20T17:00:00Z"));
    expect(r.sent).toBe(true);
    const body = JSON.parse((ntfy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ topic: "min-topic", title: "Veckan som gick (14–20/9)", markdown: true });
    expect(body.message.split("\n")).toHaveLength(6);
    expect(lastSent(db)).toBe("2026-09-20T17:00:00.000Z");

    const without = createApp(db, { databasePath: ":memory:" });
    expect((await without.request("/api/digest/send", { method: "POST" })).status).toBe(400);
    expect(await (await without.request(`/api/digest?today=${SUNDAY}`)).json()).toMatchObject({ title: "Veckan som gick (14–20/9)", canSend: false, sentAt: "2026-09-20T17:00:00.000Z" });
    const withTopic = createApp(db, { databasePath: ":memory:", ntfyTopic: "min-topic" });
    expect(await (await withTopic.request("/api/digest/send", { method: "POST" })).json()).toMatchObject({ ok: true });
    expect(ntfy).toHaveBeenCalledTimes(2);
  });
});
