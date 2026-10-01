import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/**
 * Uploaded merchant icons: PNG, JPG, WebP or SVG up to 200 kB, scaled to
 * 64×64 (contain, proportions kept, transparency kept), stored as
 * <content hash>.<ext> in the icons folder next to the database. The type is
 * read from the bytes, not from what the browser says. SVG is drawn to PNG,
 * so no uploaded SVG (scripts, links) is ever served; JPG becomes PNG too, so
 * the space around a non-square picture stays transparent.
 */

export const MAX_ICON_BYTES = 200 * 1024;
export const ICON_SIZE = 64;
/** What /api/icons serves: the hash and the stored type. */
export const ICON_FILE = /^[0-9a-f]{20}\.(png|webp)$/;

export class IconError extends Error {}

/** data/icons for data/finance.db; a temporary folder for an in-memory database (tests). */
export function iconsDir(dbFile: string): string {
  if (dbFile === ":memory:") return fs.mkdtempSync(path.join(os.tmpdir(), "privatekonomi-icons-"));
  return path.join(path.dirname(dbFile), "icons");
}

type Kind = "png" | "jpg" | "webp" | "svg";

function sniff(b: Buffer): Kind | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  const head = b.subarray(0, 2048).toString("utf8").replace(/^﻿/, "");
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/** An SVG that could run or fetch something is refused, even though it is only ever drawn to PNG. */
function unsafeSvg(text: string): boolean {
  return /<!ENTITY|<script|<foreignObject|\bon[a-z]+\s*=|(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)/i.test(text);
}

/** Validates, scales and stores an icon; returns its file name. Throws IconError with a message for the user. */
export async function saveIcon(dir: string, bytes: Buffer): Promise<string> {
  if (bytes.length === 0) throw new IconError("Filen är tom.");
  if (bytes.length > MAX_ICON_BYTES) throw new IconError(`Bilden är ${Math.ceil(bytes.length / 1024)} kB, högst 200 kB går.`);
  const kind = sniff(bytes);
  if (!kind) throw new IconError("Bara PNG, JPG, WebP eller SVG går.");
  if (kind === "svg" && unsafeSvg(bytes.toString("utf8"))) throw new IconError("SVG:n innehåller skript eller länkar och kan inte användas.");
  let out: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 4096 * 4096, density: kind === "svg" ? 300 : undefined }).resize(ICON_SIZE, ICON_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    out = kind === "webp" ? await image.webp({ quality: 90 }).toBuffer() : await image.png({ compressionLevel: 9 }).toBuffer();
  } catch {
    throw new IconError("Bilden gick inte att läsa.");
  }
  const name = `${crypto.createHash("sha256").update(out).digest("hex").slice(0, 20)}.${kind === "webp" ? "webp" : "png"}`;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, out);
  return name;
}

/** Copies icons the backup folder doesn't have yet to backups/icons (names are content hashes, so nothing is overwritten). */
export function backupIcons(dir: string, backupRoot: string): number {
  if (!fs.existsSync(dir)) return 0;
  const target = path.join(backupRoot, "icons");
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((f) => ICON_FILE.test(f))) {
    if (fs.existsSync(path.join(target, f))) continue;
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(dir, f), path.join(target, f));
    n++;
  }
  return n;
}
