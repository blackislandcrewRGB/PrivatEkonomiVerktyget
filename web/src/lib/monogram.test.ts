import { describe, expect, it } from "vitest";
import { cleanName, contrast, iconIdentity, initials, isCode, monogram, normalizeName } from "./monogram";
import { CATEGORY_PALETTE } from "./palette";

describe("monograms", () => {
  it("initials: one word one letter, several words two", () => {
    expect(initials("Nordea")).toBe("N");
    expect(initials("Exempel Gym")).toBe("EG");
    expect(initials("Kjell & Company")).toBe("KC");
    expect(initials("Bank Norwegian AS Stockholm")).toBe("BN");
    expect(initials("åhléns city")).toBe("ÅC");
  });

  it("initials: a leading digit counts, punctuation is skipped", () => {
    expect(initials("7-Eleven")).toBe("7");
    expect(initials("123 Parkering")).toBe("P");
    expect(initials("*Anthropic")).toBe("A");
    expect(initials("  (Spotify)  Premium ")).toBe("SP");
    expect(initials("--- ***")).toBe("?");
    expect(initials("")).toBe("?");
  });

  it("the bank's noise goes, the name stays", () => {
    const cases: [string, string][] = [
      ["EXEMPELBOX INC", "E"],
      ["PARKSTER SWE", "P"],
      ["AMAZON.SE* KP6TV", "A"],
      ["MUSICAPP.COM* SOUNDS RAM", "MS"],
      ["ANTHROPIC* CLAUDE SUB", "AC"],
      ["LIDL271EXEMPELSTOCKSU", "L"],
      ["ICA KVANTUM EXEMPEL", "IK"],
      ["Tele2", "T2"],
      ["Circle K", "CK"],
      ["GOOGLE *Google Play Ap", "G"],
      ["K*ICA KVANTU", "IK"],
      ["Swish Exempelbutik", "E"],
      ["Spotify AB SE", "S"],
      ["PAYPAL *STEAM", "S"],
      ["PAYPAL *SPOTIFY AB", "S"],
      ["SUMUP *CAFE LATTE", "CL"],
      ["KLARNA*", "K"],
    ];
    expect(cases.map(([name]) => [name, initials(name)])).toEqual(cases);
    expect(cleanName("AMAZON.SE* KP6TV")).toBe("AMAZON");
    expect(cleanName("ANTHROPIC* CLAUDE SUB")).toBe("ANTHROPIC CLAUDE SUB");
    expect(cleanName("GOOGLE *Google Play Ap")).toBe("GOOGLE");
    expect(["KP6TV", "P12ABC3456", "ZC62S6E24", "271"].every(isCode)).toBe(true);
    expect(["Tele2", "K", "LIDL271EXEMPELSTOCKSU", "7-Eleven", "RAM"].some(isCode)).toBe(false);
    // Nothing left after cleaning: the name as it was.
    expect(cleanName("AB INC")).toBe("AB INC");
    expect(initials("AB INC")).toBe("AI");
  });

  it("the row's own name wins; a Swish number is its contact, or a person without initials", () => {
    expect(iconIdentity({ label: "CLAUDE Abonnemang", text: "ANTHROPIC* CLAUDE SUB" })).toEqual({ kind: "monogram", name: "CLAUDE Abonnemang" });
    expect(iconIdentity({ text: "Swish skickad +46701234567", contact: "Mio" })).toEqual({ kind: "monogram", name: "Mio" });
    expect(iconIdentity({ text: "Swish mottagen +46701234567", contact: "Mio" })).toEqual(iconIdentity({ text: "+46701234567", contact: "Mio" }));
    expect(iconIdentity({ text: "Swish skickad +46701234567" })).toEqual({ kind: "person" });
    expect(iconIdentity({ text: "+46701234567" })).toEqual({ kind: "person" });
    expect(iconIdentity({ text: "Swish mottagen" })).toEqual({ kind: "person" });
    expect(iconIdentity({ text: "K*Swish skickad" })).toEqual({ kind: "person" });
    expect(iconIdentity({ text: "Swish Exempelbutik" })).toEqual({ kind: "monogram", name: "Swish Exempelbutik" });
    expect(iconIdentity({ text: "Willys" })).toEqual({ kind: "monogram", name: "Willys" });
  });

  it("the same name always gives the same colour, whatever the case, accents or spacing", () => {
    expect(normalizeName("  WILLYS   Umeå ")).toBe("willys umea");
    expect(monogram("Willys Umeå").background).toBe(monogram("WILLYS  umea").background);
    expect(monogram("Spotify")).toEqual(monogram("Spotify"));
    // The noise doesn't change the colour.
    expect(monogram("EXEMPELBOX INC").background).toBe(monogram("Exempelbox").background);
    expect(monogram("K*ICA KVANTU").background).toBe(monogram("ICA KVANTU").background);
    expect(CATEGORY_PALETTE).toContain(monogram("Spotify").background);
    // Different names spread over the palette.
    const names = ["Spotify", "Netflix", "Willys", "ICA", "Coop", "Lidl", "Circle K", "Tele2", "IKEA", "Steam", "Plex", "Apple", "Amazon", "Google", "Parkster", "Rusta"];
    expect(new Set(names.map((n) => monogram(n).background)).size).toBeGreaterThan(6);
  });

  it("the text has at least 4,5:1 contrast on every palette colour", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const m = monogram(`Butik ${[...i.toString(26)].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join("")}`);
      seen.add(m.background);
      expect(contrast(m.background, m.color)).toBeGreaterThanOrEqual(4.5);
    }
    expect(seen.size).toBe(CATEGORY_PALETTE.length);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });
});
