import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { ReceiptError } from "../receipts/parse.js";
import { grocerySummary, productHistory } from "../receipts/groceryStats.js";
import {
  createGroup,
  deleteGroup,
  detachAlias,
  getProduct,
  listGroups,
  listProducts,
  mergeProducts,
  placeUnplaced,
  renameProduct,
  setProductGroup,
  updateGroup,
} from "../receipts/products.js";

/**
 * Varor (/api/products): the groceries the receipts have seen, and the
 * shelves they are put on.
 *
 * Everything here is about names and shelves, never about money: no amount
 * changes because a product is renamed, moved or merged. The receipts keep
 * their rows exactly as they were read.
 */
const isDate = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const period = (from: string | undefined, to: string | undefined) => ({ from: isDate(from), to: isDate(to) });

export function productRoutes(db: Db) {
  const app = new Hono();

  const guard = async (run: () => unknown): Promise<Response> => {
    try {
      return Response.json(await run());
    } catch (e) {
      if (e instanceof ReceiptError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
  };

  app.get("/groups", (c) => c.json(listGroups(db)));

  app.post("/groups", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { name?: string; color?: string | null };
      return createGroup(db, b.name ?? "", b.color ?? null);
    }),
  );

  app.put("/groups/:id", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { name?: string; color?: string | null };
      return updateGroup(db, Number(c.req.param("id")), b);
    }),
  );

  /** The shelf goes; the products that stood on it are simply unplaced again. */
  app.delete("/groups/:id", (c) =>
    deleteGroup(db, Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Varugruppen finns inte." }, 404),
  );

  /** Two products become one: static path before /:id, or Hono reads 'merge' as an id. */
  app.post("/merge", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { keepId?: number; mergeIds?: number[] };
      if (typeof b.keepId !== "number") throw new ReceiptError("Välj vilken vara som ska behållas.");
      return mergeProducts(db, b.keepId, Array.isArray(b.mergeIds) ? b.mergeIds.map(Number) : []);
    }),
  );

  /** One printed name leaves the product it was put together with. */
  app.post("/detach", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { nameKey?: string };
      return detachAlias(db, typeof b.nameKey === "string" ? b.nameKey : "");
    }),
  );

  /**
   * What the receipts in the period add up to: per shelf, per month, per shop,
   * and — first of all — how much of the period's grocery money they cover.
   */
  app.get("/summary", (c) => {
    const { from, to } = period(c.req.query("from"), c.req.query("to"));
    if (!from || !to) return c.json({ error: "Ange from och to som ÅÅÅÅ-MM-DD." }, 400);
    return c.json(grocerySummary(db, from, to));
  });

  /** The rules over the shelfless ones, when asked. Never on its own. */
  app.post("/suggest", (c) => c.json({ placed: placeUnplaced(db) }));

  app.get("/", (c) => c.json(listProducts(db, period(c.req.query("from"), c.req.query("to")))));

  app.get("/:id", (c) => {
    const product = getProduct(db, Number(c.req.param("id")), period(c.req.query("from"), c.req.query("to")));
    return product ? c.json(product) : c.json({ error: "Varan finns inte." }, 404);
  });

  /** Every time this grocery was bought in the period, and what that says. */
  app.get("/:id/history", (c) => {
    const { from, to } = period(c.req.query("from"), c.req.query("to"));
    if (!from || !to) return c.json({ error: "Ange from och to som ÅÅÅÅ-MM-DD." }, 400);
    const id = Number(c.req.param("id"));
    if (!getProduct(db, id)) return c.json({ error: "Varan finns inte." }, 404);
    return c.json(productHistory(db, id, from, to));
  });

  /** Rename, move to another shelf, or take it off one (groupId: null). */
  app.put("/:id", async (c) =>
    guard(async () => {
      const id = Number(c.req.param("id"));
      const b = (await c.req.json().catch(() => ({}))) as { name?: string; groupId?: number | null };
      if (typeof b.name === "string") renameProduct(db, id, b.name);
      if (b.groupId !== undefined) setProductGroup(db, id, b.groupId === null ? null : Number(b.groupId));
      const product = getProduct(db, id);
      if (!product) throw new ReceiptError("Varan finns inte.");
      return product;
    }),
  );

  return app;
}
