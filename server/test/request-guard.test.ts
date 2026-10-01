import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { allowedHostNames, checkRequest, hostName } from "../src/requestGuard.js";
import { freshDb } from "./helpers.js";

/**
 * Only the tool's own names may ask it anything (Host, every request), and
 * only its own pages may change anything (Origin, requests that write).
 */

const TAILNET = "ekonomi.example.ts.net";
const ALLOWED = [TAILNET];
const check = (method: string, host: string | null, origin: string | null = null, fetchSite: string | null = null) =>
  checkRequest(ALLOWED, { method, host, origin, fetchSite });

describe("the allowed names", () => {
  it("are PUBLIC_BASE_URL's host and ALLOWED_HOSTS, without ports, in lower case", () => {
    expect(allowedHostNames(`https://${TAILNET}`, "")).toEqual([TAILNET]);
    expect(allowedHostNames("https://Ekonomi.example.ts.net/", " 172.30.0.2:3001, Extra.local ")).toEqual([TAILNET, "172.30.0.2", "extra.local"]);
    // Nothing configured: loopback only.
    expect(allowedHostNames("", "")).toEqual([]);
    expect(allowedHostNames("inte en adress", "")).toEqual([]);
  });

  it("read a Host header as a name alone", () => {
    expect(hostName("127.0.0.1:3001")).toBe("127.0.0.1");
    expect(hostName("[::1]:3001")).toBe("::1");
    expect(hostName(`${TAILNET.toUpperCase()}:443`)).toBe(TAILNET);
    expect(hostName("evil.example@127.0.0.1")).toBeNull();
    expect(hostName("127.0.0.1/x")).toBeNull();
    expect(hostName("")).toBeNull();
  });
});

describe("what goes through", () => {
  it.each([
    ["Docker's health check and the start script", "GET", "127.0.0.1:3001", null],
    ["the Mac on localhost", "GET", "localhost:3001", null],
    ["IPv6 loopback", "GET", "[::1]:3001", null],
    ["the browser and the deploy script on the tailnet", "GET", TAILNET, null],
    ["the tailnet name with its port, in capitals", "GET", `${TAILNET.toUpperCase()}:443`, null],
    ["Vite's proxy in dev (Host rewritten, Origin the page's)", "POST", "127.0.0.1:3001", "http://localhost:5173"],
    ["the test instance's dev page", "POST", "127.0.0.1:3101", "http://127.0.0.1:5174"],
    ["an upload from the tool's own page", "POST", TAILNET, `https://${TAILNET}`],
    ["curl, the tests and scripts: no Origin", "DELETE", "127.0.0.1:3001", null],
  ])("%s", (_why, method, host, origin) => {
    expect(check(method, host, origin)).toBeNull();
  });

  it("the bank's callback: a navigation from another site, but a GET to our own name", () => {
    expect(check("GET", TAILNET, null, "cross-site")).toBeNull();
  });
});

describe("what is refused", () => {
  it.each([
    ["DNS rebinding: another site's name pointed at us", "GET", "evil.example", null, "host"],
    ["rebinding onto the tailnet address", "GET", "evil.example:443", null, "host"],
    ["the raw tailnet IP, not configured", "GET", "100.122.38.91:3001", null, "host"],
    ["a name that only looks like loopback", "GET", "evil.example@127.0.0.1", null, "host"],
    ["a name that starts like ours", "GET", `${TAILNET}.evil.example`, null, "host"],
    ["a form posted from another site", "POST", TAILNET, "https://evil.example", "origin"],
    ["another site dressed as localhost", "PUT", "127.0.0.1:3001", "http://localhost.evil.example", "origin"],
    ["a sandboxed frame or a file", "POST", "127.0.0.1:3001", "null", "origin"],
    ["a malformed Origin", "POST", "127.0.0.1:3001", "::::", "origin"],
  ])("%s", (_why, method, host, origin, reason) => {
    expect(check(method, host, origin)?.reason).toBe(reason);
  });

  it("a write a browser says is cross-site, even without Origin", () => {
    expect(check("DELETE", "127.0.0.1:3001", null, "cross-site")).toEqual({ reason: "origin", value: "(Sec-Fetch-Site: cross-site)" });
    // Same-site and none are the tool's own pages and typed addresses.
    expect(check("DELETE", "127.0.0.1:3001", null, "same-origin")).toBeNull();
  });
});

describe("in the app", () => {
  const app = () => {
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => lines.push(line);
    const a = createApp(freshDb({ seeded: true }), { databasePath: ":memory:", allowedHosts: ALLOWED });
    return { a, lines, restore: () => (console.warn = warn) };
  };
  const req = (host: string, init: RequestInit & { origin?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("host", host);
    if (init.origin) headers.set("origin", init.origin);
    return { ...init, headers };
  };

  it("answers the health check on loopback and the tailnet name, and nothing else", async () => {
    const { a, lines, restore } = app();
    try {
      expect((await a.request("/api/health", req("127.0.0.1:3001"))).status).toBe(200);
      expect((await a.request("/api/health", req(TAILNET))).status).toBe(200);
      const refused = await a.request("/api/health", req("evil.example"));
      expect(refused.status).toBe(403);
      expect(await refused.text()).toBe("Förfrågan avvisad.");
      // Every route, not only /api: the pages Enable Banking links to as well.
      expect((await a.request("/privacy", req("evil.example"))).status).toBe(403);
      expect((await a.request("/api/data/export?format=json", req("evil.example"))).status).toBe(403);
      expect(lines).toContain("Avvisad förfrågan (Host: evil.example): GET /api/health");
    } finally {
      restore();
    }
  });

  it("takes the bank's callback, coming from the bank's site", async () => {
    const { a, restore } = app();
    try {
      const r = await a.request("/api/enable-banking/callback?error=access_denied", req(TAILNET, { headers: { "sec-fetch-site": "cross-site" } }));
      // On to Inställningar with the outcome, as before.
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toMatch(/^\/installningar\?/);
    } finally {
      restore();
    }
  });

  it("takes an upload from its own page, and refuses the same from another site", async () => {
    const { a, restore } = app();
    try {
      const csv = fs.readFileSync(path.join(import.meta.dirname, "fixtures/bank/SWEDBANK - UTTAG PRIVATKONTO.csv"));
      const form = () => {
        const f = new FormData();
        f.append("files", new File([csv], "export.csv"));
        f.append("dryRun", "1");
        return f;
      };
      const own = await a.request("/api/imports", req(TAILNET, { method: "POST", body: form(), origin: `https://${TAILNET}` }));
      expect(own.status).toBe(200);
      const dev = await a.request("/api/imports", req("127.0.0.1:3001", { method: "POST", body: form(), origin: "http://localhost:5173" }));
      expect(dev.status).toBe(200);
      const foreign = await a.request("/api/imports", req(TAILNET, { method: "POST", body: form(), origin: "https://evil.example" }));
      expect(foreign.status).toBe(403);
    } finally {
      restore();
    }
  });
});
