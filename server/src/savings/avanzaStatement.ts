import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { avanzaMovements, avanzaStatements, AVANZA_ACCOUNTS } from "../db/schema.js";
import { extractPdfLines } from "../import/pdfText.js";

/**
 * Avanza's kontobesked (PDF), for the ISK and the credit account linked to
 * it: a year's cash movements, each with the balance after it. Sparande
 * efter inflation takes the money put in and taken out from them, and the
 * credit's debt, where the bank's rows don't reach or don't tell (money into
 * the credit account pays the debt; the ISK borrows from it).
 *
 * Only the account's kind, the period, the opening and closing cash and the
 * movements (day, kind, amount, balance) are kept. Names, the personal
 * identity number, account numbers and the address on the statement are
 * never read into anything, the securities' names neither, and the file is
 * not kept.
 */

export class AvanzaStatementError extends Error {}

export type AvanzaAccount = (typeof AVANZA_ACCOUNTS)[number];

export interface ParsedMovement {
  date: string;
  kind: string;
  amountOre: number;
  balanceOre: number;
}

export interface ParsedStatement {
  account: AvanzaAccount;
  from: string;
  to: string;
  openingOre: number;
  closingOre: number;
  movements: ParsedMovement[];
}

const AMOUNT = String.raw`-?\d{1,3}(?: \d{3})*,\d{2}`;
const ore = (s: string) => Math.round(Number(s.replace(/\s/g, "").replace(",", ".")) * 100);
const KINDS: Record<string, AvanzaAccount> = { Investeringssparkonto: "isk", Kreditkonto: "credit" };

/** A security bought or sold, a dividend or its tax: the name isn't kept. */
export const SECURITY = "VÄRDEPAPPER";

/**
 * The statement from its lines (a line's cells joined by ' | ', as the PDF
 * lays them out). Throws when it isn't one, or when the balances don't add up
 * – a movement missed would otherwise count silently as return.
 */
export function parseStatementLines(lines: string[]): ParsedStatement {
  const head = lines.map((l) => /^Kontobesked \| Avanza Bank \| (\d{4}-\d{2}-\d{2}) - (\d{4}-\d{2}-\d{2})$/.exec(l.trim())).find(Boolean);
  if (!head) throw new AvanzaStatementError("Det här ser inte ut som ett kontobesked från Avanza.");
  const kind = lines.map((l) => /\| (Investeringssparkonto|Kreditkonto)(?: \||$)/.exec(l)).find(Boolean);
  if (!kind) throw new AvanzaStatementError("Kontotypen känns inte igen: bara investeringssparkonto (ISK) och kreditkonto läses in.");
  const cash = lines.map((l) => new RegExp(`^Likvida medel \\| (${AMOUNT}) \\| (${AMOUNT})$`).exec(l.trim())).find(Boolean);
  if (!cash) throw new AvanzaStatementError("Kontobeskedets likvida medel gick inte att läsa.");
  const openingOre = ore(cash[1]);
  const closingOre = ore(cash[2]);

  const movements: ParsedMovement[] = [];
  let inTransactions = false;
  let date = "";
  const cashLine = new RegExp(`^([A-ZÅÄÖ][A-ZÅÄÖ .]*?) \\| (${AMOUNT}) \\| (${AMOUNT})$`);
  const securityLine = new RegExp(`^(${AMOUNT}) \\| (${AMOUNT})$`);
  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith("Transaktionsredovisning")) inTransactions = true;
    if (!inTransactions) continue;
    // The booking day stands before its movement, alone or with the security's name.
    const d = /^(\d{4}-\d{2}-\d{2})(?:$| \|)/.exec(t);
    if (d) date = d[1];
    const c = cashLine.exec(t);
    const s = securityLine.exec(t);
    if (c && date) movements.push({ date, kind: c[1].trim(), amountOre: ore(c[2]), balanceOre: ore(c[3]) });
    else if (s && date) movements.push({ date, kind: SECURITY, amountOre: ore(s[1]), balanceOre: ore(s[2]) });
  }

  // Each balance is the one before plus the amount, and the last is the closing cash.
  let balance = openingOre;
  for (const m of movements) {
    if (Math.abs(balance + m.amountOre - m.balanceOre) > 1) {
      throw new AvanzaStatementError(`Kontobeskedet gick inte att läsa helt: saldot ${m.date} stämmer inte med rörelserna före. Inget är sparat.`);
    }
    balance = m.balanceOre;
  }
  if (Math.abs(balance - closingOre) > 1) throw new AvanzaStatementError("Kontobeskedet gick inte att läsa helt: rörelserna ger inte utgående saldo. Inget är sparat.");
  return { account: KINDS[kind[1]], from: head[1], to: head[2], openingOre, closingOre, movements };
}

export async function readAvanzaStatement(bytes: Uint8Array): Promise<ParsedStatement> {
  const lines = await extractPdfLines(bytes).catch(() => {
    throw new AvanzaStatementError("Filen gick inte att läsa som PDF.");
  });
  return parseStatementLines(lines.map((l) => l.items.map((i) => i.text).join(" | ")));
}

export interface StatementSummary {
  id: number;
  account: AvanzaAccount;
  periodFrom: string;
  periodTo: string;
  openingOre: number;
  closingOre: number;
  movements: number;
  /** Money put in and taken out (INSÄTTNING, UTTAG). */
  depositedOre: number;
  withdrawnOre: number;
}

/** Keeps a statement, replacing one for the same account and start. */
export function saveAvanzaStatement(db: Db, s: ParsedStatement): StatementSummary {
  const id = db.transaction((tx) => {
    const same = tx
      .select({ id: avanzaStatements.id })
      .from(avanzaStatements)
      .where(and(eq(avanzaStatements.account, s.account), eq(avanzaStatements.periodFrom, s.from)))
      .get();
    if (same) {
      tx.delete(avanzaMovements).where(eq(avanzaMovements.statementId, same.id)).run();
      tx.delete(avanzaStatements).where(eq(avanzaStatements.id, same.id)).run();
    }
    const row = tx
      .insert(avanzaStatements)
      .values({ account: s.account, periodFrom: s.from, periodTo: s.to, openingOre: s.openingOre, closingOre: s.closingOre })
      .returning({ id: avanzaStatements.id })
      .get();
    if (s.movements.length) tx.insert(avanzaMovements).values(s.movements.map((m, seq) => ({ statementId: row.id, seq, ...m }))).run();
    return row.id;
  });
  return listAvanzaStatements(db).find((x) => x.id === id)!;
}

export function listAvanzaStatements(db: Db): StatementSummary[] {
  const statements = db.select().from(avanzaStatements).orderBy(asc(avanzaStatements.account), asc(avanzaStatements.periodFrom)).all();
  const moves = statements.length ? db.select().from(avanzaMovements).where(inArray(avanzaMovements.statementId, statements.map((s) => s.id))).all() : [];
  return statements.map((s) => {
    const own = moves.filter((m) => m.statementId === s.id);
    return {
      id: s.id,
      account: s.account,
      periodFrom: s.periodFrom,
      periodTo: s.periodTo,
      openingOre: s.openingOre,
      closingOre: s.closingOre,
      movements: own.length,
      depositedOre: own.filter((m) => m.kind === "INSÄTTNING").reduce((a, m) => a + m.amountOre, 0),
      withdrawnOre: -own.filter((m) => m.kind === "UTTAG").reduce((a, m) => a + m.amountOre, 0),
    };
  });
}

export function deleteAvanzaStatement(db: Db, id: number): boolean {
  return db.transaction((tx) => {
    tx.delete(avanzaMovements).where(eq(avanzaMovements.statementId, id)).run();
    return tx.delete(avanzaStatements).where(eq(avanzaStatements.id, id)).run().changes > 0;
  });
}

// ---------- For Sparande efter inflation ----------

export interface AvanzaLedger {
  /** The days the ISK's statements cover, first to last. */
  coverage: { from: string; to: string };
  /** Money put in (+) and taken out (−) on the ISK and the credit account, in öre. The moves between them are left out. */
  ownFlows: { date: string; amount: number }[];
  /** The credit's balance at the start of a day (negative: debt). Nothing before its first statement. */
  creditAt(date: string): number;
  /** The ISK's cash at the start of a day; null outside the statements. */
  iskCashAt(date: string): number | null;
  /** Interest paid on the credit (and on a negative ISK balance) over [from, to], as a positive amount. */
  interestBetween(from: string, to: string): number;
}

/** The statements read in, as Sparande efter inflation uses them. Null without one for the ISK. */
export function avanzaLedger(db: Db): AvanzaLedger | null {
  const statements = db.select().from(avanzaStatements).orderBy(asc(avanzaStatements.periodFrom)).all();
  const isk = statements.filter((s) => s.account === "isk");
  if (!isk.length) return null;
  const moves = db
    .select()
    .from(avanzaMovements)
    .where(inArray(avanzaMovements.statementId, statements.map((s) => s.id)))
    .orderBy(asc(avanzaMovements.statementId), asc(avanzaMovements.seq))
    .all();
  const byAccount = (account: AvanzaAccount) => {
    const own = statements.filter((s) => s.account === account);
    return { statements: own, moves: own.flatMap((s) => moves.filter((m) => m.statementId === s.id)) };
  };
  // The balance at the start of a day: after the last movement before it, else the opening of the statement it falls in.
  const balanceAt = (account: AvanzaAccount, date: string): number | null => {
    const a = byAccount(account);
    if (!a.statements.length || date < a.statements[0].periodFrom) return null;
    const before = a.moves.filter((m) => m.date < date).at(-1);
    if (before) return before.balanceOre;
    return a.statements.find((s) => s.periodFrom <= date && date <= s.periodTo)?.openingOre ?? a.statements[0].openingOre;
  };
  return {
    coverage: { from: isk[0].periodFrom, to: isk.reduce((to, s) => (s.periodTo > to ? s.periodTo : to), isk[0].periodTo) },
    ownFlows: moves.filter((m) => m.kind === "INSÄTTNING" || m.kind === "UTTAG").map((m) => ({ date: m.date, amount: m.amountOre })),
    creditAt: (date) => balanceAt("credit", date) ?? 0,
    iskCashAt: (date) => balanceAt("isk", date),
    interestBetween: (from, to) => -moves.filter((m) => m.kind === "KAP DEB RÄNTA" && m.date >= from && m.date <= to).reduce((s, m) => s + m.amountOre, 0),
  };
}
