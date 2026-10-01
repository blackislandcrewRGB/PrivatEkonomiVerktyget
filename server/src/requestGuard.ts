import type { MiddlewareHandler } from "hono";

/**
 * Only the tool's own names may ask it anything.
 *
 * Host, on every request: a page on another site can point its own name at
 * 127.0.0.1 or at the tailnet address (DNS rebinding) and then read the
 * answers as its own — the browser still sends that site's name as Host, so
 * the name is what is checked, not the address.
 *
 * Origin, on requests that change something: a page on another site can send
 * a form or a no-cors POST at the tool without reading the answer. Browsers
 * send Origin on those, so a foreign one is refused. A request with no Origin
 * and no Sec-Fetch-Site is not from a web page (curl, the health check, the
 * tests) and is let through.
 *
 * Allowed: loopback under any port (the Mac, Docker's health check, Vite's
 * proxy and the dev pages on 5173/5174), the host in PUBLIC_BASE_URL (the
 * tailnet name), and any extra names in ALLOWED_HOSTS. A name is compared
 * without its port.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** 'Ekonomi.x.ts.net:443' -> 'ekonomi.x.ts.net', '[::1]:3001' -> '::1'. Null when it isn't a host. */
export function hostName(value: string | undefined | null): string | null {
  // A Host is a name and a port, nothing else: 'evil.example@127.0.0.1' would parse as loopback.
  if (!value || /[@/\\?#\s]/.test(value.trim())) return null;
  try {
    return new URL(`http://${value.trim()}`).hostname.replace(/^\[|\]$/g, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The names besides loopback: PUBLIC_BASE_URL's host and ALLOWED_HOSTS (comma separated). */
export function allowedHostNames(publicBaseUrl: string, extra: string): string[] {
  const names = new Set<string>();
  if (publicBaseUrl) {
    try {
      names.add(new URL(publicBaseUrl).hostname.toLowerCase());
    } catch {
      // A malformed PUBLIC_BASE_URL allows nothing extra rather than everything.
    }
  }
  for (const part of extra.split(",")) {
    const name = hostName(part);
    if (name) names.add(name);
  }
  return [...names];
}

export type Refusal = { reason: "host" | "origin"; value: string };

/** Whether a request may go on, and why not. Pure, for the tests. */
export function checkRequest(
  allowed: string[],
  req: { method: string; host: string | null; origin: string | null; fetchSite: string | null },
): Refusal | null {
  const ok = (name: string | null) => name !== null && (LOOPBACK.has(name) || allowed.includes(name));

  const host = hostName(req.host);
  if (!ok(host)) return { reason: "host", value: req.host ?? "" };
  if (SAFE.has(req.method.toUpperCase())) return null;

  if (req.origin !== null) {
    // 'null' is a sandboxed frame or a file: never ours.
    let name: string | null = null;
    try {
      name = req.origin === "null" ? null : new URL(req.origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch {
      name = null;
    }
    return ok(name) ? null : { reason: "origin", value: req.origin };
  }
  // No Origin: a browser that still says the request is from another site is refused.
  if (req.fetchSite === "cross-site") return { reason: "origin", value: "(Sec-Fetch-Site: cross-site)" };
  return null;
}

export function requestGuard(allowed: string[], log: (line: string) => void = console.warn): MiddlewareHandler {
  return async (c, next) => {
    const refusal = checkRequest(allowed, {
      method: c.req.method,
      // Node's server builds the URL from Host; a test request has only the URL.
      host: c.req.header("host") ?? new URL(c.req.url).host,
      origin: c.req.header("origin") ?? null,
      fetchSite: c.req.header("sec-fetch-site") ?? null,
    });
    if (refusal) {
      log(`Avvisad förfrågan (${refusal.reason === "host" ? "Host" : "Origin"}: ${refusal.value}): ${c.req.method} ${new URL(c.req.url).pathname}`);
      return c.text("Förfrågan avvisad.", 403);
    }
    await next();
  };
}
