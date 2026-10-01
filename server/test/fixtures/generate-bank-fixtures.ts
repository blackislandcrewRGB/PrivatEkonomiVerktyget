/**
 * Makes the bank export fixtures the tests read: made-up Swedbank CSV exports
 * for a Privatkonto and an e-sparkonto, and made-up Bank Norwegian exports.
 * Everything in them is invented (merchants are ordinary chains, the Swish
 * numbers are the +46XX5550NNN kind, the account numbers are the ones the tests
 * already use). Deterministic: the same run gives the same files.
 *
 *   npx tsx server/test/fixtures/generate-bank-fixtures.ts
 *
 * The files are committed, so the tests don't depend on running this; run it
 * when a fixture should change, and update the numbers the tests expect.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";

const OUT = path.join(import.meta.dirname, "bank");

// ---------- A seeded random number generator ----------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20260918);
/** A made-up amount in kronor with öre, between lo and hi. */
const kr = (lo: number, hi: number) => Math.round((lo + random() * (hi - lo)) * 100) / 100;
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

// ---------- Days ----------

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
// The period is set by generate(): the fixtures' own (2026-03-19 to 2026-09-18), or those months
// moved by whole months, for demo data that ends in the present.
let SHIFT = 0;
let FROM = "";
let TO = "";
let days: string[] = [];
/** A date of the fixtures' own period, moved by the shift. */
const S = (d: string) => addMonths(d, SHIFT);
function addMonths(d: string, n: number): string {
  if (n === 0) return d;
  const total = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  // The 29th–31st fall back to the month's last day.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(Number(d.slice(8)), last)).padStart(2, "0")}`;
}
/** The same day of each month in the period (skipping months where it falls outside). */
const monthly = (dom: number) => days.filter((d) => Number(d.slice(8)) === dom);

// ---------- Swedbank ----------

const PRIVAT = { number: "1234561234", product: "Privatkonto", ref: "800001234561234" };
const ESPAR = { number: "1234565678", product: "e-sparkonto", ref: "800001234565678" };
const PARTNER = "+46765550019";
const PAPPA = "+46705550009";
const MAMMA = "+46705550005";
const UNKNOWN = "+46705550008";

interface Row {
  date: string;
  desc: string;
  ref?: string;
  amount: number;
}

const GROCERIES = ["K*LIDL 271 D", "K*ICA KVANTU", "K*WILLYS TAB", "ICA KVANTUM EXEM", "COOP KONSUM EXE"];
const RESTAURANTS = ["MCDONALDS EXEMPEL", "PIZZERIA ROMA", "K*MAX HAMBURG", "WAYNES COFFEE"];

/** Money out of the Privatkonto: card purchases, subscriptions, Swish. Transfers are added separately. */
function privatOut(): Row[] {
  const rows: Row[] = [];
  days.forEach((d, i) => {
    if (i % 3 === 0) rows.push({ date: d, desc: GROCERIES[(i / 3) % GROCERIES.length], amount: -kr(60, 480) });
    if (i % 11 === 4) rows.push({ date: d, desc: i % 2 ? "CIRCLE K SOLNA J" : "OKQ8 EXEMPELSTAD", amount: -kr(350, 780) });
    if (i % 14 === 6) rows.push({ date: d, desc: RESTAURANTS[(i / 14 - 0.5) % RESTAURANTS.length | 0], amount: -kr(90, 420) });
    if (i % 9 === 2) rows.push({ date: d, desc: "Swish AB STORSTOCKHOLM", ref: "AB STORSTOCKHOLM", amount: -39 });
    if (i % 20 === 8) rows.push({ date: d, desc: i % 40 === 8 ? "K*Systembola" : "Systembolaget", amount: -kr(120, 640) });
  });
  for (const d of monthly(3)) rows.push({ date: d, desc: "APPLE.COM/BILL", amount: -29 });
  for (const d of monthly(11)) rows.push({ date: d, desc: "GOOGLE *YouTubeP", amount: -129 });
  for (const d of monthly(15)) rows.push({ date: d, desc: "K*SpotifySE", amount: -119 });
  for (const d of monthly(17)) rows.push({ date: d, desc: "GITHUB, INC.", amount: -39.4 });
  for (const d of monthly(26)) rows.push({ date: d, desc: "Swish Avanza", ref: "Avanza", amount: -3000 });

  const one = (date: string, desc: string, amount: number, ref?: string) => rows.push({ date, desc, ref, amount: -amount });
  one(S("2026-05-12"), "FORDONSSKATT TRA", 2740);
  for (const d of [S("2026-04-08"), S("2026-06-20"), S("2026-08-15")]) one(d, "TRÄNGSELSKATT TR", 60);
  for (const d of [S("2026-04-09"), S("2026-07-10")]) one(d, "Infrastrukturavg", 20);
  one(S("2026-04-22"), "K*apotekhjar", 213);
  one(S("2026-08-03"), "K*apotekhjar", 89);
  one(S("2026-05-05"), "FOLKTANDVÅRD", 1150);
  one(S("2026-06-14"), "K*Elite Stad", 1890);
  one(S("2026-07-02"), "K*Quality Ho", 1240);
  one(S("2026-07-20"), "Swish Scandic Hotels A", 1007, "Scandic Hotels A");
  one(S("2026-04-02"), "UBER   *TRIP", 156);
  one(S("2026-06-11"), "UBER   *TRIP", 98.5);
  one(S("2026-06-21"), "GRILL± ÖST @ HÄR", 145);
  one(S("2026-05-18"), "LYSA", 1000);
  one(S("2026-07-14"), "AVANZA", 2000);
  one(S("2026-05-30"), `Swish skickad ${UNKNOWN}`, 250, UNKNOWN);
  one(S("2026-08-12"), `Swish skickad ${UNKNOWN}`, 100, UNKNOWN);
  for (const [d, a] of [[S("2026-04-05"), 300], [S("2026-04-19"), 120], [S("2026-05-03"), 450], [S("2026-05-24"), 90], [S("2026-06-08"), 600], [S("2026-07-05"), 200], [S("2026-08-09"), 350], [S("2026-09-12"), 150]] as const) {
    one(d, `Swish skickad ${PARTNER}`, a, PARTNER);
  }
  // Genuinely identical rows on one day: three pairs and a triple.
  for (const [d, desc, a, n] of [[S("2026-04-14"), "K*LIDL 271 D", 112, 2], [S("2026-05-20"), "K*ICA KVANTU", 64, 2], [S("2026-06-27"), "CIRCLE K SOLNA J", 500, 2], [S("2026-07-04"), "Swish AB STORSTOCKHOLM", 39, 3]] as const) {
    for (let k = 0; k < n; k++) one(d, desc, a, desc === "Swish AB STORSTOCKHOLM" ? "AB STORSTOCKHOLM" : undefined);
  }
  return rows;
}

/** Money into the Privatkonto: the partner's share, gifts. Transfers are added separately. */
function privatIn(): Row[] {
  const rows: Row[] = [];
  for (const d of monthly(25)) rows.push({ date: d, desc: `Swish mottagen ${PARTNER}`, ref: PARTNER, amount: kr(6800, 7900) });
  rows.push({ date: S("2026-05-02"), desc: `Swish mottagen ${PAPPA}`, ref: PAPPA, amount: 500 });
  rows.push({ date: S("2026-06-07"), desc: `Swish mottagen ${MAMMA}`, ref: MAMMA, amount: 300 });
  rows.push({ date: S("2026-08-02"), desc: `Swish mottagen ${UNKNOWN}`, ref: UNKNOWN, amount: 200 });
  return rows;
}

/** Autogiro and bills from the e-sparkonto. */
function esparOut(): Row[] {
  const rows: Row[] = [];
  const every = (dom: number, desc: string, amount: number) => {
    for (const d of monthly(dom)) rows.push({ date: d, desc, amount: -amount });
  };
  every(25, "EXEMPELHEM BOSTAD", 7500);
  every(25, "CSN", 1500);
  every(28, "TELE2", 578);
  every(30, "TRE KRONOR", 231);
  every(1, "IF SKADEFÖRS", 189);
  every(5, "AKASSA EXEMPEL", 150);
  every(10, "PRIS NYCKELKUND", 29);
  every(2, "FITNESS24", 299);
  // The cards' bills, one a month.
  for (const [d, a] of [[S("2026-04-25"), 6412.35], [S("2026-05-25"), 7120.8], [S("2026-06-25"), 5977.15], [S("2026-07-25"), 6830.0], [S("2026-08-25"), 7913.5]] as const) {
    rows.push({ date: d, desc: "Bank Norwegian", ref: "Bank Norwegian", amount: -a });
  }
  for (const [d, a] of [[S("2026-04-28"), 2210.4], [S("2026-05-28"), 1893.0], [S("2026-06-28"), 2540.75], [S("2026-07-28"), 1688.2], [S("2026-08-28"), 2305.9]] as const) {
    rows.push({ date: d, desc: "Mastercard Guld", ref: "Mastercard Guld", amount: -a });
  }
  return rows;
}

/** The salary and a little else into the e-sparkonto. Transfers are added separately. */
function esparIn(): Row[] {
  const rows: Row[] = [];
  for (const d of monthly(25)) rows.push({ date: d, desc: "LÖN", ref: "EXEMPELBOLAGET AB", amount: 24500 });
  for (const d of monthly(30)) rows.push({ date: d, desc: "Sparränta", amount: kr(8, 22) });
  rows.push({ date: S("2026-06-30"), desc: "Lön", ref: "EXEMPELBOLAGET AB", amount: 1500 });
  rows.push({ date: S("2026-05-14"), desc: "ÅTERBET IF", ref: "IF SKADEFORSAKRING", amount: 230 });
  return rows;
}

/** Transfers between the two accounts: one row on each, opposite signs, each carrying the other's number. */
const transfers = (): { date: string; amount: number; from: "privat" | "espar" }[] => [
  ...monthly(27).map((d) => ({ date: d, amount: 1500, from: "privat" as const })),
  ...monthly(1).map((d) => ({ date: d, amount: 6000, from: "espar" as const })),
  // The same amount as the vehicle tax, the day it was paid: a purchase that must not be taken for a transfer.
  { date: S("2026-05-12"), amount: 2740, from: "privat" },
  { date: S("2026-07-09"), amount: 2500, from: "espar" },
];

const HEADER = "Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp";

/** Windows-1252 bytes: the en dash is 0x96, the rest is Latin-1. */
const cp1252 = (text: string) => Buffer.from(text.replace(/–/g, "\x96"), "latin1");
const money = (x: number) => x.toFixed(2);
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** One Swedbank export file: newest first, CRLF, a metadata line, then the header. */
function csv(account: typeof PRIVAT, rows: Row[], created: string): Buffer {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date) || 0);
  const lines = [
    `* Transaktioner Period ${FROM}–${TO} Skapad ${TO} ${created} CEST`,
    HEADER,
    ...sorted.map((r, i) => [i + 1, "80000", account.number, q(account.product), "SEK", r.date, r.date, r.date, q(r.ref ?? r.desc), q(r.desc), money(r.amount)].join(",")),
  ];
  return cp1252(lines.join("\r\n") + "\r\n");
}

function swedbank() {
  const out: Record<"privat" | "espar", { out: Row[]; in: Row[] }> = {
    privat: { out: privatOut(), in: privatIn() },
    espar: { out: esparOut(), in: esparIn() },
  };
  for (const t of transfers()) {
    const [from, to] = t.from === "privat" ? (["privat", "espar"] as const) : (["espar", "privat"] as const);
    const ref = (a: "privat" | "espar") => (a === "privat" ? PRIVAT.ref : ESPAR.ref);
    out[from].out.push({ date: t.date, desc: "Överföring via internet", ref: ref(to), amount: -t.amount });
    out[to].in.push({ date: t.date, desc: "Överföring via internet", ref: ref(from), amount: t.amount });
  }
  const files: Record<string, Buffer> = {
    "SWEDBANK - UTTAG PRIVATKONTO.csv": csv(PRIVAT, out.privat.out, "13:27"),
    "SWEDBANK - Insättningar PRIVATKONTO.csv": csv(PRIVAT, out.privat.in, "13:28"),
    "SWEDBANK - Uttag ESPARKONTO.csv": csv(ESPAR, out.espar.out, "14:21"),
    "SWEDBANK - Insättningar ESPARKONTO.csv": csv(ESPAR, out.espar.in, "14:22"),
  };
  // The internet bank's "Transaktioner" export is the same list under another name.
  files["Transaktioner_2026-09-18_13-27-32.csv"] = files["SWEDBANK - UTTAG PRIVATKONTO.csv"];
  return files;
}

// ---------- Bank Norwegian (xlsx) ----------

interface NorwegianRow {
  date: string;
  text: string;
  type: "Köp" | "Betalning";
  amount: number;
  area: string | null;
  category: string | null;
}

const SHOPS: { text: string; area: string; category: string; lo: number; hi: number }[] = [
  { text: "LIDL271EXEMPELSTOCKSU", area: "EXEMPELSTAD", category: "GROCERY STORES/SUPERMARKETS", lo: 80, hi: 520 },
  { text: "ICA KVANTUM EXEMPEL", area: "EXEMPELSTAD", category: "GROCERY STORES/SUPERMARKETS", lo: 60, hi: 410 },
  { text: "WILLYS EXEMPELSTAD", area: "EXEMPELSTAD", category: "GROCERY STORES/SUPERMARKETS", lo: 90, hi: 450 },
  { text: "ICA NARA EXEMPELBY", area: "EXEMPELBY", category: "MISC FOOD STORES - DEFAULT", lo: 30, hi: 180 },
  { text: "PIZZERIA ROMA", area: "EXEMPELSTAD", category: "RESTAURANTS", lo: 110, hi: 330 },
  { text: "MCDONALDS EXEMPEL", area: "EXEMPELSTAD", category: "FAST FOOD RESTAURANTS", lo: 70, hi: 240 },
  { text: "OKQ8 EXEMPELSTAD", area: "EXEMPELSTAD", category: "AUTOMATED FUEL DISPENSERS", lo: 400, hi: 820 },
  { text: "SYSTEMBOLAGET", area: "EXEMPELSTAD", category: "PKG STORES/BEER/WINE/LIQUOR", lo: 140, hi: 700 },
  { text: "STADIUM EXEMPELSTAD", area: "EXEMPELSTAD", category: "DEPARTMENT STORES", lo: 300, hi: 900 },
];

/** Purchases on each of the given days, a few a week, newest last. */
function norwegianMonth(from: string, to: string, offset: number): NorwegianRow[] {
  const rows: NorwegianRow[] = [];
  for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
    if ((i + offset) % 2 === 0) {
      const shop = SHOPS[(i + offset) % SHOPS.length];
      rows.push({ date: d, text: shop.text, type: "Köp", amount: -kr(shop.lo, shop.hi), area: shop.area, category: shop.category });
    }
  }
  return rows;
}

// Excel stores a date as the days since 1899-12-30.
const serial = (s: string) => Math.round((day(s).getTime() - Date.UTC(1899, 11, 30, 12)) / 86_400_000);

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A workbook with one sheet 'transactions', the way Bank Norwegian's export has it: dates as date cells, amounts and text as strings. */
function norwegianXlsx(rows: NorwegianRow[], bookDays: (r: NorwegianRow) => string): Buffer {
  const header = ["TransactionDate", "Text", "Type", "Currency Amount", "Currency Rate", "Currency", "Amount", "Merchant Area", "Merchant Category", "BookDate", "ValueDate"];
  const strings: string[] = [];
  const sid = (s: string) => {
    let i = strings.indexOf(s);
    if (i < 0) i = strings.push(s) - 1;
    return i;
  };
  const cell = (ref: string, v: string | number | null, kind: "s" | "d" | "n") => {
    if (v === null) return "";
    if (kind === "s") return `<c r="${ref}" t="s"><v>${sid(String(v))}</v></c>`;
    if (kind === "d") return `<c r="${ref}" s="1"><v>${v}</v></c>`;
    return `<c r="${ref}"><v>${v}</v></c>`;
  };
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = [
    `<row r="1">${header.map((h, i) => cell(`${col(i)}1`, h, "s")).join("")}</row>`,
    ...rows.map((r, n) => {
      const y = n + 2;
      const amount = r.amount.toFixed(2).replace(/\.00$/, "");
      const book = bookDays(r);
      return `<row r="${y}">${[
        cell(`A${y}`, serial(r.date), "d"),
        cell(`B${y}`, r.text, "s"),
        cell(`C${y}`, r.type, "s"),
        cell(`D${y}`, amount, "s"),
        cell(`E${y}`, 1, "n"),
        cell(`F${y}`, "SEK", "s"),
        cell(`G${y}`, amount, "s"),
        cell(`H${y}`, r.area, "s"),
        cell(`I${y}`, r.category, "s"),
        cell(`J${y}`, serial(book), "d"),
        cell(`K${y}`, serial(r.type === "Betalning" ? r.date : addDays(book, 27)), "d"),
      ].join("")}</row>`;
    }),
  ].join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="transactions" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    // Style 1 is a date (the built-in format 14), style 0 the default.
    "xl/styles.xml": strToU8(
      `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  };
  files["xl/sharedStrings.xml"] = strToU8(`${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  // A fixed time in the archive, so the same run gives the same bytes.
  return Buffer.from(zipSync(files, { mtime: new Date(Date.UTC(2026, 8, 18, 12)) }));
}

function norwegian() {
  // August: purchases 31/7–30/8 are booked the day after; the bill paid 25/8 is a 'Betalning' row.
  const august = norwegianMonth(S("2026-07-31"), S("2026-08-30"), 0);
  august.push({ date: S("2026-08-25"), text: "Inbetalning", type: "Betalning", amount: 7913.5, area: null, category: null });
  const september = norwegianMonth(S("2026-08-31"), S("2026-09-15"), 1);
  const book = (r: NorwegianRow) => (r.type === "Betalning" ? r.date : addDays(r.date, 1));
  return {
    "Augusti.xlsx": norwegianXlsx(august.sort((a, b) => a.date.localeCompare(b.date)), book),
    "September.xlsx": norwegianXlsx(september.sort((a, b) => a.date.localeCompare(b.date)), book),
  };
}

// ---------- All of it ----------

/** Every fixture file by name. `shiftMonths` moves the whole period by whole months (demo data). */
export function generate(shiftMonths = 0): Record<string, Buffer> {
  SHIFT = shiftMonths;
  FROM = S("2026-03-19");
  TO = S("2026-09-18");
  days = [];
  for (let d = FROM; d <= TO; d = addDays(d, 1)) days.push(d);
  return { ...swedbank(), ...norwegian() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, bytes] of Object.entries(generate())) {
    fs.writeFileSync(path.join(OUT, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}
