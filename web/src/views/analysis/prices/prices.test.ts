import { describe, expect, it } from "vitest";
import { changeTone } from "./types";
import { fillTone } from "./DieselCard";

describe("Priser's tones", () => {
  it("a group's change: within ±0,2 % grey, down green, up orange", () => {
    expect([changeTone(20), changeTone(-20), changeTone(0), changeTone(null)]).toEqual(["flat", "flat", "flat", "flat"]);
    expect(changeTone(21)).toBe("up");
    expect(changeTone(-21)).toBe("down");
    expect(changeTone(-1232)).toBe("down");
  });

  it("a fill-up's dot by the sign of its difference against the week's average", () => {
    expect([fillTone(-25), fillTone(4), fillTone(0), fillTone(null)]).toEqual(["under", "over", "same", "same"]);
  });
});
