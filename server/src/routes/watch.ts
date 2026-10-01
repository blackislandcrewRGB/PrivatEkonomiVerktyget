import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { todayLocal } from "../overview/dates.js";
import { acceptFinding, dismissFinding, findings, mutedSeries, muteSeries, restoreFinding, setWatchKinds, unmuteSeries, WATCH_LABELS, watchKinds } from "../watch/watch.js";

/** Vakt: the findings, which kinds are on (Inställningar), dismiss and accept. */
export function watchRoutes(db: Db) {
  const app = new Hono();

  app.get("/", (c) => c.json({ findings: findings(db, todayLocal()) }));

  const settings = () => ({ kinds: watchKinds(db), labels: WATCH_LABELS, muted: mutedSeries(db) });
  app.get("/settings", (c) => c.json(settings()));

  app.put("/settings", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { kinds?: Record<string, unknown> };
    if (!b.kinds || typeof b.kinds !== "object") return c.json({ error: "kinds saknas." }, 400);
    setWatchKinds(db, b.kinds);
    return c.json(settings());
  });

  app.post("/dismiss", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { key?: string };
    if (!b.key) return c.json({ error: "key saknas." }, 400);
    try {
      dismissFinding(db, b.key, todayLocal());
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post("/restore", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { key?: string };
    if (!b.key) return c.json({ error: "key saknas." }, 400);
    restoreFinding(db, b.key);
    return c.json({ ok: true });
  });

  /** 'Varierar – fråga inte' (a price drift's series), and back ({series}). */
  app.post("/mute", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { key?: string };
    if (!b.key) return c.json({ error: "key saknas." }, 400);
    try {
      muteSeries(db, b.key, todayLocal());
      return c.json(settings());
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.post("/unmute", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { series?: string };
    if (!b.series) return c.json({ error: "series saknas." }, 400);
    unmuteSeries(db, b.series);
    return c.json(settings());
  });

  app.post("/accept", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { key?: string };
    if (!b.key) return c.json({ error: "key saknas." }, 400);
    try {
      return c.json(acceptFinding(db, b.key, todayLocal()));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  return app;
}
