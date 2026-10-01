/**
 * Writes web/src/generated/brandIcons.ts: only the simple-icons the brand
 * table (server/src/icons/brands.ts) uses, so the web bundle doesn't carry
 * the package's thousands of icons. Run by dev:web and build:web; a test
 * checks the committed file is current.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_SLUGS } from "../server/src/icons/brands.js";
import { brandIconsModule } from "../server/src/icons/generate.js";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../web/src/generated/brandIcons.ts");
const text = await brandIconsModule(BRAND_SLUGS);
if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== text) {
  fs.writeFileSync(out, text);
  console.log(`brandIcons.ts: ${BRAND_SLUGS.length} ikoner`);
}
