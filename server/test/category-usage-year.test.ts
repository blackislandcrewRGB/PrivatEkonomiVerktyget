import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { categories, transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Usage = Record<string, { count12: number; sum12: number; countYtd: number; sumYtd: number }>;

describe("category usage over 12 months and this year", () => {
  afterEach(() => vi.useRealTimers());

  it("counts a row this year in both, last autumn in 12 months only, and older in neither", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00"));
    const db = freshDb({ seeded: true });
    const food = db.select().from(categories).where(eq(categories.name, "Livsmedel")).get()!;
    let n = 0;
    const add = (bookingDate: string, amount: number) =>
      db.insert(transactions).values({ source: "manual", bookingDate, descriptionRaw: "x", descriptionClean: "x", amount, categoryId: food.id, fingerprint: `u${++n}`, occurrenceIndex: 1 }).run();
    add("2026-03-01", -10_000);
    add("2026-09-25", -5_000);
    add("2025-12-01", -20_000);
    add("2025-01-10", -40_000);

    const app = createApp(db, { databasePath: ":memory:" });
    const usage = (await (await app.request("/api/categories/usage")).json()) as Usage;
    expect(usage[food.id]).toMatchObject({ count12: 3, sum12: -35_000, countYtd: 2, sumYtd: -15_000 });
  });
});
