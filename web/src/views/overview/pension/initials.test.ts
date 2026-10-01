import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("the provider's badge", () => {
  it("has the known ones' letters, a word in capitals, two words' first letters or two letters", () => {
    expect(initials("Pensionsmyndigheten")).toBe("PM");
    expect(initials("Exempelbolaget Pension")).toBe("EP");
    expect(initials("SEB Pension")).toBe("SEB");
    expect(initials("AMF")).toBe("AMF");
    expect(initials("Mitt Bolag")).toBe("MB");
    expect(initials("Movestic")).toBe("Mo");
  });
});
