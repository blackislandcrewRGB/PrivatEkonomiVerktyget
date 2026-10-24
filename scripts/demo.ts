/**
 * Demo data: a database for a made-up household, to look around in without
 * entering anything of your own.
 *
 *   npm run db:demo                  # data/demo/finance-demo.db
 *   npm run db:demo -- other.db      # another file (under data/demo/)
 *   npm run demo                     # makes it, then starts the app on it (port 5174)
 *
 * The household has four accounts at the banks the importers know, six months
 * of bank exports (made up, see server/test/fixtures/generate-bank-fixtures.ts,
 * moved so that they end last month) read through the real importers, fixed
 * expenses, a salary, a partner to share costs with, an ISK with a fund and a
 * few shares, and example pensions. Everything is invented. The database is
 * never data/finance.db.
 */
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { ROOT_DIR } from "../server/src/config.js";
import { openDb, runMigrations } from "../server/src/db/client.js";
import { accounts, merchantRules, priceSnapshots, recurringExpenses, recurringIncome, transactions } from "../server/src/db/schema.js";
import { getCategoryPathMap, seed } from "../server/src/db/seed.js";
import { seedExampleHousehold } from "../server/src/db/exampleHousehold.js";
import { importFiles } from "../server/src/import/importBatch.js";
import { recategorizeUncategorized } from "../server/src/categorize/categorize.js";
import { linkRecurring } from "../server/src/recurring/link.js";
import { todayLocal } from "../server/src/overview/dates.js";
import { setOwnName, setSettlementStart } from "../server/src/settings.js";
import { createInstrument, createTrade } from "../server/src/savings/instruments.js";
import { setCash } from "../server/src/savings/portfolio.js";
import { setQuarterValue } from "../server/src/tax/isk.js";
import { ensureSeries, putPoints } from "../server/src/prices/series.js";
import { KPI_TOTAL } from "../server/src/salary/annualIncome.js";
import { listManualBalances, updateManualBalance } from "../server/src/networth/manualBalances.js";
import { generate } from "../server/test/fixtures/generate-bank-fixtures.js";

const DEMO_DIR = path.join(ROOT_DIR, "data/demo");
const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
const file = path.resolve(DEMO_DIR, arg ?? "finance-demo.db");
if (path.dirname(file) !== DEMO_DIR) throw new Error(`Demodatabasen ska ligga i ${DEMO_DIR}.`);
if (fs.existsSync(file)) {
  if (!process.argv.includes("--force")) {
    console.log(`${path.relative(ROOT_DIR, file)} finns redan. Använd den, eller ta bort den (eller kör med --force) för att göra en ny.`);
    process.exit(0);
  }
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}
fs.mkdirSync(DEMO_DIR, { recursive: true });

const db = openDb(file);
runMigrations(db);
seed(db);
seedExampleHousehold(db);

// ---------- Where in time ----------

const today = todayLocal();
const month = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
// The made-up exports end 2026-09-18: moved by whole months so they end on the 18th, this month or last.
const shift = month(today) - month("2026-09-18") - (Number(today.slice(8)) < 18 ? 1 : 0);
const addMonths = (iso: string, n: number) => {
  const t = month(iso) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-${iso.slice(8)}`;
};
const lastImport = addMonths("2026-09-18", shift);

// ---------- The bank exports, through the real importers ----------

const made = generate(shift);
const names = ["SWEDBANK - UTTAG PRIVATKONTO.csv", "SWEDBANK - Insättningar PRIVATKONTO.csv", "SWEDBANK - Uttag ESPARKONTO.csv", "SWEDBANK - Insättningar ESPARKONTO.csv", "Augusti.xlsx", "September.xlsx"];
const batch = await importFiles(
  db,
  names.map((name) => ({ name: name.replace(/^Augusti|^September/, (m) => `Bank Norwegian ${m}`), bytes: made[name] })),
);
for (const f of batch.files) if (!f.ok) throw new Error(`${f.filename}: ${f.error}`);

// ---------- Categories, rules, fixed expenses ----------

const paths = getCategoryPathMap(db);
const cat = (p: string) => {
  const id = paths.get(p);
  if (id === undefined) throw new Error(`Okänd kategori ${p}`);
  return id;
};
const account = (name: string) => db.select().from(accounts).where(eq(accounts.name, name)).get()!;
const privat = account("Swedbank Privatkonto");
const espar = account("Swedbank e-sparkonto");

db.insert(merchantRules).values({ pattern: "EXEMPELHEM", matchType: "contains", categoryId: cat("Boende/Hyra"), createdFrom: "manual" }).run();
recategorizeUncategorized(db);

type Fixed = { name: string; amount: number; day: number; match: string; category: string; account: typeof privat; method: "autogiro" | "card"; shared?: boolean };
const FIXED: Fixed[] = [
  { name: "Hyra", amount: 750000, day: 25, match: "EXEMPELHEM", category: "Boende/Hyra", account: espar, method: "autogiro", shared: true },
  { name: "CSN", amount: 150000, day: 25, match: "CSN", category: "Lån & avbetalning/CSN", account: espar, method: "autogiro" },
  { name: "Bredband och mobil", amount: 57800, day: 28, match: "TELE2", category: "IT & tele/Bredband & mobil", account: espar, method: "autogiro", shared: true },
  { name: "Hemförsäkring", amount: 23100, day: 30, match: "TRE KRONOR", category: "Försäkring", account: espar, method: "autogiro", shared: true },
  { name: "Olycksfallsförsäkring", amount: 18900, day: 1, match: "IF SKADEF", category: "Försäkring", account: espar, method: "autogiro" },
  { name: "A-kassa", amount: 15000, day: 5, match: "AKASSA", category: "Försäkring/A-kassa", account: espar, method: "autogiro" },
  { name: "Bankavgift", amount: 2900, day: 10, match: "NYCKELKUND", category: "Bank & avgifter", account: espar, method: "autogiro" },
  { name: "Gym", amount: 29900, day: 2, match: "FITNESS24", category: "Hälsa/Träning", account: espar, method: "autogiro" },
  { name: "Appar", amount: 2900, day: 3, match: "APPLE.COM/BILL", category: "Nöje/Streaming", account: privat, method: "card" },
  { name: "YouTube Premium", amount: 12900, day: 11, match: "YouTubeP", category: "Nöje/Streaming", account: privat, method: "card" },
  { name: "Spotify", amount: 11900, day: 15, match: "SpotifySE", category: "Nöje/Streaming", account: privat, method: "card", shared: true },
  { name: "GitHub", amount: 3940, day: 17, match: "GITHUB", category: "AI & utveckling/Mjukvara", account: privat, method: "card" },
];
for (const f of FIXED) {
  db.insert(recurringExpenses)
    .values({
      name: f.name,
      amount: f.amount,
      anchorDay: f.day,
      paymentMethod: f.method,
      dateBasis: f.method === "card" ? "transaction" : "booking",
      accountId: f.account.id,
      matchPattern: f.match,
      shared: f.shared ?? false,
      categoryId: cat(f.category),
    })
    .run();
}
db.insert(recurringIncome).values({ name: "Lön", amount: 2450000, dayOfMonth: 25, accountId: espar.id, matchPattern: "LÖN" }).run();
linkRecurring(db);
const csn = db.select().from(recurringExpenses).where(eq(recurringExpenses.name, "CSN")).get();
const csnBalance = listManualBalances(db).find((b) => b.key === "csn");
if (csn && csnBalance) updateManualBalance(db, csnBalance.id, { recurringExpenseId: csn.id });

// ---------- Sharing with the partner ----------

setOwnName(db, "Sam");
// Groceries and eating out are shared, from the first full month of the exports.
const food = [cat("Mat/Livsmedel"), cat("Mat/Restaurang & café")];
db.update(transactions).set({ shared: true }).where(sql`${transactions.categoryId} in (${sql.join(food.map((id) => sql`${id}`), sql`, `)}) and ${transactions.amount} < 0`).run();
setSettlementStart(db, addMonths(lastImport, -2).slice(0, 7));

// ---------- Balances ----------

const set = (id: number, balance: number) => db.update(accounts).set({ balance, balanceUpdatedAt: lastImport }).where(eq(accounts.id, id)).run();
set(privat.id, 620000);
set(espar.id, 4180000);

// ---------- The ISK ----------

const fund = createInstrument(db, { name: "Exempelfond Global Index", isin: "IE00EXEMPEL1", currency: "SEK", kind: "etf", zone: "base" });
const shares = createInstrument(db, { name: "Exempelbolaget B", isin: "SE0000000001", currency: "SEK", kind: "stock", zone: "bet" });
const buy = (instrumentId: number, date: string, qty: number, price: number) =>
  createTrade(db, { instrumentId, account: "isk", side: "buy", date, quantityE4: qty * 10_000, priceE4: Math.round(price * 10_000), feeOre: 0 });
for (let i = 0; i < 6; i++) {
  // 3 000 kr a month into the fund (the 'Swish Avanza' transfers), at a price that rises a little.
  buy(fund.id, addMonths("2026-03-26", shift + i), 10, 280 + i * 4);
}
buy(shares.id, addMonths("2026-06-02", shift), 40, 112);
const price = (instrumentId: number, date: string, p: number) =>
  db.insert(priceSnapshots).values({ instrumentId, date, priceE4: Math.round(p * 10_000), currency: "SEK", source: "demo" }).onConflictDoNothing().run();
for (let i = 0; i <= 6; i++) price(fund.id, addMonths("2026-03-26", shift + i), 280 + i * 4);
price(fund.id, lastImport, 305);
price(shares.id, addMonths("2026-06-02", shift), 112);
price(shares.id, lastImport, 118);
setCash(db, "isk", lastImport, 85000);
// A quarter starts on the 1st of Jan, Apr, Jul or Oct: moved by whole quarters, so it still is one.
for (const [d, v] of [["2026-01-01", 2350000], ["2026-04-01", 2610000]] as const) setQuarterValue(db, addMonths(d, Math.floor(shift / 3) * 3).slice(0, 10), v);

// Consumer prices (made up: about 2 % a year), for the savings after inflation.
const kpi = ensureSeries(db, { key: KPI_TOTAL, name: "KPI totalt", unit: "index", source: "demo", frequency: "monthly" });
putPoints(
  db,
  kpi,
  Array.from({ length: 30 }, (_, i) => {
    const m = addMonths("2025-01-01", shift + i - 9);
    return { date: `${m.slice(0, 7)}-01`, value: Math.round(33_000 * 1.0016 ** i) };
  }),
);

db.$client.close();
console.log(`Demodatabas klar: ${path.relative(ROOT_DIR, file)} (bankfilerna slutar ${lastImport}).`);
console.log("Starta appen på den med: npm run demo");
