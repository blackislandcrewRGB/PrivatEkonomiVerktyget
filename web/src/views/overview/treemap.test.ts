import { describe, expect, it } from "vitest";
import { treemap } from "./treemap";

const round = (t: { x: number; y: number; w: number; h: number }) => [t.x, t.y, t.w, t.h].map((v) => Math.round(v * 1000) / 1000);

describe("treemap", () => {
  it("one item fills the box", () => {
    expect(treemap([{ value: 5, item: "Mat" }], 560, 250).map(round)).toEqual([[0, 0, 1, 1]]);
  });

  it("the largest takes the full height on the left of a wide box, the rest a column on the right, the next largest on top", () => {
    // As September: Mat, Bil and three small ones.
    const tiles = treemap(
      [
        { value: 396, item: "Mjukvara" },
        { value: 3636, item: "Mat" },
        { value: 167, item: "Nöje" },
        { value: 1296, item: "Bil" },
        { value: 295, item: "Prylar" },
      ],
      560,
      250,
    );
    expect(tiles.map((t) => t.item)).toEqual(["Mat", "Bil", "Mjukvara", "Prylar", "Nöje"]);
    const [mat, bil, ...small] = tiles;
    expect(round(mat)).toEqual([0, 0, Math.round((3636 / 5790) * 1000) / 1000, 1]);
    // The column to the right is taller than wide: Bil across its top.
    expect(bil.x).toBeCloseTo(mat.w);
    expect(bil.y).toBe(0);
    expect(bil.w).toBeCloseTo(1 - mat.w);
    expect(bil.h).toBeCloseTo(1296 / (5790 - 3636));
    // The small ones share what is left under it.
    for (const t of small) expect(t.y + t.h).toBeCloseTo(1);
  });

  it("each tile's area is its share, and together they fill the box without overlapping", () => {
    const values = [50, 30, 10, 6, 4];
    const tiles = treemap(
      values.map((value, i) => ({ value, item: i })),
      400,
      300,
    );
    for (const t of tiles) expect(t.w * t.h).toBeCloseTo(values[t.item] / 100);
    expect(tiles.reduce((s, t) => s + t.w * t.h, 0)).toBeCloseTo(1);
    for (const a of tiles)
      for (const b of tiles) {
        if (a === b) continue;
        const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapW <= 1e-9 || overlapH <= 1e-9).toBe(true);
      }
  });

  it("a tall box is cut across, not down", () => {
    const [first] = treemap(
      [
        { value: 3, item: "a" },
        { value: 1, item: "b" },
      ],
      300,
      500,
    );
    expect(round(first)).toEqual([0, 0, 1, 0.75]);
  });

  it("nothing, a zero or a refund takes no room", () => {
    expect(treemap([], 560, 250)).toEqual([]);
    expect(
      treemap(
        [
          { value: 0, item: "a" },
          { value: -16, item: "b" },
          { value: 10, item: "c" },
        ],
        560,
        250,
      ).map((t) => t.item),
    ).toEqual(["c"]);
  });
});
