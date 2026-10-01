import { describe, expect, it } from "vitest";
import { changeTone, shareText, shareTone, signed } from "./tones";

describe("Mat's tones", () => {
  it("the share by the figure shown: under 20 % green, from 20 % grey, from 30 % orange, over 40 % red", () => {
    const at = (share: number) => [shareText(share), shareTone(share)];
    expect(at(0.19949)).toEqual(["19,9 %", "low"]);
    // 19,96 % shows as 20,0 % and is toned as it reads.
    expect(at(0.1996)).toEqual(["20,0 %", "normal"]);
    expect(at(0.2994)).toEqual(["29,9 %", "normal"]);
    expect(at(0.3)).toEqual(["30,0 %", "high"]);
    expect(at(0.4)).toEqual(["40,0 %", "high"]);
    expect(at(0.40049)).toEqual(["40,0 %", "high"]);
    expect(at(0.4006)).toEqual(["40,1 %", "very-high"]);
  });

  it("a change: up orange, down green, within the threshold grey, both ends included", () => {
    expect(changeTone(0.6, 0.5)).toBe("up");
    expect(changeTone(0.5, 0.5)).toBe("flat");
    expect(changeTone(-0.5, 0.5)).toBe("flat");
    expect(changeTone(-0.6, 0.5)).toBe("down");
    expect([signed(2.84), signed(-2.84), signed(0.04)]).toEqual(["+2,8", "−2,8", "0,0"]);
  });
});
