import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";
import { buildDigest, lastSent, sendDigest } from "../digest/digest.js";

/** Veckodigest: the text (Översikten, 'Veckan som gick') and 'Skicka nu' (Inställningar). */
export function digestRoutes(db: Db, ntfyTopic: string) {
  const app = new Hono();

  app.get("/", (c) => {
    const q = c.req.query("today");
    return c.json({ ...buildDigest(db, q && isIsoDate(q) ? q : todayLocal()), sentAt: lastSent(db), canSend: !!ntfyTopic });
  });

  app.post("/send", async (c) => {
    if (!ntfyTopic) return c.json({ error: "Ingen ntfy-topic: NTFY_TOPIC i .env (bara den riktiga instansen skickar)." }, 400);
    const { sent } = await sendDigest(db, todayLocal(), ntfyTopic);
    return sent ? c.json({ ok: true, sentAt: lastSent(db) }) : c.json({ error: "ntfy tog inte emot notisen." }, 502);
  });

  return app;
}
