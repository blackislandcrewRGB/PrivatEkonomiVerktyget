/**
 * The deduction's threshold bar. Its whole width is the amount reckoned
 * (shifts × mil × rate); past the threshold, the part up to it is grey (it
 * gives nothing) and the rest green (deductible), with a marker between.
 * Not past it: all grey, and how far there is to go.
 */
export function thresholdBar(gross: number, threshold: number): { reached: boolean; grey: number; green: number; marker: number | null; toGo: number } {
  if (gross > threshold && gross > 0) {
    const grey = threshold / gross;
    return { reached: true, grey, green: 1 - grey, marker: grey, toGo: 0 };
  }
  return { reached: false, grey: gross > 0 ? 1 : 0, green: 0, marker: null, toGo: Math.max(0, threshold - gross) };
}
