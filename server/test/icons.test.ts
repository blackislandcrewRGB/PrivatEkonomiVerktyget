import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { categories, contacts, merchantRules, recurringExpenses, transactions } from "../src/db/schema.js";
import { BRAND_SLUGS, brandFor } from "../src/icons/brands.js";
import { brandIconsModule } from "../src/icons/generate.js";
import { assignBrandSlugs, iconResolver } from "../src/icons/icons.js";
import { createApp } from "../src/app.js";
import { freshDb } from "./helpers.js";

let seq = 0;
function tx(db: Db, desc: string, amount = -10000, o: { counterparty?: string; date?: string } = {}) {
  return db
    .insert(transactions)
    .values({
      source: "swedbank",
      bookingDate: o.date ?? "2026-09-10",
      transactionDate: o.date ?? "2026-09-10",
      descriptionRaw: desc,
      descriptionClean: desc,
      counterparty: o.counterparty ?? desc,
      amount,
      fingerprint: `i${++seq}`,
    })
    .returning()
    .get();
}
const categoryId = (db: Db) => db.select().from(categories).get()!.id;
function rule(db: Db, pattern: string, o: { brandSlug?: string; iconPath?: string; matchType?: "contains" | "regex" } = {}) {
  return db
    .insert(merchantRules)
    .values({ pattern, categoryId: categoryId(db), matchType: o.matchType ?? "contains", brandSlug: o.brandSlug ?? null, iconPath: o.iconPath ?? null })
    .returning()
    .get();
}

describe("brand icons", () => {
  it("every slug is in simple-icons, and the web's module is generated from exactly these", async () => {
    const text = await brandIconsModule(BRAND_SLUGS);
    const committed = fs.readFileSync(path.resolve(import.meta.dirname, "../../web/src/generated/brandIcons.ts"), "utf8");
    expect(committed).toBe(text);
    await expect(brandIconsModule(["willys"])).rejects.toThrow(/willys/);
  });

  it("the merchant's text gives the built-in brand, sub-brands before their parent", () => {
    expect(brandFor("GOOGLE *YouTubePremium")).toBe("youtube");
    expect(brandFor("GOOGLE *Google Play Ap")).toBe("googleplay");
    expect(brandFor("GOOGLE*CLOUD KLM")).toBe("googlecloud");
    expect(brandFor("GOOGLE *Google One")).toBe("google");
    expect(brandFor("K*SpotifySE")).toBe("spotify");
    expect(brandFor("LIDL271EXEMPELSTOCKSU")).toBe("lidl");
    expect(brandFor("ANTHROPIC* CLAUDE SUB")).toBe("claude");
    expect(brandFor("ANTHROPIC")).toBe("anthropic");
    expect(brandFor("APPLE.COM/BILL")).toBe("apple");
    expect(brandFor("Steam Purchase")).toBe("steam");
    expect(brandFor("PAYPAL *STEAM")).toBe("steam");
    expect(brandFor("PAYPAL *SPOTIFY AB")).toBe("spotify");
    expect(brandFor("SUMUP *CAFE LATTE")).toBeNull();
    expect(brandFor("WILLYS EXEMPELSTAD CENTRUM")).toBeNull();
    expect(brandFor("PINEAPPLE")).toBeNull();
  });

  it("priority: the rule's own image, then its brand, then the built-in brand; else nothing (the monogram)", () => {
    const db = freshDb({ seeded: true });
    rule(db, "ZZBILD", { iconPath: "abc.png", brandSlug: "spotify" });
    rule(db, "ZZMARKE SPOTIFY", { brandSlug: "netflix" });
    const icon = iconResolver(db);
    expect(icon("ZZBILD 123")).toEqual({ image: "/api/icons/abc.png" });
    expect(icon("ZZMARKE SPOTIFY")).toEqual({ brand: "netflix" });
    expect(icon("SPOTIFY P3BBDA28AE")).toEqual({ brand: "spotify" });
    expect(icon("ZZ ingen alls")).toBeUndefined();
    expect(icon(null)).toBeUndefined();
  });

  it("seeding: a rule gets the brand all its rows share; mixed rules and rules with a brand are left alone", () => {
    const db = freshDb({ seeded: true });
    db.update(merchantRules).set({ brandSlug: null }).run();
    const lidl = rule(db, "ZZLIDL");
    const mixed = rule(db, "ZZANTHROPIC");
    const kept = rule(db, "ZZNETFLIX", { brandSlug: "plex" });
    const empty = rule(db, "IKEA ZZKIOSK");
    const regex = rule(db, "ZZSTEAM.*", { matchType: "regex" });
    tx(db, "ZZLIDL 271 EXEMPELSTAD");
    tx(db, "K*ZZLIDL 271 D");
    tx(db, "ZZANTHROPIC");
    tx(db, "ZZANTHROPIC* CLAUDE SUB");
    tx(db, "ZZNETFLIX.COM");
    assignBrandSlugs(db);
    const slug = (id: number) => db.select().from(merchantRules).where(eq(merchantRules.id, id)).get()!.brandSlug;
    expect(slug(lidl.id)).toBe("lidl");
    expect(slug(mixed.id)).toBeNull();
    expect(slug(kept.id)).toBe("plex");
    expect(slug(empty.id)).toBe("ikea");
    expect(slug(regex.id)).toBeNull();
  });

  it("a new database seeds the brands from the rules' own text", () => {
    const db = freshDb({ seeded: true });
    const spotify = db.select().from(merchantRules).all().find((r) => r.pattern.toUpperCase() === "SPOTIFY");
    if (spotify) expect(spotify.brandSlug).toBe("spotify");
    expect(db.select().from(merchantRules).all().filter((r) => r.brandSlug).length).toBeGreaterThan(0);
  });

  it("the lists carry the icon: transactions, Att granska's groups, the top list and Fasta utgifter", async () => {
    const db = freshDb({ seeded: true });
    const app = createApp(db, { databasePath: ":memory:" });
    tx(db, "K*SpotifySE", -12900);
    tx(db, "ZZ Okänd handlare", -5000);
    tx(db, "Swish skickad +46705550004", -20000, { counterparty: "+46705550004" });
    db.insert(contacts).values({ counterparty: "+46705550004", name: "Kompis" }).run();

    const get = async (url: string) => {
      const res = await app.request(url);
      expect(res.status, url).toBe(200);
      return res.json();
    };
    const list = await get("/api/transactions?from=2026-09-01&to=2026-09-30");
    const byText = (t: string) => list.rows.find((r: { descriptionClean: string }) => r.descriptionClean === t);
    expect(byText("K*SpotifySE").icon).toEqual({ brand: "spotify" });
    expect(byText("ZZ Okänd handlare").icon).toBeUndefined();

    const groups = await get("/api/review/groups");
    expect(groups.groups.find((g: { merchant: string }) => g.merchant === "K*SpotifySE").icon).toEqual({ brand: "spotify" });

    const top = await get("/api/analysis/merchants?from=2026-09-01&to=2026-09-30&share=household");
    expect(top.pieces.find((m: { key: string }) => m.key === "K*SpotifySE").icon).toEqual({ brand: "spotify" });
    expect(top.pieces.find((m: { key: string }) => m.key === "+46705550004")).toMatchObject({ contactName: "Kompis" });

    db.insert(recurringExpenses).values({ name: "Musik", amount: 12900, paymentMethod: "card", matchPattern: "SPOTIFY" }).run();
    db.insert(recurringExpenses).values({ name: "Egen", amount: 100, paymentMethod: "card", matchPattern: "SPOTIFY", iconPath: "f00.webp" }).run();
    const expenses = await get("/api/recurring-expenses");
    expect(expenses.find((e: { name: string }) => e.name === "Musik").icon).toEqual({ brand: "spotify" });
    expect(expenses.find((e: { name: string }) => e.name === "Egen").icon).toEqual({ image: "/api/icons/f00.webp" });
  });
});
