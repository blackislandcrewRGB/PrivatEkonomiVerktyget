/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const mix = (hex: string, t: number) =>
  `#${[1, 3, 5]
    .map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16);
      return Math.round(v + (255 - v) * t)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;

/**
 * A category's colour as it shows on the card: as it is in the light theme;
 * in the dark one a dark colour (indigo, wine, deep green) is lifted towards
 * white until it stands out from the dark card (luminance at least 0,12).
 * The same category keeps its hue in both.
 */
export function chartColor(hex: string, theme: "light" | "dark"): string {
  if (theme === "light" || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  for (let t = 0; t <= 0.7; t += 0.05) {
    const c = mix(hex, t);
    if (luminance(c) >= 0.12) return c;
  }
  return mix(hex, 0.7);
}
