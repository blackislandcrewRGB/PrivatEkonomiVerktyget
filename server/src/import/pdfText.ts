import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfItem {
  x: number;
  text: string;
}

export interface PdfLine {
  page: number;
  y: number;
  items: PdfItem[]; // sorted by x
}

/**
 * Extracts text from a (text-based) PDF as visual lines: items on the same
 * baseline (within 2pt) are grouped and sorted left to right. Keeping the x
 * position lets table parsers assign cells to columns instead of relying on
 * text order.
 */
export async function extractPdfLines(bytes: Uint8Array): Promise<PdfLine[]> {
  // pdfjs takes ownership of the buffer, so give it a copy.
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const out: PdfLine[] = [];
  try {
    const doc = await task.promise;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it): it is Extract<typeof it, { str: string }> => "str" in it && it.str.trim() !== "")
        .map((it) => ({ x: it.transform[4] as number, y: it.transform[5] as number, text: it.str.trim() }))
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const lines: PdfLine[] = [];
      for (const it of items) {
        const line = lines.find((l) => Math.abs(l.y - it.y) <= 2);
        if (line) line.items.push({ x: it.x, text: it.text });
        else lines.push({ page: p, y: it.y, items: [{ x: it.x, text: it.text }] });
      }
      for (const l of lines) l.items.sort((a, b) => a.x - b.x);
      out.push(...lines.sort((a, b) => b.y - a.y));
    }
  } finally {
    await task.destroy();
  }
  return out;
}
