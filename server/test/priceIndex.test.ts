import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decimalToInt, PriceError, type Fetcher } from "../src/prices/provider.js";
import { monthFromPx, monthsBetween, SCB_KPI, ScbKpiProvider } from "../src/prices/scb.js";
import { expectedPeriod, plan, syncIndexes } from "../src/prices/sync.js";
import { latestPoint, pointsOf, seriesByKey, seriesStatus } from "../src/prices/series.js";
import { freshDb } from "./helpers.js";

/** The food series the recordings were made for; the reference budget's and Årsinkomst's series are fetched alongside in use, not here. */
const FOOD = { ...SCB_KPI, series: SCB_KPI.series.filter((s) => !s.use) };

/**
 * SCB:s KPI, mot inspelade svar.
 *
 * The fixtures are real answers from SCB's PxWeb API, fetched on 20 September
 * 2026: the table's own metadata, the whole history from 2020, and a short
 * query for the three newest months. Nothing here touches the network.
 *
 * The first test is the one that matters most: every COICOP code in the
 * configuration is held up against SCB's own metadata. A code that is renamed
 * or withdrawn then fails here, in a suite, instead of silently returning no
 * rows in production.
 */

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/prices", name), "utf8");

const METADATA = JSON.parse(fixture("scb-kpi-metadata.json")) as {
  variables: { code: string; values: string[]; valueTexts: string[] }[];
};
const HISTORY = fixture("scb-kpi-history.json");
const LATEST = fixture("scb-kpi-latest.json");

const TODAY = "2026-09-20";

interface Asked {
  url: string;
  method?: string;
  body?: string;
}

type Answer = string | { status: number; body: string; headers?: Record<string, string> };

/** A fetch that answers from a recording, and remembers what was asked. */
function recorded(answer: Answer | ((asked: Asked) => Answer)): Fetcher & { asked: Asked[] } {
  const asked: Asked[] = [];
  const fetcher = (async (url: string, init?: { method?: string; body?: string }) => {
    asked.push({ url, method: init?.method, body: init?.body });
    const a = typeof answer === "function" ? answer(asked.at(-1)!) : answer;
    if (typeof a === "string") return { ok: true, status: 200, text: async () => a };
    return { ok: a.status < 400, status: a.status, headers: { get: (n: string) => a.headers?.[n.toLowerCase()] ?? null }, text: async () => a.body };
  }) as Fetcher & { asked: Asked[] };
  fetcher.asked = asked;
  return fetcher;
}

describe("konfigurationen mot SCB:s egen metadata", () => {
  it("has every COICOP code, and the index it asks for", () => {
    const variable = (code: string) => METADATA.variables.find((v) => v.code === code);
    const groups = variable(SCB_KPI.table.groupVariable);
    const contents = variable(SCB_KPI.table.contentsVariable);
    expect(groups, `variabeln ${SCB_KPI.table.groupVariable} finns inte i tabellen`).toBeDefined();
    expect(variable(SCB_KPI.table.timeVariable)).toBeDefined();
    expect(contents?.values).toContain(SCB_KPI.table.contentsCode);
    // The contents code is the index itself, not the yearly change.
    expect(contents?.valueTexts[contents.values.indexOf(SCB_KPI.table.contentsCode)]).toBe("Index");

    for (const s of SCB_KPI.series) {
      expect(groups?.values, `COICOP ${s.coicop} (${s.key}) finns inte längre hos SCB`).toContain(s.coicop);
    }
  });

  it("names the groups the way SCB does, one key each", () => {
    const keys = SCB_KPI.series.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(SCB_KPI.series.map((s) => s.coicop)).size).toBe(keys.length);
    // My own food spending is compared against 01, food *and* non-alcoholic
    // drinks, because that is what a grocery receipt holds.
    expect(SCB_KPI.series.find((s) => s.key === SCB_KPI.headline)?.coicop).toBe("01");
    // Coffee and tea live under drinks in this classification, not under food.
    expect(SCB_KPI.series.find((s) => s.key === "kpi_coffee")?.coicop).toBe("01.2.2");
    expect(SCB_KPI.series.find((s) => s.key === "kpi_food_total")?.coicop).toBe("01.1");
  });
});

describe("att läsa ett tal", () => {
  it("keeps two decimals as hundredths and refuses what is not a number", () => {
    expect(decimalToInt("124.57", 2)).toBe(12_457);
    expect(decimalToInt("99.70", 2)).toBe(9_970);
    expect(decimalToInt("22,99", 2)).toBe(2_299);
    // What a statistics office writes when a figure is missing. Read as a
    // number it would become a zero, and a zero on a line is a collapse.
    expect(decimalToInt("..", 2)).toBeNull();
    expect(decimalToInt("", 2)).toBeNull();
    expect(decimalToInt(null, 2)).toBeNull();
  });

  it("reads PxWeb's way of writing a month", () => {
    expect(monthFromPx("2026M08")).toBe("2026-08-01");
    expect(monthFromPx("2020M01")).toBe("2020-01-01");
    expect(monthFromPx("2026M13")).toBeNull();
    expect(monthFromPx("augusti")).toBeNull();
  });

  it("counts the months a query has to reach back over", () => {
    expect(monthsBetween("2026-09-01", "2026-09-20")).toBe(1);
    expect(monthsBetween("2020-01-01", "2026-09-20")).toBe(81);
  });
});

describe("SCB", () => {
  it("asks for the configured codes, as a POST, and reads the answer", async () => {
    const fetcher = recorded(HISTORY);
    const scb = new ScbKpiProvider(fetcher, FOOD);
    const result = await scb.fetch("2020-01-01", TODAY);

    const asked = fetcher.asked[0];
    expect(fetcher.asked).toHaveLength(1);
    expect(asked.url).toBe(SCB_KPI.table.url);
    expect(asked.method).toBe("POST");
    const query = JSON.parse(asked.body!);
    expect(query.query[0].selection.values).toEqual(FOOD.series.map((s) => s.coicop));
    expect(query.query[1].selection.values).toEqual(["0000080H"]);
    // The newest month is what we cannot know before asking, so the time
    // selection is 'the N latest' rather than a list of months.
    expect(query.query[2].selection).toEqual({ filter: "top", values: ["82"] });

    expect(result.series).toHaveLength(FOOD.series.length);
    expect(result.publishedAt).toBe("2026-09-14T06:00:00Z");
    const food = result.series.find((s) => s.def.key === "kpi_food_total")!;
    expect(food.def).toMatchObject({ unit: "index", frequency: "monthly", name: "Livsmedel" });
    expect(food.points.at(-1)).toEqual({ date: "2026-08-01", value: 12_329 });
    expect(food.points[0]).toEqual({ date: "2020-01-01", value: 9_804 });
  });

  it("drops the periods asked for as slack but not wanted", async () => {
    const scb = new ScbKpiProvider(recorded(HISTORY), FOOD);
    const result = await scb.fetch("2020-01-01", TODAY);
    // The recording carries 81 months per group, one of them December 2019:
    // asking for a month too many is how the newest one is caught, and the
    // extra is dropped here rather than stored.
    for (const s of result.series) {
      expect(s.points).toHaveLength(80);
      expect(s.points.every((p) => p.date >= "2020-01-01")).toBe(true);
    }
  });

  it("gives every group its own series", async () => {
    const scb = new ScbKpiProvider(recorded(HISTORY), FOOD);
    const { series } = await scb.fetch("2026-06-01", TODAY);
    const value = (key: string) => series.find((s) => s.def.key === key)!.points.at(-1)!.value;
    expect(value("kpi_food_beverages")).toBe(12_457);
    expect(value("kpi_meat")).toBe(13_226);
    // Coffee is the group that ran away: 191,09 against 2020.
    expect(value("kpi_coffee")).toBe(19_109);
    expect(series.find((s) => s.def.key === "kpi_food_total")!.points).toHaveLength(3);
  });

  it("says what changed when the answer no longer looks like the table", async () => {
    const columnsGone = JSON.stringify({ columns: [{ code: "Nagotannat", type: "d" }], data: [{ key: ["01"], values: ["1"] }] });
    await expect(new ScbKpiProvider(recorded(columnsGone), FOOD).fetch("2026-06-01", TODAY)).rejects.toThrow(/kolumnerna för varugrupp och månad/);

    const noRows = JSON.stringify({ columns: JSON.parse(HISTORY).columns, data: [] });
    await expect(new ScbKpiProvider(recorded(noRows), FOOD).fetch("2026-06-01", TODAY)).rejects.toThrow(/utan värden/);

    const otherGroups = JSON.stringify({ columns: JSON.parse(HISTORY).columns, data: [{ key: ["99.9", "2026M08"], values: ["100.00"] }] });
    await expect(new ScbKpiProvider(recorded(otherGroups), FOOD).fetch("2026-06-01", TODAY)).rejects.toThrow(/Koderna kan ha ändrats/);

    await expect(new ScbKpiProvider(recorded("<html>Underhåll</html>"), FOOD).fetch("2026-06-01", TODAY)).rejects.toThrow(/inte är JSON/);
  });

  it("skips a period SCB has no figure for, and keeps the rest", async () => {
    const body = JSON.parse(HISTORY);
    const columns = body.columns;
    const data = [
      { key: ["01.1", "2026M07"], values: [".."] },
      { key: ["01.1", "2026M08"], values: ["123.29"] },
    ];
    const scb = new ScbKpiProvider(recorded(JSON.stringify({ columns, data })), FOOD);
    const food = (await scb.fetch("2026-06-01", TODAY)).series.find((s) => s.def.key === "kpi_food_total")!;
    expect(food.points).toEqual([{ date: "2026-08-01", value: 12_329 }]);
  });

  it("carries a refusal through as one, with what it said", async () => {
    const scb = new ScbKpiProvider(recorded({ status: 429, body: "", headers: { "retry-after": "600" } }), FOOD);
    await expect(scb.fetch("2026-06-01", TODAY)).rejects.toMatchObject({ status: 429, retryAfterMs: 600_000, source: "scb" });
  });
});

describe("när det är värt att fråga", () => {
  it("waits for the day after the publishing date", () => {
    const monthly = { frequency: "monthly" as const, from: "2020-01-01", publishDay: 15 };
    // SCB published August on 14 September; on the 14th we do not yet expect it.
    expect(expectedPeriod(monthly, "2026-09-14")).toBe("2026-07-01");
    expect(expectedPeriod(monthly, "2026-09-15")).toBe("2026-08-01");
    expect(expectedPeriod(monthly, "2026-09-30")).toBe("2026-08-01");
    expect(expectedPeriod(monthly, "2026-01-20")).toBe("2025-12-01");
  });

  it("dates a weekly source by the Monday of a week that has had time to be published", () => {
    const weekly = { frequency: "weekly" as const, from: "2020-01-06", publishLagDays: 7 };
    expect(expectedPeriod(weekly, "2026-09-20")).toBe("2026-09-07");
    expect(expectedPeriod(weekly, "2026-09-21")).toBe("2026-09-14");
  });
});

describe("synken", () => {
  const provider = (answer: Answer | ((a: Asked) => Answer)) => {
    const fetcher = recorded(answer);
    return { scb: new ScbKpiProvider(fetcher, FOOD), fetcher };
  };

  it("takes the whole history the first time", async () => {
    const db = freshDb();
    const { scb, fetcher } = provider(HISTORY);
    const r = await syncIndexes(db, [scb], { today: TODAY, log: () => {} });

    expect(r.sources[0]).toMatchObject({ source: "scb", ok: true, added: 80 * FOOD.series.length, revised: 0 });
    expect(JSON.parse(fetcher.asked[0].body!).query[2].selection.values).toEqual(["82"]);
    const food = seriesByKey(db, "kpi_food_total")!;
    expect(pointsOf(db, food)).toHaveLength(80);
    expect(latestPoint(db, food)?.value).toBe(12_329);
    expect(seriesStatus(db, food).fetchedAt).toBeTruthy();
  });

  it("asks nothing when nothing new can have been published", async () => {
    const db = freshDb();
    await syncIndexes(db, [provider(HISTORY).scb], { today: TODAY, log: () => {} });

    const { scb, fetcher } = provider(HISTORY);
    const again = await syncIndexes(db, [scb], { today: TODAY, log: () => {} });
    expect(fetcher.asked).toEqual([]);
    expect(again.sources[0]).toMatchObject({ ok: true, added: 0, skipped: "inget nytt publicerat sedan 2026-08-01" });
  });

  it("asks again in the next month, from a couple of periods back", async () => {
    const db = freshDb();
    await syncIndexes(db, [provider(HISTORY).scb], { today: TODAY, log: () => {} });

    const { scb, fetcher } = provider(LATEST);
    const r = await syncIndexes(db, [scb], { today: "2026-10-15", log: () => {} });
    // Two periods of overlap, because published statistics are revised:
    // from June, which in October is six months of 'the latest N'.
    expect(JSON.parse(fetcher.asked[0].body!).query[2].selection.values).toEqual(["6"]);
    expect(r.sources[0]).toMatchObject({ ok: true, added: 0, revised: 0, unchanged: 3 * FOOD.series.length });
  });

  it("lets a revision replace the month it belongs to", async () => {
    const db = freshDb();
    await syncIndexes(db, [provider(HISTORY).scb], { today: TODAY, log: () => {} });

    const revised = JSON.parse(LATEST);
    revised.data = revised.data.map((row: { key: string[]; values: string[] }) =>
      row.key[0] === "01.1" && row.key[1] === "2026M08" ? { ...row, values: ["123.40"] } : row,
    );
    const r = await syncIndexes(db, [provider(JSON.stringify(revised)).scb], { today: "2026-10-15", log: () => {} });

    expect(r.sources[0]).toMatchObject({ revised: 1 });
    expect(latestPoint(db, seriesByKey(db, "kpi_food_total")!)?.value).toBe(12_340);
    expect(pointsOf(db, seriesByKey(db, "kpi_food_total")!)).toHaveLength(80);
  });

  it("fetches on demand even when nothing new is expected", async () => {
    const db = freshDb();
    await syncIndexes(db, [provider(HISTORY).scb], { today: TODAY, log: () => {} });
    const { scb, fetcher } = provider(LATEST);
    const r = await syncIndexes(db, [scb], { today: TODAY, force: true, log: () => {} });
    expect(fetcher.asked).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({ ok: true, unchanged: 3 * FOOD.series.length });
  });

  it("pauses the source after a refusal, and asks nothing while it is paused", async () => {
    const db = freshDb();
    const lines: string[] = [];
    const now = new Date("2026-09-20T12:00:00.000Z");
    const r = await syncIndexes(db, [provider({ status: 429, body: "" }).scb], { today: TODAY, now, log: (m) => lines.push(m) });
    expect(r.sources[0]).toMatchObject({ ok: false, added: 0 });
    expect(lines[0]).toMatch(/spärrade \(429\)\. Väntar 30 minuter/);

    const { scb, fetcher } = provider(HISTORY);
    const paused = await syncIndexes(db, [scb], { today: TODAY, now: new Date("2026-09-20T12:20:00.000Z"), force: true, log: () => {} });
    expect(fetcher.asked).toEqual([]);
    expect(paused.sources[0].skipped).toMatch(/pausad efter en spärr — nästa försök om 10 minuter/);

    // Half an hour later the source may be asked again, and an answer pays
    // the whole ladder off.
    const after = await syncIndexes(db, [provider(HISTORY).scb], { today: TODAY, now: new Date("2026-09-20T12:31:00.000Z"), log: () => {} });
    expect(after.sources[0]).toMatchObject({ ok: true, added: 80 * FOOD.series.length });
  });

  it("keeps a source that answered nonsense from stopping the others", async () => {
    const db = freshDb();
    const inner = provider("<html/>").scb;
    // A source of its own, sharing the SCB series so both write the same
    // rows: one of them fails, and the other still gets its history in.
    const broken = { name: "trasig", series: inner.series, schedule: inner.schedule, fetch: (f: string, t: string) => inner.fetch(f, t) };
    const r = await syncIndexes(db, [broken, provider(HISTORY).scb], { today: TODAY, log: () => {} });
    expect(r.sources[0]).toMatchObject({ ok: false });
    expect(r.sources[0].error).toMatch(/inte är JSON/);
    expect(r.sources[1]).toMatchObject({ ok: true, added: 80 * FOOD.series.length });
  });

  it("plans the first fetch from the start of the history", () => {
    const db = freshDb();
    expect(plan(db, provider(HISTORY).scb, TODAY)).toEqual({ from: "2020-01-01", why: "första hämtningen: hela historiken" });
  });
});

describe("inga nätanrop", () => {
  it("throws rather than reaching the internet when no fetcher is handed in", async () => {
    // The default fetcher is the real one; every test above hands in a
    // recording instead. This one only proves the provider takes it.
    const scb = new ScbKpiProvider(async () => {
      throw new PriceError("nätet är avstängt i testerna", "scb");
    }, FOOD);
    await expect(scb.fetch("2026-08-01", TODAY)).rejects.toThrow(/avstängt/);
  });
});
