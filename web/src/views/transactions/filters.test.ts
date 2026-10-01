import { describe, expect, it } from "vitest";
import {
  activeCount,
  apiQuery,
  defaultFilters,
  extendOlder,
  fromLegacy,
  parseFilters,
  periodLabel,
  serializeFilters,
  stepPeriod,
} from "./filters";

const now = new Date(2026, 8, 18); // 18 September 2026

describe("filters in the URL", () => {
  it("a link to 'september, Norwegian, Mat' opens with exactly those filters", () => {
    const f = parseFilters("?period=2026-09&account=4&category=12", now);
    expect(f).toMatchObject({ period: "2026-09", account: "4", categories: [12], q: "" });
    expect(apiQuery(f, false)).toBe("from=2026-09-01&to=2026-09-30&accountId=4&categoryIds=12");
  });

  it("round-trips every filter, and the defaults are an empty query", () => {
    expect(serializeFilters(defaultFilters(now), now)).toBe("");
    const f = {
      ...defaultFilters(now),
      period: "range",
      from: "2026-08-01",
      to: "2026-09-30",
      account: "4",
      categories: [12, 30],
      source: "norwegian" as const,
      owner: "shared" as const,
      transfers: true,
      privateOnly: true,
      recurring: true,
      receipt: true,
      sort: "oldest" as const,
      min: "100",
      max: "2 000,50",
      q: "ica maxi",
    };
    const s = serializeFilters(f, now);
    expect(s).toContain("category=12,30");
    expect(parseFilters(s, now)).toEqual(f);
  });

  it("ignores malformed values", () => {
    const f = parseFilters("?period=nonsense&account=x&category=a,5&source=bank&owner=all&min=abc", now);
    expect(f).toEqual({ ...defaultFilters(now), categories: [5] });
  });

  it("uncategorised with Okänt, and the Norwegian invoice period", () => {
    const f = parseFilters("?period=inv:2026-09&uncategorized=1&unknown=1", now);
    expect(apiQuery(f, true)).toBe("invoice=2026-09&categoryId=none&includeUnknown=1&showPrivate=1");
    expect(periodLabel(f)).toBe("Norwegian-faktura sep 2026");
  });

  it("recurring, with a receipt and oldest first, in the URL and for the API", () => {
    const f = parseFilters("?period=all&recurring=1&receipt=1&sort=aldst", now);
    expect(f).toMatchObject({ recurring: true, receipt: true, sort: "oldest" });
    expect(apiQuery(f, false)).toBe("recurring=1&receipt=1&order=asc");
    expect(serializeFilters(f, now)).toBe("?period=all&recurring=1&receipt=1&sort=aldst");
    // The order is not a filter: 'Rensa' has nothing to clear for it.
    expect(activeCount({ ...defaultFilters(now), sort: "oldest" })).toBe(0);
    expect(activeCount({ ...defaultFilters(now), recurring: true, receipt: true })).toBe(2);
  });

  it("amounts are kronor in the URL and öre for the API", () => {
    const f = parseFilters("?period=all&min=1%20234,50&max=5000", now);
    expect(apiQuery(f, false)).toBe("amountMin=123450&amountMax=500000");
  });
});

describe("periods", () => {
  it("← → step a month, from a range the month of its end", () => {
    const sep = parseFilters("", now);
    expect(stepPeriod(sep, -1, now).period).toBe("2026-08");
    expect(stepPeriod(sep, 1, now).period).toBe("2026-10");
    expect(stepPeriod(parseFilters("?from=2026-01-01&to=2026-03-31", now), 1, now).period).toBe("2026-04");
    expect(stepPeriod(parseFilters("?period=all", now), -1, now).period).toBe("2026-09");
  });

  it("'Visa äldre' adds the month before", () => {
    const older = extendOlder(parseFilters("", now))!;
    expect(older).toMatchObject({ period: "range", from: "2026-08-01", to: "2026-09-30" });
    expect(extendOlder(older)).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(extendOlder(parseFilters("?period=all", now))).toBeNull();
    expect(periodLabel(older)).toBe("1/8 – 30/9 2026");
  });

  it("reads the presets Översikt and Analys send", () => {
    expect(fromLegacy({ period: "this", categoryId: "none" }, now)).toMatchObject({ period: "2026-09", uncategorized: true });
    expect(fromLegacy({ period: "custom", from: "2026-01-01", to: "2026-06-30", q: "ICA" }, now)).toMatchObject({
      period: "range",
      from: "2026-01-01",
      q: "ICA",
    });
    expect(fromLegacy({ categoryId: "7", shared: "shared" }, now)).toMatchObject({ period: "all", categories: [7], owner: "shared" });
  });
});
