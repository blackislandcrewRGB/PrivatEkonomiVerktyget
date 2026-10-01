import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { accounts, categories, merchantRules, receipts, recurringExpenses, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { importFiles } from "../src/import/importBatch.js";
import { importSwedbankCsv } from "../src/import/importSwedbank.js";
import { importUndoStatus } from "../src/import/undoImport.js";
import { linkRecurring } from "../src/recurring/link.js";
import { createApp } from "../src/app.js";
import { allSwedbankFiles, buildCsv, freshDb, metaLine, sampleFile } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;
type App = ReturnType<typeof createApp>;
interface Row {
  id: number;
  bookingDate: string;
  descriptionClean: string;
  counterparty: string | null;
  counterpartyName: string | null;
  amount: number;
  categoryId: number | null;
  categorySource: string;
  shared: boolean;
  isTransfer: boolean;
  isSettlement: boolean;
  returnGroupId: number | null;
  accountId: number;
  source: string;
  note: string | null;
  recurringExpenseName: string | null;
}
interface ListResponse {
  rows: Row[];
  totals: { count: number; in: number; out: number; outByDay: Record<string, number> };
}

// The fixtures' 322 rows (47 of them transfers) and the three extra Swish gifts.
const TOTAL_WITH_TRANSFERS = 325;
const catId = (db: Db, path: string) => getCategoryPathMap(db).get(path)!;
const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** The made-up fixed expenses the tests need: rent and a phone bill from e-sparkonto, a gym, and a subscription on the card (öre). */
const FIXED: { name: string; amount: number; method: "card" | "autogiro" | "transfer"; account: string; day: number; pattern: string; shared?: boolean }[] = [
  { name: "Hyra", amount: 750000, method: "transfer", account: "Swedbank e-sparkonto", day: 25, pattern: "EXEMPELHEM BOSTAD", shared: true },
  { name: "Mobil", amount: 57800, method: "autogiro", account: "Swedbank e-sparkonto", day: 28, pattern: "TELE2" },
  { name: "Gym", amount: 29900, method: "autogiro", account: "Swedbank e-sparkonto", day: 2, pattern: "FITNESS24" },
  { name: "Spotify", amount: 11900, method: "card", account: "Swedbank Privatkonto", day: 15, pattern: "SPOTIFY" },
];

async function fullDb() {
  const db = freshDb({ seeded: true });
  await importFiles(db, [...allSwedbankFiles(), sampleFile("Augusti.xlsx"), sampleFile("September.xlsx")]);
  // Three more Swish gifts from the same unknown number (the fixtures have one), so a rule for the number has rows to apply to.
  const gifts = ["100.00", "50.00", "75.00"].map((amount, i) => ({ date: `2026-09-${String(3 + i * 4).padStart(2, "0")}`, desc: "Swish mottagen +46705550008", ref: "+46705550008", amount }));
  importSwedbankCsv(db, buildCsv(gifts, { meta: metaLine("2026-09-01", "2026-09-18") }), "swish-gifts.csv");
  for (const e of FIXED) {
    db.insert(recurringExpenses)
      .values({
        name: e.name,
        amount: e.amount,
        anchorDay: e.day,
        dateBasis: e.method === "card" ? "transaction" : "booking",
        paymentMethod: e.method,
        accountId: db.select().from(accounts).where(eq(accounts.name, e.account)).get()!.id,
        matchPattern: e.pattern,
        shared: e.shared ?? false,
      })
      .run();
  }
  linkRecurring(db);
  return { db, app: createApp(db, { databasePath: ":memory:" }) };
}

/** Query values are URL-encoded ('+46…' would otherwise become a space). */
const list = async (app: App, query = "") => {
  const qs = query.replace(/^\?/, "").split("&").filter(Boolean).map((kv) => {
    const [k, ...v] = kv.split("=");
    return `${k}=${encodeURIComponent(v.join("="))}`;
  });
  return (await (await app.request(`/api/transactions${qs.length ? `?${qs.join("&")}` : ""}`)).json()) as ListResponse;
};

describe("transaction list filters", () => {
  let db: Db;
  let app: App;
  beforeAll(async () => ({ db, app } = await fullDb()));

  it("hides transfers by default and shows them on request", async () => {
    const all = await list(app, "?transfers=1");
    const visible = await list(app);
    expect(all.totals.count).toBe(TOTAL_WITH_TRANSFERS);
    expect(visible.rows.every((r) => !r.isTransfer)).toBe(true);
    expect(all.totals.count - visible.totals.count).toBe(all.rows.filter((r) => r.isTransfer).length);
  });

  it("limit returns the newest rows but totals over every match", async () => {
    const all = await list(app);
    const few = (await (await app.request("/api/transactions?limit=5")).json()) as ListResponse & { truncated: boolean };
    expect(few.rows.map((r) => r.id)).toEqual(all.rows.slice(0, 5).map((r) => r.id));
    expect(few.totals).toEqual(all.totals);
    expect(few.truncated).toBe(true);
  });

  it("sums exclude transfers and partner settlement money", async () => {
    const { rows, totals } = await list(app, "?transfers=1");
    const counted = rows.filter((r) => !r.isTransfer && !r.isSettlement);
    expect(totals.out).toBe(counted.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));
    expect(rows.some((r) => r.isSettlement)).toBe(true);
  });

  it("filters on recurring, on a receipt, and lists oldest first on request", async () => {
    const aug = "from=2026-08-01&to=2026-08-31";
    const all = await list(app, `?${aug}`);
    const linked = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(sql`booking_date between '2026-08-01' and '2026-08-31' and deleted_at is null and is_transfer = 0 and (recurring_expense_id is not null or recurring_income_id is not null)`)
      .all()
      .map((r) => r.id);
    expect(linked.length).toBeGreaterThan(0);
    const recurring = await list(app, `?${aug}&recurring=1`);
    expect(recurring.rows.map((r) => r.id).sort()).toEqual(linked.sort());
    expect(recurring.totals.count).toBeLessThan(all.totals.count);

    expect((await list(app, `?${aug}&receipt=1`)).rows).toEqual([]);
    const bought = all.rows.find((r) => r.amount < 0)!;
    db.insert(receipts).values({ transactionId: bought.id, store: "lidl", purchaseDate: bought.bookingDate, totalOre: -bought.amount, source: "text", rawText: "" }).run();
    expect((await list(app, `?${aug}&receipt=1`)).rows.map((r) => r.id)).toEqual([bought.id]);
    db.update(receipts).set({ deletedAt: "2026-09-01" }).where(eq(receipts.transactionId, bought.id)).run();
    expect((await list(app, `?${aug}&receipt=1`)).rows).toEqual([]);

    const oldest = await list(app, `?${aug}&order=asc`);
    expect(oldest.rows.map((r) => r.id)).toEqual([...all.rows].reverse().map((r) => r.id));
    expect(oldest.totals).toEqual(all.totals);
  });

  it("gives Ut per booking day, adding up to Ut, also past the limit", async () => {
    const all = await list(app, "?from=2026-08-01&to=2026-08-31");
    const days = Object.entries(all.totals.outByDay);
    expect(days.length).toBeGreaterThan(5);
    expect(days.every(([d, v]) => d.startsWith("2026-08") && v < 0)).toBe(true);
    expect(days.reduce((s, [, v]) => s + v, 0)).toBe(all.totals.out);
    const counted = all.rows.filter((r) => !r.isTransfer && !r.isSettlement && r.returnGroupId === null && r.amount < 0);
    const day = days[0][0];
    expect(all.totals.outByDay[day]).toBe(counted.filter((r) => r.bookingDate === day).reduce((s, r) => s + r.amount, 0));
    const few = (await (await app.request("/api/transactions?from=2026-08-01&to=2026-08-31&limit=3")).json()) as ListResponse;
    expect(few.totals.outByDay).toEqual(all.totals.outByDay);
  });

  it("filters by period, account, source, shared and uncategorised", async () => {
    const aug = await list(app, "?from=2026-08-01&to=2026-08-31");
    expect(aug.rows.every((r) => r.bookingDate >= "2026-08-01" && r.bookingDate <= "2026-08-31")).toBe(true);
    const espar = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!;
    expect((await list(app, `?accountId=${espar.id}`)).rows.every((r) => r.accountId === espar.id)).toBe(true);
    const nor = await list(app, "?source=norwegian");
    expect(nor.rows.length).toBeGreaterThan(0);
    expect(nor.rows.every((r) => r.source === "norwegian")).toBe(true);
    expect((await list(app, "?shared=shared")).rows.every((r) => r.shared)).toBe(true);
    expect((await list(app, "?categoryId=none")).rows.every((r) => r.categoryId === null)).toBe(true);
  });

  it("a main category includes its subcategories", async () => {
    const mat = (await list(app, `?categoryId=${catId(db, "Mat")}`)).rows;
    const paths = new Set(mat.map((r) => [...getCategoryPathMap(db)].find(([, v]) => v === r.categoryId)![0].split("/")[0]));
    expect(paths).toEqual(new Set(["Mat"]));
    expect(mat.length).toBeGreaterThan(50);
  });

  it("free text searches description, contact name (with å/ä/ö) and amount", async () => {
    const marta = await list(app, "?q=mio");
    expect(marta.rows.length).toBe(14);
    expect(marta.rows.every((r) => r.counterpartyName === "Mio")).toBe(true);
    expect((await list(app, "?q=FOLKTANDVÅRD")).rows.length).toBe(1);
    expect((await list(app, "?q=folktandvård")).rows.length).toBe(1);
    const hyra = await list(app, "?q=7500");
    expect(hyra.rows.some((r) => r.descriptionClean.startsWith("EXEMPELHEM BOSTAD"))).toBe(true);
  });

  it("shows which recurring expense a row is linked to (only on the expense's account)", async () => {
    const espar = db.select().from(accounts).where(eq(accounts.name, "Swedbank e-sparkonto")).get()!;
    // The same text on another account (a payment of her own rent from the Privatkonto) is not the fixed expense's.
    db.insert(transactions)
      .values({
        source: "swedbank",
        accountId: db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id,
        bookingDate: "2026-08-25",
        transactionDate: "2026-08-25",
        descriptionRaw: "EXEMPELHEM BOSTAD",
        descriptionClean: "EXEMPELHEM BOSTAD",
        amount: -750000,
        fingerprint: "other-account-rent",
      })
      .run();
    linkRecurring(db);
    const rows = (await list(app, "?q=EXEMPELHEM BOSTAD")).rows;
    expect(rows.some((r) => r.accountId !== espar.id)).toBe(true);
    expect(rows.filter((r) => r.accountId === espar.id).every((r) => r.recurringExpenseName === "Hyra")).toBe(true);
    expect(rows.filter((r) => r.accountId !== espar.id).every((r) => r.recurringExpenseName === null)).toBe(true);
  });
});

describe("editing and rules", () => {
  it("sets a category by hand and suggests a directional rule for Swish", async () => {
    const { db, app } = await fullDb();
    const row = (await list(app, "?q=Swish mottagen +46705550008")).rows[0];
    const res = await app.request(`/api/transactions/${row.id}`, { method: "PATCH", ...json({ categoryId: catId(db, "Inkomst/Övrigt") }) });
    const body = (await res.json()) as { transaction: Row & { manuallyEditedAt: string }; ruleSuggestion: Record<string, unknown> };
    expect(body.transaction).toMatchObject({ categorySource: "manual", categoryId: catId(db, "Inkomst/Övrigt") });
    expect(body.transaction.manuallyEditedAt).toBeTruthy();
    expect(body.ruleSuggestion).toMatchObject({ pattern: "+46705550008", direction: "in", matchType: "contains", matches: 3, existingRuleId: null });

    const saved = (await (await app.request("/api/rules", { method: "POST", ...json(body.ruleSuggestion) })).json()) as { applied: number };
    expect(saved.applied).toBe(3);
    const after = (await list(app, "?q=Swish mottagen +46705550008")).rows;
    expect(after.every((r) => r.categoryId === catId(db, "Inkomst/Övrigt"))).toBe(true);
    // Outgoing Swish to the same number is untouched by an 'in' rule.
    expect((await list(app, "?q=Swish skickad +46705550008")).rows.every((r) => r.categoryId === null)).toBe(true);
  });

  it("suggests the merchant for card rows, and no suggestion when the rule already says so", async () => {
    const { db, app } = await fullDb();
    const [row] = (await list(app, "?q=UBER")).rows;
    const patch = async (id: number, categoryId: number) =>
      (await (await app.request(`/api/transactions/${id}`, { method: "PATCH", ...json({ categoryId }) })).json()) as { ruleSuggestion: { pattern: string; direction: string; matches: number } | null };
    const r = await patch(row.id, catId(db, "Resor/Taxi"));
    // The other UBER row.
    expect(r.ruleSuggestion).toMatchObject({ pattern: "UBER *TRIP", direction: "any", matches: 1 });
    await app.request("/api/rules", { method: "POST", ...json({ ...r.ruleSuggestion, categoryId: catId(db, "Resor/Taxi") }) });
    const [other] = (await list(app, "?q=UBER")).rows.filter((x) => x.id !== row.id);
    expect((await patch(other.id, catId(db, "Resor/Taxi"))).ruleSuggestion).toBeNull();
  });

  it("edits shared and note; a transfer category makes the row a transfer and not shared", async () => {
    const { db, app } = await fullDb();
    const [row] = (await list(app, "?q=WILLYS EXEMPELSTAD&source=norwegian")).rows;
    await app.request(`/api/transactions/${row.id}`, { method: "PATCH", ...json({ shared: false, note: "  bara mitt  " }) });
    expect(db.select().from(transactions).where(eq(transactions.id, row.id)).get()).toMatchObject({ shared: false, note: "bara mitt" });
    await app.request(`/api/transactions/${row.id}`, { method: "PATCH", ...json({ shared: true, categoryId: catId(db, "Överföringar & sparande/Sparande") }) });
    expect(db.select().from(transactions).where(eq(transactions.id, row.id)).get()).toMatchObject({ isTransfer: true, shared: false });
  });

  it("previews how many rows a rule pattern would categorise", async () => {
    const { app } = await fullDb();
    const res = await app.request("/api/rules/preview", { method: "POST", ...json({ pattern: "GOOGLE *YouTubeP", matchType: "contains", direction: "any" }) });
    expect(((await res.json()) as { matches: number }).matches).toBe(6);
  });

  it("rejects an invalid regex rule", async () => {
    const { db, app } = await fullDb();
    const res = await app.request("/api/rules", { method: "POST", ...json({ pattern: "([", matchType: "regex", categoryId: catId(db, "Övrigt") }) });
    expect(res.status).toBe(400);
  });
});

describe("delete and restore", () => {
  it("soft-deletes imported rows, lists them under deleted, and restores", async () => {
    const { db, app } = await fullDb();
    const [row] = (await list(app, "?q=GITHUB")).rows;
    const before = (await list(app)).totals.count;
    expect(((await (await app.request(`/api/transactions/${row.id}`, { method: "DELETE" })).json()) as { deleted: string }).deleted).toBe("soft");
    expect((await list(app)).totals.count).toBe(before - 1);
    expect((await list(app, "?deleted=1")).rows.map((r) => r.id)).toEqual([row.id]);

    // Re-importing does not bring it back.
    await importFiles(db, allSwedbankFiles());
    expect((await list(app)).totals.count).toBe(before - 1);

    await app.request(`/api/transactions/${row.id}/restore`, { method: "POST" });
    expect((await list(app)).totals.count).toBe(before);
    expect((await list(app, "?deleted=1")).rows).toEqual([]);
  });

  it("deletes manual transactions for real", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const manual = db
      .insert(transactions)
      .values({ source: "manual", bookingDate: "2026-09-01", descriptionRaw: "Gåva", descriptionClean: "Gåva", amount: 50000, fingerprint: "manual-1" })
      .returning()
      .get();
    expect(((await (await app.request(`/api/transactions/${manual.id}`, { method: "DELETE" })).json()) as { deleted: string }).deleted).toBe("hard");
    expect(db.select().from(transactions).all()).toEqual([]);
  });
});

describe("forgetting a row", () => {
  const counts = async (app: App) => (await (await app.request("/api/review/counts")).json()) as { deleted: number };

  it("takes it out of the tool entirely, and the next import still leaves it alone", async () => {
    const { db, app } = await fullDb();
    const [row] = (await list(app, "?q=GITHUB")).rows;
    const before = await list(app);

    await app.request(`/api/transactions/${row.id}`, { method: "DELETE" });
    const deleted = await list(app);
    expect((await counts(app)).deleted).toBe(1);

    expect(await (await app.request(`/api/transactions/${row.id}/forget`, { method: "POST" })).json()).toEqual({ forgotten: true });
    // Gone from the deleted list too, and counted nowhere.
    expect((await list(app, "?deleted=1")).rows).toEqual([]);
    expect((await counts(app)).deleted).toBe(0);
    // Forgetting is not money: the sums are the ones the delete left behind.
    expect((await list(app)).totals).toEqual(deleted.totals);
    expect(before.totals.count).toBe(deleted.totals.count + 1);

    // The memory itself: the row is still there, and a re-import doesn't fetch it again.
    const kept = db.select().from(transactions).where(eq(transactions.id, row.id)).get()!;
    expect(kept.forgottenAt).toEqual(expect.any(String));
    expect(kept.deletedAt).toEqual(expect.any(String));
    await importFiles(db, allSwedbankFiles());
    expect((await list(app)).totals.count).toBe(deleted.totals.count);
    expect((await list(app, "?deleted=1")).rows).toEqual([]);
  });

  it("forgets a row that was never deleted first, and marks it deleted as well", async () => {
    const { db, app } = await fullDb();
    const [row] = (await list(app, "?q=GITHUB")).rows;
    await app.request(`/api/transactions/${row.id}/forget`, { method: "POST" });
    const kept = db.select().from(transactions).where(eq(transactions.id, row.id)).get()!;
    expect(kept.deletedAt).toEqual(kept.forgottenAt);
    expect((await list(app)).rows.map((r) => r.id)).not.toContain(row.id);
    expect((await list(app, "?deleted=1")).rows).toEqual([]);
  });

  it("protects the memory: the import it came with can no longer be undone", async () => {
    const { db, app } = await fullDb();
    const [row] = (await list(app, "?q=GITHUB")).rows;
    const importId = db.select().from(transactions).where(eq(transactions.id, row.id)).get()!.importId!;
    await app.request(`/api/transactions/${row.id}/forget`, { method: "POST" });
    expect(importUndoStatus(db, importId)).toMatchObject({ ok: false });
  });

  it("has nothing to remember about a manual row, so it is deleted for real", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    const manual = db
      .insert(transactions)
      .values({ source: "manual", bookingDate: "2026-09-01", descriptionRaw: "Gåva", descriptionClean: "Gåva", amount: 50000, fingerprint: "manual-1" })
      .returning()
      .get();
    await app.request(`/api/transactions/${manual.id}/forget`, { method: "POST" });
    expect(db.select().from(transactions).all()).toEqual([]);
  });

  it("answers 404 for a row that isn't there", async () => {
    const { app } = await fullDb();
    expect((await app.request("/api/transactions/999999/forget", { method: "POST" })).status).toBe(404);
  });
});

describe("review: uncategorised groups", () => {
  it("groups by merchant and direction, most rows first, covering every uncategorised row", async () => {
    const { app } = await fullDb();
    type Group = { merchant: string; direction: string; count: number; sum: number; ids: number[]; name: string | null };
    const groups = (await (await app.request("/api/review/groups")).json()).groups as Group[];
    const counts = (await (await app.request("/api/review/counts")).json()) as { uncategorized: number };
    expect(groups.reduce((s, g) => s + g.count, 0)).toBe(counts.uncategorized);
    expect(groups.map((g) => g.count)).toEqual([...groups.map((g) => g.count)].sort((a, b) => b - a));
    const swish = groups.filter((g) => g.merchant === "+46705550008");
    expect(swish.map((g) => g.direction).sort()).toEqual(["in", "out"]);
    const g = swish.find((x) => x.direction === "in")!;
    expect(g.count).toBe(4);
    expect(g.sum).toBeGreaterThan(0);
  });

  it("categorises a whole group with a rule in one go", async () => {
    const { db, app } = await fullDb();
    type Group = { merchant: string; direction: "in" | "out"; ids: number[]; count: number };
    const groups = (await (await app.request("/api/review/groups")).json()).groups as Group[];
    const g = groups.find((x) => x.merchant === "+46705550008" && x.direction === "out")!;
    const res = await app.request("/api/transactions/categorize", {
      method: "POST",
      ...json({ ids: g.ids, categoryId: catId(db, "Övrigt"), rule: { pattern: g.merchant, matchType: "contains", direction: g.direction } }),
    });
    expect(await res.json()).toMatchObject({ byRule: g.count, manual: 0 });
    expect(db.select().from(merchantRules).where(eq(merchantRules.pattern, "+46705550008")).get()).toMatchObject({ direction: "out", createdFrom: "manual" });
    const regrouped = (await (await app.request("/api/review/groups")).json()).groups as Group[];
    expect(regrouped.find((x) => x.merchant === "+46705550008" && x.direction === "out")).toBeUndefined();
  });

  it("categorises a group by hand without a rule", async () => {
    const { db, app } = await fullDb();
    type Group = { merchant: string; ids: number[]; count: number };
    const [g] = (await (await app.request("/api/review/groups")).json()).groups as Group[];
    const res = await app.request("/api/transactions/categorize", { method: "POST", ...json({ ids: g.ids, categoryId: catId(db, "Övrigt") }) });
    expect(await res.json()).toMatchObject({ byRule: 0, manual: g.count });
    const rows = db.select().from(transactions).where(sql`id in (${sql.join(g.ids.map((id) => sql`${id}`), sql`, `)})`).all();
    expect(rows.every((r) => r.categorySource === "manual" && r.manuallyEditedAt)).toBe(true);
  });
});

describe("review: possible duplicates", () => {
  const first = buildCsv(
    [
      { date: "2026-01-15", bookingDate: "2026-01-16", desc: "CAFE EXEMPEL", amount: "-45.00" },
      { date: "2026-01-20", desc: "SL", amount: "-43.00" },
      { date: "2026-01-20", bookingDate: "2026-01-21", desc: "SL", amount: "-43.00" },
    ],
    { meta: metaLine("2026-01-01", "2026-01-31") },
  );
  const second = buildCsv([{ date: "2026-01-15", bookingDate: "2026-01-17", desc: "CAFE EXEMPEL", amount: "-45.00" }], {
    meta: metaLine("2026-01-01", "2026-01-31"),
  });

  it("lists pairs from different imports only; identical rows in one file are genuine", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    importSwedbankCsv(db, first, "a.csv");
    expect(await (await app.request("/api/review/duplicates")).json()).toEqual([]);
    importSwedbankCsv(db, second, "b.csv");
    const pairs = (await (await app.request("/api/review/duplicates")).json()) as { older: Row; newer: Row }[];
    expect(pairs).toHaveLength(1);
    expect(pairs[0].older.bookingDate).toBe("2026-01-16");
    expect(pairs[0].newer.bookingDate).toBe("2026-01-17");
  });

  it("'ta bort den nyare' and 'behåll båda' both clear the pair", async () => {
    const setup = () => {
      const db = freshDb({ seeded: true });
      importSwedbankCsv(db, first, "a.csv");
      importSwedbankCsv(db, second, "b.csv");
      return { db, app: createApp(db, { databasePath: ":memory:" }) };
    };
    const pairsOf = async (app: App) => (await (await app.request("/api/review/duplicates")).json()) as { older: Row; newer: Row }[];

    const a = setup();
    const [p] = await pairsOf(a.app);
    await a.app.request(`/api/transactions/${p.newer.id}`, { method: "DELETE" });
    expect(await pairsOf(a.app)).toEqual([]);

    const b = setup();
    const [q] = await pairsOf(b.app);
    await b.app.request("/api/review/duplicates/dismiss", { method: "POST", ...json({ olderId: q.older.id, newerId: q.newer.id }) });
    expect(await pairsOf(b.app)).toEqual([]);
    expect(((await (await b.app.request("/api/review/counts")).json()) as { duplicates: number }).duplicates).toBe(0);
  });
});
