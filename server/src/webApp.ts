import path from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

/** A year: the build's files under /assets have their content's hash in the name. */
const ASSET_CACHE = "public, max-age=31536000, immutable";

/**
 * The built web app. The page itself (index.html, and every path of the
 * single-page app that gets it) is always asked for again (`no-cache`), so a
 * browser never keeps a page from an older build. A file under /assets that
 * doesn't exist is a 404: a page from an older build asking for its files
 * would otherwise get the page back as a script and stay blank. The text
 * files go as the brotli or gzip copy the build made beside them
 * (scripts/precompress.ts) to a browser that takes it.
 */
export function serveWeb(app: Hono, webDir: string): void {
  app.use("*", async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    if (c.req.path.startsWith("/assets/")) c.header("Cache-Control", ASSET_CACHE);
    else if (c.res.headers.get("content-type")?.startsWith("text/html")) c.header("Cache-Control", "no-cache");
  });
  app.use("/assets/*", serveStatic({ root: webDir, precompressed: true }));
  app.get("/assets/*", (c) => c.text("Filen finns inte (sidan kan vara från ett äldre bygge: ladda om).", 404));
  app.use("/*", serveStatic({ root: webDir, precompressed: true }));
  // Single-page app: any other path gets index.html.
  app.get("*", serveStatic({ path: path.join(webDir, "index.html"), precompressed: true }));
}
