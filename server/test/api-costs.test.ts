import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, categories, transactions } from "../src/db/schema.js";
import { apiCosts, apiProvider } from "../src/overview/apiCosts.js";
import { setSplits } from "../src/splits.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
const TODAY = "2026-09-24";
let seq = 0;

/** A category API under a top category of its own, as the user has it (not seeded). */
function withApi(db: Db) {
  const top = db.insert(categories).values({ name: "Mjukvara & AI" }).returning().get();
  const api = db.insert(categories).values({ name: "API", parentId: top.id }).returning().get();
  const subs = db.insert(categories).values({ name: "AI-tjänster", parentId: top.id }).returning().get();
  return { api: api.id, subs: subs.id };
}
function buy(db: Db, o: { date: string; amount: number; desc: string; categoryId: number | null; booked?: string }) {
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id,
      bookingDate: o.booked ?? o.date,
      transactionDate: o.date,
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      amount: o.amount,
      categoryId: o.categoryId,
      fingerprint: `api${++seq}`,
    })
    .returning()
    .get();
}

describe("API-kostnader", () => {
  it("knows the providers by the merchant, and goes by the name otherwise", () => {
    expect(["ANTHROPIC", "ANTHROPIC* CLAUDE SUB", "OPENAI *CHATGPT", "GOOGLE*CLOUD KLM", "MISTRAL.AI", "DEEPSEEKAPI", "DeepSeek", "OPENROUTER, INC"].map(apiProvider)).toEqual([
      "Anthropic",
      "Anthropic",
      "OpenAI",
      "Google",
      "Mistral",
      "DeepSeek",
      "DeepSeek",
      "OpenRouter",
    ]);
    expect(apiProvider("TOGETHERAI")).toBe("Together AI");
    expect(apiProvider("NEWLAB*X123")).toBe("Newlab");
  });

  it("the category API per provider and month, the last 12 months, by the purchase day", () => {
    const db = freshDb({ seeded: true });
    const { api, subs } = withApi(db);
    buy(db, { date: "2026-09-02", amount: -10000, desc: "ANTHROPIC", categoryId: api });
    buy(db, { date: "2026-09-05", amount: -6000, desc: "OPENAI", categoryId: api });
    // Bought in August, booked in September: August's.
    buy(db, { date: "2026-08-31", booked: "2026-09-02", amount: -20000, desc: "MISTRAL.AI", categoryId: api });
    buy(db, { date: "2026-08-10", amount: -4000, desc: "ANTHROPIC", categoryId: api });
    // A refund takes off.
    buy(db, { date: "2026-08-12", amount: 1000, desc: "ANTHROPIC", categoryId: api });
    // A subscription is not the API, and older than 12 months is out.
    buy(db, { date: "2026-09-06", amount: -25000, desc: "CLAUDE.AI SUBSCRIPTION", categoryId: subs });
    buy(db, { date: "2025-09-30", amount: -99900, desc: "ANTHROPIC", categoryId: api });
    // The API part of a split purchase.
    const split = buy(db, { date: "2026-09-10", amount: -5000, desc: "GOOGLE*CLOUD", categoryId: null });
    setSplits(db, split.id, [
      { categoryId: api, amount: -3000 },
      { categoryId: subs, amount: -2000 },
    ]);

    const r = apiCosts(db, TODAY);
    expect(r.categoryId).toBe(api);
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe("2025-10");
    expect(r.months.at(-1)).toEqual({ month: "2026-09", total: 19000, byProvider: { Anthropic: 10000, OpenAI: 6000, Google: 3000 } });
    expect(r.months.at(-2)).toEqual({ month: "2026-08", total: 23000, byProvider: { Mistral: 20000, Anthropic: 3000 } });
    expect(r.providers).toEqual([
      { name: "Mistral", thisMonth: 0, year: 20000 },
      { name: "Anthropic", thisMonth: 10000, year: 13000 },
      { name: "OpenAI", thisMonth: 6000, year: 6000 },
      { name: "Google", thisMonth: 3000, year: 3000 },
    ]);
    expect(r).toMatchObject({ thisMonth: 19000, year: 42000, averagePerMonth: Math.round(23000 / 11) });
  });

  it("nothing without a category called API; the API route", async () => {
    const db = freshDb({ seeded: true });
    expect(apiCosts(db, TODAY)).toMatchObject({ categoryId: null, year: 0, providers: [] });
    withApi(db);
    const app = createApp(db, { databasePath: ":memory:" });
    expect(await (await app.request(`/api/overview/api-costs?today=${TODAY}`)).json()).toMatchObject({ month: "2026-09", year: 0 });
  });
});
