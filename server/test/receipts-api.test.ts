import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, receipts, transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { WILLYS_RECEIPT, freshDb, hasPrivateSample, privateSample } from "./helpers.js";

/**
 * /api/receipts. Reading and saving are two calls on purpose: `parse` writes
 * nothing, so the rows can be looked over and corrected first.
 */

type Db = ReturnType<typeof freshDb>;
type App = ReturnType<typeof createApp>;

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/receipts", name), "utf8");
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

interface ParsedResponse {
  store: string;
  storeArea: string | null;
  purchaseDate: string | null;
  receiptDate: string | null;
  totalOre: number | null;
  sumOre: number;
  balances: boolean;
  source: string;
  rawText: string;
  statedItemCount: number | null;
  lines: { kind: string; name: string; totalOre: number; quantityMilli: number | null; unit: string | null; unitPriceOre: number | null }[];
  transaction: { id: number; amountOre: number; matchesTotal: boolean; hasReceipt: boolean } | null;
}

let seq = 0;
function tx(db: Db, amount: number, desc: string, date = "2026-09-05") {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: desc,
      amount,
      fingerprint: `a${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  return { db, app: createApp(db, { databasePath: ":memory:" }) };
}

const parse = async (app: App, body: unknown) => (await (await app.request("/api/receipts/parse", json(body))).json()) as ParsedResponse;

/** Reads a receipt and saves it, the way the panel will (step 3). */
async function save(app: App, text: string, transactionId: number | null) {
  const parsed = await parse(app, { text, transactionId });
  const res = await app.request("/api/receipts", json({ ...parsed, transactionId }));
  return { parsed, res, body: (await res.json()) as Record<string, unknown> };
}

describe("reading a receipt over the API", () => {
  it("answers with the rows and writes nothing", async () => {
    const { db, app } = setup();
    const parsed = await parse(app, { text: fixture("ica.txt") });
    expect(parsed.store).toBe("ica");
    expect(parsed.balances).toBe(true);
    expect(parsed.lines).toHaveLength(6);
    expect(parsed.source).toBe("text");
    expect(db.select().from(receipts).all()).toEqual([]);
  });

  it("says whether the receipt fits the purchase it was read for", async () => {
    const { db, app } = setup();
    const row = tx(db, -9120, "ICA SUPERMARKET EXEMPELSTAD");
    const fits = await parse(app, { text: fixture("ica.txt"), transactionId: row.id });
    expect(fits.transaction).toMatchObject({ id: row.id, amountOre: 9120, matchesTotal: true, hasReceipt: false });

    const other = tx(db, -18772, "LIDL");
    const doesNot = await parse(app, { text: fixture("ica.txt"), transactionId: other.id });
    expect(doesNot.transaction).toMatchObject({ amountOre: 18772, matchesTotal: false });
    // The rows still add up to the receipt; it is the purchase that differs.
    expect(doesNot.balances).toBe(true);
  });

  it("takes the receipt's own date, and the purchase's when it has none", async () => {
    const { db, app } = setup();
    const ica = tx(db, -9120, "ICA SUPERMARKET EXEMPELSTAD", "2026-09-06");
    // ICA writes the date on the receipt: that is the truer source.
    expect((await parse(app, { text: fixture("ica.txt"), transactionId: ica.id })).purchaseDate).toBe("2026-09-05");

    // The copied Lidl text stops before the date, so the purchase's day is used.
    const lidl = tx(db, -18772, "LIDL", "2026-09-15");
    const fromTx = await parse(app, { text: fixture("lidl.txt"), transactionId: lidl.id });
    expect(fromTx.receiptDate).toBeNull();
    expect(fromTx.purchaseDate).toBe("2026-09-15");
  });

  it.skipIf(!hasPrivateSample(WILLYS_RECEIPT))("reads a PDF sent as a file", async () => {
    const { app } = setup();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(privateSample(WILLYS_RECEIPT).bytes)], "kvitto.pdf", { type: "application/pdf" }));
    const parsed = (await (await app.request("/api/receipts/parse", { method: "POST", body: form })).json()) as ParsedResponse;
    expect(parsed.store).toBe("willys");
    expect(parsed.source).toBe("pdf");
    expect(parsed.totalOre).toBe(57825);
    expect(parsed.balances).toBe(true);
    expect(parsed.statedItemCount).toBe(27);
    // The card and membership numbers are gone before the text ever comes back.
    expect(parsed.rawText).not.toContain("9752000000001234");
    expect(parsed.rawText).toContain("KANEL MALEN 85G");
  });

  it("refuses what isn't a receipt, and what isn't a PDF", async () => {
    const { app } = setup();
    const bad = await app.request("/api/receipts/parse", json({ text: "Kaffe 25,00" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/Lidl, ICA, Willys och Rusta/);

    const form = new FormData();
    form.set("file", new File(["inte en pdf"], "kvitto.txt", { type: "text/plain" }));
    const notPdf = await app.request("/api/receipts/parse", { method: "POST", body: form });
    expect(notPdf.status).toBe(400);
    expect(((await notPdf.json()) as { error: string }).error).toMatch(/Bara en PDF/);
  });
});

describe("saving a receipt over the API", () => {
  it("stores the rows and hangs the receipt on the purchase", async () => {
    const { db, app } = setup();
    const row = tx(db, -9120, "ICA SUPERMARKET EXEMPELSTAD");
    const before = db.select().from(transactions).where(eq(transactions.id, row.id)).get();

    const { res, body } = await save(app, fixture("ica.txt"), row.id);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ store: "ica", totalOre: 9120, transactionId: row.id });
    expect((body.lines as unknown[]).length).toBe(6);

    // Metadata, not money: the transaction is untouched.
    expect(db.select().from(transactions).where(eq(transactions.id, row.id)).get()).toEqual(before);

    const forTx = (await (await app.request(`/api/receipts/transaction/${row.id}`)).json()) as { id: number; lines: unknown[] };
    expect(forTx.id).toBe(body.id);
    expect(forTx.lines).toHaveLength(6);
    const list = (await (await app.request("/api/receipts")).json()) as { rows: { id: number; lineCount: number }[] };
    expect(list.rows).toEqual([expect.objectContaining({ id: body.id, lineCount: 6 })]);
  });

  it("refuses rows that no longer add up to the total", async () => {
    const { app } = setup();
    const parsed = await parse(app, { text: fixture("ica.txt") });
    const edited = { ...parsed, lines: parsed.lines.map((l, i) => (i === 0 ? { ...l, totalOre: 1000 } : l)) };
    const res = await app.request("/api/receipts", json(edited));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/kvittot säger 91,20 kr/);
  });

  it("keeps a corrected row when the rows still add up", async () => {
    const { app } = setup();
    const parsed = await parse(app, { text: fixture("ica.txt") });
    // A name read badly is corrected by hand; nothing about the money changes.
    const edited = { ...parsed, lines: parsed.lines.map((l, i) => (i === 0 ? { ...l, name: "Bladspenat 65 g" } : l)) };
    const body = (await (await app.request("/api/receipts", json(edited))).json()) as { lines: { name: string; nameKey: string }[] };
    expect(body.lines[0]).toMatchObject({ name: "Bladspenat 65 g", nameKey: "bladspenat 65 g" });
  });

  it("gives a purchase one receipt", async () => {
    const { db, app } = setup();
    const row = tx(db, -9120, "ICA SUPERMARKET EXEMPELSTAD");
    await save(app, fixture("ica.txt"), row.id);
    const again = await save(app, fixture("ica.txt"), row.id);
    expect(again.res.status).toBe(400);
    expect(again.body.error).toMatch(/redan ett kvitto/);
    // ...and parse says so beforehand, so the panel can offer to replace it.
    expect((await parse(app, { text: fixture("ica.txt"), transactionId: row.id })).transaction).toMatchObject({ hasReceipt: true });
  });

  it("removes and restores", async () => {
    const { db, app } = setup();
    const row = tx(db, -9120, "ICA SUPERMARKET EXEMPELSTAD");
    const { body } = await save(app, fixture("ica.txt"), row.id);
    const id = body.id as number;

    expect(await (await app.request(`/api/receipts/${id}`, { method: "DELETE" })).json()).toEqual({ ok: true });
    expect((await app.request(`/api/receipts/${id}`)).status).toBe(404);
    expect(await (await app.request(`/api/receipts/transaction/${row.id}`)).json()).toBeNull();

    const back = (await (await app.request(`/api/receipts/${id}/restore`, { method: "POST" })).json()) as { id: number; lines: unknown[] };
    expect(back).toMatchObject({ id });
    expect(back.lines).toHaveLength(6);
  });

  it("answers 404 for a receipt that isn't there", async () => {
    const { app } = setup();
    expect((await app.request("/api/receipts/999")).status).toBe(404);
    expect((await app.request("/api/receipts/999", { method: "DELETE" })).status).toBe(404);
  });
});
