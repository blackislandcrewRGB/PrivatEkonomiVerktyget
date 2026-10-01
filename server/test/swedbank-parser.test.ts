import { describe, expect, it } from "vitest";
import { ImportParseError, looksLikeSwedbankCsv, parseSwedbankCsv } from "../src/import/swedbank.js";
import { assignOccurrenceIndexes } from "../src/import/fingerprint.js";
import { decodeBankText, maskAccountNumber, normalizeWhitespace, parseAmountToOre } from "../src/import/text.js";
import { extractCounterparty } from "../src/categorize/counterparty.js";
import { HEADER, buildCsv, cp1252, csvLine, swedbankSample } from "./helpers.js";

describe("parseAmountToOre", () => {
  it.each([
    ["-3000.00", -300000],
    ["-129.90", -12990],
    ["-0.05", -5],
    ["100", 10000],
    ["+12.5", 1250],
    ["-12,50", -1250],
    ["−43.00", -4300],
    [" -1 234.00 ", -123400],
  ])("%s -> %i öre", (input, expected) => {
    expect(parseAmountToOre(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234.56", "-12.345", "12.", "1e3", "--5"])("rejects %j", (input) => {
    expect(parseAmountToOre(input)).toBeNull();
  });
});

describe("text helpers", () => {
  it("normalizes whitespace but keeps the characters", () => {
    expect(normalizeWhitespace("  Swish             skickad  +46765550019 ")).toBe("Swish skickad +46765550019");
    expect(normalizeWhitespace("GRILL± ÖST @ HÄR")).toBe("GRILL± ÖST @ HÄR");
    expect(normalizeWhitespace("A \tB")).toBe("A B");
  });

  it("masks account numbers to the last four digits", () => {
    expect(maskAccountNumber("1234561234")).toBe("••1234");
    expect(maskAccountNumber("5555 1234-1234 9999")).toBe("••9999");
  });

  it("decodes Windows-1252 and UTF-8 (with and without BOM) to the same text", () => {
    const text = "Överföring – räksmörgås ± @";
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
    expect(decodeBankText(cp1252(text))).toEqual({ text, encoding: "windows-1252" });
    expect(decodeBankText(Buffer.from(text, "utf8"))).toEqual({ text, encoding: "utf-8" });
    expect(decodeBankText(bom)).toEqual({ text, encoding: "utf-8" });
  });

  it("extracts counterparty for Swish numbers and merchants", () => {
    expect(extractCounterparty("Swish skickad +46765550019")).toBe("+46765550019");
    expect(extractCounterparty("Swish mottagen +46705550008")).toBe("+46705550008");
    expect(extractCounterparty("Swish AB STORSTOCKHOLM")).toBe("AB STORSTOCKHOLM");
    expect(extractCounterparty("ICA KVANTUM EXEM")).toBe("ICA KVANTUM EXEM");
  });
});

describe("parseSwedbankCsv on the made-up sample", () => {
  const { bytes } = swedbankSample();
  const file = parseSwedbankCsv(bytes);

  it("reads all 195 rows, the period and the encoding", () => {
    expect(file.rows).toHaveLength(195);
    expect(file.period).toEqual({ from: "2026-03-19", to: "2026-09-18" });
    expect(file.encoding).toBe("windows-1252");
    expect(looksLikeSwedbankCsv(bytes)).toBe(true);
  });

  it("parses the first data row", () => {
    expect(file.rows[0]).toMatchObject({
      line: 3,
      accountNumber: "1234561234",
      product: "Privatkonto",
      currency: "SEK",
      bookingDate: "2026-09-18",
      transactionDate: "2026-09-18",
      valueDate: "2026-09-18",
      descriptionClean: "K*ICA KVANTU",
      amount: -23329,
    });
    expect(file.rows.at(-1)!.line).toBe(197);
  });

  it("keeps raw descriptions, normalizes clean ones, handles commas and odd characters", () => {
    const uber = file.rows.find((r) => r.descriptionRaw.startsWith("UBER"))!;
    expect(uber.descriptionRaw).toBe("UBER   *TRIP");
    expect(uber.descriptionClean).toBe("UBER *TRIP");
    expect(file.rows.some((r) => r.descriptionClean === "GITHUB, INC.")).toBe(true);
    expect(file.rows.some((r) => r.descriptionClean === "GRILL± ÖST @ HÄR")).toBe(true);
    expect(file.rows.some((r) => r.descriptionClean === "Överföring via internet")).toBe(true);
  });

  it("finds the genuine identical rows and numbers them", () => {
    const indexed = assignOccurrenceIndexes(file.rows);
    // 3 pairs and 1 triple of identical rows in the sample => 3 + 2 = 5 repeats.
    expect(indexed.filter((r) => r.occurrenceIndex > 1)).toHaveLength(5);
    expect(Math.max(...indexed.map((r) => r.occurrenceIndex))).toBe(3);
    const keys = new Set(indexed.map((r) => `${r.fingerprint}#${r.occurrenceIndex}`));
    expect(keys.size).toBe(195);
  });

  it("gives identical fingerprints when the file is re-saved as UTF-8 or with LF line endings", () => {
    const text = new TextDecoder("windows-1252").decode(bytes);
    const variants = [
      Buffer.from(text, "utf8"),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]),
      cp1252(text.replace(/\r\n/g, "\n")),
    ];
    const expected = file.rows.map((r) => r.fingerprint);
    for (const v of variants) expect(parseSwedbankCsv(v).rows.map((r) => r.fingerprint)).toEqual(expected);
  });
});

describe("parseSwedbankCsv metadata line", () => {
  const rows = [{ date: "2026-01-15", desc: "LIDL 271 EXEMPEL", amount: "-100.00" }];

  it.each([
    ["spaces + en dash", "* Transaktioner Period 2026-01-01–2026-01-31 Skapad 2026-02-01 10:00 CEST"],
    ["commas", "*,Transaktioner,Period,2026-01-01 2026-01-31,Skapad,2026-02-01 10:00 CEST"],
    ["semicolons", "*;Transaktioner;Period;2026-01-01 2026-01-31;Skapad;2026-02-01 10:00 CEST"],
    ["hyphen", "* Transaktioner Period 2026-01-01 - 2026-01-31 Skapad 2026-02-01"],
    ["quoted", '"*","Transaktioner","Period","2026-01-01 2026-01-31","Skapad","2026-02-01"'],
  ])("reads the period with %s", (_, meta) => {
    expect(parseSwedbankCsv(buildCsv(rows, { meta })).period).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("falls back to the booking date range when there is no metadata line", () => {
    const f = parseSwedbankCsv(
      buildCsv(
        [
          { date: "2026-03-02", desc: "A", amount: "-1.00" },
          { date: "2026-02-10", desc: "B", amount: "-1.00" },
        ],
        { meta: null },
      ),
    );
    expect(f.period).toEqual({ from: "2026-02-10", to: "2026-03-02" });
    expect(f.rows).toHaveLength(2);
  });

  it("does not let the metadata line change fingerprints", () => {
    const a = parseSwedbankCsv(buildCsv(rows, { meta: "* Transaktioner Period 2025-01-01–2026-01-31" }));
    const b = parseSwedbankCsv(buildCsv(rows, { meta: null }));
    expect(a.rows[0].fingerprint).toBe(b.rows[0].fingerprint);
  });
});

describe("parseSwedbankCsv robustness", () => {
  it("maps columns by name, not position", () => {
    const normal = parseSwedbankCsv(buildCsv([{ date: "2026-01-15", desc: "ICA", amount: "-5.00" }]));
    const cols = HEADER.split(",");
    const values = csvLine({ date: "2026-01-15", desc: "ICA", amount: "-5.00" }, 1).split(",");
    const order = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const reordered = cp1252(
      ["* Transaktioner Period 2026-01-01–2026-01-31", order.map((i) => cols[i]).join(","), order.map((i) => values[i]).join(",")].join("\r\n"),
    );
    expect(parseSwedbankCsv(reordered).rows[0].fingerprint).toBe(normal.rows[0].fingerprint);
  });

  it("accepts files with only income", () => {
    const f = parseSwedbankCsv(
      buildCsv([
        { date: "2026-01-25", desc: "LÖN", amount: "32000.00" },
        { date: "2026-01-26", desc: "Swish mottagen +46705550001", amount: "250.00" },
      ]),
    );
    expect(f.rows.map((r) => r.amount)).toEqual([3200000, 25000]);
  });

  it("differs in fingerprint when any identifying field differs", () => {
    const base = { date: "2026-01-15", desc: "ICA", amount: "-5.00" };
    const fp = (r: typeof base & { account?: string; ref?: string }) => parseSwedbankCsv(buildCsv([r])).rows[0].fingerprint;
    const f0 = fp(base);
    expect(fp({ ...base, amount: "-5.01" })).not.toBe(f0);
    expect(fp({ ...base, date: "2026-01-16" })).not.toBe(f0);
    expect(fp({ ...base, desc: "ICA2" })).not.toBe(f0);
    expect(fp({ ...base, ref: "other" })).not.toBe(f0);
    expect(fp({ ...base, account: "1111111111" })).not.toBe(f0);
    // Whitespace-only differences in the description are the same transaction.
    expect(fp({ ...base, desc: "  ICA  " })).toBe(f0);
    // Same amount written differently is the same transaction.
    expect(fp({ ...base, amount: "-5.0" })).toBe(f0);
  });

  it("rejects the whole file with line numbers when a row is malformed", () => {
    const bytes = buildCsv([
      { date: "2026-01-15", desc: "OK", amount: "-5.00" },
      { date: "2026-13-40", desc: "BAD DATE", amount: "-5.00" },
      { date: "2026-01-15", desc: "BAD AMOUNT", amount: "fem" },
    ]);
    try {
      parseSwedbankCsv(bytes);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ImportParseError);
      const details = (e as ImportParseError).details;
      expect(details).toHaveLength(2);
      expect(details[0]).toMatch(/^Rad 4: ogiltig bokföringsdag/);
      expect(details[1]).toMatch(/^Rad 5: ogiltigt belopp "fem"/);
    }
  });

  it("rejects a row with the wrong number of columns", () => {
    const bytes = cp1252(["* Transaktioner", HEADER, "1,80000,1234561234,Privatkonto,SEK,2026-01-15"].join("\r\n"));
    expect(() => parseSwedbankCsv(bytes)).toThrow(ImportParseError);
  });

  it("rejects files that are not Swedbank exports", () => {
    const bytes = Buffer.from("Datum;Text;Belopp\n2026-01-01;x;1\n");
    expect(looksLikeSwedbankCsv(bytes)).toBe(false);
    expect(() => parseSwedbankCsv(bytes)).toThrow(ImportParseError);
  });
});
