import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { recurringExpenses, rentNotices, transactions } from "../db/schema.js";
import { chargePeriod } from "../recurring/amounts.js";
import type { RentNoticeLine } from "../import/rentNotice.js";

/** Hyresavier (/api/rent-notices): a fixed expense's notices, newest first, and each one's PDF. */
export function rentNoticeRoutes(db: Db) {
  const app = new Hono();

  /** ?expenseId=: with whether the period's charge has come (the notice paid). */
  app.get("/", (c) => {
    const expenseId = Number(c.req.query("expenseId"));
    const e = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, expenseId)).get();
    if (!e) return c.json({ error: "Hittades inte." }, 404);
    const charges = db
      .select({ bookingDate: transactions.bookingDate, transactionDate: transactions.transactionDate, postedDate: transactions.postedDate, amount: transactions.amount })
      .from(transactions)
      .where(and(eq(transactions.recurringExpenseId, e.id), isNull(transactions.deletedAt)))
      .all();
    const list = db
      .select({
        id: rentNotices.id,
        issuer: rentNotices.issuer,
        number: rentNotices.number,
        noticeDate: rentNotices.noticeDate,
        dueDate: rentNotices.dueDate,
        rentMonth: rentNotices.rentMonth,
        period: rentNotices.period,
        amount: rentNotices.amount,
        lines: rentNotices.lines,
        bankgiro: rentNotices.bankgiro,
      })
      .from(rentNotices)
      .where(eq(rentNotices.recurringExpenseId, e.id))
      .orderBy(desc(rentNotices.rentMonth), desc(rentNotices.id))
      .all();
    return c.json(
      list.map((n) => {
        const paid = charges.find((t) => chargePeriod(e, t) === n.period);
        return { ...n, lines: JSON.parse(n.lines) as RentNoticeLine[], paid: paid ? { date: paid.bookingDate, amount: -paid.amount } : null };
      }),
    );
  });

  app.get("/:id/pdf", (c) => {
    const n = db.select({ pdf: rentNotices.pdf, number: rentNotices.number }).from(rentNotices).where(eq(rentNotices.id, Number(c.req.param("id")))).get();
    if (!n) return c.json({ error: "Hittades inte." }, 404);
    return c.body(new Uint8Array(n.pdf), 200, {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      // Opened to be read: inline, sandboxed so nothing inside the PDF can run or fetch anything.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `inline; filename="hyresavi-${n.number.replace(/\D/g, "")}.pdf"`,
    });
  });

  return app;
}
