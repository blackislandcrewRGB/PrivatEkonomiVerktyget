import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { labelRules } from "../db/schema.js";
import {
  LabelRuleError,
  labelRuleList,
  previewLabelRule,
  saveLabelRule,
  suggestLabelPattern,
  undoLabelRule,
  type LabelRuleSpec,
} from "../categorize/labelRules.js";

const ids = (s: string | undefined) => (s ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
const matchType = (s: string | undefined): LabelRuleSpec["matchType"] => (s === "exact" || s === "regex" ? s : "contains");

/** Name rules (/api/label-rules): new imports matching the pattern get the name. */
export function labelRuleRoutes(db: Db) {
  const app = new Hono();

  app.get("/", (c) => c.json(labelRuleList(db)));

  /** A pattern for these rows (?ids=1,2), and what else it would rename now. */
  app.get("/suggest", (c) => {
    const rows = ids(c.req.query("ids"));
    const spec = suggestLabelPattern(db, rows);
    return c.json(spec ? { ...spec, ...previewLabelRule(db, spec, rows) } : null);
  });

  /** Other rows without a name that ?pattern=…&matchType=… would rename now (?exclude=1,2 left out). */
  app.get("/preview", (c) => {
    const pattern = (c.req.query("pattern") ?? "").trim();
    if (!pattern) return c.json({ matches: 0, examples: [] });
    return c.json(previewLabelRule(db, { pattern, matchType: matchType(c.req.query("matchType")) }, ids(c.req.query("exclude"))));
  });

  /** Save a rule, name the chosen rows (ids) and every row without a name it matches. */
  app.post("/", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { pattern?: string; matchType?: string; label?: string; ids?: number[] };
    try {
      return c.json(
        saveLabelRule(db, {
          pattern: String(b.pattern ?? ""),
          matchType: (b.matchType ?? "contains") as LabelRuleSpec["matchType"],
          label: String(b.label ?? ""),
          ids: Array.isArray(b.ids) ? b.ids.filter((n) => Number.isInteger(n)) : [],
        }),
      );
    } catch (e) {
      if (e instanceof LabelRuleError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  /** 'Ångra' right after saving: the rows get their old names back, the rule goes or gets its old name. */
  app.post("/:id/undo", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { previousLabel?: string | null; before?: unknown };
    try {
      return c.json({ restored: undoLabelRule(db, Number(c.req.param("id")), b.previousLabel ?? null, b.before) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  /** Remove a rule. Rows keep the name they have; only new imports are affected. */
  app.delete("/:id", (c) => {
    const rule = db.delete(labelRules).where(eq(labelRules.id, Number(c.req.param("id")))).returning().get();
    return rule ? c.json({ rule }) : c.json({ error: "Hittades inte." }, 404);
  });

  /** Put a removed rule back (the toast's 'Ångra'). */
  app.post("/restore", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { pattern?: string; matchType?: string; label?: string };
    if (!b.pattern?.trim() || !b.label?.trim()) return c.json({ error: "Mönster och namn krävs." }, 400);
    const rule = db
      .insert(labelRules)
      .values({ pattern: b.pattern.trim(), matchType: matchType(b.matchType), label: b.label.trim() })
      .onConflictDoUpdate({ target: [labelRules.matchType, labelRules.pattern], set: { label: b.label.trim() } })
      .returning()
      .get();
    return c.json({ rule });
  });

  return app;
}
