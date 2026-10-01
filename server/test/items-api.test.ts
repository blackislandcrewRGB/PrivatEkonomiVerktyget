import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { accounts, contacts, itemAttachments, transactions } from "../src/db/schema.js";
import { getCategoryPathMap } from "../src/db/seed.js";
import { createApp } from "../src/app.js";
import { addAttachment, createItem } from "../src/items/items.js";
import { MAX_ATTACHMENTS_PER_ITEM } from "../src/items/attachments.js";
import { freshDb, tinyPdf } from "./helpers.js";

type Db = ReturnType<typeof freshDb>;

// Everything an upload writes goes to a folder of its own under /tmp; nothing
// in these tests ever comes near data/.
const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privatekonomi-items-test-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
});

let seq = 0;
function tx(db: Db, values: { amount: number; desc: string; date?: string; label?: string; categoryPath?: string; counterparty?: string }) {
  const accountId = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!.id;
  const date = values.date ?? "2026-08-31";
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      accountId,
      bookingDate: date,
      transactionDate: date,
      descriptionRaw: values.desc,
      descriptionClean: values.desc,
      counterparty: values.counterparty ?? values.desc,
      label: values.label ?? null,
      amount: values.amount,
      categoryId: values.categoryPath ? getCategoryPathMap(db).get(values.categoryPath)! : null,
      categorySource: values.categoryPath ? "rule" : "none",
      fingerprint: `a${++seq}`,
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb({ seeded: true });
  const dir = tempDir();
  const app = createApp(db, { databasePath: ":memory:", attachmentsDir: dir, iconsDir: tempDir() });
  return { db, app, dir };
}

const oura = { name: "Ovalring Gen 4", category: "Elektronik", purchaseDate: "2026-08-31", priceOre: 449000, merchant: "Amazon" };

/** A real picture, small but a proper PNG. */
const png = (w = 900, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 80, b: 160 } } }).png().toBuffer();

const form = (bytes: Buffer, filename: string, kind?: string) => {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], filename));
  if (kind) fd.set("kind", kind);
  return { method: "POST", body: fd };
};

describe("prylar over the API", () => {
  it("creates, lists and filters", async () => {
    const { app } = setup();
    await app.request("/api/items", json("POST", oura));
    await app.request("/api/items", json("POST", { name: "Skrivbordslampa", category: "Inredning & verktyg", purchaseDate: "2025-11-20", priceOre: 129900, owner: "shared", status: "broken" }));

    const all = (await (await app.request("/api/items")).json()) as any;
    expect(all.items.map((i: any) => i.name)).toEqual(["Ovalring Gen 4", "Skrivbordslampa"]);
    expect(all.totals).toEqual({ count: 2, priceOre: 578900, soldOre: 0 });
    expect(all.years).toEqual(["2026", "2025"]);
    expect(all.categories).toEqual(["Elektronik", "Inredning & verktyg"]);
    // The choices offered are the subcategories under 'Prylar & hem'.
    expect(all.categoryOptions).toEqual(["Elektronik", "Frakt", "Inredning & verktyg", "Kläder"]);

    const only = async (query: string) => ((await (await app.request(`/api/items?${query}`)).json()) as any).items.map((i: any) => i.name);
    expect(await only("year=2026")).toEqual(["Ovalring Gen 4"]);
    expect(await only("category=Elektronik")).toEqual(["Ovalring Gen 4"]);
    expect(await only("owner=shared")).toEqual(["Skrivbordslampa"]);
    expect(await only("status=owned")).toEqual(["Ovalring Gen 4"]);
    expect(await only("q=amaz")).toEqual(["Ovalring Gen 4"]);
    expect(await only("q=lampa&year=2025")).toEqual(["Skrivbordslampa"]);
    // The filters' own choices are the same however the list is filtered.
    const filtered = (await (await app.request("/api/items?year=2026")).json()) as any;
    expect(filtered.years).toEqual(["2026", "2025"]);
    expect(filtered.totals.priceOre).toBe(449000);
  });

  it("says what is wrong, and changes only what was sent", async () => {
    const { app } = setup();
    const bad = await app.request("/api/items", json("POST", { ...oura, purchaseUrl: "javascript:alert(1)" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toMatch(/http/);

    const item = (await (await app.request("/api/items", json("POST", oura))).json()) as any;
    const patched = (await (await app.request(`/api/items/${item.id}`, json("PATCH", { status: "sold", soldPriceOre: 200000 }))).json()) as any;
    expect(patched.status).toBe("sold");
    expect(patched.name).toBe("Ovalring Gen 4");
    expect(patched.warrantyEndsOn).toBeNull();

    expect((await app.request(`/api/items/${item.id}`, json("DELETE"))).status).toBe(200);
    expect((await app.request(`/api/items/${item.id}`)).status).toBe(404);
    // 'Ångra' puts it back with everything it had.
    const back = (await (await app.request(`/api/items/${item.id}/restore`, json("POST"))).json()) as any;
    expect(back.name).toBe("Ovalring Gen 4");
    expect((await app.request(`/api/items/${item.id}`)).status).toBe(200);
  });

  it("fills the dialog from a transaction, and leaves the transaction alone when it is linked", async () => {
    const { db, app } = setup();
    const purchase = tx(db, { amount: -449000, desc: "AMAZON EU", date: "2026-08-31", categoryPath: "Prylar & hem/Elektronik" });
    const before = db.select().from(transactions).where(eq(transactions.id, purchase.id)).get();

    const draft = (await (await app.request(`/api/items/suggest/${purchase.id}`)).json()) as any;
    expect(draft).toMatchObject({ name: "AMAZON EU", merchant: "AMAZON EU", priceOre: 449000, purchaseDate: "2026-08-31", bookedDate: "2026-08-31", category: "Elektronik" });

    const item = (await (await app.request("/api/items", json("POST", { ...oura, transactionIds: [purchase.id] }))).json()) as any;
    expect(item.transactionIds).toEqual([purchase.id]);

    const refund = tx(db, { amount: 449000, desc: "AMAZON EU RETUR", date: "2026-09-10" });
    await app.request(`/api/items/${item.id}/transactions`, json("POST", { transactionId: refund.id }));
    const full = (await (await app.request(`/api/items/${item.id}`)).json()) as any;
    expect(full.transactions.map((t: any) => t.id)).toEqual([purchase.id, refund.id]);

    // Nothing at all happened to the money.
    expect(db.select().from(transactions).where(eq(transactions.id, purchase.id)).get()).toEqual(before);

    // The list carries the pryl, which is what the row's marker is drawn from.
    const list = (await (await app.request("/api/transactions?from=2026-08-01&to=2026-09-30")).json()) as any;
    expect(list.rows.find((r: any) => r.id === purchase.id).items).toEqual([{ id: item.id, name: "Ovalring Gen 4" }]);
    expect(list.rows.find((r: any) => r.id === refund.id).items).toEqual([{ id: item.id, name: "Ovalring Gen 4" }]);

    const unlinked = (await (await app.request(`/api/items/${item.id}/transactions/${refund.id}`, json("DELETE"))).json()) as any;
    expect(unlinked.transactionIds).toEqual([purchase.id]);
    expect((await app.request(`/api/items/${item.id}/transactions/${refund.id}`, json("DELETE"))).status).toBe(404);
  });

  // A Swish sent on Saturday is booked on Monday. The thing was bought on the
  // Saturday — that is what a warranty runs from — but every list shows the
  // Monday, so both dates are sent and the dialog can say which is which.
  it("dates the pryl the day of the purchase, and says which day it was booked", async () => {
    const { db, app } = setup();
    const swish = db
      .insert(transactions)
      .values({
        source: "swedbank",
        bookingDate: "2026-09-14",
        transactionDate: "2026-09-12",
        descriptionRaw: "Swish Exempelbutiken",
        descriptionClean: "Swish Exempelbutiken",
        counterparty: "Swish Exempelbutiken",
        amount: -6490,
        fingerprint: "swish-1",
      })
      .returning()
      .get();
    const draft = (await (await app.request(`/api/items/suggest/${swish.id}`)).json()) as any;
    expect(draft).toMatchObject({ purchaseDate: "2026-09-12", bookedDate: "2026-09-14" });
  });

  it("takes the label and the contact's name when there are any", async () => {
    const { db, app } = setup();
    db.insert(contacts).values({ counterparty: "+46705550001", name: "Kjell & Company" }).run();
    const purchase = tx(db, { amount: -29900, desc: "Swish skickad +46705550001", counterparty: "+46705550001", label: "USB-C-kabel", categoryPath: "Mat/Livsmedel" });
    const draft = (await (await app.request(`/api/items/suggest/${purchase.id}`)).json()) as any;
    expect(draft).toMatchObject({ name: "USB-C-kabel", merchant: "Kjell & Company", priceOre: 29900 });
    // Mat › Livsmedel says nothing about what the thing is, so no category is suggested.
    expect(draft.category).toBeNull();
    expect((await app.request("/api/items/suggest/9999")).status).toBe(404);
  });
});

describe("pictures and receipts over the API", () => {
  it("stores a picture as WebP with a thumbnail, and serves both", async () => {
    const { app, dir } = setup();
    const item = (await (await app.request("/api/items", json("POST", oura))).json()) as any;
    const res = await app.request(`/api/items/${item.id}/attachments`, form(await png(), "IMG_0042.PNG"));
    expect(res.status).toBe(200);
    const a = (await res.json()) as any;
    expect(a.kind).toBe("image");
    expect(a.originalFilename).toBe("IMG_0042.PNG");
    expect(a.url).toMatch(new RegExp(`^/api/attachments/${item.id}/[0-9a-f]{20}\\.webp$`));
    expect(fs.existsSync(path.join(dir, a.filePath))).toBe(true);
    expect(fs.existsSync(path.join(dir, a.thumbnailPath))).toBe(true);
    expect((await sharp(fs.readFileSync(path.join(dir, a.thumbnailPath))).metadata()).width).toBe(480);

    const served = await app.request(a.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("cache-control")).toMatch(/immutable/);

    // The picture is the item's cover in the gallery.
    const listed = ((await (await app.request("/api/items")).json()) as any).items[0];
    expect(listed.cover).toBe(a.thumbnailUrl);
    expect(listed.attachmentCount).toBe(1);
  });

  // A product picture copied from a shop is often a screenshot with a wide
  // white margin; the thing itself should fill its card.
  it("cuts a plain border away, and leaves a picture that is already tight alone", async () => {
    const { app, dir } = setup();
    const item = (await (await app.request("/api/items", json("POST", oura))).json()) as any;
    const size = async (file: string) => {
      const m = await sharp(fs.readFileSync(path.join(dir, file))).metadata();
      return `${m.width}x${m.height}`;
    };

    // A 400×300 subject in the middle of a 1200×900 white sheet.
    const subject = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 20, g: 90, b: 160 } } }).png().toBuffer();
    const padded = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: subject, gravity: "center" }])
      .png()
      .toBuffer();
    const trimmed = (await (await app.request(`/api/items/${item.id}/attachments`, form(padded, "skarmbild.png"))).json()) as any;
    expect(await size(trimmed.filePath)).toBe("400x300");

    // The same subject on its own: nothing to cut, nothing cut.
    const tight = (await (await app.request(`/api/items/${item.id}/attachments`, form(subject, "produkt.png"))).json()) as any;
    expect(await size(tight.filePath)).toBe("400x300");
  });

  it("keeps a receipt as a PDF and serves it sandboxed", async () => {
    const { app } = setup();
    const item = (await (await app.request("/api/items", json("POST", oura))).json()) as any;
    const a = (await (await app.request(`/api/items/${item.id}/attachments`, form(tinyPdf(), "kvitto.pdf"))).json()) as any;
    expect(a.kind).toBe("receipt");
    expect(a.url).toMatch(/\.pdf$/);
    // macOS renders the first page as the thumbnail; without that the view draws a PDF symbol.
    if (process.platform === "darwin") expect(a.thumbnailUrl).toMatch(/-thumb\.webp$/);
    else expect(a.thumbnailUrl).toBeNull();

    const served = await app.request(a.url);
    expect(served.headers.get("content-type")).toBe("application/pdf");
    expect(served.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(Buffer.from(await served.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    // A PDF is not a cover picture, but it counts as a file.
    const listed = ((await (await app.request("/api/items")).json()) as any).items[0];
    expect(listed.cover).toBeNull();
    expect(listed.attachmentCount).toBe(1);
  });

  it("refuses what it can't show, what is too big, and too many", async () => {
    const { db, app } = setup();
    const item = (await (await app.request("/api/items", json("POST", oura))).json()) as any;

    const text = await app.request(`/api/items/${item.id}/attachments`, form(Buffer.from("inte en bild"), "anteckning.txt"));
    expect(text.status).toBe(400);
    expect(((await text.json()) as any).error).toMatch(/JPG, PNG, WebP, HEIC eller PDF/);

    // A real PNG header on 11 MB: the size is checked before anything is decoded.
    const huge = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(11 * 1024 * 1024)]);
    const big = await app.request(`/api/items/${item.id}/attachments`, form(huge, "stor.png"));
    expect(big.status).toBe(400);
    expect(((await big.json()) as any).error).toMatch(/högst 10 MB/);

    expect((await app.request("/api/items/9999/attachments", form(await png(), "x.png"))).status).toBe(404);

    for (let i = 0; i < MAX_ATTACHMENTS_PER_ITEM; i++) addAttachment(db, item.id, { kind: "image", filePath: `${item.id}/${i}.webp` });
    const full = await app.request(`/api/items/${item.id}/attachments`, form(await png(), "en-till.png"));
    expect(full.status).toBe(400);
    expect(((await full.json()) as any).error).toMatch(/Högst 20 bilagor/);
  });

  it("removes one file at a time and serves nothing outside its folder", async () => {
    const { db, app, dir } = setup();
    const item = (await (await app.request("/api/items", json("POST", oura))).json()) as any;
    const a = (await (await app.request(`/api/items/${item.id}/attachments`, form(await png(), "bild.png"))).json()) as any;

    expect((await app.request(`/api/items/${item.id}/attachments/${a.id}`, json("DELETE"))).status).toBe(200);
    expect(((await (await app.request(`/api/items/${item.id}`)).json()) as any).attachments).toEqual([]);
    // Soft delete: the row and the file are both still there.
    expect(db.select().from(itemAttachments).all()).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, a.filePath))).toBe(true);
    // Someone else's attachment id is not mine to remove.
    const other = createItem(db, { ...oura, name: "Annan pryl" });
    expect((await app.request(`/api/items/${other.id}/attachments/${a.id}`, json("DELETE"))).status).toBe(404);

    for (const bad of ["/api/attachments/1/..%2f..%2ffinance.db", "/api/attachments/1/hemlig.txt", "/api/attachments/x/aaaaaaaaaaaaaaaaaaaa.webp"]) {
      expect((await app.request(bad)).status).toBe(404);
    }
  });

  it.runIf(process.platform === "darwin")("reads an iPhone's HEIC", async () => {
    const { app } = setup();
    const item = (await (await app.request("/api/items", json("POST", oura))).json()) as any;
    const dir = tempDir();
    const jpg = path.join(dir, "in.jpg");
    fs.writeFileSync(jpg, await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 120, b: 90 } } }).jpeg().toBuffer());
    const { execFileSync } = await import("node:child_process");
    execFileSync("sips", ["-s", "format", "heic", jpg, "--out", path.join(dir, "in.heic")]);

    const a = (await (await app.request(`/api/items/${item.id}/attachments`, form(fs.readFileSync(path.join(dir, "in.heic")), "IMG_1234.HEIC"))).json()) as any;
    expect(a.kind).toBe("image");
    // Stored as WebP: what came in is never what is served back.
    expect(a.url).toMatch(/\.webp$/);
    expect((await app.request(a.url)).headers.get("content-type")).toBe("image/webp");
  });
});
