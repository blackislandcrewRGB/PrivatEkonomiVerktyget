import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { merchantRules, recurringExpenses } from "../db/schema.js";
import { ruleIcon } from "../icons/icons.js";
import { ICON_FILE, IconError, saveIcon } from "../icons/upload.js";

/**
 * Merchant icons: served from the icons folder with a year's cache (the name
 * is the content's hash, so a new picture is a new URL), and uploaded to or
 * removed from a rule (every purchase there) or a fixed expense (only it).
 * Removing only clears the link; the file stays (backups may point at it).
 */
export function iconRoutes(db: Db, dir: string) {
  const app = new Hono();

  app.get("/icons/:file", (c) => {
    const file = c.req.param("file");
    if (!ICON_FILE.test(file)) return c.json({ error: "Hittades inte." }, 404);
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) return c.json({ error: "Hittades inte." }, 404);
    return c.body(fs.readFileSync(full), 200, {
      "Content-Type": file.endsWith(".webp") ? "image/webp" : "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });

  /** The uploaded file ('file' in the form) stored; its name, or a response with the error. */
  const upload = async (c: Context): Promise<string | Response> => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Ingen bild skickades." }, 400);
    try {
      return await saveIcon(dir, Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof IconError) return c.json({ error: e.message }, 400);
      throw e;
    }
  };

  const ruleById = (id: number) => db.select().from(merchantRules).where(eq(merchantRules.id, id)).get();
  const setRule = (id: number, iconPath: string | null) => {
    const r = db.update(merchantRules).set({ iconPath }).where(eq(merchantRules.id, id)).returning().get();
    return { iconPath: r.iconPath, icon: ruleIcon(r) ?? null };
  };
  app.post("/rules/:id/icon", async (c) => {
    const id = Number(c.req.param("id"));
    if (!ruleById(id)) return c.json({ error: "Regeln finns inte." }, 404);
    const name = await upload(c);
    return typeof name === "string" ? c.json(setRule(id, name)) : name;
  });
  app.delete("/rules/:id/icon", (c) => {
    const id = Number(c.req.param("id"));
    return ruleById(id) ? c.json(setRule(id, null)) : c.json({ error: "Regeln finns inte." }, 404);
  });

  const expenseById = (id: number) => db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get();
  app.post("/recurring-expenses/:id/icon", async (c) => {
    const id = Number(c.req.param("id"));
    if (!expenseById(id)) return c.json({ error: "Utgiften finns inte." }, 404);
    const name = await upload(c);
    if (typeof name !== "string") return name;
    db.update(recurringExpenses).set({ iconPath: name }).where(eq(recurringExpenses.id, id)).run();
    return c.json({ iconPath: name });
  });
  app.delete("/recurring-expenses/:id/icon", (c) => {
    const id = Number(c.req.param("id"));
    if (!expenseById(id)) return c.json({ error: "Utgiften finns inte." }, 404);
    db.update(recurringExpenses).set({ iconPath: null }).where(eq(recurringExpenses.id, id)).run();
    return c.json({ iconPath: null });
  });

  return app;
}
