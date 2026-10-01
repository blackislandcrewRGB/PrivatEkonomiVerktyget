import type { Db } from "../db/client.js";
import { contacts } from "../db/schema.js";
import { cardInvoices, expenseOccurrences, reviewCount, upcomingInvoices, variableRows } from "../overview/overview.js";
import { addDays } from "../overview/dates.js";
import { cashflow } from "../cashflow/cashflow.js";
import { getSetting, setSetting } from "../settings.js";
import { sendNtfy } from "../notify.js";

/**
 * Veckodigest, Sunday 19:00: the week that went (Monday–Sunday) in a few
 * lines, sent with ntfy and shown on the overview ('Veckan som gick'):
 * variable spending (my part) against the 8 weeks before, the three largest
 * purchases, next week's draws with their sum, how many rows to review, and
 * safe to spend. A title and at most 8 lines, as Markdown.
 */

const WEEKS_BACK = 8;
const SENT_KEY = "digest_sent";

const kr = (ore: number) => `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const span = (from: string, to: string) => (from.slice(5, 7) === to.slice(5, 7) ? `${Number(from.slice(8, 10))}–${dm(to)}` : `${dm(from)}–${dm(to)}`);

/** The Sunday ending the latest whole week: today on a Sunday, else the one before. */
export function weekEnding(today: string): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -weekday);
}

export interface Digest {
  from: string;
  to: string;
  title: string;
  lines: string[];
  markdown: string;
  /** The parts, for tests and the view. */
  spent: number;
  average: number;
  largest: { name: string; date: string; amount: number }[];
  coming: { name: string; date: string; amount: number }[];
  comingTotal: number;
  review: number;
  safeToSpend: number;
  lowest: { date: string; balance: number };
}

export function buildDigest(db: Db, today: string): Digest {
  const to = weekEnding(today);
  const from = addDays(to, -6);
  const spentIn = (a: string, b: string) => Math.round(-variableRows(db, a, b, "mine").reduce((s, r) => s + r.amount, 0)) || 0;
  const spent = spentIn(from, to);
  const average = Math.round(spentIn(addDays(from, -7 * WEEKS_BACK), addDays(from, -1)) / WEEKS_BACK);

  const names = new Map(db.select().from(contacts).all().map((c) => [c.counterparty, c.name]));
  const largest = variableRows(db, from, to, "household")
    .filter((r) => r.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 3)
    .map((r) => ({ name: r.label ?? (r.counterparty && names.get(r.counterparty)) ?? r.counterparty ?? r.descriptionClean, date: r.bookingDate, amount: -r.amount }));

  // Next week: fixed expenses still to be drawn (any account) and card invoices due.
  const next = { from: addDays(to, 1), to: addDays(to, 7) };
  const inNext = (d: string) => d >= next.from && d <= next.to && d >= today;
  const coming = [
    ...expenseOccurrences(db, today, null, next.to)
      .filter((o) => o.status === "kommande" && inNext(o.dueDate))
      .map((o) => ({ name: o.name, date: o.dueDate, amount: o.amount })),
    ...cardInvoices(db, today)
      .filter((i) => i.status !== "paid" && inNext(i.dueDate))
      .map((i) => ({ name: `${i.accountName}: faktura`, date: i.dueDate, amount: i.amountDue - i.paidAmount })),
    ...upcomingInvoices(db, today)
      .filter((u) => inNext(u.dueDate))
      .map((u) => ({ name: `${u.accountName}: faktura (uppskattad)`, date: u.dueDate, amount: u.estimate })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const comingTotal = coming.reduce((s, c) => s + c.amount, 0);

  const review = reviewCount(db);
  const cf = cashflow(db, today);

  const diff = average ? Math.round(((spent - average) / average) * 100) : null;
  const title = `Veckan som gick (${span(from, to)})`;
  const lines = [
    `**Rörligt, min del:** ${kr(spent)} (snitt ${WEEKS_BACK} veckor ${kr(average)}${diff === null ? "" : `, ${diff > 0 ? "+" : ""}${diff.toLocaleString("sv-SE")} %`})`,
    largest.length ? `**Största köp:** ${largest.map((l) => `${l.name} ${kr(l.amount)}`).join(", ")}` : "**Största köp:** inga",
    coming.length
      ? `**Nästa vecka:** ${coming.length} ${coming.length === 1 ? "dragning" : "dragningar"}, ${kr(comingTotal)}`
      : "**Nästa vecka:** inga dragningar",
    ...(coming.length ? [`${coming.slice(0, 4).map((c) => `${c.name} ${kr(c.amount)} ${dm(c.date)}`).join(", ")}${coming.length > 4 ? ` och ${coming.length - 4} till` : ""}`] : []),
    `**Att granska:** ${review}`,
    `**Safe to spend:** ${kr(cf.safeToSpend)} (lägst ${kr(cf.lowest.balance)} den ${dm(cf.lowest.date)})`,
  ].slice(0, 8);
  return {
    from,
    to,
    title,
    lines,
    markdown: lines.map((l) => `- ${l}`).join("\n"),
    spent,
    average,
    largest,
    coming,
    comingTotal,
    review,
    safeToSpend: cf.safeToSpend,
    lowest: cf.lowest,
  };
}

/** When it was last sent (ISO), or null. */
export const lastSent = (db: Db) => getSetting<string | null>(db, SENT_KEY, null);

/** Sends the digest to ntfy. False without a topic or when ntfy didn't take it. */
export async function sendDigest(db: Db, today: string, ntfyTopic: string, now = new Date()): Promise<{ digest: Digest; sent: boolean }> {
  const digest = buildDigest(db, today);
  const sent = ntfyTopic ? await sendNtfy(ntfyTopic, { title: digest.title, message: digest.markdown, tags: ["calendar"], markdown: true }) : false;
  if (sent) setSetting(db, SENT_KEY, now.toISOString());
  return { digest, sent };
}
