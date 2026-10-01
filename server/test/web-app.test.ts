import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serveWeb } from "../src/webApp.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-"));
fs.mkdirSync(path.join(dir, "assets"));
fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><script type="module" src="/assets/index-NEW.js"></script>');
fs.writeFileSync(path.join(dir, "assets", "index-NEW.js"), "console.log(1)");
// What scripts/precompress.ts leaves beside a file.
fs.writeFileSync(path.join(dir, "assets", "index-NEW.js.br"), zlib.brotliCompressSync("console.log(1)"));
fs.writeFileSync(path.join(dir, "assets", "index-NEW.js.gz"), zlib.gzipSync("console.log(1)"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const app = new Hono();
serveWeb(app, dir);

describe("the built web app", () => {
  it("serves the page, and every path of the app, as never to be kept", async () => {
    for (const url of ["/", "/lon", "/installningar?oppen=lon"]) {
      const res = await app.request(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("keeps the hashed build files for a year", async () => {
    const res = await app.request("/assets/index-NEW.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("answers 404 for a build file that isn't there, not the page", async () => {
    const res = await app.request("/assets/index-OLD.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toMatch(/html/);
  });

  it("sends the brotli or gzip copy to a browser that takes it, and the file itself otherwise", async () => {
    const br = await app.request("/assets/index-NEW.js", { headers: { "Accept-Encoding": "gzip, deflate, br" } });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("content-type")).toMatch(/javascript/);
    expect(br.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(zlib.brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe("console.log(1)");
    const gz = await app.request("/assets/index-NEW.js", { headers: { "Accept-Encoding": "gzip" } });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const plain = await app.request("/assets/index-NEW.js");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe("console.log(1)");
  });
});
