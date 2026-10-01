import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categories, contacts, itemAttachments, items, itemTransactions, transactions } from "../db/schema.js";
import {
  ItemError,
  addAttachment,
  attachmentsFor,
  createItem,
  deleteAttachment,
  deleteItem,
  getItem,
  linkTransaction,
  restoreItem,
  transactionIdsFor,
  unlinkTransaction,
  updateItem,
  warrantyEndsOn,
  type ItemInput,
} from "../items/items.js";
import { ATTACHMENT_FILE, AttachmentError, MAX_ATTACHMENTS_PER_ITEM, attachmentUrl, saveAttachment } from "../items/attachments.js";
import { DEFAULT_ITEM_MIN, itemWatchSettings, setItemWatchSettings, type ItemWatchSettings } from "../items/itemWatch.js";
import { iconResolver } from "../icons/icons.js";
import { merchantName } from "../items/merchantName.js";
import { extractCounterparty } from "../categorize/counterparty.js";
import type { Item } from "../db/schema.js";

/**
 * Prylar (/api/items): the things I bought, what they were paid with, and
 * their pictures and receipts.
 *
 * Nothing here writes to a transaction. Linking one only adds a row to
 * item_transactions, so no sum, category or settlement can move because of
 * something I wrote about a thing.
 */

/** The subcategories under 'Prylar & hem' are the choices offered; the field itself is free text. */
const ITEM_CATEGORY_PARENT = "Prylar & hem";

function categoryOptions(db: Db): string[] {
  const parent = db.select().from(categories).where(and(eq(categories.name, ITEM_CATEGORY_PARENT), isNull(categories.parentId))).get();
  if (!parent) return [];
  return db.select({ name: categories.name }).from(categories).where(eq(categories.parentId, parent.id)).orderBy(asc(categories.name)).all().map((c) => c.name);
}

export function itemRoutes(db: Db) {
  const app = new Hono();
  const guard = async (run: () => unknown): Promise<Response> => {
    try {
      return Response.json(await run());
    } catch (e) {
      if (e instanceof ItemError || e instanceof AttachmentError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
  };

  /** The picture that stands for an item in the gallery: its first image, otherwise its first receipt. */
  function covers(ids: number[]): Map<number, { url: string | null; count: number }> {
    const out = new Map<number, { url: string | null; count: number }>();
    if (ids.length === 0) return out;
    const rows = db
      .select()
      .from(itemAttachments)
      .where(and(isNull(itemAttachments.deletedAt), ids.length <= 500 ? inArray(itemAttachments.itemId, ids) : undefined))
      .orderBy(asc(itemAttachments.itemId), asc(itemAttachments.id))
      .all();
    for (const a of rows) {
      const at = out.get(a.itemId) ?? { url: null, count: 0 };
      at.count += 1;
      if (!at.url && a.kind === "image") at.url = attachmentUrl(a.thumbnailPath ?? a.filePath);
      out.set(a.itemId, at);
    }
    for (const [, at] of out) at.url ??= null;
    return out;
  }

  /** An item as a list or a card shows it: its files, its transactions and the merchant's icon. */
  function decorate(rows: Item[], names = merchantNames(rows)) {
    const icon = iconResolver(db);
    const cover = covers(rows.map((r) => r.id));
    const links = new Map<number, number[]>();
    if (rows.length) {
      const all = db
        .select()
        .from(itemTransactions)
        .where(rows.length <= 500 ? inArray(itemTransactions.itemId, rows.map((r) => r.id)) : undefined)
        .orderBy(asc(itemTransactions.transactionId))
        .all();
      for (const l of all) links.set(l.itemId, [...(links.get(l.itemId) ?? []), l.transactionId]);
    }
    return rows.map((r) => ({
      ...r,
      warrantyEndsOn: warrantyEndsOn(r),
      cover: cover.get(r.id)?.url ?? null,
      attachmentCount: cover.get(r.id)?.count ?? 0,
      transactionIds: links.get(r.id) ?? [],
      // Falls back to the name so a pryl without a merchant can still show something.
      icon: icon(r.merchant ?? r.name, -1) ?? null,
      merchantName: names.get(r.id) ?? null,
    }));
  }

  /** Each pryl's merchant as a person would say it (see merchantName), by id; none without a merchant. */
  function merchantNames(rows: Item[]) {
    const icon = iconResolver(db);
    return new Map(rows.filter((r) => r.merchant).map((r) => [r.id, merchantName(r.merchant!, icon.rule(r.merchant, -1))]));
  }

  /**
   * The list, with the filters of the view: year or month (purchase date),
   * category, merchant (by its name, see merchantName), owner, status and free
   * text over name and merchant. The choices come with it, counted over
   * everything rather than the filtered set, so the filter bar doesn't empty
   * itself as you use it.
   */
  app.get("/", (c) => {
    const q = c.req.query();
    const all = db.select().from(items).where(isNull(items.deletedAt)).orderBy(desc(items.purchaseDate), desc(items.id)).all();
    const names = merchantNames(all);
    const needle = (q.q ?? "").trim().toLocaleLowerCase("sv");
    const rows = all.filter(
      (r) =>
        (!q.year || r.purchaseDate.startsWith(q.year)) &&
        (!q.month || r.purchaseDate.startsWith(q.month)) &&
        (!q.merchant || names.get(r.id) === q.merchant) &&
        (!q.category || r.category === q.category) &&
        (!q.owner || r.owner === q.owner) &&
        (!q.status || r.status === q.status) &&
        (!needle || `${r.name} ${r.merchant ?? ""}`.toLocaleLowerCase("sv").includes(needle)),
    );
    const merchants = new Map<string, number>();
    for (const name of names.values()) merchants.set(name, (merchants.get(name) ?? 0) + 1);
    return c.json({
      items: decorate(rows, names),
      // The sum of what is shown, and what it has been sold for since.
      totals: {
        count: rows.length,
        priceOre: rows.reduce((s, r) => s + r.priceOre, 0),
        soldOre: rows.reduce((s, r) => s + (r.soldPriceOre ?? 0), 0),
      },
      years: [...new Set(all.map((r) => r.purchaseDate.slice(0, 4)))].sort().reverse(),
      categories: [...new Set(all.map((r) => r.category).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "sv")),
      merchants: [...merchants].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "sv")),
      categoryOptions: categoryOptions(db),
    });
  });

  /**
   * What Vakt asks about: the categories where a purchase is probably a thing,
   * and how big it has to be. Registered before '/:id', which would otherwise
   * take 'settings' for an id.
   */
  app.get("/settings", (c) => c.json({ ...itemWatchSettings(db), defaultMinAmount: DEFAULT_ITEM_MIN }));

  app.put("/settings", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Partial<ItemWatchSettings>;
    return c.json({ ...setItemWatchSettings(db, b), defaultMinAmount: DEFAULT_ITEM_MIN });
  });

  /** What the 'Skapa pryl'-dialog is filled with when it opens from a transaction. */
  app.get("/suggest/:transactionId", (c) => {
    const id = Number(c.req.param("transactionId"));
    const t = db
      .select({ t: transactions, contactName: contacts.name, categoryName: categories.name, parentId: categories.parentId })
      .from(transactions)
      .leftJoin(contacts, eq(contacts.counterparty, transactions.counterparty))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(eq(transactions.id, id))
      .get();
    if (!t) return c.json({ error: "Transaktionen finns inte." }, 404);
    const parent = t.parentId ? db.select({ name: categories.name }).from(categories).where(eq(categories.id, t.parentId)).get() : undefined;
    const merchant = t.contactName ?? extractCounterparty(t.t.descriptionClean);
    return c.json({
      transactionId: t.t.id,
      name: t.t.label ?? merchant,
      merchant,
      // A purchase is money out; the price is what it cost, as a positive number.
      priceOre: Math.abs(t.t.amount),
      // The day the thing was bought, which is what a warranty and a right of
      // return are counted from — not the day the bank got round to booking it.
      purchaseDate: t.t.transactionDate ?? t.t.bookingDate,
      // The booking day, so the dialog can say so when the two differ: the
      // lists show this one, and a difference of a few days is otherwise a puzzle.
      bookedDate: t.t.bookingDate,
      // Only a subcategory of 'Prylar & hem' says anything about what the thing is.
      category: parent?.name === ITEM_CATEGORY_PARENT ? (t.categoryName ?? null) : null,
      icon: iconResolver(db)(t.t.descriptionClean, t.t.amount) ?? null,
      categoryOptions: categoryOptions(db),
    });
  });

  /** Everything the detail view shows: the pryl, its files and the transactions it was paid with. */
  app.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const item = getItem(db, id);
    if (!item || item.deletedAt) return c.json({ error: "Prylen finns inte." }, 404);
    const ids = transactionIdsFor(db, id);
    const icon = iconResolver(db);
    const rows = ids.length
      ? db
          .select({
            id: transactions.id,
            bookingDate: transactions.bookingDate,
            transactionDate: transactions.transactionDate,
            descriptionClean: transactions.descriptionClean,
            label: transactions.label,
            amount: transactions.amount,
            accountId: transactions.accountId,
            categoryId: transactions.categoryId,
            deletedAt: transactions.deletedAt,
          })
          .from(transactions)
          .where(inArray(transactions.id, ids))
          .orderBy(asc(transactions.bookingDate))
          .all()
      : [];
    return c.json({
      ...decorate([item])[0],
      attachments: attachmentsFor(db, id).map((a) => ({
        ...a,
        url: attachmentUrl(a.filePath),
        thumbnailUrl: attachmentUrl(a.thumbnailPath),
      })),
      transactions: rows.map((r) => ({ ...r, icon: icon(r.descriptionClean, r.amount) ?? null })),
      categoryOptions: categoryOptions(db),
    });
  });

  /** A new pryl, optionally with the transactions it was paid with. */
  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as ItemInput & { transactionIds?: number[] };
    return guard(() => {
      const item = createItem(db, b);
      for (const txId of b.transactionIds ?? []) linkTransaction(db, item.id, txId);
      return decorate([item])[0];
    });
  });

  app.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Partial<ItemInput>;
    const item = getItem(db, id);
    if (!item || item.deletedAt) return c.json({ error: "Prylen finns inte." }, 404);
    return guard(() => decorate([updateItem(db, id, b)])[0]);
  });

  /** Soft delete; the transactions are not touched. 'Ångra' puts it back. */
  app.delete("/:id", (c) => (deleteItem(db, Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Prylen finns inte." }, 404)));

  app.post("/:id/restore", (c) => {
    const id = Number(c.req.param("id"));
    if (!restoreItem(db, id)) return c.json({ error: "Prylen finns inte." }, 404);
    return c.json(decorate([getItem(db, id)!])[0]);
  });

  app.post("/:id/transactions", async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as { transactionId?: number };
    return guard(() => {
      linkTransaction(db, id, Number(b.transactionId));
      return { transactionIds: transactionIdsFor(db, id) };
    });
  });

  app.delete("/:id/transactions/:transactionId", (c) => {
    const id = Number(c.req.param("id"));
    if (!unlinkTransaction(db, id, Number(c.req.param("transactionId")))) return c.json({ error: "Kopplingen finns inte." }, 404);
    return c.json({ transactionIds: transactionIdsFor(db, id) });
  });

  return app;
}

/**
 * The files themselves: uploaded to a pryl, served from the attachments folder
 * with a year's cache (the name is the content's hash, so a new picture is a
 * new URL) and removed one at a time.
 */
export function attachmentRoutes(db: Db, dir: string) {
  const app = new Hono();

  app.get("/attachments/:itemId/:file", (c) => {
    const rel = `${c.req.param("itemId")}/${c.req.param("file")}`;
    const m = ATTACHMENT_FILE.exec(rel);
    if (!m) return c.json({ error: "Hittades inte." }, 404);
    const full = path.join(dir, m[1], m[2]);
    if (!fs.existsSync(full)) return c.json({ error: "Hittades inte." }, 404);
    const pdf = full.endsWith(".pdf");
    return c.body(fs.readFileSync(full), 200, {
      "Content-Type": pdf ? "application/pdf" : "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // A receipt is opened to be read, so it is served inline — but sandboxed,
      // so nothing inside the PDF can run or fetch anything.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(pdf ? { "Content-Disposition": "inline" } : {}),
    });
  });

  /** A picture or a receipt for a pryl. Form fields: file, and kind (image|receipt|other). */
  app.post("/items/:id/attachments", async (c) => {
    const id = Number(c.req.param("id"));
    const item = db.select().from(items).where(eq(items.id, id)).get();
    if (!item || item.deletedAt) return c.json({ error: "Prylen finns inte." }, 404);
    const count = db
      .select({ n: sql<number>`count(*)` })
      .from(itemAttachments)
      .where(and(eq(itemAttachments.itemId, id), isNull(itemAttachments.deletedAt)))
      .get()!.n;
    if (count >= MAX_ATTACHMENTS_PER_ITEM) return c.json({ error: `Högst ${MAX_ATTACHMENTS_PER_ITEM} bilagor går på en pryl.` }, 400);

    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Ingen fil skickades." }, 400);
    const kind = body.kind === "image" || body.kind === "receipt" || body.kind === "other" ? body.kind : undefined;
    try {
      const saved = await saveAttachment(dir, id, Buffer.from(await file.arrayBuffer()), { filename: file.name, kind });
      const row = addAttachment(db, id, saved);
      return c.json({ ...row, url: attachmentUrl(row.filePath), thumbnailUrl: attachmentUrl(row.thumbnailPath) });
    } catch (e) {
      if (e instanceof AttachmentError || e instanceof ItemError) return c.json({ error: (e as Error).message }, 400);
      throw e;
    }
  });

  /** Soft delete: the row is marked, the file stays, because a backup may point at it. */
  app.delete("/items/:id/attachments/:attachmentId", (c) => {
    const attachmentId = Number(c.req.param("attachmentId"));
    const row = db.select().from(itemAttachments).where(eq(itemAttachments.id, attachmentId)).get();
    if (!row || row.itemId !== Number(c.req.param("id"))) return c.json({ error: "Bilagan finns inte." }, 404);
    return deleteAttachment(db, attachmentId) ? c.json({ ok: true }) : c.json({ error: "Bilagan finns inte." }, 404);
  });

  return app;
}
