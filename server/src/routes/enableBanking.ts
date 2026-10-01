import { Hono, type Context } from "hono";
import { EbApiError, type PsuHeaders } from "../enableBanking/client.js";
import { EbError } from "../enableBanking/connect.js";
import type { BankService } from "../enableBanking/service.js";

/** The user at the screen: their address (through Tailscale and Vite) and browser. Without both, none. */
function psuOf(c: Context): PsuHeaders | null {
  const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || c.req.header("x-real-ip") || "";
  const userAgent = c.req.header("user-agent") ?? "";
  return ip && userAgent ? { ip, userAgent } : null;
}

const message = (e: unknown) => (e instanceof EbApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : (e as Error).message);

/** Bankkopplingar (/api/enable-banking). */
export function enableBankingRoutes(service: BankService) {
  const app = new Hono();

  app.get("/status", (c) => c.json(service.status()));

  /** Body: { bank } ('Swedbank' | 'Bank Norwegian'). Answers the bank's login address to go to. */
  app.post("/connect", async (c) => {
    if (!service.configured) return c.json({ error: "Enable Banking är inte konfigurerat i .env." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { bank?: unknown };
    try {
      return c.json(await service.connect(String(b.bank ?? "")));
    } catch (e) {
      return c.json({ error: message(e) }, e instanceof EbError ? 400 : 502);
    }
  });

  /** The bank sends the user back here. On to Inställningar with the outcome either way. */
  app.get("/callback", async (c) => {
    const q = c.req.query();
    const back = (params: Record<string, string>) => c.redirect(`/installningar?${new URLSearchParams(params)}#banks`, 302);
    try {
      const r = await service.callback({ code: q.code, state: q.state, error: q.error, error_description: q.error_description });
      const unmatched = r.accounts.filter((a) => a.accountId === null).length;
      return back({ bank: "ok", namn: r.bank, konton: String(r.accounts.length), okopplade: String(unmatched) });
    } catch (e) {
      return back({ bank: "fel", meddelande: message(e) });
    }
  });

  /** Body: { dryRun?, connectionId? }. A manual sync passes the user's headers (the bank then allows more fetches). */
  app.post("/sync", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { dryRun?: unknown; connectionId?: unknown };
    try {
      return c.json(
        await service.sync({
          dryRun: b.dryRun === true,
          connectionId: typeof b.connectionId === "number" ? b.connectionId : undefined,
          psu: psuOf(c),
        }),
      );
    } catch (e) {
      return c.json({ error: message(e) }, 502);
    }
  });

  /** Body: { accountId } (null: not fed into any account). */
  app.put("/bank-accounts/:id", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { accountId?: unknown };
    if (b.accountId !== null && typeof b.accountId !== "number") return c.json({ error: "accountId ska vara ett id eller null." }, 400);
    try {
      return c.json(service.setAccount(Number(c.req.param("id")), b.accountId));
    } catch (e) {
      return c.json({ error: message(e) }, 400);
    }
  });

  app.delete("/connections/:id", async (c) => {
    try {
      await service.remove(Number(c.req.param("id")));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: message(e) }, 404);
    }
  });
  return app;
}
