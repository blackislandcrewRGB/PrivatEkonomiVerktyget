/**
 * Brotli and gzip copies of the built web app's text files, next to them
 * (index-abc.js.br, index-abc.js.gz), which the server sends to a browser
 * that asks for them (serveWeb, precompressed). Done once when building,
 * at the highest levels, rather than on every request.
 *
 *   tsx scripts/precompress.ts dist/web
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const COMPRESSIBLE = /\.(js|css|html|svg|json|txt|webmanifest|map)$/;
const MIN_BYTES = 1024;

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("Ange mappen med det byggda: tsx scripts/precompress.ts dist/web");
  process.exit(2);
}

let before = 0;
let after = 0;
for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
  const file = path.join(entry.parentPath, entry.name);
  if (!entry.isFile() || !COMPRESSIBLE.test(file)) continue;
  const bytes = fs.readFileSync(file);
  if (bytes.length < MIN_BYTES) continue;
  const br = zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
  fs.writeFileSync(`${file}.br`, br);
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(bytes, { level: 9 }));
  before += bytes.length;
  after += br.length;
}
const kb = (n: number) => `${Math.round(n / 1024)} kB`;
console.log(`precompress: ${kb(before)} → ${kb(after)} med brotli`);
