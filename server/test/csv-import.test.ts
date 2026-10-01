import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, merchantRules, transactions } from "../src/db/schema.js";
import { createApp } from "../src/app.js";
import { guessMapping, importCsv, parseAmount, parseCsv, parseDate, previewCsv, savedMapping, type CsvMapping } from "../src/import/csvImport.js";
import { freshDb } from "./helpers.js";

const bytes = (text: string) => new TextEncoder().encode(text);

/** A Swedish bank's layout: semicolons, ISO dates, comma decimals, a balance column after the amount. */
const SWEDISH = `Datum;Text;Belopp;Saldo
2026-09-03;ICA SUPERMARKET EXEMPEL;-245,50;34 254,50
2026-09-02;LÖN EXEMPELBOLAGET;24 500,00;34 500,00
2026-09-01;PIZZERIA ROMA;-129,00;10 000,00
`;

/** An English-language layout: commas, day/month/year, money out and money in in their own columns. */
const SPLIT = `Date,Description,Debit,Credit
01/09/2026,"Coffee, Exempelstad",45.00,
02/09/2026,Salary,,24500.00
03/09/2026,Exempel Hyresvärd,7500.00,
`;

/** Two title lines above the table, and no header on the table itself. */
const TITLED = `Kontoutdrag Exempelbanken
Period 2026-09-01 - 2026-09-30
20260901;Swish betalning;−100,00
20260902;Insättning;1 000,00
`;

const csv = (over: Partial<CsvMapping> = {}) => ({ ...guessMapping(bytes(SWEDISH)), ...over });

describe("reading a bank's CSV", () => {
  it("dates in the ways banks write them, and nothing that isn't a date", () => {
    expect(parseDate("2026-09-03", "iso")).toBe("2026-09-03");
    expect(parseDate("2026-09-03 14:22:10", "iso")).toBe("2026-09-03");
    expect(parseDate("20260903", "ymd")).toBe("2026-09-03");
    expect(parseDate("3/9/2026", "dmy-slash")).toBe("2026-09-03");
    expect(parseDate("03.09.2026", "dmy-dot")).toBe("2026-09-03");
    expect(parseDate("03-09-2026", "dmy-dash")).toBe("2026-09-03");
    expect(parseDate("09/03/2026", "mdy-slash")).toBe("2026-09-03");
    expect(parseDate("31/02/2026", "dmy-slash")).toBeNull();
    expect(parseDate("2026-09-03", "dmy-slash")).toBeNull();
    expect(parseDate("", "iso")).toBeNull();
  });

  it("amounts with either decimal mark, thousands separators and a real minus sign, never through a float", () => {
    expect(parseAmount("-1 234,56", ",")).toBe(-123_456);
    expect(parseAmount("1.234,56", ",")).toBe(123_456);
    expect(parseAmount("−45,5", ",")).toBe(-4_550);
    expect(parseAmount("1,234.56", ".")).toBe(123_456);
    expect(parseAmount("+99.9", ".")).toBe(9_990);
    expect(parseAmount("12", ",")).toBe(1_200);
    expect(parseAmount("0,07", ",")).toBe(7);
    expect(parseAmount("abc", ",")).toBeNull();
    expect(parseAmount("1,234", ",")).toBeNull();
    expect(parseAmount("", ".")).toBeNull();
  });

  it("guesses a Swedish layout: the delimiter, the header, the day, the text, the amount (not the balance) and the decimal mark", () => {
    expect(guessMapping(bytes(SWEDISH))).toMatchObject({ delimiter: ";", skipLines: 0, hasHeader: true, dateColumn: 0, dateFormat: "iso", textColumn: 1, amountMode: "signed", amountColumn: 2, decimal: ",", outIsNegative: true });
  });

  it("guesses a layout with money out and in in separate columns, and day/month/year dates", () => {
    expect(guessMapping(bytes(SPLIT))).toMatchObject({ delimiter: ",", hasHeader: true, dateColumn: 0, dateFormat: "dmy-slash", textColumn: 1, amountMode: "split", outColumn: 2, inColumn: 3, decimal: "." });
  });

  it("skips title lines above the table and finds the amount without column names", () => {
    expect(guessMapping(bytes(TITLED))).toMatchObject({ delimiter: ";", skipLines: 2, hasHeader: false, dateColumn: 0, dateFormat: "ymd", textColumn: 1, amountColumn: 2, decimal: "," });
  });

  it("reads rows with a mapping: money out is negative, a split file's columns are combined, a quoted comma stays in the text", () => {
    const swedish = parseCsv(bytes(SWEDISH), csv());
    expect(swedish.period).toEqual({ from: "2026-09-01", to: "2026-09-03" });
    expect(swedish.rows.map((r) => [r.bookingDate, r.descriptionClean, r.amount])).toEqual([
      ["2026-09-03", "ICA SUPERMARKET EXEMPEL", -24_550],
      ["2026-09-02", "LÖN EXEMPELBOLAGET", 2_450_000],
      ["2026-09-01", "PIZZERIA ROMA", -12_900],
    ]);
    const split = parseCsv(bytes(SPLIT), guessMapping(bytes(SPLIT)));
    expect(split.rows.map((r) => [r.descriptionClean, r.amount])).toEqual([
      ["Coffee, Exempelstad", -4_500],
      ["Salary", 2_450_000],
      ["Exempel Hyresvärd", -750_000],
    ]);
    const titled = parseCsv(bytes(TITLED), guessMapping(bytes(TITLED)));
    expect(titled.rows.map((r) => [r.bookingDate, r.amount])).toEqual([["2026-09-01", -10_000], ["2026-09-02", 100_000]]);
  });

  it("a card's export that writes spending as positive numbers can be flipped", () => {
    const file = "Datum;Text;Belopp\n2026-09-01;Kaffe;45,00\n2026-09-02;Inbetalning;-500,00\n";
    const rows = parseCsv(bytes(file), { ...guessMapping(bytes(file)), outIsNegative: false }).rows;
    expect(rows.map((r) => r.amount)).toEqual([-4_500, 50_000]);
  });

  it("a line that can't be read fails the whole file with the lines named, so a wrong mapping never imports half of it", () => {
    const broken = SWEDISH + "i går;Kaffe;mycket\n";
    expect(() => parseCsv(bytes(broken), csv())).toThrow(/1 rad gick inte att läsa/);
    try {
      parseCsv(bytes(broken), csv());
    } catch (e) {
      expect((e as { details: string[] }).details).toEqual(['Rad 5: går inte att läsa: datumet "i går", beloppet "mycket".']);
    }
    expect(() => parseCsv(bytes(SWEDISH), csv({ amountColumn: null }))).toThrow(/Välj kolumn för beloppet/);
    expect(() => parseCsv(bytes("Datum;Text;Belopp\n"), csv())).toThrow(/Hittar inga transaktioner/);
  });
});

describe("importing a CSV onto an account", () => {
  const made = () => {
    const db = freshDb({ seeded: true });
    const id = db.insert(accounts).values({ name: "Exempelbanken Lönekonto", source: "csv" }).returning().get().id;
    return { db, id };
  };

  it("imports, categorises with the rules, keeps the mapping for the account, and skips what is already there", () => {
    const { db, id } = made();
    const first = importCsv(db, bytes(SWEDISH), "sep.csv", id, csv());
    expect(first).toMatchObject({ source: "csv", rowsTotal: 3, rowsNew: 3, rowsSkipped: 0, period: { from: "2026-09-01", to: "2026-09-03" } });
    expect(db.select().from(transactions).all().map((t) => [t.source, t.accountId, t.amount])).toEqual([["csv", id, -24_550], ["csv", id, 2_450_000], ["csv", id, -12_900]]);
    // The mapping is what the account reads its next file with.
    expect(savedMapping(db, id)).toMatchObject({ delimiter: ";", amountColumn: 2 });
    const again = importCsv(db, bytes(SWEDISH + "2026-09-04;OKQ8 EXEMPELSTAD;-500,00;9 500,00\n"), "sep2.csv", id, savedMapping(db, id)!);
    expect(again).toMatchObject({ rowsTotal: 4, rowsNew: 1, rowsSkipped: 3 });
  });

  it("tells two identical purchases on one day apart, and doesn't take the second file's for new", () => {
    const { db, id } = made();
    const file = "Datum;Text;Belopp\n2026-09-01;SL biljett;-39,00\n2026-09-01;SL biljett;-39,00\n";
    expect(importCsv(db, bytes(file), "a.csv", id, guessMapping(bytes(file))).rowsNew).toBe(2);
    expect(importCsv(db, bytes(file), "b.csv", id, guessMapping(bytes(file))).rowsNew).toBe(0);
  });

  it("a dry run writes nothing and keeps no mapping", () => {
    const { db, id } = made();
    const r = importCsv(db, bytes(SWEDISH), "sep.csv", id, csv(), { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, rowsNew: 3 });
    expect(db.select().from(transactions).all()).toEqual([]);
    expect(savedMapping(db, id)).toBeNull();
  });

  it("is for accounts fed by CSV, or by nothing yet: an account with a bank's own importer is refused, and a plain one becomes CSV", () => {
    const db = freshDb({ seeded: true });
    const swedbank = db.select().from(accounts).where(eq(accounts.name, "Swedbank Privatkonto")).get()!;
    expect(() => importCsv(db, bytes(SWEDISH), "x.csv", swedbank.id, csv())).toThrow(/egna filer, inte som CSV/);
    expect(() => importCsv(db, bytes(SWEDISH), "x.csv", 9999, csv())).toThrow(/Kontot finns inte/);
    const plain = db.insert(accounts).values({ name: "Utan källa" }).returning().get();
    importCsv(db, bytes(SWEDISH), "x.csv", plain.id, csv());
    expect(db.select().from(accounts).where(eq(accounts.id, plain.id)).get()!.source).toBe("csv");
  });

  it("previews the file, what the mapping makes of it and, with an account, what importing would do; a bad mapping says why", () => {
    const { db, id } = made();
    const p = previewCsv(db, bytes(SWEDISH), "sep.csv", { accountId: id });
    expect(p).toMatchObject({ origin: "guessed", table: { columns: 4, header: ["Datum", "Text", "Belopp", "Saldo"], lines: 3 }, read: { count: 3 }, dryRun: { rowsNew: 3 } });
    expect(p.table.sample[0]).toEqual(["2026-09-03", "ICA SUPERMARKET EXEMPEL", "-245,50", "34 254,50"]);
    const bad = previewCsv(db, bytes(SWEDISH), "sep.csv", { accountId: id, mapping: { dateFormat: "dmy-slash" } });
    expect(bad).toMatchObject({ origin: "sent", dryRun: null });
    expect(bad.read).toMatchObject({ error: expect.stringMatching(/3 rader gick inte att läsa/) });
    importCsv(db, bytes(SWEDISH), "sep.csv", id, csv());
    expect(previewCsv(db, bytes(SWEDISH), "sep.csv", { accountId: id }).origin).toBe("saved");
    // A file the kept mapping can't read (another layout) is guessed afresh instead of failing.
    const other = previewCsv(db, bytes(SPLIT), "other.csv", { accountId: id });
    expect(other).toMatchObject({ origin: "guessed", mapping: { amountMode: "split", delimiter: "," }, read: { count: 3 } });
  });
});

describe("accounts and the CSV routes", () => {
  const app = () => {
    const db = freshDb({ seeded: true });
    return { db, app: createApp(db, { databasePath: ":memory:" }) };
  };
  const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const upload = (fields: Record<string, string>, text = SWEDISH) => {
    const form = new FormData();
    form.append("file", new File([text], "export.csv", { type: "text/csv" }));
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return { method: "POST", body: form };
  };

  it("makes an account, refuses a name that is taken, and removes an empty one", async () => {
    const { db, app: a } = app();
    const made = await a.request("/api/accounts", json("POST", { name: "Exempelbanken Lönekonto", kind: "bank", source: "csv" }));
    expect(made.status).toBe(201);
    const row = (await made.json()) as { id: number; source: string; trackBalance: boolean };
    expect(row).toMatchObject({ source: "csv", trackBalance: true });
    expect((await a.request("/api/accounts", json("POST", { name: " exempelbanken lönekonto " }))).status).toBe(409);
    expect((await a.request("/api/accounts", json("POST", { name: "" }))).status).toBe(400);
    expect((await a.request("/api/accounts", json("POST", { name: "X", kind: "pension" }))).status).toBe(400);
    expect((await a.request("/api/accounts", json("POST", { name: "Y", source: "nordea" }))).status).toBe(400);

    db.insert(transactions).values({ source: "csv", accountId: row.id, bookingDate: "2026-09-01", descriptionRaw: "X", descriptionClean: "X", amount: -100, fingerprint: "f" }).run();
    const refused = await a.request(`/api/accounts/${row.id}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    db.delete(transactions).run();
    expect((await a.request(`/api/accounts/${row.id}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(accounts).where(eq(accounts.id, row.id)).get()).toBeUndefined();
    expect((await a.request(`/api/accounts/${row.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("a Swedbank account with a product hint is the one picked for that product on the first import", async () => {
    // A new database: the example household's own Privatkonto would make the product ambiguous.
    const db = freshDb();
    const a = createApp(db, { databasePath: ":memory:" });
    const made = (await (await a.request("/api/accounts", json("POST", { name: "Mitt privatkonto", source: "swedbank", importHint: "Privatkonto" }))).json()) as { id: number; importHint: string };
    expect(made.importHint).toBe("Privatkonto");
    const { importSwedbankCsv } = await import("../src/import/importSwedbank.js");
    const { buildCsv } = await import("./helpers.js");
    const r = importSwedbankCsv(db, buildCsv([{ date: "2026-01-10", desc: "ICA KVANTUM EXEMPEL", amount: "-100.00" }]), "x.csv", { dryRun: true });
    expect(r.accounts[0]).toMatchObject({ accountId: made.id, resolvedBy: "hint" });
  });

  it("a credit card with the text of its bill's payment gets a rule that makes the payment a transfer to the card", async () => {
    const { db, app: a } = app();
    const bank = db.insert(accounts).values({ name: "Exempelbanken Lönekonto", source: "csv" }).returning().get();
    const card = (await (await a.request("/api/accounts", json("POST", { name: "Exempelkortet", kind: "credit_card", paymentText: "EXEMPELKORTET" }))).json()) as { id: number };
    expect(db.select().from(merchantRules).where(eq(merchantRules.counterAccountId, card.id)).all()).toMatchObject([{ pattern: "EXEMPELKORTET", isTransfer: true }]);
    const file = "Datum;Text;Belopp\n2026-09-05;EXEMPELKORTET faktura;-3 200,00\n";
    importCsv(db, bytes(file), "k.csv", bank.id, guessMapping(bytes(file)));
    expect(db.select().from(transactions).get()).toMatchObject({ isTransfer: true, counterAccountId: card.id });
    // Removing the card takes its rule with it.
    db.delete(transactions).run();
    expect((await a.request(`/api/accounts/${card.id}`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(merchantRules).where(eq(merchantRules.counterAccountId, card.id)).all()).toEqual([]);
  });

  it("previews and imports a file over HTTP, and answers 422 with the reason when it can't be read", async () => {
    const { db, app: a } = app();
    const id = db.insert(accounts).values({ name: "Exempelbanken Lönekonto", source: "csv" }).returning().get().id;
    const preview = (await (await a.request("/api/imports/csv/preview", upload({ accountId: String(id) }))).json()) as { read: { count: number }; dryRun: { rowsNew: number } };
    expect(preview).toMatchObject({ read: { count: 3 }, dryRun: { rowsNew: 3 } });
    expect(db.select().from(transactions).all()).toEqual([]);

    const done = await a.request("/api/imports/csv", upload({ accountId: String(id) }));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ source: "csv", rowsNew: 3 });
    // The kept mapping reads the next file without one being sent.
    const next = await a.request("/api/imports/csv", upload({ accountId: String(id) }, SWEDISH + "2026-09-09;COOP EXEMPEL;-80,00;1,00\n"));
    expect(await next.json()).toMatchObject({ rowsNew: 1, rowsSkipped: 3 });

    const noAccount = await a.request("/api/imports/csv", upload({}));
    expect(noAccount.status).toBe(422);
    const wrong = await a.request("/api/imports/csv", upload({ accountId: String(id), mapping: JSON.stringify({ dateFormat: "dmy-slash" }) }));
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/gick inte att läsa/);
    expect((await a.request("/api/imports/csv", { method: "POST", body: new FormData() })).status).toBe(422);
  });
});
