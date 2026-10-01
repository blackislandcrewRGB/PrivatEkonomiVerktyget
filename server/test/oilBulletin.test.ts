import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cellDate, OIL_BULLETIN, OilBulletinProvider, orePerLitre } from "../src/prices/oilBulletin.js";
import type { BinaryFetcher } from "../src/prices/provider.js";
import { latestPoint, pointOn, pointsOf, seriesByKey } from "../src/prices/series.js";
import { syncIndexes } from "../src/prices/sync.js";
import { freshDb } from "./helpers.js";

/**
 * Dieselns rikssnitt, mot en inspelad prisfil.
 *
 * The fixture is the Commission's own Weekly Oil Bulletin history workbook,
 * downloaded on 20 September 2026 and cut down to the columns and years this
 * reads — the real file with rows and columns removed, not a file built to
 * look like it. Its date column, its shared strings and its number formats
 * are the Commission's, so a change in how the file is shaped would still
 * show up here.
 *
 * Nothing touches the network.
 */

const WORKBOOK = fs.readFileSync(path.join(import.meta.dirname, "fixtures/prices/oil-bulletin-history.xlsx"));

type Answer = Buffer | { status: number; headers?: Record<string, string> };

/** A fetch that answers with a recorded file. */
function recorded(answer: Answer): BinaryFetcher & { asked: string[] } {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url);
    if (Buffer.isBuffer(answer)) return { ok: true, status: 200, arrayBuffer: async () => answer.buffer.slice(answer.byteOffset, answer.byteOffset + answer.byteLength) };
    return {
      ok: false,
      status: answer.status,
      headers: { get: (n: string) => answer.headers?.[n.toLowerCase()] ?? null },
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }) as BinaryFetcher & { asked: string[] };
  fetcher.asked = asked;
  return fetcher;
}

const TODAY = "2026-09-20";

describe("att räkna om ett pris", () => {
  it("turns euro per 1 000 litres into öre per litre", () => {
    // 1 980,94 euro per 1 000 l at 0,088645 euro per krona: 22,35 kr/l.
    expect(orePerLitre(1980.9414059037317, 0.08864462370357237, 1000)).toBe(2235);
    expect(orePerLitre(1904.0494535029563, 0.08958967926894822, 1000)).toBe(2125);
  });

  it("gives nothing rather than a number for a week without figures", () => {
    // A gap is a gap. Zero would be drawn as a week the fuel was free.
    expect(orePerLitre(null, 0.0886, 1000)).toBeNull();
    expect(orePerLitre(1980, null, 1000)).toBeNull();
    expect(orePerLitre(1980, 0, 1000)).toBeNull();
    expect(orePerLitre("1 980", 0.0886, 1000)).toBeNull();
  });

  it("reads the date column however the file writes it", () => {
    expect(cellDate(new Date(Date.UTC(2026, 8, 14)))).toBe("2026-09-14");
    expect(cellDate("2026-09-14")).toBe("2026-09-14");
    expect(cellDate("Notes:")).toBeNull();
    expect(cellDate(null)).toBeNull();
  });
});

describe("Weekly Oil Bulletin", () => {
  it("takes Sweden's diesel, from the sheet and columns it was told", async () => {
    const fetcher = recorded(WORKBOOK);
    const { series, publishedAt } = await new OilBulletinProvider(fetcher).fetch("2020-01-06");

    expect(fetcher.asked).toEqual([OIL_BULLETIN.url]);
    expect(series).toHaveLength(1);
    expect(series[0].def).toMatchObject({ key: "diesel_se_avg", unit: "ore_per_liter", frequency: "weekly" });
    // The file carries no publication stamp, so the newest week is what says
    // how fresh it is.
    expect(publishedAt).toBeNull();

    const points = series[0].points;
    expect(points[0].date).toBe("2020-01-06");
    expect(points.at(-1)).toEqual({ date: "2026-09-14", value: 2235 });
    expect(points.at(-2)).toEqual({ date: "2026-09-07", value: 2125 });
    // Oldest first, one row per Monday, nothing from before the start.
    expect(points.every((p, i) => i === 0 || p.date > points[i - 1].date)).toBe(true);
    expect(new Date(`${points[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("is Sweden's own average, not the EU's and not the petrol", async () => {
    const { series } = await new OilBulletinProvider(recorded(WORKBOOK)).fetch("2026-09-01");
    const latest = series[0].points.at(-1)!;
    // The same row holds the EU average (2 158,74 €/1 000 l) and Swedish
    // petrol; picking a neighbouring column would give a figure that looks
    // every bit as reasonable.
    expect(latest.value).toBe(2235);
    expect(latest.value).not.toBe(2434);
  });

  it("stops and says so when the file is no longer shaped like this", async () => {
    const odd = new OilBulletinProvider(recorded(WORKBOOK), { ...OIL_BULLETIN, priceColumn: "SE_price_with_tax_hydrogen" });
    await expect(odd.fetch("2020-01-06")).rejects.toThrow(/saknar kolumnerna/);

    const wrongSheet = new OilBulletinProvider(recorded(WORKBOOK), { ...OIL_BULLETIN, sheet: "Prices in guilders" });
    await expect(wrongSheet.fetch("2020-01-06")).rejects.toThrow(/gick inte att läsa som Excel/);

    const notASpreadsheet = new OilBulletinProvider(recorded(Buffer.from("<html>Service unavailable</html>")));
    await expect(notASpreadsheet.fetch("2020-01-06")).rejects.toThrow(/gick inte att läsa som Excel/);

    // A file that reads but holds nothing for the years asked about.
    const future = new OilBulletinProvider(recorded(WORKBOOK));
    await expect(future.fetch("2030-01-07")).rejects.toThrow(/inga veckor från 2030-01-07/);
  });

  it("carries a refusal through with what it said", async () => {
    const blocked = new OilBulletinProvider(recorded({ status: 429, headers: { "retry-after": "3600" } }));
    await expect(blocked.fetch("2020-01-06")).rejects.toMatchObject({ status: 429, retryAfterMs: 3_600_000, source: "oil-bulletin" });
  });
});

describe("dieseln i synken", () => {
  const provider = () => new OilBulletinProvider(recorded(WORKBOOK));

  it("takes the history the first time and stores it by week", async () => {
    const db = freshDb();
    const r = await syncIndexes(db, [provider()], { today: TODAY, log: () => {} });
    expect(r.sources[0]).toMatchObject({ source: "oil-bulletin", ok: true, revised: 0 });

    const diesel = seriesByKey(db, "diesel_se_avg")!;
    expect(diesel.unit).toBe("ore_per_liter");
    expect(latestPoint(db, diesel)).toMatchObject({ date: "2026-09-14", value: 2235 });
    // Every stored row is a Monday: the week is dated by its start.
    expect(pointsOf(db, diesel).every((p) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    // 2020 has 50 weeks, not 52: the Commission surveys no prices on Easter
    // Monday or in the week after Christmas. The gaps are the source's, and
    // they are left as gaps.
    const y2020 = pointsOf(db, diesel, { from: "2020-01-01", to: "2020-12-31" });
    expect(y2020).toHaveLength(50);
    expect(y2020.map((p) => p.date)).not.toContain("2020-04-13");
    // A week with no survey is answered by the week before it, never by a nought.
    expect(pointOn(db, diesel, "2020-04-15")?.date).toBe("2020-04-06");
  });

  it("answers what a litre cost in a given week, and nothing before it starts", async () => {
    const db = freshDb();
    await syncIndexes(db, [provider()], { today: TODAY, log: () => {} });
    const diesel = seriesByKey(db, "diesel_se_avg")!;

    // A tank filled on the Thursday belongs to the week that started Monday.
    expect(pointOn(db, diesel, "2026-09-17")?.value).toBe(2235);
    expect(pointOn(db, diesel, "2026-09-13")?.value).toBe(2125);
    expect(pointOn(db, diesel, "2019-12-30")).toBeNull();
  });

  it("asks once a week, not once a day", async () => {
    const db = freshDb();
    await syncIndexes(db, [provider()], { today: TODAY, log: () => {} });

    // Sunday: the week that ended last Sunday is already in.
    const quiet = await syncIndexes(db, [provider()], { today: TODAY, log: () => {} });
    expect(quiet.sources[0]).toMatchObject({ ok: true, added: 0 });
    expect(quiet.sources[0].skipped).toMatch(/inget nytt publicerat sedan 2026-09-14/);

    // Monday: the week that just started is not published yet either.
    const monday = await syncIndexes(db, [provider()], { today: "2026-09-21", log: () => {} });
    expect(monday.sources[0].skipped).toMatch(/inget nytt publicerat/);

    // Friday, four days in: the week of 21 September is expected by now, so
    // the file is fetched — and this recording simply does not have it yet,
    // which is a quiet answer and not a failure.
    const friday = await syncIndexes(db, [provider()], { today: "2026-09-25", log: () => {} });
    expect(friday.sources[0].skipped).toBeUndefined();
    expect(friday.sources[0]).toMatchObject({ ok: true, added: 0, revised: 0 });
  });

  it("lets both sources be quiet and loud on their own", async () => {
    const db = freshDb();
    const refused = new OilBulletinProvider(recorded({ status: 429 }));
    const lines: string[] = [];
    const r = await syncIndexes(db, [refused], { today: TODAY, now: new Date("2026-09-20T09:00:00.000Z"), log: (m) => lines.push(m) });
    expect(r.sources[0].ok).toBe(false);
    expect(lines[0]).toMatch(/oil-bulletin spärrade \(429\)/);

    // While the bulletin is paused, nothing is asked of it — and the pause is
    // its own, so it says nothing about any other source.
    const paused = await syncIndexes(db, [provider()], { today: TODAY, now: new Date("2026-09-20T09:05:00.000Z"), force: true, log: () => {} });
    expect(paused.sources[0].skipped).toMatch(/pausad efter en spärr/);
    expect(seriesByKey(db, "diesel_se_avg")).toBeDefined();
    expect(pointsOf(db, seriesByKey(db, "diesel_se_avg")!)).toEqual([]);
  });
});
