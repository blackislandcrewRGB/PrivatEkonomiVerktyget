/**
 * A treemap by slicing off the largest first: the largest item takes its
 * share of the box along the longer side (the full height, on the left, in
 * a wide box), and the rest go into what is left, the same way. With a few
 * items that is one big tile on the left and a column on the right, the
 * next largest on top. Plain TS, no package.
 */
export interface Tile<T> {
  item: T;
  /** Fractions of the box, 0–1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function treemap<T>(items: { value: number; item: T }[], width: number, height: number): Tile<T>[] {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  let rest = list.reduce((s, i) => s + i.value, 0);
  // In the box's own units, so 'the longer side' is the real one.
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  const tiles: Tile<T>[] = [];
  list.forEach((i, n) => {
    const last = n === list.length - 1;
    const share = last ? 1 : i.value / rest;
    if (w >= h) {
      const cut = w * share;
      tiles.push({ item: i.item, x: x / width, y: y / height, w: cut / width, h: h / height });
      x += cut;
      w -= cut;
    } else {
      const cut = h * share;
      tiles.push({ item: i.item, x: x / width, y: y / height, w: w / width, h: cut / height });
      y += cut;
      h -= cut;
    }
    rest -= i.value;
  });
  return tiles;
}
