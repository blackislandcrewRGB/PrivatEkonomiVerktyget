import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { receiptLines, transactions } from "../db/schema.js";
import { ReceiptError, parseReceipt, scrubReceiptText, type ParsedLine, type ParsedReceipt } from "../receipts/parse.js";
import { MAX_RECEIPT_PDF_BYTES, MAX_RECEIPT_TEXT, isPdf, receiptTextFromPdf } from "../receipts/pdf.js";
import {
  createReceipt,
  deleteReceipt,
  getReceipt,
  linesFor,
  listReceipts,
  receiptForTransaction,
  restoreReceipt,
  type ReceiptSource,
} from "../receipts/receipts.js";

/**
 * Kvitton (/api/receipts): what a purchase actually bought.
 *
 * Reading and saving are two steps on purpose. `POST /parse` only reads the
 * pasted text or the PDF and answers with the rows — nothing is written — so
 * the rows can be shown, checked against the purchase and corrected before
 * `POST /` stores them. Nothing here writes to a transaction: a receipt is
 * metadata, and no sum, category or settlement can move because of it.
 */

/** The transaction a receipt is being read for, and whether it fits. */
function purchase(db: Db, transactionId: number | null, totalOre: number | null) {
  if (transactionId === null) return null;
  const row = db.select().from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!row) throw new ReceiptError("Transaktionen finns inte.");
  return {
    id: row.id,
    bookingDate: row.bookingDate,
    transactionDate: row.transactionDate,
    descriptionClean: row.descriptionClean,
    /** Positive: what was paid, to compare with the receipt's total. */
    amountOre: Math.abs(row.amount),
    matchesTotal: totalOre !== null && Math.abs(row.amount) === totalOre,
    hasReceipt: !!receiptForTransaction(db, row.id),
  };
}

/** What the client sends back to save, after the user has looked the rows over. */
function toLines(value: unknown): ParsedLine[] {
  if (!Array.isArray(value)) throw new ReceiptError("Kvittot har inga rader.");
  return value.map((raw) => {
    const l = raw as Record<string, unknown>;
    const number = (v: unknown, what: string): number | null => {
      if (v === null || v === undefined || v === "") return null;
      if (typeof v !== "number" || !Number.isFinite(v)) throw new ReceiptError(`${what} ska vara ett tal.`);
      return v;
    };
    return {
      kind: l.kind as ParsedLine["kind"],
      name: typeof l.name === "string" ? l.name : "",
      quantityMilli: number(l.quantityMilli, "Antalet"),
      unit: l.unit === "st" || l.unit === "kg" ? l.unit : null,
      unitPriceOre: number(l.unitPriceOre, "Jämförpriset"),
      totalOre: number(l.totalOre, "Beloppet") ?? 0,
    };
  });
}

export function receiptRoutes(db: Db) {
  const app = new Hono();
  const guard = async (run: () => unknown): Promise<Response> => {
    try {
      return Response.json(await run());
    } catch (e) {
      if (e instanceof ReceiptError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
  };

  /**
   * Reads a receipt and answers with what it says. Writes nothing.
   *
   * Takes either JSON `{ text, transactionId }` or a form with a PDF `file`.
   * The date is the receipt's own when it states one, because that is the
   * truest source; otherwise the purchase's own day.
   */
  app.post("/parse", async (c) =>
    guard(async () => {
      let text: string;
      let source: ReceiptSource = "text";
      let transactionId: number | null = null;

      if (c.req.header("content-type")?.includes("multipart/form-data")) {
        const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
        const file = body.file;
        if (!(file instanceof File)) throw new ReceiptError("Ingen fil skickades.");
        if (file.size > MAX_RECEIPT_PDF_BYTES) throw new ReceiptError(`Filen är större än ${Math.round(MAX_RECEIPT_PDF_BYTES / (1024 * 1024))} MB.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isPdf(bytes)) throw new ReceiptError("Bara en PDF går att läsa. Kvittotext går att klistra in i stället.");
        text = await receiptTextFromPdf(bytes);
        source = "pdf";
        if (body.transactionId !== undefined && body.transactionId !== "") transactionId = Number(body.transactionId);
      } else {
        const body = (await c.req.json().catch(() => ({}))) as { text?: string; transactionId?: number | null };
        text = typeof body.text === "string" ? body.text : "";
        transactionId = body.transactionId ?? null;
      }
      if (text.length > MAX_RECEIPT_TEXT) throw new ReceiptError("Texten är för lång för att vara ett kvitto.");
      if (transactionId !== null && !Number.isInteger(transactionId)) throw new ReceiptError("Ogiltig transaktion.");

      const parsed: ParsedReceipt = parseReceipt(text);
      const tx = purchase(db, transactionId, parsed.totalOre);
      return {
        ...parsed,
        source,
        // Already clean, so what comes back to be saved carries no card number.
        rawText: scrubReceiptText(text),
        /** What the receipt itself said, null when it doesn't say. */
        receiptDate: parsed.purchaseDate,
        purchaseDate: parsed.purchaseDate ?? tx?.transactionDate ?? tx?.bookingDate ?? null,
        transaction: tx,
      };
    }),
  );

  /** The receipt of a purchase, with its rows, or null. */
  app.get("/transaction/:transactionId", (c) => {
    const receipt = receiptForTransaction(db, Number(c.req.param("transactionId")));
    return c.json(receipt ? { ...receipt, lines: linesFor(db, receipt.id) } : null);
  });

  /** Newest purchase first. Filters: from, to (purchase date), store. */
  app.get("/", (c) => {
    const p = c.req.query();
    const rows = listReceipts(db, { from: p.from, to: p.to, store: p.store as never });
    const ids = rows.map((r) => r.id);
    const counts = new Map<number, number>();
    if (ids.length) {
      db.select({ id: receiptLines.receiptId, n: sql<number>`count(*)` })
        .from(receiptLines)
        .where(ids.length <= 500 ? inArray(receiptLines.receiptId, ids) : undefined)
        .groupBy(receiptLines.receiptId)
        .all()
        .forEach((r) => counts.set(r.id, r.n));
    }
    return c.json({ rows: rows.map((r) => ({ ...r, lineCount: counts.get(r.id) ?? 0 })) });
  });

  app.get("/:id", (c) => {
    const receipt = getReceipt(db, Number(c.req.param("id")));
    return receipt && !receipt.deletedAt ? c.json(receipt) : c.json({ error: "Kvittot finns inte." }, 404);
  });

  /** Stores a receipt that has been read and looked over. */
  app.post("/", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return createReceipt(db, {
        transactionId: b.transactionId === null || b.transactionId === undefined ? null : Number(b.transactionId),
        store: b.store as never,
        storeArea: (b.storeArea as string) ?? null,
        purchaseDate: typeof b.purchaseDate === "string" ? b.purchaseDate : "",
        purchaseTime: (b.purchaseTime as string) ?? null,
        totalOre: typeof b.totalOre === "number" ? b.totalOre : NaN,
        statedItemCount: typeof b.statedItemCount === "number" ? b.statedItemCount : null,
        source: b.source === "pdf" ? "pdf" : "text",
        rawText: typeof b.rawText === "string" ? b.rawText : "",
        lines: toLines(b.lines),
      });
    }),
  );

  /** Soft delete, as everywhere else. The transaction is not touched. */
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    return deleteReceipt(db, id) ? c.json({ ok: true }) : c.json({ error: "Kvittot finns inte." }, 404);
  });

  app.post("/:id/restore", (c) =>
    guard(() => {
      const id = Number(c.req.param("id"));
      if (!restoreReceipt(db, id)) throw new ReceiptError("Kvittot finns inte.");
      return getReceipt(db, id)!;
    }),
  );

  return app;
}
