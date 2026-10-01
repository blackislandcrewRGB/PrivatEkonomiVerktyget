import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, recurringIncome, transactions } from "../db/schema.js";
import { categoryIdByKey } from "../db/seed.js";
import { merchantText } from "../categorize/counterparty.js";
import { todayLocal } from "../overview/dates.js";

export interface IncomeSuggestion {
  name: string;
  accountId: number;
  accountName: string;
  amount: number; // öre, rounded to whole kronor
  dayOfMonth: number;
  matchPattern: string;
  basedOn: { bookingDate: string; amount: number }[];
}

const MAX_AGE_DAYS = 62;

/**
 * Suggests a recurring 'Lön' per account from its three latest salary rows:
 * average amount and the most common booking day. Only for accounts with a
 * recent salary and no active recurring income already matching it. Never
 * saved automatically; the user confirms.
 */
export function suggestRecurringIncome(db: Db, today: string = todayLocal()): IncomeSuggestion[] {
  const salaryCategory = categoryIdByKey(db, "salary");
  if (salaryCategory === undefined) return [];
  const incomes = db.select().from(recurringIncome).where(eq(recurringIncome.active, true)).all();

  const out: IncomeSuggestion[] = [];
  for (const account of db.select().from(accounts).all()) {
    const rows = db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, account.id),
          eq(transactions.categoryId, salaryCategory),
          gt(transactions.amount, 0),
          isNull(transactions.deletedAt),
        ),
      )
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .limit(3)
      .all();
    if (rows.length < 3) continue;
    const ageDays = (Date.parse(today) - Date.parse(rows[0].bookingDate)) / 86_400_000;
    if (ageDays > MAX_AGE_DAYS) continue;

    const pattern = merchantText(rows[0].descriptionClean).toLocaleUpperCase("sv");
    const covered = incomes.some(
      (i) => i.accountId === account.id && i.matchPattern && rows[0].descriptionClean.toLocaleUpperCase("sv").includes(i.matchPattern.toLocaleUpperCase("sv")),
    );
    if (covered) continue;

    const days = rows.map((r) => Number(r.bookingDate.slice(8, 10)));
    const counts = new Map<number, number>();
    for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
    const top = Math.max(...counts.values());
    const dayOfMonth = top > 1 ? [...counts].find(([, n]) => n === top)![0] : [...days].sort((a, b) => a - b)[1];

    const avg = rows.reduce((s, r) => s + r.amount, 0) / rows.length;
    out.push({
      name: "Lön",
      accountId: account.id,
      accountName: account.name,
      amount: Math.round(avg / 100) * 100,
      dayOfMonth,
      matchPattern: pattern,
      basedOn: rows.map((r) => ({ bookingDate: r.bookingDate, amount: r.amount })),
    });
  }
  return out;
}
