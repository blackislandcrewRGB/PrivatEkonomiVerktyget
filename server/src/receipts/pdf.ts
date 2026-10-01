import { extractPdfLines } from "../import/pdfText.js";

/**
 * A receipt PDF (Willys and Rusta come as one from Kivra) as the text the
 * profiles read. The same reader as the bank invoices use, so a receipt is
 * text, never a picture: items on one baseline become one line, and the gaps
 * between the columns are kept as double spaces, which is how the profiles
 * tell a name from the amount to the right of it.
 */
export async function receiptTextFromPdf(bytes: Uint8Array): Promise<string> {
  const lines = await extractPdfLines(bytes);
  return lines.map((l) => l.items.map((i) => i.text).join("  ")).join("\n");
}

/** A receipt is a page or two; anything larger isn't one. */
export const MAX_RECEIPT_PDF_BYTES = 20 * 1024 * 1024;
/** The same for pasted text: a receipt is never a book. */
export const MAX_RECEIPT_TEXT = 100_000;

/** Read from the bytes, never from what the file is called. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}
