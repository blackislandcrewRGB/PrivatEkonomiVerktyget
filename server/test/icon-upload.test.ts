import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { categories, merchantRules, recurringExpenses, transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { backupIcons, MAX_ICON_BYTES } from "../src/icons/upload.js";
import { freshDb } from "./helpers.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "icon-test-"));

/** A 100×50 PNG, red, fully transparent in its right half. */
async function widePng(): Promise<Buffer> {
  const raw = Buffer.alloc(100 * 50 * 4);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) raw.set([255, 0, 0, 255], (y * 100 + x) * 4);
  return sharp(raw, { raw: { width: 100, height: 50, channels: 4 } }).png().toBuffer();
}

function setup() {
  const db = freshDb({ seeded: true });
  const dir = tmp();
  const app = createApp(db, { databasePath: ":memory:", iconsDir: dir });
  const send = (url: string, bytes: Buffer | string, name = "ikon.png", type = "image/png") => {
    const form = new FormData();
    form.append("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type }));
    return app.request(url, { method: "POST", body: form });
  };
  return { db, dir, app, send };
}
const newRule = (db: Db, pattern: string) =>
  db.insert(merchantRules).values({ pattern, categoryId: db.select().from(categories).get()!.id }).returning().get();
const newExpense = (db: Db, name: string, matchPattern: string) =>
  db.insert(recurringExpenses).values({ name, amount: 100, paymentMethod: "card", matchPattern }).returning().get();

describe("icon upload", () => {
  it("scales to 64×64, keeps proportions and transparency, stores it by content hash and serves it with a long cache", async () => {
    const { db, dir, app, send } = setup();
    const rule = newRule(db, "ZZWILLYS");
    const res = await send(`/api/rules/${rule.id}/icon`, await widePng());
    expect(res.status).toBe(200);
    const { iconPath, icon } = await res.json();
    expect(iconPath).toMatch(/^[0-9a-f]{20}\.png$/);
    expect(icon).toEqual({ image: `/api/icons/${iconPath}` });
    const stored = fs.readFileSync(path.join(dir, iconPath));
    const meta = await sharp(stored).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([64, 64, true]);
    // 100×50 in 64×64: 64×32 with transparent bands above and below.
    const { data } = await sharp(stored).raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * 64 + x) * 4 + 3];
    expect(alpha(10, 2)).toBe(0);
    expect(alpha(10, 32)).toBe(255);
    expect(alpha(60, 32)).toBe(0);

    const served = await app.request(`/api/icons/${iconPath}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await served.arrayBuffer()).equals(stored)).toBe(true);
    expect((await app.request("/api/icons/..%2Ffinance.db")).status).toBe(404);
    // The same picture again: the same file.
    expect((await (await send(`/api/rules/${rule.id}/icon`, await widePng())).json()).iconPath).toBe(iconPath);
  });

  it("refuses files over 200 kB and other types, whatever the browser says", async () => {
    const { db, send } = setup();
    const rule = newRule(db, "ZZICA");
    const big = Buffer.concat([await widePng(), Buffer.alloc(MAX_ICON_BYTES)]);
    const tooBig = await send(`/api/rules/${rule.id}/icon`, big);
    expect(tooBig.status).toBe(400);
    expect((await tooBig.json()).error).toMatch(/200 kB/);
    const gif = await send(`/api/rules/${rule.id}/icon`, Buffer.from("GIF89a\x01\x00\x01\x00"), "ikon.png", "image/png");
    expect(gif.status).toBe(400);
    expect((await gif.json()).error).toMatch(/PNG, JPG, WebP eller SVG/);
    expect((await send(`/api/rules/${rule.id}/icon`, "hej", "ikon.txt", "text/plain")).status).toBe(400);
    const script = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    expect((await send(`/api/rules/${rule.id}/icon`, script, "a.svg", "image/svg+xml")).status).toBe(400);
    expect(db.select().from(merchantRules).where(eq(merchantRules.id, rule.id)).get()!.iconPath).toBeNull();
    expect((await send(`/api/rules/99999/icon`, await widePng())).status).toBe(404);
  });

  it("an SVG is drawn to PNG, a JPG gets transparent edges as PNG, a WebP stays WebP", async () => {
    const { db, send } = setup();
    const rule = newRule(db, "ZZCSN");
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="#0a0"/></svg>';
    expect((await (await send(`/api/rules/${rule.id}/icon`, svg, "a.svg", "image/svg+xml")).json()).iconPath).toMatch(/\.png$/);
    const jpg = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    expect((await (await send(`/api/rules/${rule.id}/icon`, jpg, "a.jpg", "image/jpeg")).json()).iconPath).toMatch(/\.png$/);
    const webp = await sharp({ create: { width: 30, height: 30, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).webp().toBuffer();
    expect((await (await send(`/api/rules/${rule.id}/icon`, webp, "a.webp", "image/webp")).json()).iconPath).toMatch(/\.webp$/);
  });

  it("priority 1 → 2 → 3, and a removed picture falls back to the brand or the monogram", async () => {
    const { db, app, send } = setup();
    const spotify = newRule(db, "ZZSPOTIFY");
    db.update(merchantRules).set({ brandSlug: "spotify" }).where(eq(merchantRules.id, spotify.id)).run();
    const pocket = newExpense(db, "Pocket", "ZZSPOTIFY");
    const plain = newRule(db, "ZZPARKSTER");
    db.insert(transactions)
      .values({ source: "swedbank", bookingDate: "2026-09-10", descriptionRaw: "ZZPARKSTER 1", descriptionClean: "ZZPARKSTER 1", amount: -100, fingerprint: "p1" })
      .run();
    const expense = async () => (await (await app.request("/api/recurring-expenses")).json()).find((e: { id: number }) => e.id === pocket.id);
    const row = async () => (await (await app.request("/api/transactions?from=2026-09-01&to=2026-09-30")).json()).rows[0];

    // 2: the rule's brand; the expense knows which rule a 'for all purchases' picture goes to.
    expect(await expense()).toMatchObject({ icon: { brand: "spotify" }, iconRule: { id: spotify.id, pattern: "ZZSPOTIFY", hasImage: false } });
    // 1: a picture on the rule wins over its brand, for the expense too.
    const onRule = (await (await send(`/api/rules/${spotify.id}/icon`, await widePng())).json()).iconPath;
    expect((await expense()).icon).toEqual({ image: `/api/icons/${onRule}` });
    // The expense's own picture wins over the rule's.
    const png2 = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#00f" } }).png().toBuffer();
    const own = (await (await send(`/api/recurring-expenses/${pocket.id}/icon`, png2)).json()).iconPath;
    expect((await expense()).icon).toEqual({ image: `/api/icons/${own}` });
    // Removed: back to the rule's picture, then to the brand.
    await app.request(`/api/recurring-expenses/${pocket.id}/icon`, { method: "DELETE" });
    expect((await expense()).icon).toEqual({ image: `/api/icons/${onRule}` });
    const removed = await (await app.request(`/api/rules/${spotify.id}/icon`, { method: "DELETE" })).json();
    expect(removed).toEqual({ iconPath: null, icon: { brand: "spotify" } });
    expect((await expense()).icon).toEqual({ brand: "spotify" });

    // 3: no brand: nothing, the web draws the monogram; a picture on the rule reaches its rows; removed, back to nothing.
    expect((await row()).icon).toBeUndefined();
    const p = (await (await send(`/api/rules/${plain.id}/icon`, await widePng())).json()).iconPath;
    expect((await row()).icon).toEqual({ image: `/api/icons/${p}` });
    const rules = await (await app.request("/api/rules")).json();
    expect(rules.find((r: { id: number }) => r.id === plain.id)).toMatchObject({ iconPath: p, icon: { image: `/api/icons/${p}` } });
    await app.request(`/api/rules/${plain.id}/icon`, { method: "DELETE" });
    expect((await row()).icon).toBeUndefined();
  });

  it("the backup keeps the icons", async () => {
    const icons = tmp();
    const backups = tmp();
    fs.writeFileSync(path.join(icons, "0123456789abcdef0123.png"), "x");
    fs.writeFileSync(path.join(icons, "annat.txt"), "y");
    expect(backupIcons(icons, backups)).toBe(1);
    expect(fs.readdirSync(path.join(backups, "icons"))).toEqual(["0123456789abcdef0123.png"]);
    expect(backupIcons(icons, backups)).toBe(0);
  });
});
