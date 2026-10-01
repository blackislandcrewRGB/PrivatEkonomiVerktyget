import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;

let seq = 0;
function tx(db: Db, o: { desc: string; note?: string; category: string; date?: string; private?: boolean; deleted?: boolean }) {
  const date = o.date ?? "2026-09-10";
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: o.desc,
      descriptionClean: o.desc,
      counterparty: o.desc,
      amount: -10000,
      categoryId: getCategoryPathMap(db).get(o.category)!,
      categorySource: "rule",
      fingerprint: `n${++seq}`,
      note: o.note ?? null,
      private: o.private ?? false,
      deletedAt: o.deleted ? "2026-09-11T00:00:00Z" : null,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  const app = createApp(db, { databasePath: ":memory:" });
  tx(db, { desc: "ICA KVANTUM", note: "MATVAROR", category: "Mat/Livsmedel" });
  tx(db, { desc: "ICA KVANTUM", note: "matvaror", category: "Mat/Livsmedel" });
  tx(db, { desc: "COOP", note: "MATVAROR", category: "Mat/Livsmedel" });
  tx(db, { desc: "CAFE EXEMPEL AB", note: "LUNCH", category: "Mat/Restaurang & café" });
  tx(db, { desc: "SWISH EXEMPELSPEL", note: "SPELKÖP A", category: "Nöje/Spel", date: "2026-09-14" });
  tx(db, { desc: "SWISH EXEMPELSPEL", note: "SPELKÖP B", category: "Nöje/Spel", date: "2026-09-12" });
  tx(db, { desc: "APOTEKET", note: "Hemligt", category: "Mat/Livsmedel", private: true });
  tx(db, { desc: "BORTTAGEN", note: "Borta", category: "Mat/Livsmedel", deleted: true });
  const lidl = tx(db, { desc: "LIDL", category: "Mat/Livsmedel" });
  const swishShop = tx(db, { desc: "SWISH EXEMPELSPEL", category: "Nöje/Spel" });
  const cafe = tx(db, { desc: "CAFE EXEMPEL AB", category: "Mat/Restaurang & café" });
  return { db, app, lidl, swishShop, cafe };
}

const notes = async (app: ReturnType<typeof createApp>, query = "") =>
  (await (await app.request(`/api/transactions/notes${query}`)).json()) as { note: string; count: number }[];

describe("note suggestions", () => {
  it("merges spellings, most used first, and leaves out private and deleted rows", async () => {
    const { app } = setup();
    const res = await notes(app);
    expect(res[0]).toEqual({ note: "MATVAROR", count: 3 });
    expect(res.map((r) => r.note)).not.toContain("matvaror");
    expect(res.map((r) => r.note)).not.toContain("Hemligt");
    expect(res.map((r) => r.note)).not.toContain("Borta");
    expect((await notes(app, "?showPrivate=1")).map((r) => r.note)).toContain("Hemligt");
  });

  it("ranks notes from the same merchant, then the same category, first", async () => {
    const { app, lidl, swishShop, cafe } = setup();
    expect((await notes(app, `?for=${swishShop.id}`)).slice(0, 2).map((r) => r.note)).toEqual(["SPELKÖP A", "SPELKÖP B"]);
    expect((await notes(app, `?for=${cafe.id}`))[0].note).toBe("LUNCH");
    expect((await notes(app, `?for=${lidl.id}`))[0].note).toBe("MATVAROR");
  });
});
