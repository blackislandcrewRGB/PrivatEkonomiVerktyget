import config from "./scb-kpi.json" with { type: "json" };
import { decimalToInt, PriceError, requestJson, type Fetcher, type IndexFetch, type IndexProvider, type IndexSchedule } from "./provider.js";
import type { PriceSeriesDef } from "./series.js";

/**
 * SCB:s konsumentprisindex, efter COICOP.
 *
 * The open PxWeb API of the statistics database: no key, no account, and the
 * same table anyone can open in a browser. The query goes as a POST body,
 * which is how PxWeb takes it.
 *
 * **The codes are configuration, not code** (`scb-kpi.json`). Table, variable
 * names and COICOP codes were read out of SCB's own metadata rather than
 * guessed, and a test holds every configured code up against a recording of
 * that metadata — so a group SCB renames fails the suite instead of quietly
 * returning nothing in production.
 *
 * Two things about this classification are worth knowing before reading a
 * chart drawn from it: coffee and tea sit under *alkoholfria drycker*
 * (01.2.2, 01.2.3), not under food, and cocoa is not a group of its own at
 * all — it lives inside chocolate (01.1.8.5). So 'kaffe, te och kakao' is two
 * series here, not three, and that is SCB's grouping rather than a choice.
 */

const SOURCE = "scb";

interface SeriesConfig {
  key: string;
  coicop: string;
  name: string;
  /**
   * 'reference': fetched for the reference budget's KPI adjustment; 'income':
   * the whole index, for Lön › Årsinkomst in real terms. Neither is shown in
   * Analys › Priser.
   */
  use?: "reference" | "income";
}

export interface ScbConfig {
  /** The series my own food spending is compared against. */
  headline: string;
  table: {
    url: string;
    groupVariable: string;
    timeVariable: string;
    contentsVariable: string;
    contentsCode: string;
    source: string;
    from: string;
    publishDay: number;
  };
  series: SeriesConfig[];
}

export const SCB_KPI = config as ScbConfig;

/** PxWeb's answer: columns say what the keys mean, and the keys are in that order. */
interface PxResponse {
  columns?: { code?: string; text?: string; type?: string }[];
  data?: { key?: string[]; values?: string[] }[];
  metadata?: { updated?: string }[];
}

/** '2026M08' -> '2026-08-01'. PxWeb's own way of writing a month. */
export function monthFromPx(value: string): string | null {
  const m = /^(\d{4})M(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}-01` : null;
}

/** Months from `from` up to and including the month `today` falls in. */
export function monthsBetween(from: string, today: string): number {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = today.slice(0, 7).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

export class ScbKpiProvider implements IndexProvider {
  readonly name = SOURCE;
  readonly series: PriceSeriesDef[];
  readonly schedule: IndexSchedule;

  constructor(
    private readonly fetcher: Fetcher = globalThis.fetch as unknown as Fetcher,
    private readonly config: ScbConfig = SCB_KPI,
  ) {
    this.series = config.series.map((s) => ({
      key: s.key,
      name: s.name,
      unit: "index" as const,
      source: config.table.source,
      frequency: "monthly" as const,
    }));
    this.schedule = { frequency: "monthly", from: config.table.from, publishDay: config.table.publishDay };
  }

  /**
   * Every configured group, from `from` to the newest month published.
   *
   * The time selection is `top`: the N most recent months, rather than a list
   * of months we believe exist. Asking for a month SCB has not published yet
   * is an error for the whole query, and the newest month is precisely what
   * we do not know before asking. One month of slack is added and anything
   * older than `from` is dropped here.
   */
  async fetch(from: string, today: string): Promise<IndexFetch> {
    const { table } = this.config;
    const top = Math.max(1, monthsBetween(from, today) + 1);
    const body = JSON.stringify({
      query: [
        { code: table.groupVariable, selection: { filter: "item", values: this.config.series.map((s) => s.coicop) } },
        { code: table.contentsVariable, selection: { filter: "item", values: [table.contentsCode] } },
        { code: table.timeVariable, selection: { filter: "top", values: [String(top)] } },
      ],
      response: { format: "json" },
    });

    const res = await requestJson<PxResponse>(this.fetcher, table.url, this.name, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const columns = res.columns ?? [];
    const groupAt = columns.findIndex((c) => c.code === table.groupVariable);
    const timeAt = columns.findIndex((c) => c.code === table.timeVariable || c.type === "t");
    if (groupAt < 0 || timeAt < 0) {
      throw new PriceError(`SCB svarade utan kolumnerna för varugrupp och månad. Tabellen ${table.url.split("/").pop()} kan ha ändrats.`, this.name);
    }
    if (!res.data?.length) throw new PriceError("SCB svarade utan värden. Frågan kan ha blivit fel eller tabellen ha ändrats.", this.name);

    // Group by COICOP code, keeping only months at or after `from` and values
    // that are numbers: a statistics office writes a missing figure as '..',
    // and a missing figure read as zero would be drawn as a collapse.
    const byCode = new Map<string, { date: string; value: number }[]>();
    for (const row of res.data) {
      const code = row.key?.[groupAt];
      const period = row.key?.[timeAt];
      if (!code || !period) continue;
      const date = monthFromPx(period);
      if (!date || date < from) continue;
      const value = decimalToInt(row.values?.[0], 2);
      if (value === null) continue;
      const list = byCode.get(code) ?? [];
      list.push({ date, value });
      byCode.set(code, list);
    }

    const series = this.config.series.map((s, i) => ({ def: this.series[i], points: byCode.get(s.coicop) ?? [] }));
    if (series.every((s) => s.points.length === 0)) {
      throw new PriceError(`SCB svarade, men ingen av varugrupperna ${this.config.series.map((s) => s.coicop).join(", ")} fanns i svaret. Koderna kan ha ändrats.`, this.name);
    }
    return { series, publishedAt: res.metadata?.[0]?.updated ?? null };
  }
}
