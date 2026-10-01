import { vi } from "vitest";

type Handler = unknown | ((url: string, init: RequestInit & { json?: unknown }) => unknown);

/**
 * Answers fetch('/api/…') from a map of 'METHOD path-prefix' or 'path-prefix'
 * (any method) -> JSON or a function of (url, init). The longest match wins.
 * The mock records every call, with the parsed JSON body as init.json.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input).replace(/^\/api/, "");
    const method = (init.method ?? "GET").toUpperCase();
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, p] = k.includes(" ") ? k.split(" ") : [null, k];
        return (!m || m === method) && url.startsWith(p);
      })
      .sort((a, b) => b.replace(/^\w+ /, "").length - a.replace(/^\w+ /, "").length)[0];
    if (key === undefined) return new Response(JSON.stringify({ error: `not mocked: ${method} ${url}` }), { status: 404 });
    const json = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const h = routes[key];
    const body = typeof h === "function" ? (h as (u: string, i: RequestInit & { json?: unknown }) => unknown)(url, { ...init, json }) : h;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The calls made with this method whose path starts with `path`, as [url, json body]. */
export function callsTo(fetchMock: ReturnType<typeof mockApi>, method: string, path: string) {
  return fetchMock.mock.calls
    .filter(([u, i]) => ((i as RequestInit | undefined)?.method ?? "GET").toUpperCase() === method && String(u).replace(/^\/api/, "").startsWith(path))
    .map(([u, i]) => [String(u), typeof (i as RequestInit)?.body === "string" ? JSON.parse((i as RequestInit).body as string) : undefined] as const);
}
