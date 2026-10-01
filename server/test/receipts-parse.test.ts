import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReceiptError, parseReceipt, scrubReceiptText } from "../src/receipts/parse.js";
import { receiptTextFromPdf } from "../src/receipts/pdf.js";
import { WILLYS_RECEIPT, hasPrivateSample, privateSample } from "./helpers.js";

/**
 * The four shops' own receipts, as they come out of Lidl's and ICA's pages and
 * out of Willys's and Rusta's PDFs from Kivra. Every one of them states its
 * total, so the test that matters most is the same for all four: the rows add
 * up to it, to the öre.
 */

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/receipts", name), "utf8");
const kr = (ore: number) => ore / 100;

describe("reading a receipt", () => {
  it("reads Lidl, where the copied text has lost every line break", () => {
    const r = parseReceipt(fixture("lidl.txt"));
    expect(r.store).toBe("lidl");
    expect(r.storeArea).toBe("Exempelstad, Exempelvägen 1");
    expect(kr(r.totalOre!)).toBe(187.72);
    expect(r.balances).toBe(true);
    expect(r.lines).toHaveLength(12);

    // A count stands before its amount: 'Havredryck Barista 14,20 x 2 28,40 B'.
    expect(r.lines.find((l) => l.name === "Havredryck Barista")).toMatchObject({
      quantityMilli: 2000,
      unit: "st",
      unitPriceOre: 1420,
      totalOre: 2840,
    });
    // ...and a weight stands after it, so it has to be carried back one row.
    expect(r.lines.find((l) => l.name === "Morötter lösvikt")).toMatchObject({
      quantityMilli: 310,
      unit: "kg",
      unitPriceOre: 1490,
      totalOre: 462,
    });
    expect(r.lines.map((l) => l.kind).filter((k) => k !== "item")).toEqual(["discount", "deposit", "deposit", "bag"]);
    expect(r.lines.find((l) => l.kind === "discount")).toMatchObject({ name: "Lidl Plus-rabatt", totalOre: -800 });
  });

  it("knows a deposit however the shop spells it", () => {
    // Lidl's own fixture says 'Pant-PET 2kr SE', but the shops also write
    // 'Pantburk 1,00 SE' and Willys puts a plus in front: '+PANT ENG PET'.
    const text = "lidl.se/kontakt SEK A-fil 3% 14,15 B Pantburk 1,00 SE 1,00 B +PANT ENG PET <=1L 1,00 B ------ ATT BETALA 16,15 Kort 16,15";
    const r = parseReceipt(text);
    expect(r.lines.map((l) => [l.name, l.kind])).toEqual([
      ["A-fil 3%", "item"],
      ["Pantburk 1,00 SE", "deposit"],
      ["+PANT ENG PET <=1L", "deposit"],
    ]);
    expect(r.balances).toBe(true);
  });

  it("reads ICA, where the price is on the line under the name", () => {
    const r = parseReceipt(fixture("ica.txt"));
    expect(r.store).toBe("ica");
    expect(r.storeArea).toBe("ICA SUPERMARKET EXEMPELSTAD");
    expect(r.purchaseDate).toBe("2026-09-05");
    expect(r.purchaseTime).toBe("10:20");
    expect(kr(r.totalOre!)).toBe(91.2);
    expect(r.balances).toBe(true);
    // ICA marks a campaign price with an asterisk in the name; it isn't a name.
    expect(r.lines.map((l) => l.name)).toEqual([
      "Bladspenat",
      "Havrebar Choklad",
      "Creme fraiche 32%",
      "Crème Fraic 10kr/st",
      "Kanelbulle 6-p",
      "Vispgrädde 36%",
    ]);
    expect(r.lines.find((l) => l.kind === "discount")).toMatchObject({ totalOre: -575 });
  });

  it("reads Rusta, where the count is a bullet under the price", () => {
    const r = parseReceipt(fixture("rusta.txt"));
    expect(r.store).toBe("rusta");
    expect(r.purchaseDate).toBe("2026-08-15");
    expect(kr(r.totalOre!)).toBe(87.8);
    expect(r.balances).toBe(true);
    expect(r.lines.find((l) => l.name.startsWith("Bomullsrondeller"))).toMatchObject({
      quantityMilli: 3000,
      unit: "st",
      unitPriceOre: 850,
      totalOre: 2550,
    });
    // Both a named discount and an offer that only says what it is.
    expect(r.lines.filter((l) => l.kind === "discount").map((l) => l.name)).toEqual(["3 för 20:-", "Erhållen rabatt"]);
  });

  it.skipIf(!hasPrivateSample(WILLYS_RECEIPT))("reads the Willys PDF, which is the printed receipt", async () => {
    const r = parseReceipt(await receiptTextFromPdf(new Uint8Array(privateSample(WILLYS_RECEIPT).bytes)));
    expect(r.store).toBe("willys");
    expect(r.storeArea).toMatch(/^Willys /);
    expect(r.purchaseDate).toBe("2026-08-22");
    expect(kr(r.totalOre!)).toBe(578.25);
    expect(r.balances).toBe(true);
    expect(r.statedItemCount).toBe(27);
    // The counts add up to what the receipt says it sold: a second check.
    const counted = r.lines.filter((l) => l.kind === "item").reduce((s, l) => s + (l.unit === "st" && l.quantityMilli ? l.quantityMilli / 1000 : 1), 0);
    expect(counted).toBe(r.statedItemCount);

    // Weighed goods have the name on one line and the weight on the next.
    expect(r.lines[0]).toMatchObject({ name: "GODIS LV", quantityMilli: 180, unit: "kg", unitPriceOre: 8990, totalOre: 1618 });
    // A discount is indented under what it belongs to, and may be counted twice.
    expect(r.lines.filter((l) => l.kind === "discount").map((l) => l.totalOre)).toEqual([-712, -600]);
    // Nothing from the card, the terminal or the VAT table became a row.
    expect(r.lines.every((l) => l.totalOre !== 57825)).toBe(true);
  });

  it("says which shops it knows when it doesn't recognise the receipt", () => {
    expect(() => parseReceipt("Kaffe 25,00\nTotalt 25,00")).toThrow(ReceiptError);
    expect(() => parseReceipt("   ")).toThrow(/Klistra in/);
  });

  it("takes card and membership numbers out of the text before it is kept", () => {
    const text = "Willys Plus-nummer: 9752000000001234\nVisa ************9609\n2026-08-22 12:11:47\nKANEL MALEN 85G  23,56";
    const safe = scrubReceiptText(text);
    expect(safe).not.toContain("9752000000001234");
    expect(safe).not.toContain("9609");
    // ...and nothing that says what was bought is lost.
    expect(safe).toContain("2026-08-22 12:11:47");
    expect(safe).toContain("KANEL MALEN 85G  23,56");
  });
});
