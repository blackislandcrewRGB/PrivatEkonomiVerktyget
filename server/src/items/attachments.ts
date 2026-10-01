import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { AttachmentKind } from "./items.js";

/**
 * Pictures and receipts for a pryl: files under data/attachments/<item_id>/,
 * next to the database and outside git, the way merchant icons are.
 *
 * A picture is re-encoded to WebP (at most 2000 px) and a receipt PDF is kept
 * as it came, because it can't be re-encoded — those are the only two things
 * ever served back, and both go out with a fixed content type and nosniff.
 * An iPhone's HEIC and a PDF's first page are turned into something sharp can
 * read by macOS's own `sips`; without it (another platform, an odd file) the
 * PDF simply gets no thumbnail and the view draws a PDF symbol instead.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
/** More than this on one thing is an album, not a pryl. */
export const MAX_ATTACHMENTS_PER_ITEM = 20;
/** The big picture in the detail view, and the one in the gallery. */
export const IMAGE_SIZE = 2000;
export const THUMB_SIZE = 480;
/**
 * How far a pixel may differ from the corner's colour and still count as
 * border. A product picture copied from a shop is often a screenshot with a
 * wide white margin; trimming it is what makes the thing fill its card.
 */
const TRIM_THRESHOLD = 10;
/** Trimming that removes less than this isn't worth a second encoding. */
const TRIM_MIN_GAIN = 0.02;
/**
 * ...and one that leaves almost nothing found a speck on an empty sheet, not
 * a border. A screenshot of a small product on a big white page legitimately
 * leaves a tenth of itself, so this only catches the absurd.
 */
const TRIM_MIN_LEFT = 0.02;
/** What /api/attachments serves: <item id>/<content hash>[-thumb].<type>. */
export const ATTACHMENT_FILE = /^(\d+)\/([0-9a-f]{20}(?:-thumb)?\.(?:webp|pdf))$/;

export class AttachmentError extends Error {}

type Kind = "png" | "jpg" | "webp" | "heic" | "pdf";

/** data/attachments for data/finance.db; a temporary folder for an in-memory database (tests). */
export function attachmentsDir(dbFile: string): string {
  if (dbFile === ":memory:") return fs.mkdtempSync(path.join(os.tmpdir(), "privatekonomi-attachments-"));
  return path.join(path.dirname(dbFile), "attachments");
}

/** The type is read from the bytes, never from what the browser says the file is called. */
function sniff(b: Buffer): Kind | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  // HEIC/HEIF (and AVIF) are ISO base media files: 'ftyp' then the brand.
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif)/.test(b.toString("latin1", 8, 12))) {
    return "heic";
  }
  return null;
}

const KINDS: Record<Kind, string> = { png: "PNG", jpg: "JPG", webp: "WebP", heic: "HEIC", pdf: "PDF" };
const IMAGE_KINDS: Kind[] = ["png", "jpg", "webp", "heic"];
const execFileAsync = promisify(execFile);

/**
 * macOS's own converter, the way to read an iPhone photo and a PDF's first
 * page: sharp's libvips has neither HEVC nor a PDF reader. Returns null when
 * it isn't there or can't do it.
 */
async function sipsToPng(bytes: Buffer, suffix: string): Promise<Buffer | null> {
  if (process.platform !== "darwin") return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privatekonomi-sips-"));
  const input = path.join(dir, `in${suffix}`);
  const output = path.join(dir, "out.png");
  try {
    fs.writeFileSync(input, bytes);
    await execFileAsync("sips", ["-s", "format", "png", input, "--out", output], { timeout: 20_000 });
    return fs.existsSync(output) ? fs.readFileSync(output) : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** What an item's files are called on disk, as stored in file_path ('12/ab….webp'). */
const rel = (itemId: number, name: string) => `${itemId}/${name}`;

export interface SavedAttachment {
  kind: AttachmentKind;
  filePath: string;
  thumbnailPath: string | null;
  originalFilename: string | null;
}

/** Only the name, never a path, and never long enough to be a problem. */
function cleanFilename(name: string | null | undefined): string | null {
  const base = path.basename((name ?? "").replace(/\\/g, "/")).trim();
  return base === "" || base === "." || base === ".." ? null : base.slice(0, 120);
}

/**
 * Validates, converts and stores one file; returns what to write in
 * item_attachments. Throws AttachmentError with a message for the user.
 */
export async function saveAttachment(
  dir: string,
  itemId: number,
  bytes: Buffer,
  opts: { filename?: string | null; kind?: AttachmentKind } = {},
): Promise<SavedAttachment> {
  if (bytes.length === 0) throw new AttachmentError("Filen är tom.");
  const type = sniff(bytes);
  if (!type) throw new AttachmentError("Bara JPG, PNG, WebP, HEIC eller PDF går att lägga in.");
  const mb = (n: number) => Math.round(n / (1024 * 1024));
  const limit = type === "pdf" ? MAX_RECEIPT_BYTES : MAX_IMAGE_BYTES;
  if (bytes.length > limit) {
    throw new AttachmentError(`Filen är ${mb(bytes.length)} MB, högst ${mb(limit)} MB går för ${KINDS[type]}.`);
  }

  const itemDir = path.join(dir, String(itemId));
  fs.mkdirSync(itemDir, { recursive: true });
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 20);
  // A PDF is a receipt unless the upload says otherwise; a picture is a picture.
  const kind: AttachmentKind = opts.kind ?? (type === "pdf" ? "receipt" : "image");
  const originalFilename = cleanFilename(opts.filename);

  if (type === "pdf") {
    fs.writeFileSync(path.join(itemDir, `${hash}.pdf`), bytes);
    const page = await sipsToPng(bytes, ".pdf");
    let thumbnailPath: string | null = null;
    if (page) {
      try {
        const thumb = await sharp(page).resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        fs.writeFileSync(path.join(itemDir, `${hash}-thumb.webp`), thumb);
        thumbnailPath = rel(itemId, `${hash}-thumb.webp`);
      } catch {
        thumbnailPath = null;
      }
    }
    return { kind, filePath: rel(itemId, `${hash}.pdf`), thumbnailPath, originalFilename };
  }

  let source = bytes;
  if (type === "heic") {
    const png = await sipsToPng(bytes, ".heic");
    if (!png) throw new AttachmentError("HEIC-bilden gick inte att läsa. Spara om den som JPEG och försök igen.");
    source = png;
  }
  // A plain border around the picture is cut away, so the thing itself fills
  // the frame. It is only used when it really was a border: a picture that is
  // already tight comes back unchanged, and one that all but disappears was
  // never a margin in the first place.
  let rotated = true;
  try {
    const before = await sharp(source).metadata();
    const trimmed = await sharp(source, { limitInputPixels: 20000 * 20000 }).rotate().trim({ threshold: TRIM_THRESHOLD }).toBuffer({ resolveWithObject: true });
    const area = (w?: number, h?: number) => (w ?? 0) * (h ?? 0);
    const left = area(trimmed.info.width, trimmed.info.height) / (area(before.width, before.height) || 1);
    if (left <= 1 - TRIM_MIN_GAIN && left >= TRIM_MIN_LEFT && trimmed.info.width >= 32 && trimmed.info.height >= 32) {
      source = trimmed.data;
      rotated = false; // the rotation is already in these bytes
    }
  } catch {
    // Nothing to trim (a picture of one colour, say): keep it as it came.
  }
  let full: Buffer;
  let thumb: Buffer;
  try {
    const image = () => {
      const s = sharp(source, { limitInputPixels: 20000 * 20000 });
      return rotated ? s.rotate() : s;
    };
    full = await image().resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    thumb = await image().resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new AttachmentError("Bilden gick inte att läsa.");
  }
  fs.writeFileSync(path.join(itemDir, `${hash}.webp`), full);
  fs.writeFileSync(path.join(itemDir, `${hash}-thumb.webp`), thumb);
  return { kind, filePath: rel(itemId, `${hash}.webp`), thumbnailPath: rel(itemId, `${hash}-thumb.webp`), originalFilename };
}

/** The URL the web app asks for a stored file ('12/ab….webp' -> '/api/attachments/12/ab….webp'). */
export const attachmentUrl = (filePath: string | null): string | null => (filePath ? `/api/attachments/${filePath}` : null);
