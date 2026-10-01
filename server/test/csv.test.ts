import { describe, expect, it } from "vitest";
import { kronor, percent, toCsv } from "../../web/src/csv.js";

describe("CSV export", () => {
  it("uses semicolons and decimal commas, and quotes cells that need it", () => {
    expect(kronor(123456)).toBe("1234,56");
    expect(kronor(-5)).toBe("-0,05");
    expect(kronor(null)).toBe("");
    expect(percent(0.2534)).toBe("25,3");
    expect(toCsv(["Handlare", "Summa"], [["ICA; Nära", kronor(12345)], ['Säg "hej"', 1.5], [null, 0]])).toBe(
      'Handlare;Summa\r\n"ICA; Nära";123,45\r\n"Säg ""hej""";1,5\r\n;0',
    );
  });
});
